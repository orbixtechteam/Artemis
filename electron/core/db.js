// SQLite storage for Artemis (sessions, the full-text index and the memory index).
// Uses Node's built-in node:sqlite (Node 22.13+ / Electron 35+), so there is no native module to rebuild.
// Returns null when node:sqlite is not available: callers then keep the old JSON files.
const fs = require('fs');
const path = require('path');

let sqlite = null;
function loadSqlite() {
  if (sqlite !== null) return sqlite;
  try {
    // node:sqlite prints an ExperimentalWarning on first load; it is harmless, so it is filtered out once.
    const emit = process.emitWarning;
    process.emitWarning = function (w, ...rest) { if (String((w && w.message) || w).includes('SQLite')) return; return emit.call(process, w, ...rest); };
    try { sqlite = require('node:sqlite'); } finally { process.emitWarning = emit; }
  } catch { sqlite = false; }
  return sqlite;
}

const MIGRATIONS = [
  // 1: chat sessions and their messages, with a full-text index over message text
  `CREATE TABLE IF NOT EXISTS sessions (
     id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', project_id TEXT, source TEXT, incognito INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0, ord INTEGER NOT NULL DEFAULT 0,
     hash TEXT NOT NULL DEFAULT '', meta TEXT NOT NULL DEFAULT '{}', deleted_at INTEGER);
   CREATE INDEX IF NOT EXISTS sessions_updated ON sessions(updated_at);
   CREATE TABLE IF NOT EXISTS messages (
     session_id TEXT NOT NULL, seq INTEGER NOT NULL, id TEXT, role TEXT NOT NULL, text TEXT NOT NULL DEFAULT '', via TEXT, json TEXT NOT NULL,
     PRIMARY KEY (session_id, seq));
   CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(text, session_id UNINDEXED, seq UNINDEXED, role UNINDEXED, tokenize = 'unicode61 remove_diacritics 2');
   CREATE VIRTUAL TABLE IF NOT EXISTS titles_fts USING fts5(title, session_id UNINDEXED, tokenize = 'unicode61 remove_diacritics 2');`,
  // 2: memory index (workspace markdown split into chunks), full-text and optional embeddings
  `CREATE TABLE IF NOT EXISTS mem_files (path TEXT PRIMARY KEY, hash TEXT NOT NULL, mtime INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE IF NOT EXISTS mem_chunks (
     id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL, start_line INTEGER NOT NULL, end_line INTEGER NOT NULL,
     text TEXT NOT NULL, hash TEXT NOT NULL, emb BLOB, emb_model TEXT);
   CREATE INDEX IF NOT EXISTS mem_chunks_path ON mem_chunks(path);
   CREATE VIRTUAL TABLE IF NOT EXISTS mem_fts USING fts5(text, chunk_id UNINDEXED, path UNINDEXED, tokenize = 'unicode61 remove_diacritics 2');
   CREATE TABLE IF NOT EXISTS emb_cache (hash TEXT NOT NULL, model TEXT NOT NULL, emb BLOB NOT NULL, PRIMARY KEY (hash, model));`,
  // 3: change tracking, so the desktop app and the headless gateway can share one database:
  //    every write bumps meta.seq and stamps the session with it and with who wrote it
  `ALTER TABLE sessions ADD COLUMN seq INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE sessions ADD COLUMN writer TEXT NOT NULL DEFAULT '';
   CREATE INDEX IF NOT EXISTS sessions_seq ON sessions(seq);
   INSERT OR IGNORE INTO meta (key, value) VALUES ('seq', '0');`
];

/** Opens (and migrates) <dir>/artemis.db. Returns a small wrapper, or null when SQLite is not available. */
function openDb(file, { log = () => {} } = {}) {
  const lib = loadSqlite();
  if (!lib) { log('warn', 'node:sqlite is not available; using JSON files'); return null; }
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new lib.DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)');
  const getMeta = (k) => { const r = db.prepare('SELECT value FROM meta WHERE key = ?').get(k); return r ? r.value : null; };
  const setMeta = (k, v) => db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, String(v));
  const version = Number(getMeta('schema') || 0);
  for (let i = version; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN');
    try { db.exec(MIGRATIONS[i]); setMeta('schema', i + 1); db.exec('COMMIT'); }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  const stmts = new Map();
  const prep = (sql) => { let s = stmts.get(sql); if (!s) { s = db.prepare(sql); stmts.set(sql, s); } return s; };
  let depth = 0;
  /** Runs fn inside one transaction (nested calls join the outer one). */
  const tx = (fn) => {
    if (depth > 0) return fn();
    depth++;
    db.exec('BEGIN IMMEDIATE'); // take the write lock up front: another process (the gateway) may write too
    try { const r = fn(); db.exec('COMMIT'); return r; }
    catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
    finally { depth--; }
  };
  return {
    raw: db, file,
    all: (sql, ...a) => prep(sql).all(...a),
    get: (sql, ...a) => prep(sql).get(...a),
    run: (sql, ...a) => prep(sql).run(...a),
    exec: (sql) => db.exec(sql),
    tx, getMeta, setMeta,
    /** Next change number (shared by every process using this file). Call inside tx(). */
    nextSeq: () => Number(db.prepare("INSERT INTO meta (key, value) VALUES ('seq', '1') ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1 RETURNING value").get().value),
    seq: () => Number(getMeta('seq') || 0),
    close: () => { try { db.close(); } catch {} }
  };
}

/** Letters the unicode61 tokenizer does not fold (they are not accents): Azerbaijani/Turkish ə and dotless ı. Applied to indexed text and queries. */
const fold = (t) => String(t || '').replace(/[əƏ]/g, (c) => (c === 'ə' ? 'e' : 'E')).replace(/ı/g, 'i').replace(/İ/g, 'I');

/** Turns free text into a safe FTS5 query: every word quoted, prefix match on the last one. mode 'and' | 'or'. */
function ftsQuery(q, mode = 'and') {
  const words = fold(q).toLowerCase().normalize('NFKC').split(/[^\p{L}\p{N}_]+/u).filter((w) => w.length > 1).slice(0, 12);
  if (!words.length) return '';
  return words.map((w, i) => `"${w.replace(/"/g, '')}"${i === words.length - 1 && w.length > 2 ? '*' : ''}`).join(mode === 'or' ? ' OR ' : ' ');
}

module.exports = { openDb, ftsQuery, fold, available: () => !!loadSqlite() };
