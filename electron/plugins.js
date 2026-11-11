// Plugins: small apps the assistant (or the user) writes for Artemis, in the spirit of DeepSeek Harness's plugin
// creator. A plugin is a folder in <userData>/plugins/<slug>/ with a plugin.json:
//   { "name", "description", "version",
//     "tools":  [{ "name", "description", "parameters": {JSON schema}, "file": "tools/x.js" }],
//     "panels": [{ "id", "title", "file": "panel.html" }] }
// A tool file is the body of an async function: it reads `args`, may call `await web(url, {method, headers, body})`
// (→ { status, ok, headers, text, json() }) and connector tools (`tools.<server>.<tool>(args)`), and returns its answer.
// It runs in the code-mode sandbox (electron/code-mode.js). A panel is one self-contained HTML page shown in the side
// panel as a sandboxed artifact. Plugins are read from disk on use, so edits apply at once (hot reload).
const fs = require('fs');
const path = require('path');

const MAX_FILE = 512 * 1024, MAX_FILES = 40;
const slugOf = (name) => String(name || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const toolKey = (s) => String(s || '').replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 40);
const fullName = (slug, tool) => `plugin__${slug.replace(/-/g, '_')}__${toolKey(tool)}`;

/** Checks a manifest; returns { ok, manifest } with defaults filled in, or { ok: false, error }. */
function validateManifest(m, files = null) {
  if (!m || typeof m !== 'object') return { ok: false, error: 'plugin.json must be a JSON object' };
  const name = String(m.name || '').trim();
  if (!name || !slugOf(name)) return { ok: false, error: 'plugin.json needs a "name"' };
  const out = { name, description: String(m.description || '').slice(0, 400), version: String(m.version || '0.1.0'), tools: [], panels: [] };
  const seen = new Set();
  for (const t of Array.isArray(m.tools) ? m.tools : []) {
    const tn = toolKey(t && t.name);
    if (!tn) return { ok: false, error: 'every tool needs a "name"' };
    if (seen.has(tn)) return { ok: false, error: `two tools are called "${tn}"` };
    seen.add(tn);
    if (!t.file || !safeRel(t.file)) return { ok: false, error: `tool "${tn}" needs a "file" inside the plugin folder (e.g. tools/${tn}.js)` };
    if (files && !(t.file in files)) return { ok: false, error: `tool "${tn}": ${t.file} is missing` };
    const params = t.parameters && t.parameters.type === 'object' ? t.parameters : { type: 'object', properties: {} };
    out.tools.push({ name: tn, description: String(t.description || tn).slice(0, 600), parameters: params, file: t.file });
  }
  for (const p of Array.isArray(m.panels) ? m.panels : []) {
    if (!p || !p.file || !safeRel(p.file) || !/\.html?$/i.test(p.file)) return { ok: false, error: 'every panel needs an .html "file" inside the plugin folder' };
    if (files && !(p.file in files)) return { ok: false, error: `panel ${p.file} is missing` };
    out.panels.push({ id: slugOf(p.id || p.title || p.file) || 'panel', title: String(p.title || out.name).slice(0, 60), file: p.file });
  }
  if (!out.tools.length && !out.panels.length) return { ok: false, error: 'a plugin needs at least one tool or panel' };
  return { ok: true, manifest: out };
}
function safeRel(p) { const s = String(p || ''); return !!s && !path.isAbsolute(s) && !s.split(/[\\/]/).includes('..') && s.length < 200; }

/** deps: { dir, getDisabled(): string[], setDisabled(list), notify?() } */
function createPlugins(deps) {
  const dir = deps.dir;
  const disabled = () => new Set((deps.getDisabled && deps.getDisabled()) || []);
  const notify = () => { try { deps.notify && deps.notify(); } catch {} };

  function list() {
    let names = [];
    try { names = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; }
    const off = disabled();
    const out = [];
    for (const slug of names.sort()) {
      const root = path.join(dir, slug);
      let m;
      try { m = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8')); } catch (e) { out.push({ slug, root, ok: false, error: 'plugin.json: ' + e.message, enabled: false }); continue; }
      const v = validateManifest(m);
      out.push(v.ok ? { slug, root, ok: true, enabled: !off.has(slug), ...v.manifest } : { slug, root, ok: false, error: v.error, name: m.name || slug, enabled: false });
    }
    return out;
  }
  const enabled = () => list().filter((p) => p.ok && p.enabled);

  /** OpenAI function definitions for the enabled plugins' tools. */
  function definitions() {
    const defs = [];
    for (const p of enabled()) for (const t of p.tools) defs.push({ type: 'function', function: { name: fullName(p.slug, t.name), description: `[Plugin ${p.name}] ${t.description}`, parameters: t.parameters } });
    return defs;
  }
  function find(name) {
    for (const p of enabled()) for (const t of p.tools) if (fullName(p.slug, t.name) === name) return { plugin: p, tool: t };
    return null;
  }
  const readIn = (p, rel) => { const abs = path.join(p.root, rel); if (!abs.startsWith(p.root + path.sep)) throw new Error('bad path'); return fs.readFileSync(abs, 'utf8'); };

  /** Runs a plugin tool in the sandbox. hooks: { signal, web(url, opts), call(name, args), names } */
  async function run(name, args, hooks = {}) {
    const hit = find(name);
    if (!hit) throw new Error(`Plugin tool not found or switched off: ${name}`);
    const code = readIn(hit.plugin, hit.tool.file);
    return require('./code-mode').runCode(code, { args: args || {}, signal: hooks.signal, web: hooks.web, call: hooks.call || (async () => ({ ok: false, text: 'connectors are not available' })), names: hooks.names || [] });
  }

  /** Writes a plugin (create or update). files: { relPath: text } including plugin.json (or `manifest` separately). */
  function save({ manifest, files = {}, replace = false }) {
    const all = { ...files };
    if (manifest) all['plugin.json'] = typeof manifest === 'string' ? manifest : JSON.stringify(manifest, null, 2);
    let m;
    const slug0 = (() => { try { m = JSON.parse(all['plugin.json'] || 'null'); } catch (e) { throw new Error('plugin.json is not valid JSON: ' + e.message); } return m ? slugOf(m.name) : ''; })();
    const existingRoot = slug0 ? path.join(dir, slug0) : '';
    if (!m && existingRoot && fs.existsSync(path.join(existingRoot, 'plugin.json'))) m = JSON.parse(fs.readFileSync(path.join(existingRoot, 'plugin.json'), 'utf8'));
    if (!m) throw new Error('give plugin.json (the manifest)');
    const keys = Object.keys(all);
    if (keys.length > MAX_FILES) throw new Error(`too many files (max ${MAX_FILES})`);
    for (const k of keys) { if (!safeRel(k)) throw new Error(`bad file path: ${k}`); if (Buffer.byteLength(String(all[k])) > MAX_FILE) throw new Error(`${k} is too large`); }
    const root = path.join(dir, slugOf(m.name));
    const onDisk = {};
    if (!replace && fs.existsSync(root)) for (const f of walk(root)) onDisk[f] = true;
    const v = validateManifest(m, { ...onDisk, ...Object.fromEntries(keys.map((k) => [k, true])) });
    if (!v.ok) throw new Error(v.error);
    if (replace && fs.existsSync(root)) fs.rmSync(root, { recursive: true, force: true });
    for (const k of keys) {
      const abs = path.join(root, k);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      const tmp = abs + '.tmp-' + process.pid;
      fs.writeFileSync(tmp, String(all[k])); fs.renameSync(tmp, abs);
    }
    notify();
    return { slug: slugOf(m.name), root, manifest: v.manifest };
  }
  function walk(root, rel = '') {
    const out = [];
    for (const d of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const r = rel ? rel + '/' + d.name : d.name;
      if (d.isDirectory()) out.push(...walk(root, r)); else out.push(r);
    }
    return out;
  }
  function get(slug) {
    const p = list().find((x) => x.slug === slugOf(slug) || String(x.name).toLowerCase() === String(slug).toLowerCase());
    if (!p) return null;
    const files = {};
    for (const f of walk(p.root).slice(0, MAX_FILES)) { try { files[f] = fs.readFileSync(path.join(p.root, f), 'utf8').slice(0, 20000); } catch {} }
    return { ...p, files };
  }
  function remove(slug) {
    const p = list().find((x) => x.slug === slugOf(slug));
    if (!p) return false;
    fs.rmSync(p.root, { recursive: true, force: true });
    setEnabled(p.slug, true); notify();
    return true;
  }
  function setEnabled(slug, on) {
    const off = disabled();
    if (on) off.delete(slug); else off.add(slug);
    deps.setDisabled && deps.setDisabled([...off]); notify();
  }
  function panel(slug, id) {
    const p = list().find((x) => x.slug === slug && x.ok);
    const pn = p && (p.panels.find((x) => x.id === id) || p.panels[0]);
    if (!pn) return null;
    return { title: pn.title, html: readIn(p, pn.file), plugin: p.name };
  }
  // ---- each plugin's own data (a plugin window keeps its state here), outside the plugin folder so a save never wipes it
  const dataFile = (slug) => path.join(deps.dataDir || path.join(dir, '..', 'plugin-data'), slugOf(slug) + '.json');
  const dataAll = (slug) => { try { return JSON.parse(fs.readFileSync(dataFile(slug), 'utf8')) || {}; } catch { return {}; } };
  function dataSet(slug, key, value) {
    const all = dataAll(slug);
    if (value === undefined || value === null) delete all[String(key)]; else all[String(key)] = value;
    const text = JSON.stringify(all);
    if (text.length > 5 * 1024 * 1024) throw new Error('plugin data is limited to 5 MB');
    fs.mkdirSync(path.dirname(dataFile(slug)), { recursive: true });
    const tmp = dataFile(slug) + '.tmp-' + process.pid; fs.writeFileSync(tmp, text); fs.renameSync(tmp, dataFile(slug));
    return true;
  }
  /** A file of a working plugin, for the plugin window (artemis-plugin://<slug>/<file>); null when outside or missing. */
  function fileOf(slug, rel) {
    const p = list().find((x) => x.slug === slug && x.ok);
    if (!p) return null;
    const abs = path.resolve(p.root, String(rel || '').replace(/^\/+/, ''));
    if (!abs.startsWith(p.root + path.sep)) return null;
    try { return fs.statSync(abs).isFile() ? abs : null; } catch { return null; }
  }
  return { list, definitions, find, run, save, get, remove, setEnabled, panel, dir, dataAll, dataSet, fileOf, appPage: (slug) => { const p = list().find((x) => x.slug === slug && x.ok); return p ? appPage(p) : null; } };
}

const escHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** The window of a plugin without a panel: a small app made from its tools (a form per tool from its JSON schema, Run, output). */
function appPage(p) {
  const field = (k, sc, req) => {
    const t = sc && sc.type, label = `<span>${escHtml(k)}${req ? ' *' : ''}</span>`, hint = sc && sc.description ? `<small>${escHtml(sc.description)}</small>` : '';
    if (sc && Array.isArray(sc.enum)) return `<label>${label}<select name="${escHtml(k)}">${sc.enum.map((v) => `<option>${escHtml(v)}</option>`).join('')}</select>${hint}</label>`;
    if (t === 'boolean') return `<label class="row"><input type="checkbox" name="${escHtml(k)}" data-t="boolean"> ${escHtml(k)}${hint}</label>`;
    if (t === 'object' || t === 'array') return `<label>${label}<textarea name="${escHtml(k)}" data-t="json" rows="3" placeholder="${t === 'array' ? '[ ]' : '{ }'}"></textarea>${hint}</label>`;
    return `<label>${label}<input name="${escHtml(k)}" data-t="${t === 'number' || t === 'integer' ? 'number' : 'string'}" ${req ? 'required' : ''}>${hint}</label>`;
  };
  const cards = p.tools.map((t) => {
    const props = (t.parameters && t.parameters.properties) || {}, req = new Set((t.parameters && t.parameters.required) || []);
    return `<form class="card" data-tool="${escHtml(t.name)}"><h2>${escHtml(t.name.replace(/_/g, ' '))}</h2><p>${escHtml(t.description)}</p>${Object.keys(props).map((k) => field(k, props[k], req.has(k))).join('')}<button type="submit">Run</button><pre class="out" hidden></pre></form>`;
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escHtml(p.name)}</title><style>
:root{color-scheme:light dark;--bg:#faf9f7;--card:#fff;--line:#e6e3de;--text:#1f1e1c;--muted:#78736b;--accent:#6b5cff}
@media (prefers-color-scheme:dark){:root{--bg:#1a1a19;--card:#232322;--line:#363533;--text:#ecebe8;--muted:#9c978f}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
header{padding:28px 28px 8px}h1{margin:0;font:600 24px/1.2 Georgia,serif}header p{margin:6px 0 0;color:var(--muted)}
main{padding:16px 28px 40px;display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(320px,1fr))}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px;display:flex;flex-direction:column;gap:10px}
.card h2{margin:0;font-size:16px;text-transform:capitalize}.card p{margin:0;color:var(--muted)}label{display:flex;flex-direction:column;gap:4px;font-size:13px}label.row{flex-direction:row;align-items:center;gap:8px}
small{color:var(--muted)}input,select,textarea{font:inherit;color:inherit;background:var(--bg);border:1px solid var(--line);border-radius:9px;padding:8px 10px}
button{align-self:flex-start;font:inherit;font-weight:600;color:#fff;background:var(--accent);border:0;border-radius:9px;padding:8px 16px;cursor:pointer}button:disabled{opacity:.6}
pre{margin:0;white-space:pre-wrap;word-break:break-word;background:var(--bg);border:1px solid var(--line);border-radius:9px;padding:10px;max-height:360px;overflow:auto;font:12.5px/1.45 ui-monospace,Menlo,monospace}pre.err{border-color:#d4483b}
</style></head><body><header><h1>${escHtml(p.name)}</h1><p>${escHtml(p.description || '')}</p></header><main>${cards || '<p>This plugin has no tools.</p>'}</main>
<script src="artemis-plugin://${escHtml(p.slug)}/__app__.js"></script></body></html>`;
}
const APP_JS = `document.querySelectorAll('form[data-tool]').forEach((f) => f.addEventListener('submit', async (e) => {
  e.preventDefault(); const out = f.querySelector('.out'), b = f.querySelector('button'); const args = {};
  for (const el of f.querySelectorAll('[name]')) { const t = el.dataset.t; if (t === 'boolean') { args[el.name] = el.checked; continue; } const v = el.value.trim(); if (!v) continue;
    try { args[el.name] = t === 'number' ? Number(v) : t === 'json' ? JSON.parse(v) : v; } catch { out.hidden = false; out.className = 'out err'; out.textContent = el.name + ': not valid JSON'; return; } }
  b.disabled = true; out.hidden = false; out.className = 'out'; out.textContent = 'Running…';
  try { const r = await window.artemis.tool(f.dataset.tool, args); out.className = r.ok ? 'out' : 'out err'; out.textContent = r.text; }
  catch (err) { out.className = 'out err'; out.textContent = String(err && err.message || err); } finally { b.disabled = false; }
}));`;

const MANAGER_DEF = {
  type: 'function',
  function: {
    name: 'plugin_manager',
    description: 'Builds and manages Artemis plugins: small apps that add tools and panels to Artemis. Use it when the user asks for a new '
      + 'capability or mini app Artemis does not have (a tracker, a converter, an API integration). Actions: list; get (name); save (manifest + files); '
      + 'test (name, tool, args: runs one tool); enable / disable / remove (name). '
      + 'Manifest (plugin.json): {"name","description","version","tools":[{"name","description","parameters":{JSON schema},"file":"tools/<name>.js"}],'
      + '"panels":[{"id","title","file":"panel.html"}]}. A plugin opens as its own app window: its first panel, or (no panel) a form per tool. A tool file is the BODY of an async function (no imports, no require): read `args`, '
      + 'call `await web(url, {method, headers, body})` for HTTP (returns {status, ok, text, json()}), `await tools.<server>.<tool>(args)` for connectors (MCP: use the exact server and tool names from connector_tools or the connector list), '
      + 'and `return` the answer (a string or JSON-able value). A panel is one self-contained HTML page (inline CSS/JS) shown in the side panel; '
      + 'it can run the plugin\'s own tools with `await artemis.tool("<tool>", args)` (→ {ok, text}), call connectors (MCP) directly with `await artemis.call("mcp__<server>__<tool>", args)` (→ {ok, text}; list them with `await artemis.connectors()`), '
      + 'and keep data with `await artemis.data.get(key)` / `artemis.data.set(key, value)`; the user allows each connector once per plugin. '
      + 'it may load scripts from cdn.jsdelivr.net, unpkg.com or cdnjs.cloudflare.com and fetch https APIs. After save, test each tool, fix errors, then tell the user. '
      + 'Saved plugin tools are available as plugin__<plugin>__<tool> from the next message.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'get', 'save', 'test', 'enable', 'disable', 'remove'] },
        name: { type: 'string', description: 'Plugin name (get, test, enable, disable, remove)' },
        manifest: { type: 'object', description: 'plugin.json content (save)' },
        files: { type: 'object', description: 'Other files to write: { "tools/x.js": "code", "panel.html": "<!doctype html>…" } (save)' },
        replace: { type: 'boolean', description: 'save: delete files that are not given (default: keep them)' },
        tool: { type: 'string', description: 'test: the tool name inside the plugin' },
        args: { type: 'object', description: 'test: arguments for the tool' }
      },
      required: ['action']
    }
  }
};

module.exports = { createPlugins, validateManifest, slugOf, fullName, MANAGER_DEF, APP_JS };
