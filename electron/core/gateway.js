// The Artemis gateway: one local HTTP API in front of the agent, so other clients (the CLI, scripts, other apps,
// later Discord/Slack/WhatsApp adapters) talk to the same agent, sessions and memory as the desktop app.
// Runs inside the desktop app (Settings → Gateway) or headless (electron/core/headless.js, `artemis gateway`).
//
// Security: binds to 127.0.0.1 by default, every request needs "Authorization: Bearer <token>", any request with an
// Origin header is refused (no browser page can call it), and on loopback the Host header must be loopback too (DNS rebinding).
//
//   GET  /v1/health                         -> { ok, name, mode, version, model }
//   GET  /v1/sessions?limit=20              -> { sessions: [...] }
//   GET  /v1/sessions/:id?last=20           -> { id, title, turns: [{ role, content }] }
//   GET  /v1/search?q=...&limit=8           -> { hits: [...] }          (full-text over saved chats)
//   POST /v1/chat { message, session_id?, model?, project_id?, stream? }
//        stream (default): text/event-stream, one event per agent event, ending with "done" { session_id, text }
//        stream: false   : { session_id, run_id, text }
//   GET  /v1/runs                           -> { runs: [{ run_id, session_id, started }] }
//   POST /v1/runs/:id/abort                 -> { ok }
//   POST /v1/approvals/:id { approve }      -> { ok }    (answers a "tool:approval" event)
//   GET  /v1/memory?q=...&limit=6           -> { hits }   (workspace memory search)
//   GET  /v1/memory/list                    -> { entries }
//   POST /v1/memory { text }                -> { entry }  (adds a durable fact to MEMORY.md)
//   POST /v1/memory/note { text }           -> { path }   (appends to today's daily note)
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');

const MAX_BODY = 2 * 1024 * 1024;
const newToken = () => crypto.randomBytes(24).toString('base64url');
const newId = (p) => p + crypto.randomBytes(6).toString('hex');
const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

function safeEqual(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}
/** Agent events can carry screenshots (base64): the API sends a marker instead. */
function slim(ev) {
  if (!ev || typeof ev !== 'object') return ev;
  const out = {};
  for (const [k, v] of Object.entries(ev)) {
    if (typeof v === 'string' && v.length > 2000 && /^data:image\//.test(v)) out[k] = '[image omitted]';
    else out[k] = v;
  }
  return out;
}

/**
 * opts: { host, port, token, log?(level, msg), handlers }
 * handlers: {
 *   info(): { mode, version, model }
 *   chat({ runId, sessionId, message, model, projectId }, emit(ev)) -> Promise<{ sessionId, text }>
 *   abort(runId) -> boolean, approve(id, ok) -> boolean
 *   sessions: { recent(n), get(id), search(q, n) }
 *   memory?: { search(q, n) -> Promise<hits>, list(), add(text), note(text) }
 * }
 */
function createGateway({ host = '127.0.0.1', port = 8789, token, log = () => {}, handlers }) {
  if (!token) throw new Error('The gateway needs a token');
  const runs = new Map(); // runId -> { sessionId, started, abort }
  let server = null;
  const loopbackOnly = host === '127.0.0.1' || host === 'localhost' || host === '::1';

  const json = (res, status, body) => {
    const s = JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(s) });
    res.end(s);
  };
  const fail = (res, status, message) => json(res, status, { ok: false, error: message });

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0; const parts = [];
      req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(Object.assign(new Error('Body too large'), { status: 413 })); req.destroy(); } else parts.push(c); });
      req.on('end', () => {
        const raw = Buffer.concat(parts).toString('utf8');
        if (!raw.trim()) return resolve({});
        try { resolve(JSON.parse(raw)); } catch { reject(Object.assign(new Error('Body is not valid JSON'), { status: 400 })); }
      });
      req.on('error', reject);
    });
  }

  async function chat(req, res) {
    const body = await readBody(req);
    const message = String(body.message || '').trim();
    if (!message) return fail(res, 400, 'message is required');
    const runId = newId('run_');
    const sessionId = body.session_id ? String(body.session_id).slice(0, 80) : '';
    if (sessionId && [...runs.values()].some((r) => r.sessionId === sessionId)) return fail(res, 409, 'That session is already running a task. Wait for it or abort it.');
    const stream = body.stream !== false;
    const entry = { sessionId, started: Date.now() };
    runs.set(runId, entry);
    let closed = false;
    if (stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', 'x-run-id': runId });
      res.write(`event: run\ndata: ${JSON.stringify({ run_id: runId, session_id: sessionId || null })}\n\n`);
    }
    const ping = stream ? setInterval(() => { if (!closed) res.write(': ping\n\n'); }, 15000) : null;
    res.on('close', () => { closed = true; if (runs.has(runId)) { log('info', `gateway client left, stopping run ${runId}`); handlers.abort(runId); } });
    const emit = (ev) => {
      if (!ev || !ev.type || ev.type === 'done') return; // "done" is sent once below with the result
      if (stream && !closed) res.write(`event: ${String(ev.type).replace(/[^a-z0-9:_-]/gi, '')}\ndata: ${JSON.stringify(slim(ev))}\n\n`);
    };
    try {
      const out = await handlers.chat({ runId, sessionId, message, model: body.model ? String(body.model) : '', projectId: body.project_id ? String(body.project_id) : null }, emit);
      runs.delete(runId);
      const result = { session_id: out.sessionId, run_id: runId, text: out.text || '' };
      if (stream) { if (!closed) { res.write(`event: done\ndata: ${JSON.stringify(result)}\n\n`); res.end(); } }
      else if (!closed) json(res, 200, { ok: true, ...result });
    } catch (e) {
      runs.delete(runId);
      // the client gets the error's message (what went wrong for the user), never a stack or the error object
      const msg = e instanceof Error && e.message ? e.message.split('\n')[0].slice(0, 500) : 'The run failed';
      log('warn', 'gateway run failed: ' + ((e && e.stack) || e));
      if (stream) { if (!closed) { res.write(`event: error\ndata: ${JSON.stringify({ message: msg })}\n\n`); res.end(); } }
      else if (!closed) fail(res, 500, msg);
    } finally { if (ping) clearInterval(ping); }
  }

  async function route(req, res) {
    const u = new URL(req.url, 'http://gateway.local');
    const p = u.pathname.replace(/\/+$/, '') || '/';
    const m = req.method;
    const seg = p.split('/').filter(Boolean); // ['v1', ...]
    if (seg[0] !== 'v1') return fail(res, 404, 'Not found');
    if (m === 'GET' && p === '/v1/health') { const i = handlers.info ? handlers.info() : {}; return json(res, 200, { ok: true, name: 'artemis', ...i }); }
    if (m === 'GET' && p === '/v1/sessions') return json(res, 200, { ok: true, sessions: handlers.sessions.recent(Math.min(200, Number(u.searchParams.get('limit')) || 20)) });
    if (m === 'GET' && seg[1] === 'sessions' && seg[2] && seg.length === 3) {
      const c = handlers.sessions.get(decodeURIComponent(seg[2]));
      if (!c || c.incognito) return fail(res, 404, 'No session with that id');
      const { chatTurns } = require('../chatsearch');
      return json(res, 200, { ok: true, id: c.id, title: c.title || '', updated_at: c.updatedAt || 0, turns: chatTurns(c, Math.min(200, Number(u.searchParams.get('last')) || 20)) });
    }
    if (m === 'GET' && p === '/v1/search') return json(res, 200, { ok: true, hits: handlers.sessions.search(String(u.searchParams.get('q') || ''), Math.min(50, Number(u.searchParams.get('limit')) || 8)) });
    if (m === 'POST' && p === '/v1/chat') return chat(req, res);
    if (m === 'GET' && p === '/v1/runs') return json(res, 200, { ok: true, runs: [...runs].map(([id, r]) => ({ run_id: id, session_id: r.sessionId || null, started: r.started })) });
    if (m === 'POST' && seg[1] === 'runs' && seg[3] === 'abort') return json(res, 200, { ok: !!handlers.abort(seg[2]) });
    if (m === 'POST' && seg[1] === 'approvals' && seg[2]) { const b = await readBody(req); return json(res, 200, { ok: !!handlers.approve(decodeURIComponent(seg[2]), b.approve === true) }); }
    if (m === 'POST' && seg[1] === 'phone' && seg[2] === 'send') { // send_to_phone for the app while this process owns the Telegram bot
      const ph = handlers.phone && handlers.phone();
      if (!ph) return fail(res, 409, 'Telegram is not connected and paired');
      const b = await readBody(req);
      if (b.file) await ph.sendFile(String(b.file), b.caption ? String(b.caption) : undefined);
      else if (b.photo) await ph.sendPhoto(String(b.photo), b.caption ? String(b.caption) : undefined);
      else if (b.markdown) await ph.sendMd(String(b.markdown));
      else if (b.text) await ph.send(String(b.text));
      else return fail(res, 400, 'text, markdown, file or photo is required');
      return json(res, 200, { ok: true });
    }
    if (m === 'GET' && p === '/v1/phone') { const ph = handlers.phone && handlers.phone(); return json(res, 200, { ok: true, paired: !!ph }); }
    if (seg[1] === 'memory') {
      const mem = handlers.memory;
      if (!mem) return fail(res, 404, 'Memory is off');
      if (m === 'GET' && seg.length === 2) return json(res, 200, { ok: true, hits: await mem.search(String(u.searchParams.get('q') || ''), Math.min(20, Number(u.searchParams.get('limit')) || 6)) });
      if (m === 'GET' && seg[2] === 'list') return json(res, 200, { ok: true, entries: mem.list() });
      if (m === 'POST' && seg.length === 2) { const b = await readBody(req); if (!String(b.text || '').trim()) return fail(res, 400, 'text is required'); return json(res, 200, { ok: true, entry: mem.add(String(b.text)) }); }
      if (m === 'POST' && seg[2] === 'note') { const b = await readBody(req); if (!String(b.text || '').trim()) return fail(res, 400, 'text is required'); return json(res, 200, { ok: true, path: mem.note(String(b.text)) }); }
    }
    return fail(res, 404, 'Not found');
  }

  async function onRequest(req, res) {
    try {
      if (req.headers.origin) return fail(res, 403, 'Browser requests are not allowed');
      if (loopbackOnly && !LOOPBACK.test(String(req.headers.host || ''))) return fail(res, 403, 'Bad Host header');
      const auth = String(req.headers.authorization || '');
      if (!safeEqual(auth.replace(/^Bearer\s+/i, ''), token)) return fail(res, 401, 'Missing or wrong token');
      await route(req, res);
    } catch (e) {
      // errors we raise on purpose carry a status and a message for the client; anything else stays in the log
      if (res.headersSent) { try { res.end(); } catch {} }
      else if (e && e.status) { fail(res, e.status, String(e.message || 'Error').slice(0, 300)); }
      else { log('warn', 'gateway error: ' + ((e && e.stack) || e)); fail(res, 500, 'Internal error (see the Artemis log)'); }
    }
  }

  return {
    start: () => new Promise((resolve, reject) => {
      server = http.createServer(onRequest);
      server.on('error', reject);
      server.listen(port, host, () => { const a = server.address(); log('info', `gateway listening on http://${host}:${a.port}`); resolve({ host, port: a.port }); });
    }),
    stop: () => new Promise((resolve) => { if (!server) return resolve(); for (const id of runs.keys()) { try { handlers.abort(id); } catch {} } server.close(() => resolve()); try { server.closeAllConnections(); } catch {} server = null; }),
    address: () => (server ? server.address() : null),
    runs: () => [...runs.keys()]
  };
}

// ---- discovery file: how the CLI finds a running gateway (<data>/gateway.json, readable by this user only) ----
function writeDiscovery(file, info) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ ...info, pid: process.pid, startedAt: Date.now() }, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, 0o600); } catch {}
}
function readDiscovery(file) {
  try {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (d && d.pid && !alive(d.pid)) return null;
    return d;
  } catch { return null; }
}
function removeDiscovery(file) { try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); if (d.pid === process.pid) fs.unlinkSync(file); } catch {} }
function alive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }

module.exports = { createGateway, newToken, writeDiscovery, readDiscovery, removeDiscovery, alive };
