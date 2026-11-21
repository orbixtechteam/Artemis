// Moving a desktop's data to a server, server side. The desktop (electron/migrate-export.js) sends a manifest, then each
// file as raw bytes, then "commit". Nothing is applied until every file has arrived with the size and sha256 the manifest
// promised. Before applying, the server's data is backed up (<data>/backups/<time>/). Applying twice adds nothing twice:
// chats are matched by id (new messages merged by message id), files by content, lists by id.
//
// Files a migration may carry (paths relative to the package):
//   chats.jsonl            one chat per line, the desktop's format
//   projects.json teams.json settings.json providers.json schedules.json heartbeats.json hooks.json mcp.json secrets.json
//   media/<hash>.<ext>     chat images      workspace/**.md   memory      skills/** agents/** brains/**   their folders
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');

const TOP = new Set(['chats.jsonl', 'projects.json', 'teams.json', 'settings.json', 'providers.json', 'schedules.json', 'heartbeats.json', 'hooks.json', 'mcp.json', 'secrets.json']);
const DIRS = new Set(['media', 'workspace', 'skills', 'agents', 'brains']);
const MEDIA_RE = /^[a-f0-9]{32}\.(png|jpg|gif|webp)$/;
const SEG_RE = /^[\p{L}\p{N}_ .@()+,'&=-]{1,200}$/u;
const MAX_FILE = 512 * 1024 * 1024;
const MAX_TOTAL = 20 * 1024 * 1024 * 1024;
const MAX_FILES = 50000;
// settings that belong to the machine, never copied from another one
const LOCAL_SETTINGS = /Enc$|^(workspaceFolder|notesFolder|filesFolder|serverLink|serverPublicHosts|serverAllowedOrigins|gatewayEnabled|gatewayPort|gatewayToken|mcpServer\w*|hooksPort|hooksTunnel\w*|launchAtLogin|openAtLogin|shortcut\w*|sentinel\w*|wakeword\w*|lock\w*|windowBounds|zoom\w*)$/;

/** A package path, or throws: no absolute paths, no "..", no hidden or odd names, only known areas. */
function safeRel(p) {
  try { return checkRel(p); } catch (e) { throw Object.assign(e, { status: 400 }); }
}
function checkRel(p) {
  const s = String(p || '');
  if (!s || s.length > 1000 || s.includes('\\') || s.includes('\0') || s.startsWith('/')) throw new Error(`Bad path: ${s.slice(0, 80)}`);
  const parts = s.split('/');
  if (parts.some((x) => !x || x === '.' || x === '..' || x.startsWith('.') || !SEG_RE.test(x))) throw new Error(`Bad path: ${s.slice(0, 80)}`);
  if (parts.length === 1) { if (!TOP.has(s)) throw new Error(`Not allowed in a migration: ${s}`); return s; }
  if (!DIRS.has(parts[0])) throw new Error(`Not allowed in a migration: ${s.slice(0, 80)}`);
  if (parts[0] === 'media' && (parts.length !== 2 || !MEDIA_RE.test(parts[1]))) throw new Error(`Bad media file: ${s.slice(0, 80)}`);
  if (parts[0] === 'workspace' && !/\.md$/i.test(s)) throw new Error(`Only Markdown files in workspace/: ${s.slice(0, 80)}`);
  return s;
}
const inside = (root, rel) => { const f = path.resolve(root, rel); if (!f.startsWith(path.resolve(root) + path.sep)) throw new Error('Bad path'); return f; };
const sha256File = (f) => new Promise((resolve, reject) => { const h = crypto.createHash('sha256'); fs.createReadStream(f).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject); });
const readJsonFile = (f, fb) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } };
const sameFile = (a, b) => { try { const x = fs.readFileSync(a), y = fs.readFileSync(b); return x.length === y.length && x.equals(y); } catch { return false; } };

/** Lines of `incoming` that `existing` does not have, appended in their order (memory files: entries are lines). */
function unionLines(existing, incoming) {
  const have = new Set(existing.split('\n').map((l) => l.trimEnd()));
  const add = incoming.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() && !have.has(l));
  if (!add.length) return null;
  return existing.replace(/\n*$/, '\n') + add.join('\n') + '\n';
}
/** Lists merged by id: the server's entries stay, new ids are added. */
function mergeById(mine, theirs) {
  const a = Array.isArray(mine) ? mine : [];
  const ids = new Set(a.map((x) => x && x.id));
  const add = (Array.isArray(theirs) ? theirs : []).filter((x) => x && x.id != null && !ids.has(x.id));
  return { list: [...a, ...add], added: add.length, skipped: (Array.isArray(theirs) ? theirs.length : 0) - add.length };
}

/**
 * deps: { dataDir, sessions, workspaceDir() , backupDb(file), secretStore?, onApplied?(report), log?, now? }
 */
function createMigrations({ dataDir, sessions, workspaceDir = () => path.join(dataDir, 'workspace'), backupDb = null, secretStore = null, onApplied = () => {}, log = () => {}, now = () => Date.now() }) {
  const root = path.join(dataDir, 'migrate');
  const dirOf = (id) => { if (!/^mig_[a-f0-9]{16}$/.test(String(id))) throw Object.assign(new Error('No such migration'), { status: 404 }); return path.join(root, id); };
  const stateFile = (id) => path.join(dirOf(id), 'state.json');
  const load = (id) => { const s = readJsonFile(stateFile(id), null); if (!s) throw Object.assign(new Error('No such migration'), { status: 404 }); return s; };
  const save = (s) => { const f = stateFile(s.id); fs.writeFileSync(f + '.tmp', JSON.stringify(s)); fs.renameSync(f + '.tmp', f); };
  const busy = new Set();

  function pub(s, full = false) {
    const files = s.manifest.files;
    const got = files.filter((f) => s.received[f.path]);
    return { id: s.id, status: s.status, createdAt: s.createdAt, from: s.from, files: files.length, received: got.length, bytes: files.reduce((n, f) => n + f.size, 0), bytesReceived: got.reduce((n, f) => n + f.size, 0), missing: files.filter((f) => !s.received[f.path]).map((f) => f.path).slice(0, full ? Infinity : 50), report: s.report || null, error: s.error || '' };
  }

  /** manifest: { files: [{ path, size, sha256 }], from?: { name, platform, version } }. A retry with the same manifest continues the open migration. */
  function start(manifest = {}, { client = null } = {}) {
    const files = Array.isArray(manifest.files) ? manifest.files : [];
    if (!files.length) throw Object.assign(new Error('Nothing to move'), { status: 400 });
    if (files.length > MAX_FILES) throw Object.assign(new Error('Too many files'), { status: 413 });
    const seen = new Set(); let total = 0;
    const clean = files.map((f) => {
      const p = safeRel(f && f.path);
      if (seen.has(p)) throw Object.assign(new Error(`Listed twice: ${p}`), { status: 400 });
      seen.add(p);
      const size = Number(f.size);
      if (!Number.isInteger(size) || size < 0 || size > MAX_FILE) throw Object.assign(new Error(`Bad size for ${p}`), { status: 400 });
      if (!/^[a-f0-9]{64}$/.test(String(f.sha256))) throw Object.assign(new Error(`Bad sha256 for ${p}`), { status: 400 });
      total += size;
      return { path: p, size, sha256: String(f.sha256) };
    });
    if (total > MAX_TOTAL) throw Object.assign(new Error('The data is larger than 20 GB'), { status: 413 });
    const key = crypto.createHash('sha256').update(JSON.stringify(clean)).digest('hex');
    fs.mkdirSync(root, { recursive: true });
    for (const d of fs.readdirSync(root)) { // the same package again (an interrupted upload): continue it
      const s = readJsonFile(path.join(root, d, 'state.json'), null);
      if (s && s.key === key && s.status === 'receiving') return pub(s);
    }
    const id = 'mig_' + crypto.randomBytes(8).toString('hex');
    fs.mkdirSync(path.join(dirOf(id), 'files'), { recursive: true, mode: 0o700 });
    const s = { id, key, status: 'receiving', createdAt: now(), from: { name: String((manifest.from && manifest.from.name) || (client && client.name) || '').slice(0, 80), platform: String((manifest.from && manifest.from.platform) || '').slice(0, 20), version: String((manifest.from && manifest.from.version) || '').slice(0, 20) }, manifest: { files: clean }, received: {} };
    save(s);
    log('info', `migration ${id} started: ${clean.length} files, ${Math.round(total / 1048576)} MB`);
    return pub(s);
  }

  /** One file's bytes (a readable stream). Checked against the manifest; a file that already arrived is accepted again. */
  async function receive(id, rel, stream) {
    const s = load(id);
    if (s.status !== 'receiving') throw Object.assign(new Error('This migration is not receiving files any more'), { status: 409 });
    const p = safeRel(rel);
    const want = s.manifest.files.find((f) => f.path === p);
    if (!want) throw Object.assign(new Error(`Not in the manifest: ${p}`), { status: 400 });
    const dest = inside(path.join(dirOf(id), 'files'), p);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = dest + '.part-' + crypto.randomBytes(4).toString('hex');
    const h = crypto.createHash('sha256');
    let size = 0;
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(tmp, { mode: 0o600 });
      let over = false;
      // too many bytes: stop writing but read the rest, so the client gets a clear answer instead of a cut connection
      stream.on('data', (c) => {
        if (over) return;
        size += c.length;
        if (size > want.size) { over = true; out.destroy(); return; }
        h.update(c);
        if (!out.write(c)) { stream.pause(); out.once('drain', () => stream.resume()); }
      });
      stream.on('end', () => { if (over) reject(Object.assign(new Error(`${p} is larger than announced`), { status: 413 })); else out.end(); });
      stream.on('error', reject);
      out.on('error', (e) => { if (!over) reject(e); });
      out.on('finish', resolve);
    }).catch((e) => { try { fs.unlinkSync(tmp); } catch {} throw e; });
    const sum = h.digest('hex');
    if (size !== want.size || sum !== want.sha256) { try { fs.unlinkSync(tmp); } catch {} throw Object.assign(new Error(`${p} arrived damaged (size or checksum differs). Send it again.`), { status: 422 }); }
    fs.renameSync(tmp, dest);
    const fresh = load(id); fresh.received[p] = true; save(fresh);
    return { path: p, ok: true };
  }

  const status = (id, full = false) => pub(load(id), full);
  const list = () => { try { return fs.readdirSync(root).map((d) => readJsonFile(path.join(root, d, 'state.json'), null)).filter(Boolean).map(pub).sort((a, b) => b.createdAt - a.createdAt); } catch { return []; } };
  function cancel(id) { const s = load(id); if (s.status === 'applying') throw Object.assign(new Error('Already applying'), { status: 409 }); fs.rmSync(dirOf(id), { recursive: true, force: true }); return { ok: true }; }

  /** Backs up the server's data, applies the package, returns the report. options: { automations: 'move'|'keep', telegram: 'move'|'keep' } */
  async function commit(id, options = {}) {
    if (busy.has(id)) throw Object.assign(new Error('Already applying'), { status: 409 });
    const s = load(id);
    if (s.status === 'done') return pub(s);
    const missing = s.manifest.files.filter((f) => !s.received[f.path]);
    if (missing.length) throw Object.assign(new Error(`${missing.length} file(s) have not arrived yet`), { status: 409 });
    busy.add(id);
    s.status = 'applying'; save(s);
    const src = path.join(dirOf(id), 'files');
    const has = (p) => s.manifest.files.some((f) => f.path === p);
    const report = { startedAt: now(), backup: '', chats: { added: 0, merged: 0, skipped: 0, failed: 0 }, media: { copied: 0, skipped: 0 }, memory: { added: 0, merged: 0, skipped: 0 }, files: { added: 0, skipped: 0, conflicts: [] }, projects: { added: 0, skipped: 0, withoutFolder: [] }, teams: { added: 0, skipped: 0 }, automations: { moved: options.automations === 'move', added: 0, skipped: 0 }, telegram: { moved: options.telegram === 'move' }, settings: { applied: false }, providers: { added: 0, skipped: 0, missingKeys: [] }, connectors: { added: 0, skipped: 0, needSetup: [] }, secrets: { stored: 0 }, failures: [] };
    const fail = (what, e) => { report.failures.push({ what, error: String((e && e.message) || e).slice(0, 300) }); log('warn', `migration ${id}: ${what}: ${e && e.message}`); };
    try {
      // 1. backup of what is here now
      const bdir = path.join(dataDir, 'backups', new Date(now()).toISOString().replace(/[:.]/g, '-') + '-before-' + id);
      fs.mkdirSync(bdir, { recursive: true });
      for (const n of fs.readdirSync(dataDir)) if (/\.json$/.test(n) && !/^(gateway|clients|secrets\.enc)\.json$/.test(n)) { try { fs.copyFileSync(path.join(dataDir, n), path.join(bdir, n)); } catch {} }
      if (backupDb) backupDb(path.join(bdir, 'artemis.db'));
      try { fs.cpSync(workspaceDir(), path.join(bdir, 'workspace'), { recursive: true }); } catch {}
      report.backup = bdir;

      // 2. files: media, memory, skills, agents, brains
      for (const f of s.manifest.files) {
        const [area] = f.path.split('/');
        if (!DIRS.has(area)) continue;
        try {
          const from = inside(src, f.path);
          const to = area === 'workspace' ? inside(workspaceDir(), f.path.slice('workspace/'.length)) : inside(dataDir, f.path);
          fs.mkdirSync(path.dirname(to), { recursive: true });
          const bucket = area === 'media' ? report.media : area === 'workspace' ? report.memory : report.files;
          if (!fs.existsSync(to)) { fs.copyFileSync(from, to); if (area === 'media') report.media.copied++; else bucket.added++; continue; }
          if (sameFile(from, to)) { bucket.skipped++; continue; }
          if (area === 'workspace') { // memory: entries are lines, keep both sides
            const merged = unionLines(fs.readFileSync(to, 'utf8'), fs.readFileSync(from, 'utf8'));
            if (merged) { fs.writeFileSync(to + '.tmp', merged); fs.renameSync(to + '.tmp', to); report.memory.merged++; } else report.memory.skipped++;
            continue;
          }
          report.files.conflicts.push(f.path); // a skill or agent that differs: the server's copy stays
        } catch (e) { fail(f.path, e); }
      }

      // 3. chats, in batches (ids and times kept; a retry adds nothing)
      if (has('chats.jsonl')) {
        try {
          const rl = readline.createInterface({ input: fs.createReadStream(path.join(src, 'chats.jsonl'), 'utf8'), crlfDelay: Infinity });
          let batch = [];
          const flush = () => { const r = sessions.importChats(batch); report.chats.added += r.added; report.chats.merged += r.merged; report.chats.skipped += r.skipped; report.chats.failed += r.failed.length; for (const x of r.failed.slice(0, 20)) report.failures.push({ what: 'chat ' + x.id, error: x.error }); batch = []; };
          for await (const line of rl) {
            if (!line.trim()) continue;
            let c; try { c = JSON.parse(line); } catch (e) { report.chats.failed++; continue; }
            if (c && c.incognito) continue;
            batch.push(c);
            if (batch.length >= 100) flush();
          }
          if (batch.length) flush();
        } catch (e) { fail('chats', e); }
      }

      const json = (name, fb) => readJsonFile(path.join(src, name), fb);
      const local = (name, fb) => readJsonFile(path.join(dataDir, name), fb);
      const write = (name, data) => { const f = path.join(dataDir, name); fs.writeFileSync(f + '.tmp', JSON.stringify(data, null, 2)); fs.renameSync(f + '.tmp', f); };

      // 4. projects (a folder on the other machine does not exist here: the project stays, without a folder)
      if (has('projects.json')) {
        try {
          const theirs = (json('projects.json', []) || []).map((p) => {
            if (p && p.folder && !fs.existsSync(p.folder)) { report.projects.withoutFolder.push(p.name || p.id); return { ...p, folder: '', originalFolder: p.folder }; }
            return p;
          });
          const r = mergeById(local('projects.json', []), theirs); write('projects.json', r.list); report.projects.added = r.added; report.projects.skipped = r.skipped;
        } catch (e) { fail('projects', e); }
      }
      // 5. teams
      if (has('teams.json')) {
        try { const mine = local('teams.json', { teams: [] }); const r = mergeById(mine.teams, (json('teams.json', {}) || {}).teams); write('teams.json', { ...mine, teams: r.list }); report.teams.added = r.added; report.teams.skipped = r.skipped; } catch (e) { fail('teams', e); }
      }
      // 6. scheduled tasks, heartbeats, webhooks: only when the user chose to move them
      if (options.automations === 'move') {
        for (const n of ['schedules.json', 'heartbeats.json', 'hooks.json']) {
          if (!has(n)) continue;
          try { const r = mergeById(local(n, []), json(n, [])); write(n, r.list); report.automations.added += r.added; report.automations.skipped += r.skipped; } catch (e) { fail(n, e); }
        }
      }
      // 7. providers (keys come separately, in secrets.json)
      if (has('providers.json')) {
        try { const r = mergeById(local('providers.json', []), json('providers.json', [])); write('providers.json', r.list); report.providers.added = r.added; report.providers.skipped = r.skipped; } catch (e) { fail('providers', e); }
      }
      // 8. settings: the other machine's choices, without its paths, ports, window and secrets
      if (has('settings.json')) {
        try {
          const theirs = json('settings.json', {}) || {};
          const mine = local('settings.json', {});
          const out = { ...mine };
          for (const [k, v] of Object.entries(theirs)) if (!LOCAL_SETTINGS.test(k)) out[k] = v;
          if (options.telegram !== 'move') { out.telegramEnabled = !!mine.telegramEnabled; if (mine.telegramChatId !== undefined) out.telegramChatId = mine.telegramChatId; else delete out.telegramChatId; }
          write('settings.json', out); report.settings.applied = true;
        } catch (e) { fail('settings', e); }
      }
      // 9. secrets: stored encrypted with this server's key; connector secrets become "sec:" references in mcp.json
      const sec = has('secrets.json') ? json('secrets.json', {}) || {} : {};
      if (has('secrets.json')) {
        if (!secretStore) fail('secrets', new Error('This server has no secret store'));
        else {
          try {
            const items = {};
            for (const [pid, k] of Object.entries(sec.providerKeys || {})) if (k) items['provider:' + pid] = k;
            for (const n of ['braveKey', 'makeToken']) if (sec[n]) items[n] = sec[n];
            if (sec.telegramToken && options.telegram === 'move') items.telegramToken = sec.telegramToken;
            secretStore.setMany(items);
            report.secrets.stored = Object.keys(items).length;
          } catch (e) { fail('secrets', e); }
        }
      }
      // 10. connectors
      if (has('mcp.json')) {
        try {
          const ref = (cid, field, v) => {
            if (typeof v !== 'string' || !v.startsWith('secret:')) return v;
            const val = sec.connectors && sec.connectors[v.slice(7)];
            if (!val || !secretStore) return '';
            const name = `mcp:${cid}:${field}`.replace(/[^\w:.@-]/g, '_').slice(0, 200);
            secretStore.set(name, val); report.secrets.stored++;
            return 'sec:' + name;
          };
          const mapVals = (cid, field, o) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, ref(cid, `${field}.${k}`, v)])) : o);
          const theirs = (json('mcp.json', []) || []).map((c) => {
            if (!c || !c.id) return c;
            const out = { ...c, env: mapVals(c.id, 'env', c.env), headers: mapVals(c.id, 'headers', c.headers) };
            if (c.clientSecret !== undefined) out.clientSecret = ref(c.id, 'clientSecret', c.clientSecret);
            if (c.oauth && typeof c.oauth === 'object') out.oauth = { ...c.oauth, accessToken: ref(c.id, 'oauth.accessToken', c.oauth.accessToken), refreshToken: ref(c.id, 'oauth.refreshToken', c.oauth.refreshToken) };
            const cmd = [c.command, ...(c.args || [])].join(' ');
            const macOnly = c.type === 'stdio' && (/\/Users\/|\/Applications\/|\/opt\/homebrew|\.app\//.test(cmd));
            const lost = JSON.stringify(out).includes('"secret:') || (c.oauth && !out.oauth.accessToken && c.oauth.accessToken);
            if (macOnly || lost) { report.connectors.needSetup.push({ name: c.name || c.id, why: macOnly ? 'runs a program from the other computer' : 'needs its sign-in or secret again' }); if (macOnly) out.enabled = false; }
            return out;
          });
          // a connector that is already here gets the secrets that came this time (a second move with secrets switched on)
          const hasSec = (x) => JSON.stringify(x || {}).includes('"sec:');
          const mine = (local('mcp.json', []) || []).map((m) => { const t = theirs.find((x) => x && x.id === m.id); if (!t || !hasSec(t)) return m; report.connectors.updated = (report.connectors.updated || 0) + 1; return { ...m, env: t.env, headers: t.headers, ...(t.clientSecret !== undefined ? { clientSecret: t.clientSecret } : {}), ...(t.oauth ? { oauth: t.oauth } : {}) }; });
          const r = mergeById(mine, theirs); write('mcp.json', r.list); report.connectors.added = r.added; report.connectors.skipped = r.skipped - (report.connectors.updated || 0);
        } catch (e) { fail('connectors', e); }
      }

      // providers that still have no key on this server: the user has to send or type them
      try {
        const envName = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]+/g, '_');
        for (const p of local('providers.json', []) || []) {
          if (!p || !p.id || p.needsKey === false || p.enabled === false) continue;
          if (process.env['ARTEMIS_KEY_' + envName(p.id)] || (secretStore && secretStore.get('provider:' + p.id))) continue;
          report.providers.missingKeys.push(p.name || p.id);
        }
      } catch {}
      report.finishedAt = now();
      const fresh = load(id);
      fresh.status = 'done'; fresh.report = report; save(fresh);
      fs.rmSync(src, { recursive: true, force: true }); // the copy of the data is not kept; the backup is
      try { onApplied(report); } catch (e) { log('warn', 'after migration: ' + e.message); }
      log('info', `migration ${id} applied: ${report.chats.added} chats added, ${report.chats.merged} merged, ${report.failures.length} failures`);
      return pub(fresh);
    } catch (e) {
      const fresh = load(id); fresh.status = 'receiving'; fresh.error = String(e.message || e); save(fresh); // can be committed again
      throw e;
    } finally { busy.delete(id); }
  }

  return { start, receive, status, list, commit, cancel };
}

module.exports = { createMigrations, safeRel, unionLines, mergeById };
