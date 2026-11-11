// Code mode for connectors (the DeepSeek Harness "PTC" idea / Anthropic's "code execution with MCP"): instead of
// sending every connector tool's JSON schema with each request, the model gets one run_code tool and writes a short
// JavaScript program that calls `tools.<server>.<tool>(args)`. Intermediate results stay inside the program; only what
// it prints comes back, so big listings are filtered before they reach the context.
//
// The program runs in a separate process (electron/code-runner-src.js) under Node's permission model with string code
// generation disabled. Every connector call goes back through the normal tool runner, so approvals work as usual.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const RUNNER = fs.readFileSync(path.join(__dirname, 'code-runner-src.js'), 'utf8');
const TIMEOUT_MS = 120000, MAX_OUT = 24000, MAX_CALLS = 300;
const HARD_FLAGS = ['--permission', '--disallow-code-generation-from-strings', '--max-old-space-size=256'];
const SOFT_FLAGS = ['--disallow-code-generation-from-strings', '--max-old-space-size=256'];
let permissionWorks = null; // learned on first run: some runtimes refuse --permission

function spawnRunner(execPath, flags) {
  const env = { ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '' };
  for (const k of ['PATH', 'SystemRoot', 'TEMP', 'TMP', 'HOME', 'USERPROFILE']) if (process.env[k]) env[k] = process.env[k];
  return spawn(execPath, [...flags, '-e', RUNNER], { env, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true, serialization: 'json' });
}

/** Starts a runner and waits for it to say ready; falls back to the soft flags when --permission is refused. */
function start(execPath) {
  const attempt = (flags) => new Promise((resolve, reject) => {
    const child = spawnRunner(execPath, flags);
    let err = '';
    child.stderr.on('data', (d) => { err += d; if (err.length > 4000) err = err.slice(-4000); });
    const fail = (e) => { cleanup(); reject(e); };
    const onMsg = (m) => { if (m && m.type === 'ready') { cleanup(); resolve(child); } };
    const onExit = (code) => fail(new Error(`code runner exited (${code})${err ? ': ' + err.trim().split('\n').slice(-2).join(' ') : ''}`));
    const t = setTimeout(() => { try { child.kill(); } catch {} fail(new Error('code runner did not start')); }, 15000);
    function cleanup() { clearTimeout(t); child.off('message', onMsg); child.off('exit', onExit); child.off('error', fail); }
    child.on('message', onMsg); child.once('exit', onExit); child.once('error', fail);
  });
  if (permissionWorks === false) return attempt(SOFT_FLAGS);
  return attempt(HARD_FLAGS).then((c) => { permissionWorks = true; return c; }, (e) => {
    if (permissionWorks === true) throw e;
    permissionWorks = false;
    return attempt(SOFT_FLAGS);
  });
}

const clipOut = (s) => (s.length > MAX_OUT ? s.slice(0, MAX_OUT - 400) + `\n…[output cut: ${s.length} chars. Print less: filter, slice or summarise inside the program.]` : s);

/**
 * Runs one program. call(name, args) → { ok, text } runs a connector tool through the normal tool path; names are the
 * full tool names the program may call (mcp__server__tool). Resolves { ok, text } for the model.
 */
async function runCode(code, { call, names = [], signal, timeoutMs = TIMEOUT_MS, execPath = process.execPath, args, web } = {}) {
  if (!String(code || '').trim()) return { ok: false, text: 'Error: no code given.' };
  const allowed = new Set(names);
  const child = await start(execPath);
  const logs = [];
  let size = 0, calls = 0, done = false;
  const push = (line) => { if (size > MAX_OUT * 2) return; logs.push(line); size += line.length + 1; };
  return new Promise((resolve) => {
    const finish = (r) => {
      if (done) return; done = true;
      clearTimeout(timer); if (signal) signal.removeEventListener('abort', onAbort);
      try { child.kill(); } catch {}
      const parts = [];
      if (logs.length) parts.push(logs.join('\n'));
      if (r.ok && r.result != null && r.result !== '') parts.push((logs.length ? 'Result: ' : '') + r.result);
      if (!r.ok) parts.push('Error: ' + r.error);
      if (!parts.length) parts.push('(the program printed nothing; use console.log or return a value)');
      resolve({ ok: !!r.ok, text: clipOut(parts.join('\n')), calls });
    };
    const onAbort = () => finish({ ok: false, error: 'stopped' });
    const timer = setTimeout(() => finish({ ok: false, error: `the program ran longer than ${Math.round(timeoutMs / 1000)} s and was stopped` }), timeoutMs);
    if (signal) { if (signal.aborted) return onAbort(); signal.addEventListener('abort', onAbort); }
    child.on('exit', (c) => finish({ ok: false, error: `the program's process ended (${c})` }));
    child.on('message', async (m) => {
      if (!m || done) return;
      if (m.type === 'log') push((m.level === 'log' ? '' : `[${m.level}] `) + String(m.text));
      else if (m.type === 'done') finish(m);
      else if (m.type === 'web') {
        let r;
        if (!web) r = { ok: false, text: 'web() is not available here' };
        else { try { r = { ok: true, text: JSON.stringify(await web(m.url, m.opts || {})) }; } catch (e) { r = { ok: false, text: String(e && e.message || e) }; } }
        if (!done) child.send({ type: 'result', id: m.id, ok: r.ok, text: r.text });
      }
      else if (m.type === 'sleep') setTimeout(() => { if (!done) child.send({ type: 'result', id: m.id, ok: true, text: '' }); }, m.ms);
      else if (m.type === 'call') {
        let r;
        if (++calls > MAX_CALLS) r = { ok: false, text: `too many tool calls in one program (max ${MAX_CALLS})` };
        else if (!allowed.has(m.name)) r = { ok: false, text: `unknown tool ${m.name}. Available: ${[...allowed].slice(0, 40).join(', ')}` };
        else { try { r = await call(m.name, m.args || {}); } catch (e) { r = { ok: false, text: String(e && e.message || e) }; } }
        if (r && r.denied) r = { ok: false, text: r.text || 'The user declined this tool call.' };
        if (!done) child.send({ type: 'result', id: m.id, ok: !!(r && r.ok !== false), text: String((r && r.text) || '') });
      }
    });
    child.send({ type: 'run', code: String(code), names: [...allowed], args });
  });
}

/** Compact signatures for the model: `server.tool({a: string, b?: number}) — description`, filtered by a query. */
function describeTools(defs, { query = '', limit = 30 } = {}) {
  const q = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const rows = [];
  for (const d of defs || []) {
    const f = d.function || d; const m = /^mcp__(.+?)__(.+)$/.exec(f.name || '') || /^(artemis)__(.+)$/.exec(f.name || ''); if (!m) continue;
    const hay = (f.name + ' ' + (f.description || '')).toLowerCase();
    if (q.length && !q.every((w) => hay.includes(w))) continue;
    rows.push(`tools.${m[1]}.${m[2]}(${sigOf(f.parameters)}) — ${String(f.description || '').replace(/^\[[^\]]*\]\s*/, '').replace(/\s+/g, ' ').slice(0, 220)}`);
  }
  if (!rows.length) return q.length ? `No connector tool matches "${query}".` : 'No connector tools are connected.';
  return rows.slice(0, limit).join('\n') + (rows.length > limit ? `\n…${rows.length - limit} more: narrow the query.` : '');
}

function typeOf(s) {
  if (!s || typeof s !== 'object') return 'any';
  if (Array.isArray(s.enum)) return s.enum.slice(0, 6).map((x) => JSON.stringify(x)).join('|') + (s.enum.length > 6 ? '|…' : '');
  const t = Array.isArray(s.type) ? s.type.join('|') : s.type;
  if (t === 'array') return typeOf(s.items) + '[]';
  if (t === 'object' && s.properties) return sigOf(s);
  return t || (s.anyOf || s.oneOf ? (s.anyOf || s.oneOf).map(typeOf).join('|') : 'any');
}
function sigOf(schema) {
  const props = (schema && schema.properties) || {};
  const req = new Set((schema && schema.required) || []);
  const keys = Object.keys(props);
  if (!keys.length) return '';
  return '{' + keys.slice(0, 12).map((k) => `${k}${req.has(k) ? '' : '?'}: ${typeOf(props[k])}`).join(', ') + (keys.length > 12 ? ', …' : '') + '}';
}

const RUN_CODE_DEF = {
  type: 'function',
  function: {
    name: 'run_code',
    description: 'Runs a short JavaScript program (JavaScript, not Python: use arr.length, JSON.parse, for...of; async, top-level await works) that uses Artemis\'s tools and the connectors. Call a tool with '
      + '`await tools.artemis.<tool>({...args})` (files, documents, diagrams, spreadsheets, web, notes) or `await tools.<server>.<tool>({...args})` (connectors): '
      + 'it returns parsed JSON when the tool answers JSON, else its text, and throws on errors. '
      + 'Only what you console.log or return comes back to you, so filter, join and summarise inside the program instead of printing raw listings. '
      + 'Also available: callTool("mcp__server__tool", args), sleep(ms). No require, files, network or eval. Find tool names and arguments with connector_tools first.',
    parameters: { type: 'object', properties: { code: { type: 'string', description: 'The program' } }, required: ['code'] }
  }
};
const CONNECTOR_TOOLS_DEF = {
  type: 'function',
  function: {
    name: 'connector_tools',
    description: 'Lists the tools run_code can call, as code signatures: tools.artemis.<tool>({args}) and tools.<server>.<tool>({args}), with what they do. Pass words to search (e.g. "spreadsheet", "calendar events").',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'Words to match; empty lists all' } } }
  }
};
const PROMPT = 'Code mode is on. When a task needs more than one tool call (reading several files, turning data into a file, '
  + 'calling connectors, looping over items), do it in ONE run_code program: tools.artemis.* for files, documents (create_document), '
  + 'diagrams (create_diagram), spreadsheets, shell commands (run_command, still asks first) and the web, tools.<server>.* for connectors. Look up exact names and arguments with connector_tools. '
  + 'Keep data inside the program and print only a short result. Single quick reads may still use the normal tools. Never write Python or shell '
  + 'scripts to generate documents, PDFs, spreadsheets or diagrams.';
/** Artemis tools a program may call as tools.artemis.<name> (approvals still apply to each call). */
const ARTEMIS_IN_CODE = new Set(['read_file', 'list_dir', 'search_files', 'write_file', 'edit_file', 'write_spreadsheet', 'update_cells', 'create_document', 'create_diagram', 'run_command',
  'create_folder', 'move_file', 'web_search', 'web_fetch', 'library_list', 'library_search', 'library_read', 'notes_list', 'notes_search', 'notes_read', 'memory_search']);

module.exports = { runCode, describeTools, sigOf, RUN_CODE_DEF, CONNECTOR_TOOLS_DEF, PROMPT, MAX_CALLS, ARTEMIS_IN_CODE };
