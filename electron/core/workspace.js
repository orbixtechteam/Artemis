// The agent's workspace: plain Markdown files the user can open and edit, and the source of long-term memory.
//   SOUL.md    who Artemis is for this user (voice, values, limits); added to every chat
//   USER.md    lasting context about the user; added to every chat
//   MEMORY.md  durable facts, one "- " line each (memory_save / memory_forget, the Memory panel)
//   memory/YYYY-MM-DD.md  daily notes (memory_note, the pre-compaction flush); today and yesterday are added to every chat
// Everything is searchable through memindex.js (memory_search).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TEMPLATES = {
  'SOUL.md': '# Soul\n\n<!-- Who Artemis is for you: voice, values, what it should never do. Write plain sentences below.\n     Everything outside these comments is added to every chat. -->\n',
  'USER.md': '# User\n\n<!-- Lasting context about you that Artemis should always have: your work, projects, people, how you like answers.\n     Everything outside these comments is added to every chat. -->\n',
  'MEMORY.md': '# Memory\n\n<!-- Durable facts. Artemis adds lines here with memory_save; you can add, edit or delete lines yourself.\n     One fact per "- " line. -->\n\n'
};

/** Same normalisation as the old memory list: "Use X." and "use x" are the same entry. */
const memKey = (t) => String(t || '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().slice(0, 500);
/** Stable id of an entry: derived from its words, so hand edits need no bookkeeping. */
const idOf = (t) => crypto.createHash('sha1').update(memKey(t)).digest('base64').replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 6);
const stripComments = (t) => String(t || '').replace(/<!--[\s\S]*?-->/g, '');
/** The part of a file that says something: comments and a lone top heading do not count. */
function meaningful(text) {
  const t = stripComments(text).replace(/^\s*#\s+(Soul|User|Memory)\s*$/im, '').trim();
  return t;
}
const pad = (n) => String(n).padStart(2, '0');
const dateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const clipTail = (s, n) => (s.length > n ? '…' + s.slice(-n) : s);
const clipHead = (s, n) => (s.length > n ? s.slice(0, n) + '\n…(cut; the full file can be read with memory_get)' : s);

/** deps: { dir, log?(level, msg), onChange?(what) } */
function createWorkspace({ dir, log = () => {}, onChange = () => {} }) {
  const abs = (rel) => path.join(dir, rel);
  const readText = (rel) => { try { return fs.readFileSync(abs(rel), 'utf8'); } catch { return null; } };
  function writeText(rel, text) {
    const file = abs(rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
  }

  /** Creates the folder and the starter files. importList: the old memory.json entries, moved into MEMORY.md once. */
  function ensure(importList) {
    fs.mkdirSync(abs('memory'), { recursive: true });
    for (const [name, body] of Object.entries(TEMPLATES)) {
      if (fs.existsSync(abs(name))) continue;
      let text = body;
      if (name === 'MEMORY.md' && Array.isArray(importList) && importList.length) {
        text += importList.map((m) => `- ${oneLine(m.text)}`).filter((l) => l.length > 2).join('\n') + '\n';
        log('info', `Moved ${importList.length} memory entries into MEMORY.md`);
      }
      writeText(name, text);
    }
  }
  const oneLine = (t) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 500);

  // ---- MEMORY.md entries ----
  function parseMemory(text) {
    const lines = String(text || '').split('\n');
    // comments are blanked (line numbers kept), so lines inside them are never entries
    const visible = String(text || '').replace(/<!--[\s\S]*?(-->|$)/g, (m) => m.replace(/[^\n]/g, ' ')).split('\n');
    const entries = [];
    let fence = false;
    visible.forEach((line, i) => {
      if (/^\s*```/.test(line)) { fence = !fence; return; }
      if (fence) return;
      const m = /^[-*]\s+(.+?)\s*$/.exec(line);
      if (m && !/^\[[ x]\]/i.test(m[1])) entries.push({ line: i, text: m[1] });
    });
    return { lines, entries };
  }
  function list() {
    const { entries } = parseMemory(readText('MEMORY.md') || '');
    const seen = new Set();
    let mtime = 0; try { mtime = fs.statSync(abs('MEMORY.md')).mtimeMs; } catch {}
    return entries.map((e) => ({ id: idOf(e.text), text: e.text, createdAt: Math.floor(mtime) })).filter((e) => (seen.has(e.id) ? false : seen.add(e.id)));
  }
  function add(text0) {
    const text = oneLine(text0);
    if (!text) throw new Error('text is empty');
    const cur = list();
    const same = cur.find((m) => memKey(m.text) === memKey(text));
    if (same) return { ...same, duplicate: true };
    let body = readText('MEMORY.md');
    if (body == null) body = TEMPLATES['MEMORY.md'];
    if (!body.endsWith('\n')) body += '\n';
    writeText('MEMORY.md', body + `- ${text}\n`);
    onChange('memory');
    return { id: idOf(text), text, createdAt: Date.now() };
  }
  function remove(id) {
    const body = readText('MEMORY.md');
    if (body == null) return false;
    const { lines, entries } = parseMemory(body);
    const hit = entries.filter((e) => idOf(e.text) === String(id));
    if (!hit.length) return false;
    const drop = new Set(hit.map((e) => e.line));
    writeText('MEMORY.md', lines.filter((_, i) => !drop.has(i)).join('\n'));
    onChange('memory');
    return true;
  }
  /** Replaces all entries with `items` (the Memory panel saves its whole list); text outside the entries is kept. */
  function replaceAll(items) {
    const body = readText('MEMORY.md') ?? TEMPLATES['MEMORY.md'];
    const { lines, entries } = parseMemory(body);
    const drop = new Set(entries.map((e) => e.line));
    const firstAt = entries.length ? entries[0].line : -1;
    const fresh = (Array.isArray(items) ? items : []).map((m) => oneLine(m && m.text)).filter(Boolean).map((t) => `- ${t}`);
    const out = [];
    let placed = false;
    lines.forEach((l, i) => {
      if (i === firstAt) { out.push(...fresh); placed = true; }
      if (!drop.has(i)) out.push(l);
    });
    if (!placed) { while (out.length && out[out.length - 1] === '') out.pop(); out.push('', ...fresh, ''); }
    writeText('MEMORY.md', out.join('\n').replace(/\n{3,}/g, '\n\n'));
    onChange('memory');
    return list();
  }

  // ---- daily notes ----
  const dailyPath = (d = new Date()) => `memory/${dateStr(d)}.md`;
  function note(text0, d = new Date()) {
    const text = String(text0 || '').trim();
    if (!text) throw new Error('text is empty');
    const rel = dailyPath(d);
    let body = readText(rel);
    if (body == null) body = `# ${dateStr(d)}\n\n`;
    if (!body.endsWith('\n')) body += '\n';
    const lines = text.split('\n').map((l, i) => (i === 0 ? `- ${pad(d.getHours())}:${pad(d.getMinutes())} ${l}` : `  ${l}`)).join('\n');
    writeText(rel, body + lines + '\n');
    onChange('daily');
    return rel;
  }

  /** What every chat's system prompt gets from the workspace. */
  function context({ maxSoul = 4000, maxUser = 4000, maxDaily = 3000, now = new Date() } = {}) {
    const soul = meaningful(readText('SOUL.md') || '');
    const user = meaningful(readText('USER.md') || '');
    const y = new Date(now.getTime() - 86400000);
    const day = (d) => { const t = readText(dailyPath(d)); return t ? stripComments(t).replace(/^#\s+.*\n/, '').trim() : ''; };
    const today = day(now), yest = day(y);
    let daily = '';
    if (yest) daily += `Yesterday (${dateStr(y)}):\n${clipTail(yest, Math.floor(maxDaily / 3))}\n`;
    if (today) daily += `Today (${dateStr(now)}):\n${clipTail(today, maxDaily - Math.min(yest.length, Math.floor(maxDaily / 3)))}`;
    return { soul: clipHead(soul, maxSoul), user: clipHead(user, maxUser), daily: daily.trim() };
  }

  /** Reads a workspace file (relative path), lines from..from+count (1-based). Never leaves the workspace folder. */
  function read(rel, from = 1, count = 80) {
    const file = resolveInside(rel);
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split('\n');
    const start = Math.max(1, Math.floor(Number(from) || 1));
    const n = Math.max(1, Math.min(400, Math.floor(Number(count) || 80)));
    const part = lines.slice(start - 1, start - 1 + n);
    return { path: path.relative(dir, file).split(path.sep).join('/'), from: start, to: start - 1 + part.length, total: lines.length, text: part.join('\n') };
  }
  function resolveInside(rel) {
    const s = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!s || s.split('/').includes('..')) throw new Error('Use a path inside the workspace, like MEMORY.md or memory/2026-01-31.md');
    const file = path.resolve(dir, s);
    let real = file; try { real = fs.realpathSync(file); } catch {}
    let base = dir; try { base = fs.realpathSync(dir); } catch {}
    if (real !== base && !real.startsWith(base + path.sep)) throw new Error('That path is outside the workspace');
    if (!/\.md$/i.test(file)) throw new Error('Only Markdown files in the workspace can be read with memory_get');
    return file;
  }

  /** Every Markdown file in the workspace (relative paths), dot folders skipped. */
  function files() {
    const out = [];
    const walk = (d, relBase, depth) => {
      let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        if (e.name.startsWith('.')) continue;
        const r = relBase ? relBase + '/' + e.name : e.name;
        if (e.isDirectory() && depth < 4) walk(path.join(d, e.name), r, depth + 1);
        else if (e.isFile() && /\.md$/i.test(e.name)) out.push(r);
      }
    };
    walk(dir, '', 0);
    return out.sort();
  }

  return { dir, ensure, list, add, remove, replaceAll, note, context, read, files, dailyPath, readText: (rel) => readText(rel), abs };
}

module.exports = { createWorkspace, memKey, idOf, meaningful, dateStr };
