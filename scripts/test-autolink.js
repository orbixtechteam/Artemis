const assert = require('assert');
const { createChannel, isBackgroundChat } = require('../electron/remote');

(async () => {
  const seen = [];
  const saved = [];
  const chat = { id: 'c1', title: 'Old chat' };
  const mk = (auto) => createChannel(async ({ messages, send }) => { seen.push(messages); send({ type: 'chunk', text: 'ok' }); }, () => {}, (l, u, a) => seen.push(['turn', l.id, u, a]), auto, (l) => saved.push(l && l.id));
  // continues the most recent chat when nothing is linked
  let ch = mk(() => ({ chat, turns: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }] }));
  await ch.ask('next', () => {});
  assert.strictEqual(ch.linked().id, 'c1');
  assert.strictEqual(seen[0].length, 3); // 2 earlier turns + the new message
  assert.ok(seen.some((x) => x[0] === 'turn' && x[1] === 'c1' && x[2] === 'next'));
  assert.deepStrictEqual(saved, ['c1']);
  // /new clears the link and it stays cleared (no history, but autoLink would relink on the next ask: so reset keeps history empty)
  ch.reset();
  assert.strictEqual(ch.linked(), null);
  assert.strictEqual(saved[saved.length - 1], null);
  // no candidate: stays unlinked
  seen.length = 0;
  const ch2 = mk(() => null);
  await ch2.ask('x', () => {});
  assert.strictEqual(ch2.linked(), null);
  assert.strictEqual(seen[0].length, 1);
  // heartbeat, webhook and schedule chats are never continued from the phone
  assert.ok(isBackgroundChat({ id: 'heartbeat-hbee391ab2' }));
  assert.ok(isBackgroundChat({ id: 'bg-x1', source: '' }));
  assert.ok(isBackgroundChat({ id: 'abc', source: 'schedule' }));
  assert.ok(!isBackgroundChat({ id: '8st1i5p113zv', source: '' }));
  assert.ok(!isBackgroundChat({ id: 'p1', source: 'phone' }));
  console.log('autolink: all tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
