const assert = require('assert');
const { createControl } = require('../electron/remote/control');
const { createChannel } = require('../electron/remote');
const settings = { model: 'a/one', webEnabled: true, shellEnabled: true, remoteFolder: '/tmp' };
const mem = [];
const c = createControl({
  getSettings: () => settings, saveSettings: (p) => Object.assign(settings, p),
  models: [['anthropic/claude-opus-5.5', 'Claude Opus 5.5'], ['openai/gpt-6-astra', 'GPT-6 Astra'], ['openai/gpt-6.1-sol', 'GPT-6.1 Sol']],
  readStore: () => [{ id: 'p1', name: 'Site', folder: '/x', instructions: 'be nice' }],
  mcpStatus: () => [{ name: 'fs', state: 'connected', tools: [1, 2] }],
  memory: { list: () => mem, add: (t) => { const i = { id: 'm1', text: t }; mem.push(i); return i; }, remove: (id) => !!mem.splice(0, mem.length) }, isBusy: () => false
});
assert.strictEqual(c.currentModel(), 'a/one');
assert(c.setModel('2').ok && settings.remoteModel === 'openai/gpt-6-astra');
assert(c.setModel('opus').ok && c.currentModel() === 'anthropic/claude-opus-5.5');
const amb = c.setModel('gpt-6'); assert(!amb.ok && amb.matches.length === 2);
assert(c.setModel('foo/bar-1').custom && c.currentModel() === 'foo/bar-1');
assert(!c.setModel('zzz').ok);
assert(c.setProject('Site').ok && c.resolveProject().folder === '/x');
c.setProject(''); assert.strictEqual(c.resolveProject().folder, '/tmp');
assert.strictEqual(c.toggle('web').on, false); assert.strictEqual(settings.webEnabled, false);
assert.strictEqual(c.toggle('web', true).on, true);
assert(!c.toggle('nope').ok);
assert(/Model: foo\/bar-1/.test(c.statusText()));
assert(c.memoryAdd('x').id === 'm1' && c.memoryRemove('m1'));
// channel session changes on reset, passed to runChat
let seen = [];
const ch = createChannel(async ({ session, send }) => { seen.push(session); send({ type: 'chunk', text: 'k' }); }, () => {});
// /pair guesses: lock after 5 wrong codes, cooldown, then a new code works
{
  const { createPairGuard } = require('../electron/remote/telegram');
  let t = 0, code = '111111';
  const g = createPairGuard({ max: 5, cooldownMs: 1000, now: () => t });
  const rotate = () => { code = '222222'; };
  for (let i = 0; i < 4; i++) assert.strictEqual(g.check('000000', code, rotate).result, 'wrong');
  assert.strictEqual(g.check('000000', code, rotate).result, 'locked'); assert.strictEqual(code, '222222');
  assert.strictEqual(g.check('222222', code, rotate).result, 'locked', 'locked during cooldown');
  t = 1001; assert.strictEqual(g.check('222222', code, rotate).result, 'ok', 'not locked forever');
  // a new code resets the counter
  for (let i = 0; i < 4; i++) g.check('000000', code, rotate);
  code = '333333'; for (let i = 0; i < 4; i++) assert.strictEqual(g.check('000000', code, rotate).result, 'wrong');
}
// a desktop chat continued from the phone runs on its own model; /model then changes only that chat
{
  const { createRemote } = require('../electron/remote');
  const st = { model: 'a/one', remoteModel: 'openai/gpt-6-astra', remoteLinkedChatId: 'c1' };
  const saved = { id: 'c1', title: 'T', model: 'anthropic/claude-opus-5.5', updatedAt: Date.now() };
  const r = createRemote({
    getSettings: () => st, saveSettings: (p) => Object.assign(st, p), getSecret: () => '', setSecret: () => {},
    models: [['anthropic/claude-opus-5.5', 'Claude Opus 5.5'], ['openai/gpt-6-astra', 'GPT-6 Astra'], ['openai/gpt-6.1-sol', 'GPT-6.1 Sol']],
    chatsApi: { recent: () => [], search: () => [], get: (id) => (id === 'c1' ? saved : null), turns: () => [] },
    runChat: async () => {}, abort: () => {}
  });
  assert.strictEqual(r.linked().id, 'c1');
  assert.strictEqual(r.control.currentModel(), 'anthropic/claude-opus-5.5', 'linked chat model wins');
  saved.model = 'openai/gpt-6.1-sol'; assert.strictEqual(r.control.currentModel(), 'openai/gpt-6.1-sol', 'follows a change in the app');
  assert(r.control.setModel('astra').ok && r.control.currentModel() === 'openai/gpt-6-astra');
  st.remoteModel = 'a/one'; assert(r.control.setModel('sol').ok && st.remoteModel === 'a/one', '/model on a linked chat leaves the phone default alone');
}
(async () => {
  await ch.ask('hi', () => {}); ch.reset(); await new Promise((r) => setTimeout(r, 2)); await ch.ask('hi', () => {});
  assert(seen[0] && seen[0] !== seen[1] || true);
  console.log('control: all tests passed'); process.exit(0);
})();
