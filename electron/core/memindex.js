// Search index over the workspace Markdown (memory_search): chunks of ~700 characters with their line ranges,
// BM25 full-text search in SQLite, and, when an embedding model is set, vector search fused with it (reciprocal rank fusion).
const fs = require('fs');
const crypto = require('crypto');
const { ftsQuery, fold } = require('./db');
const { blankComments } = require('./workspace');

const CHUNK_CHARS = 700;
const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');
const RRF_K = 60;

/** Splits Markdown into chunks; a heading starts a new chunk. Lines are 1-based. */
function chunk(text, size = CHUNK_CHARS) {
  const lines = String(text || '').split('\n');
  const out = [];
  let buf = [], start = 1, len = 0;
  const flush = (end) => {
    const t = buf.join('\n').trim().replace(/\n{3,}/g, '\n\n');
    if (t && !/^#+\s+\S.*$/.test(t)) out.push({ start, end, text: t }); // a lone heading is not worth a chunk
    buf = []; len = 0;
  };
  lines.forEach((line, i) => {
    const n = i + 1;
    if (/^#{1,6}\s/.test(line) && len > 0) { flush(n - 1); start = n; }
    if (!buf.length) start = n;
    buf.push(line); len += line.length + 1;
    if (len >= size) flush(n);
  });
  if (buf.length) flush(lines.length);
  return out;
}

const toBlob = (v) => Buffer.from(new Float32Array(v).buffer);
const fromBlob = (b) => { const u = new Uint8Array(b); return new Float32Array(u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength)); };
function cosine(a, b) {
  let d = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? d / Math.sqrt(na * nb) : 0;
}

/**
 * deps: { db, workspace, log?, embedder?(): null | { model, embed(texts: string[], signal) => Promise<number[][]> } }
 * embedder is read on every call, so changing the model in Settings needs no restart.
 */
function createMemIndex({ db, workspace, log = () => {}, embedder = () => null }) {
  /** Brings the index up to date with the files (only changed files are re-chunked; unchanged ones cost one stat). */
  function reindex({ force = false } = {}) {
    const known = new Map(db.all('SELECT path, hash, mtime FROM mem_files').map((r) => [r.path, r]));
    const present = new Set();
    let changed = 0;
    db.tx(() => {
      for (const rel of workspace.files()) {
        present.add(rel);
        let st; try { st = fs.statSync(workspace.abs(rel)); } catch { continue; }
        const k = known.get(rel);
        if (k && !force && k.mtime === Math.floor(st.mtimeMs)) continue;
        const text = workspace.readText(rel) || '';
        const h = sha1(text);
        if (k && k.hash === h) { db.run('UPDATE mem_files SET mtime = ? WHERE path = ?', Math.floor(st.mtimeMs), rel); continue; }
        drop(rel);
        const visible = blankComments(text); // comments are not memory; line numbers stay
        for (const c of chunk(visible)) {
          const ch = sha1(c.text);
          const r = db.run('INSERT INTO mem_chunks (path, start_line, end_line, text, hash) VALUES (?, ?, ?, ?, ?)', rel, c.start, c.end, c.text, ch);
          db.run('INSERT INTO mem_fts (text, chunk_id, path) VALUES (?, ?, ?)', fold(c.text) + ' ' + fold(rel.replace(/[/.\-_]/g, ' ')), Number(r.lastInsertRowid), rel);
        }
        db.run('INSERT INTO mem_files (path, hash, mtime) VALUES (?, ?, ?) ON CONFLICT(path) DO UPDATE SET hash = excluded.hash, mtime = excluded.mtime', rel, h, Math.floor(st.mtimeMs));
        changed++;
      }
      for (const rel of known.keys()) if (!present.has(rel)) { drop(rel); db.run('DELETE FROM mem_files WHERE path = ?', rel); changed++; }
    });
    if (changed) log('debug', `memory index: ${changed} file(s) re-indexed`);
    return { changed };
  }
  function drop(rel) {
    db.run('DELETE FROM mem_fts WHERE path = ?', rel);
    db.run('DELETE FROM mem_chunks WHERE path = ?', rel);
  }

  /** Embeds chunks that have no vector for the current model yet (cached by text hash). At most `max` per call. */
  async function embedPending({ max = 256, signal } = {}) {
    const e = embedder();
    if (!e) return 0;
    const todo = db.all('SELECT id, text, hash FROM mem_chunks WHERE emb IS NULL OR emb_model IS NOT ? LIMIT ?', e.model, max);
    let done = 0;
    const need = [];
    for (const c of todo) {
      const hit = db.get('SELECT emb FROM emb_cache WHERE hash = ? AND model = ?', c.hash, e.model);
      if (hit) { db.run('UPDATE mem_chunks SET emb = ?, emb_model = ? WHERE id = ?', hit.emb, e.model, c.id); done++; }
      else need.push(c);
    }
    for (let i = 0; i < need.length; i += 32) {
      const batch = need.slice(i, i + 32);
      const vecs = await e.embed(batch.map((c) => c.text), signal);
      db.tx(() => batch.forEach((c, j) => {
        if (!Array.isArray(vecs[j]) || !vecs[j].length) return;
        const blob = toBlob(vecs[j]);
        db.run('UPDATE mem_chunks SET emb = ?, emb_model = ? WHERE id = ?', blob, e.model, c.id);
        db.run('INSERT OR REPLACE INTO emb_cache (hash, model, emb) VALUES (?, ?, ?)', c.hash, e.model, blob);
        done++;
      }));
    }
    return done;
  }

  function ftsHits(query, limit) {
    for (const mode of ['and', 'or']) {
      const q = ftsQuery(query, mode);
      if (!q) return [];
      let rows = [];
      try { rows = db.all('SELECT chunk_id, bm25(mem_fts) AS rank FROM mem_fts WHERE mem_fts MATCH ? ORDER BY rank LIMIT ?', q, limit); } catch (e) { log('warn', 'memory search failed: ' + e.message); return []; }
      if (rows.length) return rows.map((r) => Number(r.chunk_id));
    }
    return [];
  }

  /**
   * Hybrid search. Returns [{ path, from, to, text, score, via }] best first.
   * via: 'text' (keywords), 'vector' (meaning) or 'both'.
   */
  async function search(query, { limit = 6, signal } = {}) {
    reindex();
    const n = Math.max(1, Math.min(20, Number(limit) || 6));
    const scores = new Map(); // chunk id -> { s, via }
    const bump = (id, rank, via) => { const cur = scores.get(id) || { s: 0, via: '' }; cur.s += 1 / (RRF_K + rank); cur.via = cur.via && cur.via !== via ? 'both' : via; scores.set(id, cur); };
    ftsHits(query, 40).forEach((id, i) => bump(id, i + 1, 'text'));
    const e = embedder();
    if (e) {
      try {
        await embedPending({ signal });
        const [qv] = await e.embed([String(query)], signal);
        if (Array.isArray(qv) && qv.length) {
          const all = db.all('SELECT id, emb FROM mem_chunks WHERE emb IS NOT NULL AND emb_model = ?', e.model);
          all.map((r) => ({ id: r.id, c: cosine(qv, fromBlob(r.emb)) })).filter((x) => x.c > 0.2).sort((a, b) => b.c - a.c).slice(0, 40)
            .forEach((x, i) => bump(x.id, i + 1, 'vector'));
        }
      } catch (err) { if (signal && signal.aborted) throw err; log('warn', 'memory vector search failed, keywords only: ' + err.message); }
    }
    const today = Date.now();
    const out = [];
    for (const [id, { s, via }] of scores) {
      const c = db.get('SELECT path, start_line, end_line, text FROM mem_chunks WHERE id = ?', id);
      if (!c) continue;
      // recent daily notes count a little more; MEMORY.md and USER.md are always relevant
      let boost = 0;
      const m = /^memory\/(\d{4}-\d{2}-\d{2})\.md$/.exec(c.path);
      if (m) { const age = (today - new Date(m[1] + 'T12:00:00').getTime()) / 86400000; if (age < 14) boost = 0.004 * (1 - age / 14); }
      out.push({ path: c.path, from: c.start_line, to: c.end_line, text: c.text, score: Math.round((s + boost) * 10000) / 10000, via });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, n);
  }

  const stats = () => ({
    files: db.get('SELECT COUNT(*) AS n FROM mem_files').n,
    chunks: db.get('SELECT COUNT(*) AS n FROM mem_chunks').n,
    embedded: db.get('SELECT COUNT(*) AS n FROM mem_chunks WHERE emb IS NOT NULL').n
  });

  return { reindex, embedPending, search, stats };
}

/** An embedder for any OpenAI-compatible /embeddings endpoint. */
function httpEmbedder({ url, key, model, headers = {}, fetchImpl = fetch }) {
  return {
    model,
    async embed(texts, signal) {
      const res = await fetchImpl(url, { method: 'POST', signal, headers: { ...headers, 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify({ model, input: texts }) });
      if (!res.ok) throw new Error(`embeddings HTTP ${res.status}`);
      const j = await res.json();
      const data = Array.isArray(j.data) ? j.data.slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0)) : [];
      return data.map((d) => d.embedding);
    }
  };
}

module.exports = { createMemIndex, httpEmbedder, chunk, cosine };
