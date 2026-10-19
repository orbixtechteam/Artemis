// Markdown notes vault: plain .md files in a folder the user picks (default ~/Documents/Artemis Notes).
// Same idea as Delta: files stay readable by any other editor. All paths are relative to the vault root
// and can never escape it.
const fs = require('fs');
const path = require('path');

const IGNORE = new Set(['.git', '.DS_Store', 'node_modules', '.obsidian', '.trash']);
const MAX_READ = 200 * 1024;

function createNotes({ getRoot }) {
  const root = () => { const r = getRoot(); fs.mkdirSync(r, { recursive: true }); return r; };
  const safe = (rel) => {
    const base = path.resolve(root());
    const abs = path.resolve(base, String(rel || '').replace(/^[/\\]+/, ''));
    if (abs !== base && !abs.startsWith(base + path.sep)) throw new Error('Path is outside the notes folder.');
    return abs;
  };
  const relOf = (abs) => path.relative(path.resolve(root()), abs).split(path.sep).join('/');
  const isMd = (n) => /\.(md|markdown|txt)$/i.test(n);
  const withExt = (n) => (/\.(md|markdown|txt)$/i.test(n) ? n : n + '.md');
  const cleanName = (n) => String(n || '').replace(/[\\:*?"<>|\x00-\x1f]/g, '').replace(/^\.+/, '').trim().slice(0, 120);

  function walk(dir, out, depth = 0) {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    ents.sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name, undefined, { numeric: true }));
    for (const e of ents) {
      if (IGNORE.has(e.name) || e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { out.push({ path: relOf(full), name: e.name, dir: true, depth }); if (depth < 8) walk(full, out, depth + 1); }
      else if (isMd(e.name)) {
        let st; try { st = fs.statSync(full); } catch { continue; }
        out.push({ path: relOf(full), name: e.name.replace(/\.(md|markdown|txt)$/i, ''), dir: false, depth, mtime: st.mtimeMs, size: st.size });
      }
    }
  }

  function list() { const out = []; walk(root(), out); return out; }

  function read(rel, { max = MAX_READ } = {}) {
    const abs = safe(rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new Error('Note not found: ' + rel);
    const text = fs.readFileSync(abs, 'utf8');
    return { path: relOf(abs), text: text.length > max ? text.slice(0, max) : text, truncated: text.length > max, length: text.length, mtime: fs.statSync(abs).mtimeMs };
  }

  function write(rel, text, { append = false } = {}) {
    const abs = safe(withExt(rel));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (append && fs.existsSync(abs)) {
      const cur = fs.readFileSync(abs, 'utf8');
      fs.writeFileSync(abs, cur + (cur && !cur.endsWith('\n') ? '\n' : '') + String(text));
    } else fs.writeFileSync(abs, String(text));
    return { path: relOf(abs), mtime: fs.statSync(abs).mtimeMs };
  }

  function create(name, folder = '', text = '') {
    const dirAbs = safe(folder || '');
    fs.mkdirSync(dirAbs, { recursive: true });
    const base = cleanName(name) || 'Untitled';
    let n = base, i = 2;
    while (fs.existsSync(path.join(dirAbs, withExt(n)))) n = `${base} ${i++}`;
    const abs = path.join(dirAbs, withExt(n));
    fs.writeFileSync(abs, text || `# ${n}\n\n`);
    return { path: relOf(abs) };
  }

  function createFolder(name, parent = '') {
    const abs = path.join(safe(parent || ''), cleanName(name) || 'New folder');
    if (!abs.startsWith(path.resolve(root()) + path.sep)) throw new Error('Bad folder name.');
    fs.mkdirSync(abs, { recursive: true });
    return { path: relOf(abs) };
  }

  function rename(rel, newName) {
    const abs = safe(rel);
    if (!fs.existsSync(abs)) throw new Error('Not found.');
    const isDir = fs.statSync(abs).isDirectory();
    const nm = cleanName(newName); if (!nm) throw new Error('Empty name.');
    const to = path.join(path.dirname(abs), isDir ? nm : withExt(nm));
    // on a case-insensitive disk (macOS, Windows) "Artemis" -> "artemis" points at the very same entry: that is a rename, not a clash
    let same = false;
    if (to !== abs && fs.existsSync(to)) { try { const a = fs.statSync(abs), b = fs.statSync(to); same = a.ino === b.ino && a.dev === b.dev; } catch {} }
    if (to !== abs && fs.existsSync(to) && !same) throw new Error('A file with that name already exists.');
    if (same) { const tmp = abs + '.rename-' + Date.now(); fs.renameSync(abs, tmp); fs.renameSync(tmp, to); } else fs.renameSync(abs, to);
    return { path: relOf(to) };
  }

  function move(rel, folder) {
    const abs = safe(rel); const to = path.join(safe(folder || ''), path.basename(abs));
    if (to !== abs && fs.existsSync(to)) throw new Error('A file with that name already exists there.');
    if (to.startsWith(abs + path.sep)) throw new Error('Cannot move a folder into itself.');
    fs.mkdirSync(path.dirname(to), { recursive: true }); fs.renameSync(abs, to);
    return { path: relOf(to) };
  }

  function remove(rel) {
    const abs = safe(rel);
    if (abs === path.resolve(root())) throw new Error('Cannot delete the notes folder itself.');
    fs.rmSync(abs, { recursive: true, force: true });
    return true;
  }

  function search(query, { limit = 30 } = {}) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    const terms = q.split(/\s+/).filter(Boolean);
    const res = [];
    for (const f of list()) {
      if (f.dir) continue;
      let text = '';
      try { text = fs.readFileSync(safe(f.path), 'utf8'); } catch { continue; }
      const low = text.toLowerCase(), title = f.name.toLowerCase();
      if (!terms.every((t) => low.includes(t) || title.includes(t))) continue;
      let score = 0;
      for (const t of terms) { if (title.includes(t)) score += 10; const m = low.split(t).length - 1; score += Math.min(m, 10); }
      const idx = low.indexOf(terms[0]);
      const snippet = idx >= 0 ? text.slice(Math.max(0, idx - 60), idx + 140).replace(/\s+/g, ' ').trim() : text.slice(0, 160).replace(/\s+/g, ' ');
      res.push({ path: f.path, name: f.name, score, snippet });
    }
    return res.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /** The same search without blocking the app: the files are read a few at a time and the event loop breathes in between. isStale() stops it when a newer query came in. */
  async function searchAsync(query, { limit = 30, isStale = () => false } = {}) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    const terms = q.split(/\s+/).filter(Boolean);
    const res = []; let n = 0;
    for (const f of list()) {
      if (f.dir) continue;
      if (++n % 15 === 0) { await new Promise((r) => setImmediate(r)); if (isStale()) return []; }
      let text = '';
      try { text = fs.readFileSync(safe(f.path), 'utf8'); } catch { continue; }
      const low = text.toLowerCase(), title = f.name.toLowerCase();
      if (!terms.every((t) => low.includes(t) || title.includes(t))) continue;
      let score = 0;
      for (const t of terms) { if (title.includes(t)) score += 10; const m = low.split(t).length - 1; score += Math.min(m, 10); }
      const idx = low.indexOf(terms[0]);
      const snippet = idx >= 0 ? text.slice(Math.max(0, idx - 60), idx + 140).replace(/\s+/g, ' ').trim() : text.slice(0, 160).replace(/\s+/g, ' ');
      res.push({ path: f.path, name: f.name, score, snippet });
    }
    return res.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  // Link graph: every note, plus an edge per [[link]] / ![[embed]]. Links to notes that don't exist become "ghost" nodes.
  const LINK_RE = /!?\[\[([^\]\n|]+)(?:\|[^\]\n]*)?\]\]/g;
  function graph() {
    const files = list().filter((f) => !f.dir);
    const byName = new Map(), byPath = new Map();
    for (const f of files) { if (!byName.has(f.name.toLowerCase())) byName.set(f.name.toLowerCase(), f); byPath.set(f.path.replace(/\.(md|markdown|txt)$/i, '').toLowerCase(), f); }
    const nodes = files.map((f) => ({ id: f.path, path: f.path, name: f.name, exists: true }));
    const ghosts = new Map(), edges = [];
    for (const f of files) {
      let text = '';
      try { text = fs.readFileSync(safe(f.path), 'utf8'); } catch { continue; }
      const seen = new Set();
      for (const m of text.matchAll(LINK_RE)) {
        const t = m[1].trim(), key = t.toLowerCase().replace(/\.md$/, '');
        if (!t || seen.has(key)) continue;
        seen.add(key);
        const hit = byName.get(key) || byPath.get(key);
        if (hit) { if (hit.path !== f.path) edges.push({ from: f.path, to: hit.path }); }
        else {
          if (!ghosts.has(key)) ghosts.set(key, { id: 'ghost:' + key, path: '', name: t, exists: false });
          edges.push({ from: f.path, to: 'ghost:' + key });
        }
      }
    }
    return { nodes: [...nodes, ...ghosts.values()], edges };
  }

  // Files dropped or pasted into a note are saved next to it (images, PDFs, ...), so a relative link keeps working.
  const MAX_ASSET = 25 * 1024 * 1024;
  const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' };
  function saveAsset(rel, name, base64) {
    const dirAbs = path.dirname(safe(rel));
    const buf = Buffer.from(String(base64 || ''), 'base64');
    if (!buf.length) throw new Error('Empty file.');
    if (buf.length > MAX_ASSET) throw new Error('File is too large (25 MB max).');
    const clean = cleanName(name).replace(/\s+/g, '-') || 'file';
    const ext = path.extname(clean), stem = clean.slice(0, clean.length - ext.length) || 'file';
    let n = clean, i = 2;
    while (fs.existsSync(path.join(dirAbs, n))) n = `${stem}-${i++}${ext}`;
    fs.mkdirSync(dirAbs, { recursive: true });
    fs.writeFileSync(path.join(dirAbs, n), buf);
    return { name: n, path: relOf(path.join(dirAbs, n)) };
  }
  function readAsset(rel, link) {
    let l = String(link || ''); try { l = decodeURI(l); } catch {}
    const target = l.startsWith('/') ? l.replace(/^\/+/, '') : path.posix.join(path.posix.dirname(String(rel).replace(/\\/g, '/')), l);
    const abs = safe(target);
    const mime = MIME[path.extname(abs).slice(1).toLowerCase()];
    if (!mime) throw new Error('Unsupported file type.');
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new Error('File not found.');
    if (fs.statSync(abs).size > MAX_ASSET) throw new Error('File is too large to preview.');
    return { url: `data:${mime};base64,${fs.readFileSync(abs).toString('base64')}` };
  }

  return { root, list, read, write, create, createFolder, rename, move, remove, search, searchAsync, graph, saveAsset, readAsset };
}

module.exports = { createNotes };
