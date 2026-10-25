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
  console.log('teams: all tests passed');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
