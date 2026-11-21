// Tests for the app's pure helpers (node mobile/scripts/test-lib.mjs, no Expo needed).
import assert from 'node:assert';
import { normalizeUrl, parsePairLink, sseParser, utf8Decoder, newAssistant, applyEvent, finishAssistant, messageText, newChatId } from '../src/lib/core.js';

assert.strictEqual(normalizeUrl('artemis.example.com/'), 'https://artemis.example.com');
assert.strictEqual(normalizeUrl('https://artemis.example.com/v1'), 'https://artemis.example.com');
assert.strictEqual(normalizeUrl('192.168.0.5:8789'), 'http://192.168.0.5:8789');
assert.throws(() => normalizeUrl('http://artemis.example.com'), /https/);
assert.deepStrictEqual(parsePairLink('artemis://connect?url=https%3A%2F%2Fa.example.com&code=K7QM-2XRD'), { url: 'https://a.example.com', code: 'K7QM-2XRD' });
assert.deepStrictEqual(parsePairLink('https://a.example.com/connect?code=AB'), { url: 'https://a.example.com', code: 'AB' });
assert.strictEqual(parsePairLink('hello'), null);

// SSE across chunk borders, comments, ids
const got = [];
const feed = sseParser((e) => got.push(e));
feed(': ok\n\nid: 1\nevent: run\ndata: {"run_id":"r1"}\n\nid: 2\nevent: chu');
feed('nk\ndata: {"type":"chunk","text":"Salam "}\n\n');
assert.deepStrictEqual(got.map((e) => [e.type, e.seq]), [['run', 1], ['chunk', 2]]);
assert.strictEqual(got[1].data.text, 'Salam ');

// UTF-8 split in the middle of a character, with and without TextDecoder
const bytes = new TextEncoder().encode('ə ı ş 🙂');
for (const make of [utf8Decoder, () => { const T = globalThis.TextDecoder; globalThis.TextDecoder = undefined; try { return utf8Decoder(); } finally { globalThis.TextDecoder = T; } }]) {
  const dec = make();
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) s += dec(bytes.slice(i, i + 3), false);
  s += dec(new Uint8Array(0), true);
  assert.strictEqual(s, 'ə ı ş 🙂');
}

// turn builder
let m = newAssistant('a');
for (const ev of [{ type: 'chunk', text: 'Hi' }, { type: 'tool:call', id: 't', name: 'write_file', args: { path: 'x' } }, { type: 'tool:approval', id: 't', summary: 'Write x' }, { type: 'step:new' }, { type: 'chunk', text: 'Done' }, { type: 'step:new' }]) m = applyEvent(m, ev);
assert.strictEqual(m.steps[0].toolCalls[0].status, 'awaiting');
m = finishAssistant(m);
assert.strictEqual(m.steps.length, 2); assert.strictEqual(m.steps[0].toolCalls[0].status, 'cancelled');
assert.strictEqual(messageText(m), 'Hi\n\nDone');
assert.ok(/^m-[\w-]+$/.test(newChatId()));
console.log('mobile lib: ok');
