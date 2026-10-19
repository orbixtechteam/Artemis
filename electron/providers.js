// Extra model providers: any OpenAI-compatible endpoint (Cloudflare Workers AI, Ollama, LM Studio, OpenRouter, ...).
// A provider's model is addressed as "prov:<providerId>:<modelId>" so ids from different providers never clash.
const PREFIX = 'prov:';

const PRESETS = [
  {
    key: 'cloudflare', name: 'Cloudflare Workers AI', needsKey: true,
    baseUrl: 'https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/v1',
    headers: { 'cf-aig-gateway-id': 'default' },
    hint: 'Replace YOUR_ACCOUNT_ID with your Cloudflare account ID. API key = a Workers AI API token. 10,000 neurons/day are free. To pay with prepaid AI Gateway credits (needed for the big Kimi/GLM models without Workers Paid), create a gateway named "default" and set its Workers AI billing to Unified billing. The header below routes requests through it; remove it to bill normally.',
    models: [
      { id: '@cf/moonshotai/kimi-k2.7-code', name: 'Kimi K2.7 Code', in: 0.95, out: 4 },
      { id: '@cf/openai/gpt-oss-120b', name: 'GPT-OSS 120B', in: 0.35, out: 0.75 },
      { id: '@cf/qwen/qwen3-30b-a3b-fp8', name: 'Qwen3 30B A3B', in: 0.051, out: 0.335 },
      { id: '@cf/moonshotai/kimi-k2.6', name: 'Kimi K2.6', in: 0.95, out: 4 },
      { id: '@cf/moonshotai/kimi-k2.5', name: 'Kimi K2.5', in: 0.6, out: 3 },
      { id: '@cf/nvidia/nemotron-3-120b-a12b', name: 'Nemotron 3 120B', in: 0.5, out: 1.5 },
      { id: '@cf/meta/llama-3.1-70b-instruct-fp8-fast', name: 'Llama 3.1 70B', in: 0.293, out: 2.253 },
      { id: '@cf/google/gemma-4-26b-a4b-it', name: 'Gemma 4 26B', in: 0.1, out: 0.3 },
      { id: '@cf/meta/llama-3.1-8b-instruct-fp8-fast', name: 'Llama 3.1 8B', in: 0.045, out: 0.384 }
    ]
  },
  { key: 'ollama', name: 'Ollama (local)', needsKey: false, baseUrl: 'http://localhost:11434/v1', hint: 'Runs on your computer. Start Ollama, then press "Fetch models". Pick a model that supports tools for the best results.', local: true, models: [] },
  { key: 'lmstudio', name: 'LM Studio (local)', needsKey: false, baseUrl: 'http://localhost:1234/v1', hint: 'Start the local server in LM Studio (Developer tab), load a model, then press "Fetch models".', local: true, models: [] },
  { key: 'openrouter', name: 'OpenRouter', needsKey: true, baseUrl: 'https://openrouter.ai/api/v1', hint: 'One key for hundreds of models.', models: [] },
  { key: 'openai', name: 'OpenAI', needsKey: true, baseUrl: 'https://api.openai.com/v1', hint: '', models: [] },
  { key: 'anthropic', name: 'Anthropic (Claude API)', needsKey: true, baseUrl: 'https://api.anthropic.com/v1', hint: 'Uses Anthropic\'s OpenAI-compatible endpoint with an API key (pay per token). Claude Pro/Max logins cannot be used here.', models: [{ id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', in: 2, out: 10 }, { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', in: 0.1, out: 0.5 }] },
  { key: 'custom', name: 'Custom (OpenAI-compatible)', needsKey: false, baseUrl: '', hint: 'Any server that implements /v1/chat/completions.', models: [] }
];

/** Join a base URL and an API path. /v1 is added only to a bare host (no path); a base with its own path (/v1, /v1beta/openai, /api/v3, ...) is used as is. */
function joinUrl(base, p) {
  const b = String(base || '').trim().replace(/\/+$/, '');
  const tail = String(p || '').replace(/^\/+/, '').replace(/^v1\//, '');
  let pathname = '';
  try { pathname = new URL(b).pathname; } catch { pathname = b.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, ''); }
  return !pathname || pathname === '/' ? `${b}/v1/${tail}` : `${b}/${tail}`;
}

const prefixId = (pid, model) => `${PREFIX}${pid}:${model}`;
function parseModel(id) {
  const s = String(id || '');
  if (!s.startsWith(PREFIX)) return null;
  const rest = s.slice(PREFIX.length);
  const i = rest.indexOf(':');
  if (i <= 0 || i === rest.length - 1) return null;
  return { pid: rest.slice(0, i), model: rest.slice(i + 1) };
}

/** Clean a provider object coming from the UI. */
function normalize(p, existingId) {
  const id = String(p.id || existingId || '').replace(/[^a-z0-9_-]/gi, '') || Math.random().toString(36).slice(2, 10);
  const models = [];
  const seen = new Set();
  for (const m of Array.isArray(p.models) ? p.models : []) {
    const mid = String(m && (m.id ?? m) || '').trim();
    if (!mid || seen.has(mid)) continue;
    seen.add(mid);
    const out = { id: mid };
    if (m && m.name && String(m.name).trim() && m.name !== mid) out.name = String(m.name).trim();
    for (const k of ['in', 'out']) { const v = m && m[k]; if (v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0) out[k] = Number(v); }
    models.push(out);
  }
  return {
    id, name: String(p.name || '').trim() || 'Provider', baseUrl: String(p.baseUrl || '').trim().replace(/\/+$/, ''),
    needsKey: !!p.needsKey, local: !!p.local, enabled: p.enabled !== false, models,
    ...(p.noTools === true || p.noTools === false ? { noTools: p.noTools } : {}),
    ...(Object.keys(cleanHeaders(p.headers)).length ? { headers: cleanHeaders(p.headers) } : {}),
    ...(cleanRouting(p.routing) ? { routing: cleanRouting(p.routing) } : {})
  };
}

/** Extra request headers for a provider ({ name: value }). Names are checked; Authorization, Content-Type and friends can never be overridden. */
const BLOCKED_HEADERS = new Set(['authorization', 'content-type', 'content-length', 'host', 'connection', 'transfer-encoding', 'cookie']);
function cleanHeaders(h) {
  const out = {};
  if (!h || typeof h !== 'object' || Array.isArray(h)) return out;
  for (const [k, v] of Object.entries(h)) {
    const name = String(k).trim();
    const val = String(v ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 512);
    if (/^[A-Za-z0-9-]{1,64}$/.test(name) && !BLOCKED_HEADERS.has(name.toLowerCase()) && val) out[name] = val;
    if (Object.keys(out).length >= 10) break;
  }
  return out;
}

// Providers' extra headers, looked up by request URL so every fetch (chat, summaries, brains, skills learning) adds them without being passed around.
let headerRegistry = [];
function registerHeaders(providers) {
  routingRegistry = (providers || []).filter((p) => p && p.baseUrl && cleanRouting(p.routing))
    .map((p) => ({ base: String(p.baseUrl).trim().replace(/\/+$/, ''), routing: cleanRouting(p.routing) }))
    .sort((a, b) => b.base.length - a.base.length);
  headerRegistry = (providers || []).filter((p) => p && p.baseUrl && p.headers && Object.keys(cleanHeaders(p.headers)).length)
    .map((p) => ({ base: String(p.baseUrl).trim().replace(/\/+$/, ''), headers: cleanHeaders(p.headers) }))
    .sort((a, b) => b.base.length - a.base.length);
}
function headersFor(url) {
  const u = String(url || '');
  const m = headerRegistry.find((r) => u === r.base || u.startsWith(r.base + '/') || u.startsWith(r.base + '?'));
  return m ? m.headers : {};
}

/** OpenRouter provider routing. sort: price | throughput | latency (like the :floor / :nitro model suffixes); order: server slugs to try first. Empty = OpenRouter's default balancing. */
const ROUTING_SORTS = ['price', 'throughput', 'latency'];
function cleanRouting(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  const out = {};
  if (ROUTING_SORTS.includes(r.sort)) out.sort = r.sort;
  const order = (Array.isArray(r.order) ? r.order : String(r.order || '').split(','))
    .map((x) => String(x).trim().toLowerCase().replace(/\s+/g, '-')).filter((x) => /^[a-z0-9][a-z0-9._\/-]{0,63}$/.test(x)).slice(0, 8);
  if (order.length) out.order = [...new Set(order)];
  const slugs = (v) => [...new Set((Array.isArray(v) ? v : String(v || '').split(',')).map((x) => String(x).trim().toLowerCase().replace(/\s+/g, '-')).filter((x) => /^[a-z0-9][a-z0-9._\/-]{0,63}$/.test(x)).slice(0, 16))];
  const only = slugs(r.only); if (only.length) out.only = only;
  const ignore = slugs(r.ignore); if (ignore.length) out.ignore = ignore;
  if (r.zdr === true) out.zdr = true;
  if (r.denyCollection === true) out.denyCollection = true;
  if (r.noFallbacks === true) out.noFallbacks = true;
  return Object.keys(out).length ? out : null;
}
let routingRegistry = [];
function routingFor(url) {
  const u = String(url || '');
  const m = routingRegistry.find((r) => u === r.base || u.startsWith(r.base + '/') || u.startsWith(r.base + '?'));
  return m ? { ...m.routing } : null;
}
/** Spread into a chat request body: { provider: {...} } for a provider with routing set, otherwise nothing. */
function routingBody(url) {
  const r = routingFor(url);
  if (!r) return {};
  const { denyCollection, noFallbacks, zdr, ...rest } = r;
  const provider = { ...rest, allow_fallbacks: !(noFallbacks || zdr || denyCollection || (rest.only && rest.only.length)) };
  if (zdr) provider.zdr = true;
  if (denyCollection) provider.data_collection = 'deny';
  return { provider };
}

/** Which endpoint/key/model to use for a chat model id ("prov:<providerId>:<modelId>"). */
function resolve(modelId, providers, getProviderKey) {
  const pm = parseModel(modelId);
  if (!pm) return { error: 'No model selected. Add a provider in Settings → Providers and pick one of its models.' };
  const p = (providers || []).find((x) => x.id === pm.pid);
  if (!p) return { error: 'This model belongs to a provider that was removed. Pick another model.' };
  if (p.enabled === false) return { error: `Provider "${p.name}" is turned off. Turn it on in Settings → Providers.` };
  if (!p.baseUrl) return { error: `Provider "${p.name}" has no endpoint URL. Fix it in Settings → Providers.` };
  const key = getProviderKey(p.id) || '';
  if (p.needsKey && !key) return { error: `No API key for "${p.name}". Add one in Settings → Providers.` };
  return { provider: p, baseUrl: p.baseUrl, key, model: pm.model, noTools: cannotCallTools(p) };
}

/** A server that takes the tools list but never uses it (a proxy in front of the Claude Code CLI). Setting noTools on the provider decides; the Claude proxy is recognised by name and address. */
function cannotCallTools(p) {
  if (p && (p.noTools === true || p.noTools === false)) return p.noTools;
  return /claude|anthropic/i.test(String((p && p.name) || '')) && /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i.test(String((p && p.baseUrl) || ''));
}

/** { "prov:id:model": [in, out] } for models that have a price (local providers default to free). */
function priceMap(providers) {
  const out = {};
  for (const p of providers || []) {
    for (const m of p.models || []) {
      if (typeof m.in === 'number' || typeof m.out === 'number') out[prefixId(p.id, m.id)] = [m.in || 0, m.out || 0];
      else if (p.local) out[prefixId(p.id, m.id)] = [0, 0];
    }
  }
  return out;
}

/** Chat model list entries [id, label] for pickers outside the app UI (phone). */
const modelEntries = (providers) => (providers || []).filter((p) => p.enabled !== false).flatMap((p) => (p.models || []).map((m) => [prefixId(p.id, m.id), `${m.name || m.id} (${p.name})`]));

/** Ask the endpoint for its models; if it has no list, send a 1-token chat to prove the key/URL work. */
async function probe({ baseUrl, key, models, headers: extra }, fetchImpl = fetch) {
  const headers = { ...cleanHeaders(extra), 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) };
  if (!/^https?:\/\//i.test(String(baseUrl || ''))) return { ok: false, error: 'The endpoint URL must start with http:// or https://' };
  let listErr = '';
  try {
    const res = await fetchImpl(joinUrl(baseUrl, 'models'), { headers, signal: AbortSignal.timeout(12000) });
    if (res.ok) {
      const j = await res.json();
      const raw = Array.isArray(j) ? j : j.data || j.models || j.result || [];
      const ids = raw.map((m) => (typeof m === 'string' ? m : m && (m.id || m.name || m.model))).filter((x) => typeof x === 'string' && x);
      if (ids.length) return { ok: true, models: [...new Set(ids)] };
      listErr = 'The endpoint returned an empty model list.';
    } else if (res.status === 401 || res.status === 403) {
      return { ok: false, error: `The endpoint rejected the key (HTTP ${res.status}).` };
    } else listErr = `Model list not available (HTTP ${res.status}).`;
  } catch (e) {
    const msg = e && e.cause && e.cause.code ? `${e.cause.code}` : (e && e.message) || String(e);
    if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed/i.test(msg + (e && e.message))) return { ok: false, error: `Cannot reach ${baseUrl}. Is the server running? (${msg})` };
    listErr = msg;
  }
  const first = (models || [])[0];
  const mid = first && (first.id || first);
  if (!mid) return { ok: false, error: `${listErr} Add at least one model ID and test again.` };
  try {
    const res = await fetchImpl(joinUrl(baseUrl, 'chat/completions'), { method: 'POST', headers, body: JSON.stringify({ model: mid, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }), signal: AbortSignal.timeout(30000) });
    if (res.ok) return { ok: true, models: null, note: 'Connected. This endpoint does not list models, so add model IDs by hand.' };
    const t = (await res.text().catch(() => '')).slice(0, 200);
    return { ok: false, error: `HTTP ${res.status}: ${t || res.statusText}` };
  } catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
}

module.exports = { cannotCallTools, PRESETS, PREFIX, joinUrl, prefixId, parseModel, normalize, resolve, priceMap, modelEntries, probe, cleanHeaders, registerHeaders, headersFor, cleanRouting, routingFor, routingBody, ROUTING_SORTS };
