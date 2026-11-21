// Moving this desktop's data to a paired Artemis server, desktop side (the server side is core/migrate-import.js).
// Reads only: the desktop's own data is never changed by the export. The package is built in a temporary folder
// (chats as JSON lines, settings without secrets), every file is hashed, the server gets a manifest, then the files
// (raw bytes, one request each, resumable), then "commit", and answers with a report.
// No Electron here: everything comes in through deps, so scripts/test-migrate.js runs it against a real server.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');

const AREAS = ['chats', 'media', 'projects', 'memory', 'skills', 'teams', 'settings', 'connectors', 'automations'];
const MEDIA_RE = /^[a-f0-9]{32}\.(png|jpg|gif|webp)$/;
const SEG_RE = /^[\p{L}\p{N}_ .@()+,'&=-]{1,200}$/u;

function walk(dir, base = '') {
  const out = [];
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    if (e.name.startsWith('.') || !SEG_RE.test(e.name)) continue; // hidden files and odd names stay home
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), rel));
    else if (e.isFile()) out.push(rel);
  }
  return out;
}
const sha256File = (f) => new Promise((resolve, reject) => { const h = crypto.createHash('sha256'); fs.createReadStream(f).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject); });

/**
 * deps: {
 *   dataDir, workspaceDir(), listChats() -> chats, readJson(name, fallback),
 *   providerKey(id) -> string, secret(name) -> string, mcpDecrypted() -> connectors with plain values,
 *   link: { request(path, opts), upload(path, file) }, from: { name, platform, version }, log?
 * }
 */
function createExporter(deps) {
  const { dataDir, workspaceDir, listChats, readJson, link, log = () => {} } = deps;

  /** What each area holds (counts and bytes), for the dialog. */
  function survey() {
    const size = (rels, root) => rels.reduce((n, r) => { try { return n + fs.statSync(path.join(root, r)).size; } catch { return n; } }, 0);
    const chats = (listChats() || []).filter((c) => c && !c.incognito);
    const media = walk(path.join(dataDir, 'media')).filter((r) => MEDIA_RE.test(r));
    const mem = walk(workspaceDir()).filter((r) => /\.md$/i.test(r));
    const skills = ['skills', 'agents', 'brains'].reduce((n, d) => n + walk(path.join(dataDir, d)).length, 0);
    const list = (n) => { const l = readJson(n, []); return Array.isArray(l) ? l.length : 0; };
    return {
      chats: { count: chats.length }, media: { count: media.length, bytes: size(media, path.join(dataDir, 'media')) },
      projects: { count: list('projects') }, memory: { count: mem.length }, skills: { count: skills },
      teams: { count: ((readJson('teams', {}) || {}).teams || []).length }, settings: { count: list('providers') },
      connectors: { count: list('mcp') }, automations: { count: list('schedules') + list('heartbeats') + list('hooks') },
      telegram: { configured: !!deps.secret('telegramToken') }
    };
  }

  /** Builds the package. options: { areas: [...], secrets: bool, telegram: 'move'|'keep', automations: 'move'|'keep' } */
  async function build(options = {}) {
    const areas = new Set((options.areas || AREAS).filter((a) => AREAS.includes(a)));
    if (options.automations !== 'move') areas.delete('automations');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'artemis-export-'));
    const entries = []; // { path, file }
    const gen = (rel, data) => { const f = path.join(tmp, rel); fs.writeFileSync(f, typeof data === 'string' ? data : JSON.stringify(data)); entries.push({ path: rel, file: f }); };
    const copyJson = (name) => { const v = readJson(name, null); if (v != null) gen(name + '.json', v); };

    if (areas.has('chats')) {
      const f = path.join(tmp, 'chats.jsonl');
      const fd = fs.openSync(f, 'w');
      for (const c of listChats() || []) if (c && !c.incognito) fs.writeSync(fd, JSON.stringify(c) + '\n');
      fs.closeSync(fd);
      entries.push({ path: 'chats.jsonl', file: f });
    }
    if (areas.has('media')) for (const r of walk(path.join(dataDir, 'media'))) if (MEDIA_RE.test(r)) entries.push({ path: 'media/' + r, file: path.join(dataDir, 'media', r) });
    if (areas.has('memory')) for (const r of walk(workspaceDir())) if (/\.md$/i.test(r)) entries.push({ path: 'workspace/' + r, file: path.join(workspaceDir(), r) });
    if (areas.has('skills')) for (const d of ['skills', 'agents', 'brains']) for (const r of walk(path.join(dataDir, d))) entries.push({ path: `${d}/${r}`, file: path.join(dataDir, d, r) });
    if (areas.has('projects')) copyJson('projects');
    if (areas.has('teams')) copyJson('teams');
    if (areas.has('automations')) { copyJson('schedules'); copyJson('heartbeats'); copyJson('hooks'); }
    if (areas.has('settings')) {
      const st = readJson('settings', {}) || {};
      gen('settings.json', Object.fromEntries(Object.entries(st).filter(([k]) => !/Enc$/.test(k))));
      copyJson('providers');
    }
    // secrets: decrypted here, only when the user said so; connector secrets travel as references
    const sec = { providerKeys: {}, connectors: {} };
    let n = 0;
    if (areas.has('connectors')) {
      const raw = readJson('mcp', []) || [];
      const plain = new Map((deps.mcpDecrypted() || []).map((c) => [c.id, c]));
      const ref = (rawV, plainV) => {
        if (typeof rawV !== 'string' || !rawV.startsWith('enc:')) return rawV;
        if (!options.secrets || !plainV) return 'secret:missing';
        const k = 's' + (++n); sec.connectors[k] = plainV; return 'secret:' + k;
      };
      const mapObj = (r, p) => (r && typeof r === 'object' && !Array.isArray(r) ? Object.fromEntries(Object.entries(r).map(([k, v]) => [k, ref(v, p && p[k])])) : r);
      gen('mcp.json', raw.map((c) => {
        if (!c || !c.id) return c;
        const p = plain.get(c.id) || {};
        const out = { ...c, env: mapObj(c.env, p.env), headers: mapObj(c.headers, p.headers) };
        if (c.clientSecret !== undefined) out.clientSecret = ref(c.clientSecret, p.clientSecret);
        if (c.oauth && typeof c.oauth === 'object') out.oauth = { ...c.oauth, accessToken: ref(c.oauth.accessToken, p.oauth && p.oauth.accessToken), refreshToken: ref(c.oauth.refreshToken, p.oauth && p.oauth.refreshToken) };
        return out;
      }));
    }
    if (options.secrets) {
      for (const p of readJson('providers', []) || []) { const k = p && p.id ? deps.providerKey(p.id) : ''; if (k) sec.providerKeys[p.id] = k; }
      for (const name of ['braveKey', 'makeToken']) { const v = deps.secret(name); if (v) sec[name] = v; }
    }
    if (options.telegram === 'move') { const t = deps.secret('telegramToken'); if (t) sec.telegramToken = t; }
    if (options.secrets || sec.telegramToken) gen('secrets.json', sec);

    const files = [];
    for (const e of entries) {
      const st = fs.statSync(e.file);
      files.push({ path: e.path, size: st.size, sha256: await sha256File(e.file), file: e.file });
    }
    return { tmp, files };
  }

  /**
   * Sends everything and applies it on the server. onProgress({ phase, done, total, bytes, bytesTotal, file }).
   * Returns the server's migration record with its report.
   */
  async function run(options = {}, onProgress = () => {}) {
    onProgress({ phase: 'preparing' });
    const pkg = await build(options);
    try {
      const manifest = { files: pkg.files.map(({ path: p, size, sha256 }) => ({ path: p, size, sha256 })), from: deps.from || {} };
      const r = await link.request('/v1/x/migrate', { method: 'POST', body: { manifest }, timeout: 60000 });
      const id = r.migration.id;
      const st = await link.request(`/v1/x/migrate/${id}?full=1`);
      const missing = new Set(st.migration.missing);
      const todo = pkg.files.filter((f) => missing.has(f.path));
      const bytesTotal = todo.reduce((n, f) => n + f.size, 0);
      let done = 0, bytes = 0;
      onProgress({ phase: 'sending', done, total: todo.length, bytes, bytesTotal });
      for (const f of todo) {
        let tries = 0;
        for (;;) {
          try { await link.upload(`/v1/x/migrate/${id}/file?path=${encodeURIComponent(f.path)}`, f.file, f.size); break; }
          catch (e) { if (++tries >= 3 || (e.status && e.status < 500 && e.status !== 422)) throw new Error(`Sending ${f.path} failed: ${e.message}`); await new Promise((res) => setTimeout(res, 1000 * tries)); }
        }
        done++; bytes += f.size;
        onProgress({ phase: 'sending', done, total: todo.length, bytes, bytesTotal, file: f.path });
      }
      onProgress({ phase: 'applying' });
      const out = await link.request(`/v1/x/migrate/${id}/commit`, { method: 'POST', body: { options: { automations: options.automations || 'keep', telegram: options.telegram || 'keep' } }, timeout: 30 * 60 * 1000 });
      onProgress({ phase: 'done' });
      log('info', `migration ${id} done`);
      return out.migration;
    } finally { fs.rmSync(pkg.tmp, { recursive: true, force: true }); }
  }

  return { survey, build, run, AREAS };
}

/** A file as a request body, streamed (for link.upload). */
const fileBody = (file) => Readable.toWeb(fs.createReadStream(file));

module.exports = { createExporter, fileBody, AREAS };
