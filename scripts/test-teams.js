// Agent teams engine (electron/teams.js) with a fake agent turn: planning, dependencies, asking a teammate,
// review rounds, budget pause and resume, user pause, failures, restart and follow-up rounds.
const assert = require('assert');
const { createTeams, cleanDef } = require('../electron/teams');

const ROSTER = [
  { name: 'Athena', role: 'Researcher', description: 'Finds facts', tools: ['web', 'read'], body: 'research' },
  { name: 'Calliope', role: 'Writer', description: 'Writes', tools: ['read', 'write'], body: 'write' },
  { name: 'Themis', role: 'Reviewer', description: 'Checks', tools: ['read'], body: 'review' }
];
const tool = (o, name) => o.extraTools.find((t) => t.name === name);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function make(runTurn, initial) {
  let saved = initial || null;
  const teams = createTeams({ load: () => saved, save: (d) => { saved = JSON.parse(JSON.stringify(d)); }, emit: () => {}, roster: () => ROSTER, runTurn });
  return { teams, saved: () => saved };
}
const def = (extra) => ({ name: 'Launch', goal: 'Ship the notes', members: [{ name: 'Athena' }, { name: 'Calliope' }, { name: 'Themis' }], ...extra });

(async () => {
  // definitions are checked
  assert.throws(() => cleanDef({ name: '', goal: 'x', members: [{ name: 'Athena' }] }, ROSTER), /name/);
  assert.throws(() => cleanDef({ name: 'a', goal: '', members: [{ name: 'Athena' }] }, ROSTER), /goal/);
  assert.throws(() => cleanDef({ name: 'a', goal: 'g', members: [{ name: 'Nobody' }] }, ROSTER), /at least one/);
  const c = cleanDef({ name: 'a', goal: 'g', members: [{ name: 'athena' }, { name: 'Athena' }], mode: 'weird', budgetUsd: -4, minutes: 9999 }, ROSTER);
  assert.deepStrictEqual(c.members, [{ name: 'Athena', model: '' }]);
  assert.strictEqual(c.mode, 'lead'); assert.strictEqual(c.budgetUsd, 0); assert.strictEqual(c.minutes, 600);
  console.log('teams: definitions ok');

  // a full run: plan -> Athena -> Calliope (asks Athena, depends on her) -> Themis sends it back once -> summary
  {
    const order = []; let calliopePrompt = '', reviews = 0;
    const { teams, saved } = make(async (o) => {
      const who = o.agent.name;
      o.onUsage({ prompt: 100, completion: 20, usd: 0.01 });
      if (who === 'Artemis' && /Call team_plan/.test(o.prompt)) {
        assert.match(tool(o, 'team_plan').run({ tasks: [{ title: 'Find the facts', assignee: 'Athena' }, { title: 'Write the notes', assignee: 'Calliope', after: [1] }, { title: 'Review', assignee: 'Themis' }] }), /2 tasks/);
        return 'Athena first, then Calliope.';
      }
      if (who === 'Artemis') return 'Final: notes are in notes.md';
      if (who === 'Themis') {
        const ofCalliope = /Calliope's work/.test(o.prompt);
        reviews++;
        tool(o, 'team_review').run(ofCalliope && !/draft v2/.test(o.prompt) ? { verdict: 'changes', note: 'Source the 40% claim' } : { verdict: 'approve', note: 'Good' });
        return '';
      }
      if (/Your teammate Calliope asks/.test(o.prompt)) return 'Startup went from 2.0 s to 1.2 s.';
      order.push(who);
      if (who === 'Athena') { tool(o, 'team_post').run({ text: 'Found 24 user-facing commits' }); tool(o, 'team_done').run({ result: 'facts: 24 commits' }); return 'done'; }
      if (who === 'Calliope') {
        calliopePrompt = o.prompt;
        if (/Fix this/.test(o.prompt)) { assert.match(o.prompt, /Source the 40% claim/); tool(o, 'team_done').run({ result: 'draft v2' }); return ''; }
        assert.match(await tool(o, 'team_ask').run({ to: 'Athena', question: 'How much faster is startup?' }), /1\.2 s/);
        assert.match(await tool(o, 'team_ask').run({ to: 'Nobody', question: '?' }), /No teammate/);
        tool(o, 'team_done').run({ result: 'draft v1' });
        return '';
      }
      throw new Error('unexpected ' + who);
    });
    const t = teams.save(def());
    teams.start(t.id);
    const end = await teams.idle(t.id);
    assert.strictEqual(end.run.status, 'done', JSON.stringify(end.run.messages.filter((m) => m.kind === 'error')));
    assert.deepStrictEqual(order, ['Athena', 'Calliope', 'Calliope'], 'Calliope waits for Athena, then fixes once');
    assert.match(calliopePrompt, /facts: 24 commits/, 'the dependency result is in the prompt');
    assert.strictEqual(end.run.tasks.length, 2, 'a review task for the reviewer is not created');
    assert.ok(end.run.tasks.every((k) => k.status === 'done'));
    assert.strictEqual(end.run.tasks[1].result, 'draft v2');
    assert.strictEqual(reviews, 3);
    const kinds = end.run.messages.map((m) => m.kind);
    for (const k of ['plan', 'review', 'summary']) assert.ok(kinds.includes(k), k);
    assert.ok(end.run.messages.some((m) => m.from === 'Calliope' && m.to === 'Athena'), 'the question is in the room');
    assert.ok(end.run.messages.some((m) => m.from === 'Athena' && m.to === 'Calliope' && /1\.2 s/.test(m.text)), 'and the answer');
    assert.ok(end.run.messages.some((m) => m.kind === 'review' && m.verdict === 'changes'));
    assert.ok(end.run.spent.usd > 0.05 && end.run.spent.tokens > 0);
    assert.deepStrictEqual(end.run.live, {});
    teams.flush();
    assert.strictEqual(saved().teams[0].run.status, 'done');
    console.log('teams: full run ok');

    // a question after the end starts a follow-up round
    const { teams: t2 } = { teams };
    let followed = false;
    // swap behaviour: the next plan call adds one task for Athena
    const tm = t2.get(t.id);
    tm.members = tm.members.filter((m) => m.name !== 'Themis'); // keep it short: no review this round
    t2.save({ ...tm, members: tm.members });
    await t2.say(t.id, 'Answer only: which file?');
    const after = await t2.idle(t.id);
    assert.strictEqual(after.run.status, 'done');
    assert.ok(after.run.messages.some((m) => m.from === 'you' && /which file/.test(m.text)));
    followed = true;
    assert.ok(followed);
    console.log('teams: follow-up ok');
  }

  // "@Name" in the room: a paused team picks up, and that member answers first (no review, no new summary after the end)
  {
    const seen = [];
    let pauseNow = true;
    const { teams } = make(async (o) => {
      const who = o.agent.name;
      if (who === 'Artemis' && /Call team_plan/.test(o.prompt)) { tool(o, 'team_plan').run({ tasks: [{ title: 'Write it', assignee: 'Calliope' }] }); return 'ok'; }
      if (who === 'Artemis') return 'Summary';
      if (who === 'Themis') { tool(o, 'team_review').run({ verdict: 'approve', note: 'ok' }); return ''; }
      seen.push(`${who}: ${/user wrote to you/.test(o.prompt) ? 'answer' : 'task'}`);
      if (who === 'Calliope' && pauseNow) { pauseNow = false; o.onUsage({ prompt: 400000, completion: 0, usd: 0 }); }
      if (/user wrote to you/.test(o.prompt)) assert.match(o.prompt, /post it on Notes/);
      tool(o, 'team_done').run({ result: 'did it' });
      return '';
    });
    const t = teams.save(def({ budgetTokens: 300000 }));
    teams.start(t.id);
    let end = await teams.idle(t.id);
    assert.strictEqual(end.run.status, 'paused');
    await teams.say(t.id, '@Athena post it on Notes please');
    end = await teams.idle(t.id);
    assert.strictEqual(end.run.status, 'done', JSON.stringify(end.run.messages.slice(-3)));
    assert.strictEqual(seen[1], 'Athena: answer', seen.join(' | '));
    const direct = end.run.tasks.find((k) => k.direct);
    assert.ok(direct && direct.status === 'done' && direct.assignee === 'Athena');
    const summaries = end.run.messages.filter((m) => m.kind === 'summary').length;
    await teams.say(t.id, '@Calliope one more thing: post it on Notes');
    end = await teams.idle(t.id);
    assert.strictEqual(end.run.status, 'done');
    assert.strictEqual(end.run.messages.filter((m) => m.kind === 'summary').length, summaries, 'answering after the end writes no new summary');
    assert.strictEqual(seen[seen.length - 1], 'Calliope: answer');
    console.log('teams: @mention answers ok');
  }

  // a team that works for a project: its folder, its instructions in every prompt, its own agents in the roster
  {
    const got = []; const roots = [];
    let saved = null;
    const PROJ_AGENT = { name: 'Pip', role: 'Publisher', description: 'Posts', tools: ['browser'], body: 'post' };
    const teams = createTeams({
      load: () => saved, save: (d) => { saved = d; }, emit: () => {},
      roster: (root) => { roots.push(root); return root === '/p/sticky' ? [...ROSTER, PROJ_AGENT] : ROSTER; },
      project: (id) => (id === 'p1' ? { id: 'p1', name: 'Sticky', folder: '/p/sticky', instructions: 'Voice: we, the Artemis team.' } : null),
      runTurn: async (o) => {
        got.push({ who: o.agent.name, folder: o.folder, prompt: o.prompt });
        if (o.agent.name === 'Artemis' && /Call team_plan/.test(o.prompt)) { tool(o, 'team_plan').run({ tasks: [{ title: 'Post', assignee: 'Pip' }] }); return 'ok'; }
        if (o.agent.name === 'Artemis') return 'Summary';
        tool(o, 'team_done').run({ result: 'posted' }); return '';
      }
    });
    assert.throws(() => teams.save({ name: 'S', goal: 'g', members: [{ name: 'Pip' }] }), /at least one/, 'a project agent needs the project');
    const t = teams.save({ name: 'S', goal: 'g', members: [{ name: 'Pip' }], projectId: 'p1' });
    teams.start(t.id);
    const end = await teams.idle(t.id);
    assert.strictEqual(end.run.status, 'done', JSON.stringify(end.run.messages.slice(-2)));
    assert.ok(got.every((x) => x.folder === '/p/sticky'), 'turns run in the project folder');
    assert.ok(got.filter((x) => !/All tasks are done/.test(x.prompt)).every((x) => /project "Sticky"/.test(x.prompt) && /Voice: we, the Artemis team\./.test(x.prompt)), 'project instructions in every prompt');
    const own = teams.save({ ...teams.get(t.id), folder: '/elsewhere' });
    assert.strictEqual(own.projectId, 'p1');
    console.log('teams: project link ok');
  }

  // a member the agent loop stopped (a tool kept failing) has not done its task, whatever its last words were
  {
    let tries = 0;
    const { teams } = make(async (o) => {
      if (o.agent.name === 'Artemis' && /Call team_plan/.test(o.prompt)) { tool(o, 'team_plan').run({ tasks: [{ title: 'Read strategy.md', assignee: 'Athena' }] }); return 'ok'; }
      if (o.agent.name === 'Artemis') return 'Summary';
      tries++;
      assert.match(o.prompt, /does not exist yet is not an error/);
      o.onStep({ type: 'notice', text: 'Stopped: read_file failed 3 times in a row.' });
      return 'I stopped: the read_file tool failed 3 times in a row.';
    });
    const t = teams.save(def({ members: [{ name: 'Athena' }] }));
    teams.start(t.id);
    const end = await teams.idle(t.id);
    assert.notStrictEqual(end.run.tasks[0].status, 'done');
    assert.ok(end.run.messages.some((m) => m.kind === 'error' && /did not finish: read_file failed 3 times/.test(m.text)));
    assert.ok(tries >= 1);
    console.log('teams: stopped members are not done ok');
  }

  // the reviewer is the team's choice, whatever the member's role is called
  {
    const reviewed = [];
    const { teams } = make(async (o) => {
      if (o.agent.name === 'Artemis' && /Call team_plan/.test(o.prompt)) { tool(o, 'team_plan').run({ tasks: [{ title: 'Write it', assignee: 'Calliope' }] }); return 'ok'; }
      if (o.agent.name === 'Artemis') return 'Summary';
      if (/reviewing/.test(o.prompt)) { reviewed.push(o.agent.name); tool(o, 'team_review').run({ verdict: reviewed.length === 1 ? 'changes' : 'approve', note: 'Add the intro' }); return ''; }
      tool(o, 'team_done').run({ result: /Add the intro/.test(o.prompt) ? 'v2' : 'v1' }); return '';
    });
    const t = teams.save(def({ members: [{ name: 'Athena' }, { name: 'Calliope' }], reviewer: 'athena' }));
    assert.strictEqual(t.reviewer, 'Athena', 'a member, by name');
    teams.start(t.id);
    const end = await teams.idle(t.id);
    assert.deepStrictEqual(reviewed, ['Athena', 'Athena'], 'Athena (a Researcher) reviews because the team says so');
    assert.strictEqual(end.run.tasks[0].result, 'v2', 'sent-back work is redone');
    assert.strictEqual(teams.save({ ...t, reviewer: '' }).reviewer, '', 'nobody');
    assert.strictEqual(teams.save({ ...t, reviewer: 'Nobody-here' }).reviewer, '', 'not a member: nobody');
    console.log('teams: reviewer setting ok');
  }

  // budget: the team pauses at the cap; resume gives it the same amount again
  {
    let calls = 0;
    const { teams } = make(async (o) => {
      calls++;
      if (o.agent.name === 'Artemis' && /Call team_plan/.test(o.prompt)) { tool(o, 'team_plan').run({ tasks: [{ title: 'A', assignee: 'Athena' }, { title: 'B', assignee: 'Athena', after: [1] }] }); o.onUsage({ usd: 0.6 }); return 'plan'; }
      o.onUsage({ usd: 0.6 });
      if (o.extraTools.length) tool(o, 'team_done').run({ result: 'ok' });
      return 'sum';
    });
    const t = teams.save(def({ members: [{ name: 'Athena' }], budgetUsd: 1 }));
    teams.start(t.id);
    let end = await teams.idle(t.id);
    assert.strictEqual(end.run.status, 'paused'); assert.strictEqual(end.run.reason, 'budget');
    assert.ok(end.run.messages.some((m) => m.kind === 'status' && /Budget reached/.test(m.text)));
    teams.resume(t.id);
    end = await teams.idle(t.id);
    assert.strictEqual(end.run.extraUsd, 1);
    assert.ok(['paused', 'done'].includes(end.run.status));
    assert.ok(calls >= 3);
    console.log('teams: budget ok');
  }

  // live steps: tool calls and text stream into run.live while the turn runs, then stay on the task as its log
  {
    let seenLive = null;
    const { teams } = make(async (o) => {
      if (o.agent.name === 'Artemis' && /Call team_plan/.test(o.prompt)) { tool(o, 'team_plan').run({ tasks: [{ title: 'Look it up', assignee: 'Athena' }] }); return 'p'; }
      if (o.agent.name === 'Artemis') return 's';
      o.onStep({ type: 'thinking' });
      o.onStep({ type: 'tool', id: 'c1', name: 'web_search', args: { query: 'artemis 1.5', secret: 'x'.repeat(50) } });
      o.onStep({ type: 'tool:done', id: 'c1', ok: true });
      o.onStep({ type: 'tool', id: 'c2', name: 'web_fetch', args: { url: 'https://example.com' } });
      o.onStep({ type: 'tool:done', id: 'c2', ok: false });
      o.onStep({ type: 'tool', id: 'c4', name: 'write_file', args: { path: 'a.md' } });
      o.onStep({ type: 'tool:done', id: 'c4', ok: true, denied: true });
      o.onStep({ type: 'tool', id: 'c3', name: 'team_done', args: { result: 'r' } }); // already shown in the room: not a step
      o.onStep({ type: 'text', text: 'Writing it up' });
      o.onStep({ type: 'notice', text: 'Reasoning is off for this task.' });
      o.onStep({ type: 'notice', text: 'Reasoning is off for this task.' });
      seenLive = JSON.parse(JSON.stringify(Object.values(teamsRef.get(tid).run.live)));
      tool(o, 'team_done').run({ result: 'found' });
      return '';
    });
    const teamsRef = teams;
    const t = teams.save(def({ members: [{ name: 'Athena' }] }));
    const tid = t.id;
    teams.start(t.id);
    const end = await teams.idle(t.id);
    assert.strictEqual(seenLive.length, 1);
    assert.strictEqual(seenLive[0].task, end.run.tasks[0].id);
    assert.deepStrictEqual(seenLive[0].steps.map((x) => [x.name, x.status]), [['web_search', 'done'], ['web_fetch', 'error'], ['write_file', 'denied']]);
    assert.deepStrictEqual(seenLive[0].steps[0].args, { query: 'artemis 1.5' }, 'only the short, known arguments are kept');
    assert.strictEqual(seenLive[0].text, 'Writing it up'); assert.strictEqual(seenLive[0].thinking, false);
    assert.deepStrictEqual(end.run.tasks[0].log.map((x) => [x.name, x.by]), [['web_search', 'Athena'], ['web_fetch', 'Athena'], ['write_file', 'Athena']]);
    const res = end.run.messages.find((m) => m.kind === 'result');
    assert.deepStrictEqual(res.steps.map((x) => x.status), ['done', 'error', 'denied'], 'the result post carries the steps of that attempt');
    assert.deepStrictEqual(end.run.live, {});
    assert.strictEqual(end.run.messages.filter((m) => m.kind === 'status' && /Reasoning is off/.test(m.text)).length, 1, 'a notice shows once per run');
    console.log('teams: live steps ok');
  }

  // found with a real model: the lead plans only (no tools of its own), keeps its plan note short, and everyone knows the date
  {
    const seen = [];
    const { teams } = make(async (o) => {
      seen.push({ who: o.agent.name, tools: o.agent.tools, prompt: o.prompt });
      if (o.agent.name === 'Artemis' && /Call team_plan/.test(o.prompt)) { tool(o, 'team_plan').run({ tasks: [{ title: 'X', assignee: 'Athena' }] }); return 'Here is my own long answer. '.repeat(40); }
      if (o.agent.name === 'Artemis') return 'summary';
      tool(o, 'team_done').run({ result: 'r' });
      return '';
    });
    const t = teams.save(def({ members: [{ name: 'Athena' }] }));
    teams.start(t.id);
    const end = await teams.idle(t.id);
    assert.ok(seen.filter((x) => x.who === 'Artemis').every((x) => x.tools.length === 0), 'the lead has no file or web tools');
    assert.ok(seen.every((x) => /Today is \w{3} \w{3} \d{2} \d{4}\./.test(x.prompt)), 'every prompt carries the date');
    assert.ok(end.run.messages.find((m) => m.kind === 'plan').text.length <= 401, 'the plan note is clipped');
    console.log('teams: lead and prompts ok');
  }

  // pause stops the running turn and puts its task back; stop ends the run
  {
    const { teams } = make((o) => new Promise((resolve, reject) => {
      if (o.agent.name === 'Artemis') { tool(o, 'team_plan').run({ tasks: [{ title: 'Long job', assignee: 'Athena' }] }); return resolve('plan'); }
      o.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
    }));
    const t = teams.save(def({ members: [{ name: 'Athena' }] }));
    teams.start(t.id);
    await wait(30);
    assert.strictEqual(teams.get(t.id).run.tasks[0].status, 'doing');
    const lv = Object.values(teams.get(t.id).run.live);
    assert.strictEqual(lv.length, 1); assert.strictEqual(lv[0].name, 'Athena'); assert.strictEqual(lv[0].what, 'Long job');
    teams.pause(t.id);
    const p = await teams.idle(t.id);
    assert.strictEqual(p.run.status, 'paused');
    assert.strictEqual(p.run.tasks[0].status, 'todo');
    assert.deepStrictEqual(p.run.live, {});
    teams.stop(t.id);
    assert.strictEqual(teams.get(t.id).run.status, 'stopped');
    console.log('teams: pause and stop ok');
  }

  // a task that keeps failing fails the run instead of looping
  {
    const { teams } = make(async (o) => {
      if (o.agent.name === 'Artemis') { tool(o, 'team_plan').run({ tasks: [{ title: 'X', assignee: 'Athena' }] }); return 'plan'; }
      throw new Error('The model is not available');
    });
    const t = teams.save(def({ members: [{ name: 'Athena' }] }));
    teams.start(t.id);
    const end = await teams.idle(t.id);
    assert.strictEqual(end.run.status, 'failed');
    assert.strictEqual(end.run.messages.filter((m) => m.kind === 'error').length, 2);
    console.log('teams: failures ok');
  }

  // pipeline: every task waits for the one before; a lead that never plans still gets one task
  {
    const seen = [];
    const { teams } = make(async (o) => {
      if (o.agent.name === 'Artemis' && /Call team_plan/.test(o.prompt)) { tool(o, 'team_plan').run({ tasks: [{ title: 'one', assignee: 'Athena' }, { title: 'two', assignee: 'Calliope' }, { title: 'three', assignee: 'Athena' }] }); return 'p'; }
      if (o.agent.name === 'Artemis') return 's';
      seen.push(o.prompt.match(/Your task \(#\d\): (\w+)/)[1]);
      tool(o, 'team_done').run({ result: 'r' });
      return '';
    });
    const t = teams.save(def({ members: [{ name: 'Athena' }, { name: 'Calliope' }], mode: 'pipeline' }));
    teams.start(t.id);
    const end = await teams.idle(t.id);
    assert.deepStrictEqual(seen, ['one', 'two', 'three']);
    assert.deepStrictEqual(end.run.tasks.map((k) => k.after.length), [0, 1, 1]);

    const { teams: lazy } = make(async (o) => { if (o.agent.name === 'Artemis') return 'I will just do it'; tool(o, 'team_done').run({ result: 'did it' }); return ''; });
    const t2 = lazy.save(def({ members: [{ name: 'Athena' }] }));
    lazy.start(t2.id);
    const e2 = await lazy.idle(t2.id);
    assert.strictEqual(e2.run.status, 'done');
    assert.strictEqual(e2.run.tasks[0].title, 'Ship the notes');
    console.log('teams: pipeline and fallback ok');
  }

  // after a restart a working team is paused and an open approval is expired
  {
    const { teams } = make(async () => '', { teams: [{ id: 'x', name: 'n', goal: 'g', members: [{ name: 'Athena' }], mode: 'lead', run: { status: 'working', tasks: [{ id: 'k', status: 'doing', after: [] }], messages: [{ id: 'm', kind: 'approval', decided: null }], live: { x1: { name: 'Athena' } }, active: { Athena: 'busy' }, spent: { usd: 0, tokens: 0 } } }] });
    const t = teams.get('x');
    assert.strictEqual(t.run.status, 'paused'); assert.strictEqual(t.run.reason, 'restart');
    assert.strictEqual(t.run.tasks[0].status, 'todo');
    assert.strictEqual(t.run.messages[0].decided, false);
    assert.deepStrictEqual(t.run.live, {}); assert.strictEqual(t.run.active, undefined);
    console.log('teams: restart ok');
  }
  // Teams 2: rules and the notebook in the prompts, hiring, a token budget, the "no price" warning, since() and reload()
  {
    const roster = ROSTER.map((a) => ({ ...a }));
    let saved = null; const hired = []; const prompts = [];
    let runN = 0;
    const teams = createTeams({ load: () => saved, save: (d) => { saved = JSON.parse(JSON.stringify(d)); }, emit: () => {}, roster: () => roster,
      hire: async (a) => { hired.push(a); roster.push({ name: a.name, role: a.role, description: a.role, tools: a.tools, body: a.body }); return { ok: true, name: a.name }; },
      runTurn: async (o) => {
        prompts.push(o.prompt);
        o.onUsage({ prompt: 400, completion: 100, usd: 0, priced: false });
        if (o.agent.name === 'Artemis' && /Call team_plan/.test(o.prompt)) {
          if (runN === 1) assert.match(await tool(o, 'team_hire').run({ name: 'Mira', role: 'Marketer', instructions: 'posts', tools: ['make', 'web'] }), /now a member/);
          tool(o, 'team_plan').run({ tasks: [{ title: 'Do it', assignee: runN === 1 ? 'Mira' : 'Athena' }] });
          return 'plan';
        }
        if (o.agent.name === 'Artemis') return `Run ${runN} found: niche ${runN}`;
        tool(o, 'team_done').run({ result: 'ok' }); return '';
      } });
    const t = teams.save({ name: 'Biz', goal: 'Find a niche', members: [{ name: 'Athena' }], rules: 'Post only in English', canHire: true, budgetUsd: 2, budgetTokens: 1e6, repeat: { type: 'daily', at: '09:00', junk: 1 } });
    assert.deepStrictEqual(t.repeat, { type: 'daily', at: '09:00' });
    assert.strictEqual(cleanDef({ name: 'a', goal: 'g', members: [{ name: 'Athena' }], repeat: { type: 'hourly' } }, ROSTER).repeat, null);
    runN = 1; teams.start(t.id); let done = await teams.idle(t.id);
    assert.strictEqual(done.run.status, 'done', JSON.stringify(done.run.messages.slice(-3)));
    assert.ok(prompts[0].includes('Team rules from the user:\nPost only in English') && prompts[0].includes('team_hire adds a new agent'));
    assert.strictEqual(hired.length, 1); assert.deepStrictEqual(hired[0].tools, ['make', 'web']);
    assert.ok(done.members.some((m) => m.name === 'Mira') && done.run.tasks[0].assignee === 'Mira');
    assert.ok(done.run.messages.some((m) => m.kind === 'status' && /No price is set/.test(m.text)), 'warns once that $ cannot be counted');
    assert.strictEqual(done.run.messages.filter((m) => /No price is set/.test(m.text)).length, 1);
    assert.match(done.notebook, /^## \d{4}-\d\d-\d\d\nRun 1 found: niche 1$/);
    const ts = done.updatedAt;
    runN = 2; prompts.length = 0; teams.start(t.id); done = await teams.idle(t.id); // a second run reads the notebook
    assert.ok(prompts[0].includes('Team notebook') && prompts[0].includes('Run 1 found: niche 1'));
    assert.ok(done.notebook.includes('Run 2 found') && done.notebook.includes('Run 1 found'));
    assert.ok(teams.since(ts).some((x) => x.id === t.id) && !teams.since(done.updatedAt).length);
    // the token budget pauses the run
    const t2 = teams.save({ name: 'Small', goal: 'g', members: [{ name: 'Athena' }], budgetTokens: 900 });
    runN = 3; teams.start(t2.id); const p = await teams.idle(t2.id);
    assert.strictEqual(p.run.status, 'paused'); assert.strictEqual(p.run.reason, 'tokens');
    assert.ok(p.run.messages.some((m) => /Token budget reached/.test(m.text)));
    teams.stop(t2.id);
    assert.strictEqual(teams.clearNotebook(t.id).notebook, '');
    assert.ok(teams.reload()); assert.strictEqual(teams.get(t.id).notebook, '');
    console.log('teams: rules, notebook, hiring, token budget ok');
  }
  // found with a real team (Sticky Notes): a turn cut off by a pause is not finished work, a reviewer cut off mid-check
  // approves nothing, a member that stops without a result fails the task, and team tools written as text still count
  {
    const { teams } = make((o) => new Promise((resolve) => {
      if (o.agent.name === 'Artemis') { tool(o, 'team_plan').run({ tasks: [{ title: 'Post the note', assignee: 'Athena' }] }); return resolve('plan'); }
      o.signal.addEventListener('abort', () => resolve('I will open the page first')); // runAgent returns, it does not throw
    }));
    const t = teams.save(def({ members: [{ name: 'Athena' }] }));
    teams.start(t.id);
    await wait(20);
    teams.pause(t.id);
    const p = await teams.idle(t.id);
    assert.strictEqual(p.run.tasks[0].status, 'todo', 'the cut-off task goes back to the queue');
    assert.ok(!p.run.messages.some((m) => m.kind === 'result'), 'no result is posted for it');
    teams.stop(t.id);

    let reviews = 0;
    const { teams: rv } = make((o) => new Promise((resolve) => {
      if (o.agent.name === 'Artemis' && /Call team_plan/.test(o.prompt)) { tool(o, 'team_plan').run({ tasks: [{ title: 'Write', assignee: 'Calliope' }] }); return resolve('plan'); }
      if (o.agent.name === 'Calliope') { tool(o, 'team_done').run({ result: 'the note' }); return resolve(''); }
      if (o.agent.name === 'Themis') { reviews++; o.signal.addEventListener('abort', () => resolve('I will verify the files it claims to have written.')); return; }
      resolve('summary');
    }));
    const t2 = rv.save(def({ members: [{ name: 'Calliope' }, { name: 'Themis' }] }));
    rv.start(t2.id);
    await wait(20);
    assert.strictEqual(reviews, 1);
    rv.pause(t2.id);
    const p2 = await rv.idle(t2.id);
    assert.strictEqual(p2.run.tasks[0].status, 'review', 'the review runs again after Resume');
    assert.strictEqual(p2.run.tasks[0].result, 'the note', 'work handed in with team_done before the pause is kept');
    assert.ok(!p2.run.messages.some((m) => m.kind === 'review'), 'nothing was approved');
    rv.stop(t2.id);

    const { teams: lost } = make(async (o) => {
      if (o.agent.name === 'Artemis') { tool(o, 'team_plan').run({ tasks: [{ title: 'Post it', assignee: 'Athena' }] }); return 'plan'; }
      o.onStep({ type: 'notice', text: 'Stopped: the model kept repeating the same browser_read_page call.' });
      return '';
    });
    const t3 = lost.save(def({ members: [{ name: 'Athena' }] }));
    lost.start(t3.id);
    const p3 = await lost.idle(t3.id);
    assert.strictEqual(p3.run.status, 'failed');
    assert.ok(p3.run.messages.some((m) => m.kind === 'error' && /Athena stopped without a result \(Stopped: the model kept repeating the same browser_read_page call\)/.test(m.text)), JSON.stringify(p3.run.messages.map((m) => m.text)));
    assert.ok(!p3.run.messages.some((m) => m.kind === 'result'));

    let round = 0;
    const { teams: txt } = make(async (o) => {
      if (o.agent.name === 'Artemis' && /Call team_plan/.test(o.prompt)) { tool(o, 'team_plan').run({ tasks: [{ title: 'Write', assignee: 'Calliope' }] }); return 'plan'; }
      if (o.agent.name === 'Calliope') return `Note v${++round}: we are the AI team.\n\nteam_post(text="Draft is in Files/sticky (v${round})")\n\nteam_done(result="Wrote the note")`;
      if (o.agent.name === 'Themis') return round === 1 ? 'team_review(verdict="changes", note="Add a hook")' : 'team_review(verdict="approve", note="Good")';
      return 'summary';
    });
    const t4 = txt.save(def({ members: [{ name: 'Calliope' }, { name: 'Themis' }] }));
    txt.start(t4.id);
    const p4 = await txt.idle(t4.id);
    assert.strictEqual(p4.run.status, 'done');
    const res = p4.run.messages.filter((m) => m.kind === 'result').map((m) => m.text);
    assert.deepStrictEqual(res, ['Note v1: we are the AI team.', 'Note v2: we are the AI team.'], 'the text calls are taken out of the result');
    assert.deepStrictEqual(p4.run.messages.filter((m) => m.kind === 'review').map((m) => m.verdict), ['changes', 'approve']);
    assert.strictEqual(p4.run.messages.find((m) => m.kind === 'review').text, 'Add a hook');
    assert.ok(p4.run.messages.some((m) => m.kind === 'msg' && m.from === 'Calliope' && m.text === 'Draft is in Files/sticky (v1)'), 'a team_post written as text is posted');
    console.log('teams: cut-off turns, empty results and text tool calls ok');
  }
  // core/teamrun.js: a member gets the tools of its groups, approvals go to the room and to Telegram
  {
    const { createTeamRunner } = require('../electron/core/teamrun');
    let got = null; const asked = []; const reg = new Map(); const phoneAsks = []; const released = [];
    const run = createTeamRunner({
      runAgent: async (o) => { got = o; const ok = o.autoAll ? true : await o.approve({ name: 'make_run', summary: 'Run scenario 7' }); o.send({ type: 'chunk', text: ok ? 'ran it' : 'denied' }); },
      settings: () => ({ maxTokens: 1000 }), userData: '/tmp', resolveModel: (m) => (m === 'bad' ? { error: 'no key' } : { baseUrl: 'u', key: 'k', model: m }), fallbackModel: () => 'chat',
      prices: () => ({}), costOf: () => 0, recordUsage: () => {}, limitBlocked: () => '', filesDir: () => '/files',
      tools: ({ caps }) => ({ make: caps.has('make') ? { m: 1 } : null, browser: caps.has('browser') ? { b: 1 } : null, shellEnabled: caps.has('shell') }),
      approvals: { add: (id, decide) => reg.set(id, decide), drop: (id) => { const d = reg.get(id); reg.delete(id); if (d) d(false); } },
      phone: () => ({ askApproval: async (id, text) => phoneAsks.push([id, text]) }), release: (id) => released.push(id)
    });
    const ctrl = new AbortController();
    const p = run({ agent: { name: 'Mira', tools: ['make', 'web'], model: 'bad', body: 'posts' }, prompt: 'go', extraTools: [], signal: ctrl.signal, askWrites: true, team: 'Biz',
      onUsage: () => {}, onApproval: { asked: (i) => asked.push(i), done: () => {} } });
    await wait(10);
    assert.strictEqual(asked.length, 1); assert.strictEqual(phoneAsks.length, 1);
    assert.match(phoneAsks[0][1], /Team "Biz" · Mira wants to:\nRun scenario 7/);
    reg.get(asked[0].id)(true);
    assert.strictEqual(await p, 'ran it');
    assert.strictEqual(got.model, 'chat', 'a model without a key falls back to the chat model');
    assert.ok(got.make && !got.browser && !got.shellEnabled && got.isSub && got.memberCaps.has('make'));
    assert.ok(got.allowTools.has('make_run') && got.allowTools.has('web_search') && !got.allowTools.has('browser_click'));
    assert.ok(!got.autoAll);
    assert.strictEqual(released.length, 1, 'the turn frees its browser handle when it ends');
    await run({ agent: { name: 'Mira', tools: [] }, prompt: 'go', extraTools: [], signal: new AbortController().signal, askWrites: false, onUsage: () => {}, onApproval: { asked: () => {}, done: () => {} } }).catch(() => {});
    assert.ok(got.autoAll && got.autoApprove, '"ask me first" off: the member acts on its own');
    console.log('teams: member tools and approvals ok');
  }
  // chat tools: agents and teams from a chat (agent_save, team_save, team_list, team_start)
  {
    const tools = require('../electron/tools');
    const roster = ROSTER.map((a) => ({ ...a })); const saved = []; let started = null; const approvals = [];
    const store = [];
    const ctx = { approve: async (i) => { approvals.push(i.summary); return true; }, session: new Set(), teams: {
      agents: () => roster, saveAgent: (a) => { saved.push(a); roster.push({ name: a.name, role: a.role, tools: a.tools }); return { ok: true, name: a.name }; },
      list: async () => store, get: async (id) => store.find((t) => t.id === id || t.name.toLowerCase() === String(id).toLowerCase()) || null,
      save: async (d) => { const t = { ...cleanDef(d, roster), id: d.id || 't1' }; const i = store.findIndex((x) => x.id === t.id); if (i >= 0) store[i] = t; else store.push(t); return t; },
      start: async (id) => { started = id; }, remove: async () => true } };
    const defs = tools.definitions({ teamsEnabled: true }).map((d) => d.function.name);
    assert.ok(['agent_save', 'agent_list', 'team_save', 'team_list', 'team_start', 'team_delete'].every((n) => defs.includes(n)));
    let r = await tools.run('agent_save', { name: 'Pip', role: 'Publisher', instructions: 'Post notes on Substack.', tools: ['browser', 'read'] }, ctx);
    assert.ok(r.ok && /Pip/.test(r.text), r.text);
    assert.deepStrictEqual(saved[0].tools, ['browser', 'read']);
    r = await tools.run('team_save', { name: 'Notes', goal: 'Post notes', members: [{ name: 'Pip' }, { name: 'Nobody' }] }, ctx);
    assert.ok(!r.ok && /Nobody/.test(r.text), 'a missing member is named');
    r = await tools.run('team_save', { name: 'Notes', goal: 'Post notes', members: [{ name: 'Pip' }, { name: 'Athena' }], rules: 'No em dashes', budget_tokens: 300000, ask_first: false, repeat: { type: 'interval', every: 360 } }, ctx);
    assert.ok(r.ok && /every 6 h/.test(r.text), r.text);
    assert.strictEqual(store[0].askWrites, false); assert.strictEqual(store[0].budgetTokens, 300000); assert.deepStrictEqual(store[0].repeat, { type: 'interval', every: 360 });
    r = await tools.run('team_save', { id: 't1', name: 'Notes', goal: 'Post better notes', members: [{ name: 'Pip' }] }, ctx);
    assert.ok(r.ok && store[0].goal === 'Post better notes' && store[0].budgetTokens === 300000, 'changing keeps what was not given');
    r = await tools.run('team_start', { id: 'notes' }, ctx);
    assert.ok(r.ok && started === 't1');
    assert.ok(approvals.length >= 4 && approvals.some((x) => /Create team "Notes"/.test(x)), 'every change asks');
    r = await tools.run('team_list', {}, ctx);
    assert.ok(/Notes/.test(r.text));
    ctx.teams.models = () => [{ id: 'prov:or:cheap', name: 'Cheap', provider: 'OpenRouter', in: 0.1, out: 0.4 }];
    r = await tools.run('model_list', {}, ctx);
    assert.ok(/prov:or:cheap/.test(r.text) && /cli:claude/.test(r.text), r.text);
    r = await tools.run('agent_set_model', { agents: ['Pip'], model: 'prov:or:made-up' }, ctx);
    assert.ok(!r.ok && /model_list/.test(r.text), 'an unknown model id is refused');
    roster.find((a) => a.name === 'Pip').body = 'Post notes on Substack.';
    r = await tools.run('agent_set_model', { agents: ['Pip'], model: 'prov:or:cheap' }, ctx);
    assert.ok(r.ok, r.text);
    assert.strictEqual(saved.at(-1).model, 'prov:or:cheap'); assert.strictEqual(saved.at(-1).body, 'Post notes on Substack.');
    console.log('teams: chat tools ok');
  }
  console.log('teams: all tests passed');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
