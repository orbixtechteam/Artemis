const assert = require('assert');
const P = require('../electron/providers.js');
// url joining
assert.strictEqual(P.joinUrl('https://api.example.com', 'chat/completions'), 'https://api.example.com/v1/chat/completions');
assert.strictEqual(P.joinUrl('https://api.example.com/', '/v1/models'), 'https://api.example.com/v1/models');
assert.strictEqual(P.joinUrl('http://localhost:11434/v1', 'chat/completions'), 'http://localhost:11434/v1/chat/completions');
assert.strictEqual(P.joinUrl('https://openrouter.ai/api/v1/', 'models'), 'https://openrouter.ai/api/v1/models');
assert.strictEqual(P.joinUrl('https://api.cloudflare.com/client/v4/accounts/abc/ai/v1', 'chat/completions'), 'https://api.cloudflare.com/client/v4/accounts/abc/ai/v1/chat/completions');
// a base with its own version path is used as is; /v1 is added only to a bare host
assert.strictEqual(P.joinUrl('https://generativelanguage.googleapis.com/v1beta/openai', 'chat/completions'), 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
assert.strictEqual(P.joinUrl('https://ark.example.com/api/v3/', 'chat/completions'), 'https://ark.example.com/api/v3/chat/completions');
assert.strictEqual(P.joinUrl('https://api.groq.com/openai', 'models'), 'https://api.groq.com/openai/models');
assert.strictEqual(P.joinUrl('https://openrouter.ai/api/v1', 'v1/models'), 'https://openrouter.ai/api/v1/models');
assert.strictEqual(P.joinUrl('http://localhost:3456/', 'chat/completions'), 'http://localhost:3456/v1/chat/completions');
// ids
const id = P.prefixId('ab12', 'llama3.2:3b');
assert.strictEqual(id, 'prov:ab12:llama3.2:3b');
assert.deepStrictEqual(P.parseModel(id), { pid: 'ab12', model: 'llama3.2:3b' });
assert.deepStrictEqual(P.parseModel('prov:cf:@cf/meta/llama-3.1-8b-instruct-fp8-fast'), { pid: 'cf', model: '@cf/meta/llama-3.1-8b-instruct-fp8-fast' });
assert.strictEqual(P.parseModel('anthropic/claude-sonnet-5.5'), null);
assert.strictEqual(P.parseModel('prov:x:'), null);
// normalize
const n = P.normalize({ name: ' Mine ', baseUrl: 'http://x/v1/', models: [{ id: 'a', in: '1', out: '2' }, { id: 'a' }, 'b', { id: '' }, { id: 'c', in: -1 }] }, 'zz');
assert.strictEqual(n.id, 'zz'); assert.strictEqual(n.name, 'Mine'); assert.strictEqual(n.baseUrl, 'http://x/v1');
assert.deepStrictEqual(n.models, [{ id: 'a', in: 1, out: 2 }, { id: 'b' }, { id: 'c' }]);
// resolve
const provs = [{ id: 'cf', name: 'CF', baseUrl: 'https://cf/v1', needsKey: true, models: [] }, { id: 'ol', name: 'Ollama', baseUrl: 'http://localhost:11434/v1', needsKey: false, local: true, models: [{ id: 'qwen3:8b' }] }, { id: 'off', name: 'Off', baseUrl: 'http://o', enabled: false, models: [] }];
const keys = { cf: 'K' };
let r = P.resolve('anthropic/claude-sonnet-5.5', provs, (i) => keys[i]);
assert.ok(/No model selected/.test(r.error));
r = P.resolve('prov:cf:@cf/x', provs, (i) => keys[i]); assert.strictEqual(r.key, 'K'); assert.strictEqual(r.model, '@cf/x'); assert.strictEqual(r.baseUrl, 'https://cf/v1');
r = P.resolve('prov:ol:qwen3:8b', provs, () => ''); assert.ok(!r.error); assert.strictEqual(r.key, ''); assert.strictEqual(r.model, 'qwen3:8b');
r = P.resolve('prov:cf:m', provs, () => ''); assert.ok(/No API key/.test(r.error));
r = P.resolve('prov:off:m', provs, () => ''); assert.ok(/turned off/.test(r.error));
r = P.resolve('prov:gone:m', provs, () => ''); assert.ok(/removed/.test(r.error));
// prices
provs[0].models = [{ id: 'k', in: 0.95, out: 4 }];
const pm = P.priceMap(provs);
assert.deepStrictEqual(pm['prov:cf:k'], [0.95, 4]); assert.deepStrictEqual(pm['prov:ol:qwen3:8b'], [0, 0]);
assert.ok(P.modelEntries(provs).some(([i, l]) => i === 'prov:cf:k' && /CF/.test(l)));
assert.ok(!P.modelEntries(provs).some(([i]) => i.startsWith('prov:off:')));
// limits cost with extra prices
const { checkLimits } = require('../electron/limits.js');
const now = Date.now();
const lr = checkLimits([{ t: now, model: 'prov:cf:k', prompt: 1e6, completion: 1e6 }], { dailyUsdLimit: 4 }, now, pm);
assert.ok(/spending limit reached/.test(lr.blocked), lr.blocked); // 0.95 + 4 = 4.95
// probe
(async () => {
  const mk = (map) => async (url, o) => { const h = map(url, o); if (h instanceof Error) throw h; return { ok: h.status < 400, status: h.status, statusText: 'x', json: async () => h.body, text: async () => JSON.stringify(h.body || '') }; };
  let out = await P.probe({ baseUrl: 'http://localhost:11434/v1', key: '' }, mk((u) => { assert.strictEqual(u, 'http://localhost:11434/v1/models'); return { status: 200, body: { data: [{ id: 'a' }, { id: 'b' }, { id: 'a' }] } }; }));
  assert.deepStrictEqual(out, { ok: true, models: ['a', 'b'] });
  out = await P.probe({ baseUrl: 'https://x', key: 'k' }, mk(() => ({ status: 401 })));
  assert.ok(!out.ok && /rejected the key/.test(out.error));
  out = await P.probe({ baseUrl: 'http://localhost:1', key: '' }, mk(() => new TypeError('fetch failed')));
  assert.ok(!out.ok && /Cannot reach/.test(out.error));
  out = await P.probe({ baseUrl: 'https://x/v1', key: 'k', models: [{ id: 'm' }] }, mk((u) => (/models$/.test(u) ? { status: 404 } : { status: 200, body: {} })));
  assert.ok(out.ok && out.models === null);
  out = await P.probe({ baseUrl: 'https://x/v1', key: 'k', models: [] }, mk(() => ({ status: 404 })));
  assert.ok(!out.ok && /Add at least one model/.test(out.error));
  out = await P.probe({ baseUrl: 'nope' }, mk(() => ({ status: 200 })));
  assert.ok(!out.ok);
  console.log('providers: all tests passed');
})().catch((e) => { console.error(e); process.exit(1); });

// ---- extra headers per provider
(async () => {
  const assert = require('assert');
  const pv = require('../electron/providers');
  const n = pv.normalize({ name: 'CF', baseUrl: 'https://api.cloudflare.com/client/v4/accounts/A/ai/v1/', headers: { 'cf-aig-gateway-id': 'default', Authorization: 'x', 'Content-Type': 'y', 'bad name': 'z', 'X-Ok': 'a\r\nb', Empty: '' } });
  assert.deepStrictEqual(n.headers, { 'cf-aig-gateway-id': 'default', 'X-Ok': 'a b' });
  assert.strictEqual(pv.normalize({ name: 'x', baseUrl: 'http://h/v1' }).headers, undefined);
  pv.registerHeaders([n, pv.normalize({ name: 'Other', baseUrl: 'https://api.groq.com/openai/v1' })]);
  assert.deepStrictEqual(pv.headersFor('https://api.cloudflare.com/client/v4/accounts/A/ai/v1/chat/completions'), { 'cf-aig-gateway-id': 'default', 'X-Ok': 'a b' });
  assert.deepStrictEqual(pv.headersFor('https://api.groq.com/openai/v1/chat/completions'), {});
  assert.deepStrictEqual(pv.headersFor('https://evil.example/https://api.cloudflare.com/client/v4/accounts/A/ai/v1/chat/completions'), {});
  assert.deepStrictEqual(pv.headersFor('https://api.cloudflare.com/client/v4/accounts/AB/ai/v1/chat/completions'), {});
  pv.registerHeaders([]);
  // probe sends them, and cannot override Authorization
  let seen = null;
  await pv.probe({ baseUrl: 'http://h/v1', key: 'k', headers: { 'cf-aig-gateway-id': 'default', authorization: 'evil' } }, async (url, o) => { seen = o.headers; return { ok: true, json: async () => ({ data: [{ id: 'm' }] }) }; });
  assert.strictEqual(seen['cf-aig-gateway-id'], 'default'); assert.strictEqual(seen.authorization, 'Bearer k');
  const cf = pv.PRESETS.find((p) => p.key === 'cloudflare');
  assert.deepStrictEqual(cf.headers, { 'cf-aig-gateway-id': 'default' });
  assert(cf.models.some((m) => m.id === '@cf/moonshotai/kimi-k2.7-code'));
  console.log('providers: extra headers ok');
})().catch((e) => { console.error(e); process.exit(1); });

// ---- OpenRouter routing per provider
(async () => {
  const assert = require('assert');
  const pv = require('../electron/providers');
  const n = pv.normalize({ name: 'OR', baseUrl: 'https://openrouter.ai/api/v1', routing: { sort: 'latency', order: ' Morph, Open Inference ,morph,bad name!' } });
  assert.deepStrictEqual(n.routing, { sort: 'latency', order: ['morph', 'open-inference'] });
  assert.strictEqual(pv.normalize({ name: 'x', baseUrl: 'http://h/v1', routing: { sort: 'nope', order: '' } }).routing, undefined);
  assert.strictEqual(pv.normalize({ name: 'x', baseUrl: 'http://h/v1' }).routing, undefined);
  pv.registerHeaders([n]);
  assert.deepStrictEqual(pv.routingBody('https://openrouter.ai/api/v1/chat/completions'), { provider: { sort: 'latency', order: ['morph', 'open-inference'], allow_fallbacks: true } });
  assert.deepStrictEqual(pv.routingBody('https://api.groq.com/openai/v1/chat/completions'), {});
  assert.deepStrictEqual(pv.routingBody('https://evil.example/https://openrouter.ai/api/v1/chat/completions'), {});
  const priv = pv.normalize({ name: 'OR', baseUrl: 'https://openrouter.ai/api/v1', routing: { zdr: true, denyCollection: true, ignore: 'DeepSeek, bad name!', only: 'together,fireworks' } });
  assert.deepStrictEqual(priv.routing, { only: ['together', 'fireworks'], ignore: ['deepseek'], zdr: true, denyCollection: true });
  pv.registerHeaders([priv]);
  assert.deepStrictEqual(pv.routingBody('https://openrouter.ai/api/v1/chat/completions'), { provider: { only: ['together', 'fireworks'], ignore: ['deepseek'], allow_fallbacks: false, zdr: true, data_collection: 'deny' } });
  pv.registerHeaders([]);
  assert.deepStrictEqual(pv.routingBody('https://openrouter.ai/api/v1/chat/completions'), {});
  console.log('providers: routing ok');
})().catch((e) => { console.error(e); process.exit(1); });
