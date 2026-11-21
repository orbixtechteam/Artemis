// Chat sessions in SQLite. The renderer still keeps the chat list in memory and saves the whole array;
// sync() turns that array into rows (only chats whose content changed are rewritten) and toArray() rebuilds it.
// Headless runs (gateway, CLI, scheduled tasks without a window) use appendTurn() directly.
const crypto = require('crypto');
const chatSearch = require('../chatsearch');
const { ftsQuery, fold } = require('./db');
const { namesIn } = require('./mediastore');

const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');
const day = (t) => { if (!t) return ''; const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }; // local date, like the user's calendar
const uid = () => Math.random().toString(36).slice(2, 10);
const DAY = 86400000;

/** deps: { db (from openDb), log?(level, msg), media? (core/mediastore: images are stored as files, not base64) } */
function createSessions({ db, log = () => {}, writer: defaultWriter = 'app', media = null }) {
  const hashes = new Map(); // session id -> content hash, so unchanged chats are skipped without a query
  for (const r of db.all('SELECT id, hash FROM sessions WHERE deleted_at IS NULL')) hashes.set(r.id, r.hash);

  function writeChat(chat, ord, hash, writer = defaultWriter) {
    const { messages, ...meta } = chat;
    const msgs = (Array.isArray(messages) ? messages : []).map((m) => (media ? media.externalize(m) : m));
    const incognito = chat.incognito ? 1 : 0;
    const created = Number(chat.createdAt) || Number(chat.updatedAt) || Date.now();
    db.run(`INSERT INTO sessions (id, title, project_id, source, incognito, created_at, updated_at, ord, hash, meta, deleted_at, seq, writer)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
            ON CONFLICT(id) DO UPDATE SET title = excluded.title, project_id = excluded.project_id, source = excluded.source, incognito = excluded.incognito,
              updated_at = excluded.updated_at, ord = excluded.ord, hash = excluded.hash, meta = excluded.meta, deleted_at = NULL, seq = excluded.seq, writer = excluded.writer`,
      String(chat.id), String(chat.title || ''), chat.projectId == null ? null : String(chat.projectId), chat.source == null ? null : String(chat.source), incognito,
      created, Number(chat.updatedAt) || created, ord, hash, JSON.stringify(meta), db.nextSeq(), String(writer));
    db.run('DELETE FROM messages WHERE session_id = ?', String(chat.id));
    db.run('DELETE FROM messages_fts WHERE session_id = ?', String(chat.id));
    db.run('DELETE FROM titles_fts WHERE session_id = ?', String(chat.id));
    msgs.forEach((m, seq) => {
      const text = chatSearch.messageText(m) || '';
      db.run('INSERT INTO messages (session_id, seq, id, role, text, via, json) VALUES (?, ?, ?, ?, ?, ?, ?)',
        String(chat.id), seq, m && m.id != null ? String(m.id) : null, String((m && m.role) || 'user'), text, m && m.via ? String(m.via) : null, JSON.stringify(m));
      if (!incognito && text.trim()) db.run('INSERT INTO messages_fts (text, session_id, seq, role) VALUES (?, ?, ?, ?)', fold(text), String(chat.id), seq, String((m && m.role) || 'user'));
    });
    if (!incognito && chat.title) db.run('INSERT INTO titles_fts (title, session_id) VALUES (?, ?)', fold(chat.title), String(chat.id));
    hashes.set(String(chat.id), hash);
  }

  function softDelete(id, writer = defaultWriter) {
    db.run('UPDATE sessions SET deleted_at = ?, seq = ?, writer = ? WHERE id = ?', Date.now(), db.nextSeq(), String(writer), id);
    db.run('DELETE FROM messages_fts WHERE session_id = ?', id);
    db.run('DELETE FROM titles_fts WHERE session_id = ?', id);
    hashes.delete(id);
  }

  /**
   * Makes the database match the renderer's chat array. Deleted chats are kept for 30 days (deleted_at) before purge().
   * opts.writer: who is saving ('renderer'). opts.known: ids the saver has seen; chats it never saw (written meanwhile by
   * another writer, e.g. the gateway) are not deleted. When the stored copy was written by someone else and has messages
   * the saver does not have, they are merged in (by message id) instead of being overwritten; such chats are returned in
   * `merged` so the saver can be given the result.
   */
  function sync(chats, { writer = defaultWriter, known = null } = {}) {
    if (!Array.isArray(chats)) throw new Error('chats must be an array');
    return apply(chats.map((c) => (c && c.id != null ? String(c.id) : null)), chats, { writer, known });
  }

  /**
   * Like sync(), but the saver sends only what changed: `order` is every chat id in list order, `chats` holds the chats
   * whose content changed since its last save. Ids in `order` that are neither sent nor stored come back in `missing`,
   * so the saver can send them in full next time.
   */
  function syncDelta({ order, chats = [] } = {}, { writer = defaultWriter, known = null } = {}) {
    if (!Array.isArray(order) || !Array.isArray(chats)) throw new Error('order and chats must be arrays');
    const byId = new Map();
    for (const c of chats) if (c && c.id != null && !byId.has(String(c.id))) byId.set(String(c.id), c);
    return apply(order.map((id) => (id == null ? null : String(id))), order.map((id) => byId.get(String(id)) || null), { writer, known });
  }

  // ids[i] is the chat at position i; list[i] its full content, or null when only its position is known (syncDelta).
  function apply(ids, list, { writer, known }) {
    let changed = 0, deleted = 0;
    const merged = [], missing = [];
    db.tx(() => {
      const seen = new Set();
      // other writers may have changed rows since the hash cache was filled
      for (const r of db.all('SELECT id, hash FROM sessions WHERE deleted_at IS NULL AND writer <> ?', String(writer))) hashes.set(r.id, r.hash);
      ids.forEach((id, i) => {
        if (id == null) return;
        if (seen.has(id)) return; // a duplicate id would make the rows ambiguous: the first copy wins
        seen.add(id);
        const c = list[i];
        if (!c) { // unchanged content: keep the row, only follow its position
          if (!hashes.has(id)) { missing.push(id); return; }
          const [base, ord] = String(hashes.get(id)).split(':');
          if (ord !== String(i)) { const h = base + ':' + i; db.run('UPDATE sessions SET ord = ?, hash = ? WHERE id = ?', i, h, id); hashes.set(id, h); }
          return;
        }
        const h = sha1(JSON.stringify(c)) + ':' + i;
        if (hashes.get(id) === h) return;
        if (hashes.has(id) && hashes.get(id).split(':')[0] === h.split(':')[0]) { db.run('UPDATE sessions SET ord = ?, hash = ? WHERE id = ?', i, h, id); hashes.set(id, h); return; } // only moved
        const row = db.get('SELECT * FROM sessions WHERE id = ? AND deleted_at IS NULL', id);
        if (row && row.writer && row.writer !== String(writer)) {
          const stored = rowToChat(row);
          const mine = new Set((c.messages || []).map((m) => m && m.id).filter(Boolean));
          const extra = (stored.messages || []).filter((m) => m && m.id && !mine.has(m.id));
          if (extra.length) {
            const out = { ...c, messages: [...(c.messages || []), ...extra], updatedAt: Math.max(Number(c.updatedAt) || 0, Number(stored.updatedAt) || 0) };
            writeChat(out, i, '', 'merge');
            merged.push(get(id));
            changed++;
            return;
          }
        }
        writeChat(c, i, h, writer); changed++;
      });
      const mayDelete = (id) => !known || known.has(id);
      for (const r of db.all('SELECT id FROM sessions WHERE deleted_at IS NULL')) {
        if (!seen.has(r.id) && mayDelete(r.id)) { softDelete(r.id, writer); deleted++; }
      }
    });
    if (changed || deleted) log('debug', `sessions sync: ${changed} written, ${deleted} deleted${merged.length ? `, ${merged.length} merged` : ''}`);
    return { changed, deleted, merged, missing };
  }

  /** Changes by other writers after change number `since`: { seq, chats (current versions), deleted (ids) }. */
  function changesSince(since, { exclude = '' } = {}) {
    const rows = db.all('SELECT * FROM sessions WHERE seq > ? AND writer <> ? ORDER BY seq', Number(since) || 0, String(exclude));
    const chats = [], deletedIds = [];
    for (const r of rows) { if (r.deleted_at) deletedIds.push(r.id); else chats.push(rowToChat(r)); }
    return { seq: db.seq(), chats, deleted: deletedIds };
  }

  function rowToChat(r) {
    let meta = {};
    try { meta = JSON.parse(r.meta || '{}'); } catch {}
    const messages = db.all('SELECT json FROM messages WHERE session_id = ? ORDER BY seq', r.id).map((m) => { try { return JSON.parse(m.json); } catch { return null; } }).filter(Boolean);
    return { ...meta, id: meta.id !== undefined ? meta.id : r.id, messages };
  }

  const toArray = () => db.all('SELECT * FROM sessions WHERE deleted_at IS NULL ORDER BY ord, updated_at DESC').map(rowToChat);
  const get = (id) => { const r = db.get('SELECT * FROM sessions WHERE id = ? AND deleted_at IS NULL', String(id)); return r ? rowToChat(r) : null; };
  const count = () => db.get('SELECT COUNT(*) AS n FROM sessions WHERE deleted_at IS NULL').n;

  function recent(n = 10, projects = []) {
    const pname = (id) => (projects.find((p) => p.id === id) || {}).name || '';
    return db.all(`SELECT s.*, (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS count FROM sessions s
                   WHERE s.deleted_at IS NULL AND s.incognito = 0 AND count > 0 ORDER BY s.updated_at DESC LIMIT ?`, Math.max(1, Math.min(200, n)))
      .map((r) => { let meta = {}; try { meta = JSON.parse(r.meta); } catch {} return { id: r.id, title: r.title || 'Untitled', project: pname(r.project_id), date: day(r.updated_at), model: meta.model || '', count: r.count, updatedAt: r.updated_at, source: r.source || '' }; });
  }

  /** A page of the chat list for remote clients: newest first, `before` (updated_at) for the next page, optional project. */
  function page({ limit = 50, before = 0, projectId = '', projects = [] } = {}) {
    const pname = (id) => (projects.find((p) => p.id === id) || {}).name || '';
    const where = ['s.deleted_at IS NULL', 's.incognito = 0'];
    const args = [];
    if (before) { where.push('s.updated_at < ?'); args.push(Number(before)); }
    if (projectId) { where.push('s.project_id = ?'); args.push(String(projectId)); }
    args.push(Math.max(1, Math.min(500, Number(limit) || 50)));
    return db.all(`SELECT s.*, (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS count FROM sessions s WHERE ${where.join(' AND ')} ORDER BY s.updated_at DESC LIMIT ?`, ...args)
      .map((r) => { let meta = {}; try { meta = JSON.parse(r.meta); } catch {} return { id: r.id, title: r.title || 'Untitled', projectId: r.project_id || null, project: pname(r.project_id), model: meta.model || '', date: day(r.updated_at), count: r.count, updatedAt: r.updated_at, createdAt: r.created_at, source: r.source || '', pinned: !!meta.pinned, env: meta.env || '' }; });
  }

  /** Full-text search (BM25). Same result shape as chatsearch.searchChats. */
  function search(query, { limit = 8, projects = [] } = {}) {
    const pname = (id) => (projects.find((p) => p.id === id) || {}).name || '';
    const run = (mode) => {
      const q = ftsQuery(query, mode);
      if (!q) return [];
      const best = new Map();
      let rows = [];
      try { rows = db.all(`SELECT session_id, seq, role, snippet(messages_fts, 0, '', '', '…', 24) AS snip, bm25(messages_fts) AS rank FROM messages_fts WHERE messages_fts MATCH ? ORDER BY rank LIMIT 300`, q); } catch (e) { log('warn', 'chat search failed: ' + e.message); return []; }
      for (const r of rows) {
        const cur = best.get(r.session_id);
        if (!cur) best.set(r.session_id, { ...r, hits: 1 });
        else cur.hits++;
      }
      let titles = [];
      try { titles = db.all('SELECT session_id, bm25(titles_fts) AS rank FROM titles_fts WHERE titles_fts MATCH ? LIMIT 100', q); } catch {}
      for (const t of titles) { const cur = best.get(t.session_id); if (cur) cur.title = t.rank; else best.set(t.session_id, { session_id: t.session_id, snip: '', role: '', rank: 0, hits: 0, title: t.rank }); }
      const out = [];
      for (const b of best.values()) {
        const s = db.get('SELECT id, title, project_id, updated_at FROM sessions WHERE id = ? AND deleted_at IS NULL AND incognito = 0', b.session_id);
        if (!s) continue;
        const score = -b.rank + Math.log1p(b.hits) + (b.title != null ? 3 - b.title : 0);
        out.push({ id: s.id, title: s.title || 'Untitled', project: pname(s.project_id), date: day(s.updated_at), snippet: b.snip ? (b.role === 'user' ? 'You: ' : 'Assistant: ') + b.snip.replace(/\s+/g, ' ') : '', score: Math.round(score * 100) / 100, updatedAt: s.updated_at });
      }
      return out.sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt).slice(0, limit);
    };
    const hits = run('and');
    return hits.length ? hits : run('or');
  }

  const read = (id, last, offset) => { const c = get(id); return c && !c.incognito ? chatSearch.transcript(c, { last, offset }) : null; };
  const turns = (chat, n) => chatSearch.chatTurns(chat, n);

  /** Adds one user turn and the assistant's answer to a chat, creating the chat when it does not exist. */
  function appendTurn(id, { user, assistant, via = '', title = '', source = '', model = '', projectId = null, steps = null, writer = defaultWriter }) {
    const now = Date.now();
    const sid = String(id);
    return db.tx(() => {
      let c = get(sid);
      if (!c) {
        const top = db.get('SELECT MIN(ord) AS o FROM sessions WHERE deleted_at IS NULL');
        c = { id: sid, title: String(title || user || 'Chat').replace(/\s+/g, ' ').slice(0, 48), source: source || undefined, model: model || undefined, projectId, createdAt: now, messages: [] };
        c._ord = top && top.o != null ? top.o - 1 : 0;
      }
      const ord = c._ord != null ? c._ord : (db.get('SELECT ord FROM sessions WHERE id = ?', sid) || {}).ord || 0;
      delete c._ord;
      const u = { id: uid(), role: 'user', content: String(user || '') };
      const a = { id: uid(), role: 'assistant', steps: Array.isArray(steps) && steps.length ? steps : [{ text: String(assistant || ''), toolCalls: [] }] };
      if (via) { u.via = via; a.via = via; }
      c.messages.push(u, a);
      c.updatedAt = now;
      if (model) c.model = model;
      writeChat(c, ord, '', writer);
      const back = get(sid); // hash the chat exactly as toArray() returns it, so the renderer saving it back is a no-op
      const h = sha1(JSON.stringify(back)) + ':' + ord;
      db.run('UPDATE sessions SET hash = ? WHERE id = ?', h, sid); hashes.set(sid, h);
      return back;
    });
  }

  /**
   * Starts a turn written by this process (the server): the user's message and the assistant message being built, both in
   * the desktop's full format. Creates the chat when it does not exist. Returns the chat.
   */
  function startTurn(id, { user, assistant, title = '', source = '', model = '', projectId = null, writer = defaultWriter }) {
    const now = Date.now();
    const sid = String(id);
    return db.tx(() => {
      let c = get(sid);
      let ord;
      if (!c) {
        const top = db.get('SELECT MIN(ord) AS o FROM sessions WHERE deleted_at IS NULL');
        ord = top && top.o != null ? top.o - 1 : 0;
        c = { id: sid, title: String(title || (user && user.content) || 'Chat').replace(/\s+/g, ' ').trim().slice(0, 48) || 'Chat', source: source || undefined, model: model || undefined, projectId, createdAt: now, messages: [] };
      } else ord = (db.get('SELECT ord FROM sessions WHERE id = ?', sid) || {}).ord || 0;
      c.messages.push(...[user, assistant].filter(Boolean));
      c.updatedAt = now;
      if (model) c.model = model;
      writeChat(c, ord, '', writer);
      return get(sid);
    });
  }

  /**
   * Replaces one message (found by id) of a chat, or appends it when it is not there; patch: chat fields to change
   * (model, artifacts...). Cheaper than a whole rewrite, used while an answer streams in. final: hash the result so a
   * window saving the same chat back is a no-op.
   */
  function putMessage(id, msg, { patch = null, writer = defaultWriter, final = false } = {}) {
    const sid = String(id);
    if (!msg || msg.id == null) throw new Error('putMessage needs a message with an id');
    return db.tx(() => {
      const row = db.get('SELECT * FROM sessions WHERE id = ? AND deleted_at IS NULL', sid);
      if (!row) return null;
      const m = media ? media.externalize(msg) : msg;
      const text = chatSearch.messageText(m) || '';
      const ex = db.get('SELECT seq FROM messages WHERE session_id = ? AND id = ?', sid, String(m.id));
      let seq;
      if (ex) { seq = ex.seq; db.run('UPDATE messages SET role = ?, text = ?, via = ?, json = ? WHERE session_id = ? AND seq = ?', String(m.role || 'assistant'), text, m.via ? String(m.via) : null, JSON.stringify(m), sid, seq); }
      else {
        const top = db.get('SELECT MAX(seq) AS s FROM messages WHERE session_id = ?', sid);
        seq = top && top.s != null ? top.s + 1 : 0;
        db.run('INSERT INTO messages (session_id, seq, id, role, text, via, json) VALUES (?, ?, ?, ?, ?, ?, ?)', sid, seq, String(m.id), String(m.role || 'assistant'), text, m.via ? String(m.via) : null, JSON.stringify(m));
      }
      db.run('DELETE FROM messages_fts WHERE session_id = ? AND seq = ?', sid, seq);
      if (!row.incognito && text.trim()) db.run('INSERT INTO messages_fts (text, session_id, seq, role) VALUES (?, ?, ?, ?)', fold(text), sid, seq, String(m.role || 'assistant'));
      let meta = {}; try { meta = JSON.parse(row.meta || '{}'); } catch {}
      const now = Date.now();
      meta = { ...meta, ...(patch || {}), updatedAt: now };
      db.run('UPDATE sessions SET meta = ?, updated_at = ?, seq = ?, writer = ?, hash = ? WHERE id = ?', JSON.stringify(meta), now, db.nextSeq(), String(writer), '', sid);
      hashes.set(sid, '');
      if (!final) return null;
      const back = get(sid);
      const h = sha1(JSON.stringify(back)) + ':' + row.ord;
      db.run('UPDATE sessions SET hash = ? WHERE id = ?', h, sid); hashes.set(sid, h);
      return back;
    });
  }

  /**
   * Chats from another Artemis (migration). Each chat is written as it is, ids and timestamps kept. A chat that is already
   * here: skipped when the content is the same, otherwise the incoming messages that are new (by message id) are added.
   * Returns { added, merged, skipped, failed: [{ id, error }] }.
   */
  function importChats(list, { writer = 'import' } = {}) {
    const out = { added: 0, merged: 0, skipped: 0, failed: [] };
    db.tx(() => {
      const top = db.get('SELECT MAX(ord) AS o FROM sessions WHERE deleted_at IS NULL');
      let ord = top && top.o != null ? top.o + 1 : 0;
      for (const c of Array.isArray(list) ? list : []) {
        try {
          if (!c || c.id == null || !Array.isArray(c.messages)) throw new Error('not a chat');
          const id = String(c.id);
          const cur = get(id);
          if (!cur) { writeChat(c, ord++, '', writer); out.added++; continue; }
          const have = new Set(cur.messages.map((m) => m && m.id).filter(Boolean));
          const extra = c.messages.filter((m) => m && m.id && !have.has(m.id));
          if (!extra.length) { out.skipped++; continue; }
          const r = db.get('SELECT ord FROM sessions WHERE id = ?', id);
          writeChat({ ...cur, ...c, messages: [...cur.messages, ...extra], updatedAt: Math.max(Number(cur.updatedAt) || 0, Number(c.updatedAt) || 0) }, r ? r.ord : ord++, '', writer);
          out.merged++;
        } catch (e) { out.failed.push({ id: c && c.id != null ? String(c.id) : '?', error: e.message }); }
      }
    });
    return out;
  }

  /** Changes chat fields (title, pinned, projectId...) without touching the messages. Returns the chat or null. */
  function patchChat(id, patch, { writer = defaultWriter } = {}) {
    const sid = String(id);
    const row = db.get('SELECT * FROM sessions WHERE id = ? AND deleted_at IS NULL', sid);
    if (!row) return null;
    let meta = {}; try { meta = JSON.parse(row.meta || '{}'); } catch {}
    const allowed = {};
    for (const k of ['title', 'pinned', 'projectId', 'model', 'env']) if (patch && patch[k] !== undefined) allowed[k] = patch[k];
    meta = { ...meta, ...allowed };
    db.tx(() => {
      db.run('UPDATE sessions SET meta = ?, title = ?, project_id = ?, seq = ?, writer = ?, hash = ? WHERE id = ?', JSON.stringify(meta), String(meta.title || ''), meta.projectId == null ? null : String(meta.projectId), db.nextSeq(), String(writer), '', sid);
      db.run('DELETE FROM titles_fts WHERE session_id = ?', sid);
      if (!row.incognito && meta.title) db.run('INSERT INTO titles_fts (title, session_id) VALUES (?, ?)', fold(meta.title), sid);
    });
    hashes.set(sid, '');
    return get(sid);
  }
  /** Moves a chat to the 30-day trash. */
  function remove(id, { writer = defaultWriter } = {}) {
    const sid = String(id);
    if (!db.get('SELECT id FROM sessions WHERE id = ? AND deleted_at IS NULL', sid)) return false;
    db.tx(() => softDelete(sid, writer));
    return true;
  }

  /** Removes chats deleted more than `days` ago for good. */
  function purge(days = 30) {
    const old = db.all('SELECT id FROM sessions WHERE deleted_at IS NOT NULL AND deleted_at < ?', Date.now() - days * DAY);
    db.tx(() => { for (const r of old) { db.run('DELETE FROM messages WHERE session_id = ?', r.id); db.run('DELETE FROM sessions WHERE id = ?', r.id); } });
    return old.length;
  }

  /** Moves base64 images already in the database into media files (one pass, for chats saved by older versions). */
  function migrateMedia() {
    if (!media) return { messages: 0, chats: 0 };
    const rows = db.all("SELECT session_id, seq, json FROM messages WHERE json LIKE '%data:image/%'");
    const touched = new Set();
    let n = 0;
    db.tx(() => {
      for (const r of rows) {
        let m; try { m = JSON.parse(r.json); } catch { continue; }
        const out = media.externalize(m);
        if (out === m) continue;
        db.run('UPDATE messages SET json = ? WHERE session_id = ? AND seq = ?', JSON.stringify(out), r.session_id, r.seq);
        touched.add(r.session_id); n++;
      }
      // another process that has these chats open gets the new versions through changesSince()
      for (const id of touched) db.run("UPDATE sessions SET seq = ?, writer = 'media' WHERE id = ?", db.nextSeq(), id);
    });
    return { messages: n, chats: touched.size };
  }

  /** Deletes media files that no stored message (deleted chats in the 30-day trash included) links to. */
  function gcMedia(opts) {
    if (!media) return 0;
    const keep = new Set();
    for (const r of db.all("SELECT json FROM messages WHERE json LIKE '%artemis-media://%'")) namesIn(r.json, keep);
    return media.gc(keep, opts);
  }

  /** Chats deleted in the last `days` days (for an undo / restore view). */
  const trash = (days = 30) => db.all('SELECT id, title, deleted_at FROM sessions WHERE deleted_at IS NOT NULL AND deleted_at >= ? ORDER BY deleted_at DESC', Date.now() - days * DAY);
  return { sync, syncDelta, changesSince, seq: () => db.seq(), toArray, get, count, recent, page, search, read, turns, appendTurn, startTurn, putMessage, importChats, patchChat, remove, purge, trash, migrateMedia, gcMedia };
}

module.exports = { createSessions };
