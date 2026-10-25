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
    assert.deepStrictEqual(end.run.active, {});
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
    assert.ok(teams.get(t.id).run.active.Athena);
    teams.pause(t.id);
    const p = await teams.idle(t.id);
    assert.strictEqual(p.run.status, 'paused');
    assert.strictEqual(p.run.tasks[0].status, 'todo');
    assert.deepStrictEqual(p.run.active, {});
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
    const { teams } = make(async () => '', { teams: [{ id: 'x', name: 'n', goal: 'g', members: [{ name: 'Athena' }], mode: 'lead', run: { status: 'working', tasks: [{ id: 'k', status: 'doing', after: [] }], messages: [{ id: 'm', kind: 'approval', decided: null }], active: { Athena: 'busy' }, spent: { usd: 0, tokens: 0 } } }] });
    const t = teams.get('x');
    assert.strictEqual(t.run.status, 'paused'); assert.strictEqual(t.run.reason, 'restart');
    assert.strictEqual(t.run.tasks[0].status, 'todo');
    assert.strictEqual(t.run.messages[0].decided, false);
    assert.deepStrictEqual(t.run.active, {});
    console.log('teams: restart ok');
  }
  console.log('teams: all tests passed');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
