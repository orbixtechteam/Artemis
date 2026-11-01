const assert = require('assert');
const { overview, detail } = require('../electron/remote/teamstatus.js');
const t = {
  name: 'Pickles', members: [{ name: 'Lana' }, { name: 'Shaira' }],
  run: { status: 'working', startedAt: 1, tasks: [{ status: 'done', assignee: 'Lana', title: 'Review' }, { status: 'doing', assignee: 'Shaira', title: 'Publish' }],
    live: { a: { name: 'Shaira', steps: [{ name: 'done_one', status: 'done' }, { name: 'browser_click', status: 'running' }] } },
    messages: [{ t: 1, from: 'Lana', text: 'Handing off\n to Shaira' }], spent: { usd: 0.5 } },
};
const o = overview([t], [{ name: 'Lana' }, { name: 'Themis' }]);
assert(o.includes('Pickles: working, 1/2 tasks'));
assert(o.includes('Now: Shaira'));
assert(o.includes('Agents without a team: Themis') && !o.includes('team: Lana'));
const d = detail(t);
assert(d.includes('[doing] Shaira: Publish'));
assert(d.includes('Shaira: browser_click'));
assert(d.includes('Lana: Handing off to Shaira'));
assert(d.includes('spent $0.50'));
assert.strictEqual(overview([], []), 'No teams or agents yet.');
assert(detail({ name: 'Empty' }).startsWith('Empty: idle, no tasks'));
console.log('teamstatus ok');
