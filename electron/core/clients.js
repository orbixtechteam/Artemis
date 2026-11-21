// Paired clients of a server: the desktop app, the mobile/web app and scripts each get their own revocable credential.
// A client joins with a short pairing code that the server shows (console: `artemis pair`, or an already paired app):
//   1. createPairing()            -> { code: 'K7QM-2XRD', expiresAt }   (10 minutes, single use; only its hash is stored)
//   2. exchange(code, { name })   -> { client, token }                  (the long-lived credential, shown once)
//   3. verify(token)              -> client | null                      (every API call)
// Tokens look like "art_<clientId>.<secret>"; only sha256(secret) is stored, compared in constant time.
// Pairing attempts are rate limited (per address and in total), so a code cannot be guessed through the API.
// File: <data>/clients.json, readable by this user only. Codes and tokens never go to the log.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ'; // no 0/O, 1/I/L, U
const KINDS = ['desktop', 'mobile', 'web', 'cli', 'other'];
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

function randomCode(len = 8) {
  const bytes = crypto.randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return s.slice(0, 4) + '-' + s.slice(4);
}
/** What the user typed: upper case, no spaces or dashes, look-alike letters mapped. */
function normCode(code) {
  return String(code || '').toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}
const codeHash = (code) => sha256('pair:' + normCode(code));

/**
 * opts: { file, now?() , log?(level, msg), ttlMs?, maxFailures?, windowMs? }
 */
function createClients({ file, now = () => Date.now(), log = () => {}, ttlMs = 10 * 60 * 1000, maxFailures = 8, windowMs = 10 * 60 * 1000 } = {}) {
  if (!file) throw new Error('createClients needs a file');
  let state = load();
  let saveTimer = null;
  const failures = new Map(); // key -> [times]

  function load() {
    try {
      const d = JSON.parse(fs.readFileSync(file, 'utf8'));
      return { clients: Array.isArray(d.clients) ? d.clients : [], pairing: Array.isArray(d.pairing) ? d.pairing : [] };
    } catch { return { clients: [], pairing: [] }; }
  }
  function save() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
    try { fs.chmodSync(file, 0o600); } catch {}
  }
  const saveSoon = () => { if (!saveTimer) { saveTimer = setTimeout(save, 2000); if (saveTimer.unref) saveTimer.unref(); } };
  const prune = () => { const t = now(); state.pairing = state.pairing.filter((p) => p.expiresAt > t); };
  const pub = (c) => (c ? { id: c.id, name: c.name, kind: c.kind, createdAt: c.createdAt, lastSeenAt: c.lastSeenAt || 0, revoked: !!c.revokedAt, revokedAt: c.revokedAt || 0, rotatedAt: c.rotatedAt || 0 } : null);

  function blocked(key) {
    const t = now();
    const list = (failures.get(key) || []).filter((x) => t - x < windowMs);
    failures.set(key, list);
    return list.length >= maxFailures;
  }
  function fail(key) { const l = failures.get(key) || []; l.push(now()); failures.set(key, l); }

  /** A new single-use pairing code. label: shown in the client list later ("from the console"). */
  function createPairing({ label = '', ttl = ttlMs } = {}) {
    prune();
    if (state.pairing.length >= 5) state.pairing.sort((a, b) => a.createdAt - b.createdAt).shift(); // keep at most 5 open codes
    const code = randomCode();
    const expiresAt = now() + Math.max(30000, Math.min(60 * 60 * 1000, Number(ttl) || ttlMs));
    state.pairing.push({ hash: codeHash(code), createdAt: now(), expiresAt, label: clean(label, 60) });
    save();
    log('info', 'a pairing code was created (valid until ' + new Date(expiresAt).toISOString() + ')');
    return { code, expiresAt };
  }

  function issue(c) {
    const secret = crypto.randomBytes(32).toString('base64url');
    c.secretHash = sha256(secret);
    return `art_${c.id}.${secret}`;
  }

  /**
   * Trades a pairing code for a client credential. from: the caller's address (for rate limiting).
   * Throws { status: 429 } when blocked, { status: 401 } for a wrong or expired code.
   */
  function exchange(code, { name = '', kind = 'other', from = '' } = {}) {
    const ipKey = 'ip:' + (from || '?');
    if (blocked('all') || blocked(ipKey)) throw Object.assign(new Error('Too many wrong pairing codes. Wait a few minutes and create a new code.'), { status: 429 });
    prune();
    const h = codeHash(code);
    const i = state.pairing.findIndex((p) => p.hash.length === h.length && crypto.timingSafeEqual(Buffer.from(p.hash), Buffer.from(h)));
    if (i < 0) { fail('all'); fail(ipKey); throw Object.assign(new Error('That pairing code is wrong or has expired. Create a new one on the server.'), { status: 401 }); }
    const pairing = state.pairing.splice(i, 1)[0];
    const c = { id: crypto.randomBytes(8).toString('hex'), name: clean(name, 60) || 'Client', kind: KINDS.includes(kind) ? kind : 'other', createdAt: now(), lastSeenAt: now(), via: pairing.label || '' };
    const token = issue(c);
    state.clients.push(c);
    save();
    log('info', `client paired: ${c.name} (${c.kind}, ${c.id})`);
    return { client: pub(c), token };
  }

  /** The client a bearer token belongs to, or null. Revoked clients get null. */
  function verify(token) {
    const m = /^art_([a-f0-9]{16})\.([A-Za-z0-9_-]{20,})$/.exec(String(token || ''));
    if (!m) return null;
    const c = state.clients.find((x) => x.id === m[1]);
    if (!c || c.revokedAt || !c.secretHash) return null;
    const a = Buffer.from(sha256(m[2])), b = Buffer.from(c.secretHash);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    if (now() - (c.lastSeenAt || 0) > 60000) { c.lastSeenAt = now(); saveSoon(); }
    return pub(c);
  }

  const list = () => state.clients.map(pub);
  function revoke(id) {
    const c = state.clients.find((x) => x.id === id);
    if (!c) return false;
    if (!c.revokedAt) { c.revokedAt = now(); c.secretHash = ''; save(); log('info', `client revoked: ${c.name} (${c.id})`); }
    return true;
  }
  /** Removes a revoked client from the list for good. */
  function remove(id) {
    const n = state.clients.length;
    state.clients = state.clients.filter((x) => !(x.id === id && x.revokedAt));
    if (state.clients.length !== n) { save(); return true; }
    return false;
  }
  /** A new token for a client; the old one stops working at once. */
  function rotate(id) {
    const c = state.clients.find((x) => x.id === id && !x.revokedAt);
    if (!c) return null;
    const token = issue(c);
    c.rotatedAt = now();
    save();
    log('info', `client token rotated: ${c.name} (${c.id})`);
    return { client: pub(c), token };
  }
  function rename(id, name) {
    const c = state.clients.find((x) => x.id === id);
    if (!c) return null;
    c.name = clean(name, 60) || c.name; save();
    return pub(c);
  }
  const openCodes = () => { prune(); return state.pairing.map((p) => ({ createdAt: p.createdAt, expiresAt: p.expiresAt, label: p.label })); };
  const flush = () => { if (saveTimer) save(); };

  return { createPairing, exchange, verify, list, revoke, remove, rotate, rename, openCodes, flush, reload: () => { state = load(); } };
}

module.exports = { createClients, normCode, randomCode, KINDS };
