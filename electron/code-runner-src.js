// The child side of code mode (electron/code-mode.js). This file's text is run with `node -e` under
// --permission (no file writes, no child processes) and --disallow-code-generation-from-strings (no eval / Function,
// which also closes the usual vm escape), inside a fresh vm context that holds only what is defined below.
// It talks to the parent over the IPC channel: { type: 'run' } in; 'call' / 'log' / 'sleep' / 'done' out.
'use strict';
const vm = require('vm');
const send = (m) => { try { process.send(m); } catch {} };
let ctx = null;

const PRELUDE = `
(() => {
  const pending = new Map(); let n = 0;
  const send = __send; const names = JSON.parse(__names);
  const fmt = (v) => typeof v === 'string' ? v : (() => { try { return JSON.stringify(v, null, 2); } catch { return String(v); } })();
  const parse = (t) => { const s = String(t).trim(); if (/^[\\[{"]/.test(s) || /^(true|false|null|-?\\d)/.test(s)) { try { return JSON.parse(s); } catch {} } return t; };
  globalThis.__settle = (id, ok, text) => { const p = pending.get(id); if (!p) return; pending.delete(id); ok ? p.res(text) : p.rej(new Error(text)); };
  const wait = (msg) => new Promise((res, rej) => { const id = ++n; pending.set(id, { res, rej }); msg.id = id; send(JSON.stringify(msg)); });
  globalThis.callTool = async (name, args) => parse(await wait({ type: 'call', name: String(name), args: args === undefined ? {} : args }));
  globalThis.web = async (url, opts) => { const t = await wait({ type: 'web', url: String(url), opts: opts || {} }); const r = JSON.parse(t); r.json = () => JSON.parse(r.text); return r; };
  globalThis.args = JSON.parse(__args);
  globalThis.sleep = (ms) => wait({ type: 'sleep', ms: Math.max(0, Math.min(Number(ms) || 0, 30000)) });
  globalThis.setTimeout = (fn, ms) => { sleep(ms).then(() => fn()); return 0; };
  const tools = {};
  for (const full of names) {
    const m = /^mcp__(.+?)__(.+)$/.exec(full) || /^(artemis)__(.+)$/.exec(full); if (!m) continue;
    const key = (s) => s.replace(/[^A-Za-z0-9_$]/g, '_');
    const srv = tools[m[1]] || (tools[m[1]] = {}); if (key(m[1]) !== m[1]) tools[key(m[1])] = srv;
    srv[m[2]] = (args) => callTool(full, args); if (key(m[2]) !== m[2]) srv[key(m[2])] = srv[m[2]];
  }
  // a name the model guessed slightly wrong (add-comment for add-comments, add_comment, AddComments) still finds the tool;
  // an unknown one fails with the list of real names instead of "is not a function"
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '').replace(/s$/, '');
  const near = (obj, prop) => { if (typeof prop !== 'string') return undefined; if (prop in obj) return obj[prop]; const k = Object.keys(obj).find((x) => norm(x) === norm(prop)); return k ? obj[k] : undefined; };
  const real = (obj) => Object.keys(obj).filter((k) => !(k.indexOf('_') >= 0 && Object.keys(obj).indexOf(k.split('_').join('-')) >= 0));
  const wrapSrv = (srvName, srv) => new Proxy(srv, { get: (t, prop) => { const v = near(t, prop); if (v !== undefined || typeof prop !== 'string' || prop === 'then') return v;
    return () => Promise.reject(new Error('tools.' + srvName + ' has no tool "' + prop + '". Its tools: ' + real(t).join(', '))); } });
  const wrapped = {}; for (const k of Object.keys(tools)) wrapped[k] = wrapSrv(k, tools[k]);
  globalThis.tools = new Proxy(wrapped, { get: (t, prop) => { const v = near(t, prop); if (v !== undefined || typeof prop !== 'string' || prop === 'then') return v;
    return new Proxy({}, { get: (_x, tool) => (typeof tool !== 'string' || tool === 'then' ? undefined : () => Promise.reject(new Error('No connector "' + prop + '" here. Connected: ' + (Object.keys(t).join(', ') || 'none')))) }); } });
  const log = (level) => (...a) => send(JSON.stringify({ type: 'log', level, text: a.map(fmt).join(' ') }));
  globalThis.console = { log: log('log'), info: log('log'), debug: log('log'), warn: log('warn'), error: log('error'), table: log('log') };
  globalThis.__fmt = fmt;
})();`;

process.on('message', async (m) => {
  if (!m || typeof m !== 'object') return;
  if (m.type === 'result' && ctx) { try { ctx.__settle(m.id, !!m.ok, String(m.text == null ? '' : m.text)); } catch {} return; }
  if (m.type !== 'run') return;
  ctx = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false }, name: 'artemis-code' });
  ctx.__send = (s) => { try { send(JSON.parse(s)); } catch {} };
  ctx.__names = JSON.stringify(m.names || []);
  ctx.__args = JSON.stringify(m.args === undefined ? {} : m.args);
  try {
    vm.runInContext(PRELUDE, ctx, { timeout: 1000 });
    const wrapped = `(async () => { try { const r = await (async () => {\n${m.code}\n})(); return JSON.stringify({ ok: true, result: r === undefined ? null : __fmt(r) }); }
      catch (e) { return JSON.stringify({ ok: false, error: String(e && e.stack ? e.stack.split('\\n').slice(0, 4).join('\\n') : e) }); } })()`;
    const out = await vm.runInContext(wrapped, ctx, { timeout: m.syncTimeoutMs || 10000, filename: 'run_code.js', lineOffset: -1 });
    send({ type: 'done', ...JSON.parse(out) });
  } catch (e) {
    send({ type: 'done', ok: false, error: String((e && e.message) || e) });
  }
});
send({ type: 'ready' });
