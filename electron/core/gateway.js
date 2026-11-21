// The Artemis gateway: one HTTP API in front of the agent, so other clients (the CLI, scripts, the desktop app in
// "Home server" mode, the mobile and web app) talk to the same agent, sessions and memory.
// Runs inside the desktop app (Settings → Gateway) or headless (electron/core/headless.js, `artemis gateway`), e.g. on a
// home server behind an https tunnel or reverse proxy.
//
// Security
//   - every /v1 call needs "Authorization: Bearer <token>": the gateway's own token (the CLI on the same machine), or a
//     paired client's token (core/clients.js). The only calls without one are GET /v1/ping and POST /v1/pair, which
//     trades a short-lived, single-use, rate-limited pairing code for a client token.
//   - a request with an Origin header (a web page) is refused unless the origin is the gateway's own (the web app it serves
//     from webRoot) or listed in allowedOrigins (a web app deployed elsewhere). Allowed origins get CORS headers.
//   - on loopback the Host header must be loopback too (DNS rebinding), or one of publicHosts (the tunnel's hostname).
//
//   GET  /v1/ping                           -> { ok, name, version }                 (no token)
//   POST /v1/pair { code, name, kind }      -> { token, client }                      (no token; pairing code)
//   GET  /v1/me                             -> { client }
//   POST /v1/pairing { label? }             -> { code, expiresAt }   (a code for another device, shown as text or QR)
//   GET  /v1/clients                        -> { clients }            POST /v1/clients/:id { name }  -> { client }
//   POST /v1/clients/:id/revoke|rotate      -> { ok } | { token }     DELETE /v1/clients/:id (a revoked one) -> { ok }
//   GET  /v1/health                         -> { ok, name, mode, version, model, ... }
//   GET  /v1/sessions?limit=20              -> { sessions: [...] }
//   GET  /v1/sessions/:id?last=20           -> { id, title, turns: [{ role, content }] }
//   GET  /v1/sessions/:id?full=1            -> { chat, run }   (the whole chat as the desktop stores it: steps, tool cards, files)
//   GET  /v1/media/:name                    -> image bytes (artemis-media:// links in chats)
//   GET  /v1/search?q=...&limit=8           -> { hits: [...] }          (full-text over saved chats)
//   POST /v1/chat { message, session_id?, model?, project_id?, stream?, detach? }
//        stream (default): text/event-stream, one event per agent event (with "id: <seq>"), ending with "done" { session_id, run_id, text }
//        stream: false   : { session_id, run_id, text }
//        detach: true    : the run goes on when the connection drops; resume with GET /v1/runs/:id/events?after=<seq>
//   GET  /v1/runs?session_id=&active=1      -> { runs }       GET /v1/runs/:id -> { run }
//   GET  /v1/runs/:id/events?after=N        -> text/event-stream (replay after N, then live; Last-Event-ID works too)
//   POST /v1/runs/:id/abort                 -> { ok }
//   GET  /v1/approvals                      -> { approvals }  (questions waiting for an answer, for clients that reconnect)
//   POST /v1/approvals/:id { approve }      -> { ok }    (answers a "tool:approval" event)
//   GET  /v1/memory?q=...&limit=6           -> { hits }   (workspace memory search)
//   GET  /v1/memory/list                    -> { entries }
//   POST /v1/memory { text }                -> { entry }  (adds a durable fact to MEMORY.md)
//   POST /v1/memory/note { text }           -> { path }   (appends to today's daily note)
//   GET  /v1/teams?since=<ms>               -> { teams }  (agent teams; since: only those changed after that time)
//   POST /v1/teams { team }                 -> { team }   (create or change)
//   DELETE /v1/teams/:id                    -> { ok }
//   POST /v1/teams/:id/start|pause|resume|stop|say|notebook-clear { text? } -> { team }
//   /v1/x/<area>/...                        -> handlers.extra(area, ...) (more server features, added by headless.js)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createRunHub } = require('./runhub');

const MAX_BODY = 2 * 1024 * 1024;
const MAX_CHAT_BODY = 40 * 1024 * 1024; // a chat turn may carry photos and files
const newToken = () => crypto.randomBytes(24).toString('base64url');
const newId = (p) => p + crypto.randomBytes(6).toString('hex');
const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;
const MEDIA_RE = /^[a-f0-9]{32}\.(png|jpg|gif|webp)$/;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.map': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm' };

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
const hostName = (h) => String(h || '').toLowerCase().replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
const listOf = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((x) => String(x).trim()).filter(Boolean);

/**
 * opts: { host, port, token, clients?, publicHosts?, allowedOrigins?, webRoot?, log?(level, msg), handlers }
 * handlers: {
 *   info(): { mode, version, model }
 *   chat({ runId, sessionId, message, model, projectId, client, attachments }, emit(ev), ctx) -> Promise<{ sessionId, text }>
 *       ctx.setSnapshot(fn): fn() returns the assistant message built so far (sent to clients that resume after a gap)
 *   abort(runId) -> boolean, approve(id, ok) -> boolean
 *   sessions: { recent(n, { before, projectId }), get(id), search(q, n) }
 *   media?: { file(name) -> absolute path | '' }
 *   memory?: { search(q, n) -> Promise<hits>, list(), add(text), note(text) }
 *   extra?: (area, { method, parts, query, body(), req, res, client }) -> Promise<object | undefined | null>
 *           (an object is sent as JSON, undefined = not found, null = the handler answered itself)
 * }
 */
function createGateway({ host = '127.0.0.1', port = 8789, token, clients = null, publicHosts = [], allowedOrigins = [], webRoot = '', log = () => {}, handlers }) {
  if (!token) throw new Error('The gateway needs a token');
  const hub = createRunHub({ log });
  let server = null;
  const loopbackOnly = host === '127.0.0.1' || host === 'localhost' || host === '::1';
  const hosts = new Set(listOf(publicHosts).map(hostName));
  const origins = new Set(listOf(allowedOrigins).map((o) => o.replace(/\/+$/, '').toLowerCase()));

  const json = (res, status, body) => {
    const s = JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(s) });
    res.end(s);
  };
  const fail = (res, status, message) => json(res, status, { ok: false, error: message });
  const bad = (status, message) => Object.assign(new Error(message), { status });

  function readBody(req, max = MAX_BODY) {
    return new Promise((resolve, reject) => {
      let size = 0; const parts = [];
      req.on('data', (c) => { size += c.length; if (size > max) { reject(bad(413, 'Body too large')); req.destroy(); } else parts.push(c); });
      req.on('end', () => {
        const raw = Buffer.concat(parts).toString('utf8');
        if (!raw.trim()) return resolve({});
        try { resolve(JSON.parse(raw)); } catch { reject(bad(400, 'Body is not valid JSON')); }
      });
      req.on('error', reject);
    });
  }
  /** The caller's address: behind a tunnel or proxy on this machine, the header it adds; otherwise the socket. */
  function remoteOf(req) {
    const sock = String((req.socket && req.socket.remoteAddress) || '');
    const local = /^(::ffff:)?127\.|^::1$/.test(sock);
    if (local) { const h = req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0]; if (h) return String(h).trim().slice(0, 64); }
    return sock;
  }

  function sseHead(res, extra = {}) {
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no', ...extra });
  }
  const sseWrite = (res, ev) => res.write(`id: ${ev.seq}\nevent: ${String(ev.type).replace(/[^a-z0-9:_-]/gi, '')}\ndata: ${JSON.stringify(ev.type === 'snapshot' ? { ...ev.data, seq: ev.seq } : { ...slim(ev.data), seq: ev.seq })}\n\n`);

  /** Streams a run's events (after `after`) to the response; ends when the run ends. onLeave: the client went away first. */
  function follow(res, runId, after, onLeave) {
    let closed = false, unsub = null;
    const ping = setInterval(() => { if (!closed) res.write(': ping\n\n'); }, 15000);
    const end = () => { if (closed) return; closed = true; clearInterval(ping); if (unsub) unsub(); try { res.end(); } catch {} };
    res.on('close', () => { if (!closed) { closed = true; clearInterval(ping); if (unsub) unsub(); if (onLeave) onLeave(); } });
    unsub = hub.subscribe(runId, after, (ev) => {
      if (closed) return;
      sseWrite(res, ev);
      if (ev.type === 'done' || ev.type === 'error') setImmediate(end);
    });
    if (!unsub) end();
  }

  async function chat(req, res, client) {
    const body = await readBody(req, client ? MAX_CHAT_BODY : MAX_BODY);
    const message = String(body.message || '').trim();
    const attachments = Array.isArray(body.attachments) ? body.attachments.slice(0, 10) : [];
    if (!message && !attachments.length) return fail(res, 400, 'message is required');
    const runId = newId('run_');
    const sessionId = body.session_id ? String(body.session_id).slice(0, 80) : 'gw-' + crypto.randomBytes(5).toString('hex');
    if (!/^[\w.:-]{1,80}$/.test(sessionId)) return fail(res, 400, 'Bad session_id');
    if (hub.busy(sessionId)) return fail(res, 409, 'That session is already running a task. Wait for it or abort it.');
    const stream = body.stream !== false;
    const detach = body.detach === true;
    const who = client ? { id: client.id, name: client.name, kind: client.kind } : null;
    hub.start({ runId, sessionId, client: who, abort: () => handlers.abort(runId),
      exec: (emit, ctx) => handlers.chat({ runId, sessionId, message, model: body.model ? String(body.model) : '', projectId: body.project_id ? String(body.project_id) : null, client: who, attachments, clientMessageId: body.client_message_id ? String(body.client_message_id).slice(0, 64) : '', options: body.options && typeof body.options === 'object' ? body.options : {} }, emit, ctx) });
    if (stream) {
      sseHead(res, { 'x-run-id': runId });
      return follow(res, runId, 0, () => { const r = hub.get(runId); if (!detach && r && !r.ended) { log('info', `gateway client left, stopping run ${runId}`); hub.abort(runId); } });
    }
    let left = false;
    res.on('close', () => { if (!res.writableFinished) { left = true; if (!detach) hub.abort(runId); } });
    try { const out = await hub.wait(runId); if (!left) json(res, 200, { ok: true, ...out }); }
    catch (e) { if (!left) fail(res, e.status && e.status < 500 ? e.status : 500, e.message); }
  }

  function serveFile(res, file, { cache = 'no-cache', type } = {}) {
    let st;
    try { st = fs.statSync(file); } catch { return false; }
    if (!st.isFile()) return false;
    res.writeHead(200, { 'content-type': type || MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'content-length': st.size, 'cache-control': cache, 'x-content-type-options': 'nosniff' });
    fs.createReadStream(file).pipe(res);
    return true;
  }
  /** The web app (Expo web build) at "/": static files; unknown paths fall back to index.html (client-side routes). */
  function serveWeb(req, res, p) {
    if (!webRoot || (req.method !== 'GET' && req.method !== 'HEAD')) return fail(res, 404, 'Not found');
    const root = path.resolve(webRoot);
    let rel; try { rel = decodeURIComponent(p); } catch { return fail(res, 400, 'Bad path'); }
    if (rel.includes('\0')) return fail(res, 400, 'Bad path');
    const file = path.resolve(root, '.' + path.posix.normalize('/' + rel));
    if (file !== root && !file.startsWith(root + path.sep)) return fail(res, 404, 'Not found');
    res.setHeader('x-frame-options', 'DENY'); res.setHeader('referrer-policy', 'no-referrer');
    const hashed = /\/_expo\/static\/|\/assets\//.test(p);
    if (serveFile(res, file, { cache: hashed ? 'public, max-age=31536000, immutable' : 'no-cache' })) return;
    if (path.extname(file) && !/\.html?$/.test(file)) return fail(res, 404, 'Not found');
    if (file !== root && serveFile(res, file + '.html')) return; // expo static export: /chats -> chats.html
    if (!serveFile(res, path.join(root, 'index.html'))) fail(res, 404, 'Not found');
  }

  async function route(req, res, client) {
    const u = new URL(req.url, 'http://gateway.local');
    const p = u.pathname.replace(/\/+$/, '') || '/';
    const m = req.method;
    const seg = p.split('/').filter(Boolean).map((x) => { try { return decodeURIComponent(x); } catch { return x; } }); // ['v1', ...]
    if (m === 'GET' && p === '/v1/health') { const i = handlers.info ? handlers.info() : {}; return json(res, 200, { ok: true, name: 'artemis', ...i }); }
    if (m === 'GET' && p === '/v1/me') return json(res, 200, { ok: true, client: client || { id: 'gateway-token', name: 'Gateway token', kind: 'cli' } });
    if (seg[1] === 'pairing' || seg[1] === 'clients') {
      if (!clients) return fail(res, 404, 'Pairing is off on this gateway');
      if (m === 'POST' && seg[1] === 'pairing' && seg.length === 2) { const b = await readBody(req); return json(res, 200, { ok: true, ...clients.createPairing({ label: b.label || (client ? `from ${client.name}` : 'from the gateway token'), ttl: b.ttl_ms }) }); }
      if (m === 'GET' && seg[1] === 'pairing') return json(res, 200, { ok: true, open: clients.openCodes() });
      if (m === 'GET' && seg.length === 2) return json(res, 200, { ok: true, clients: clients.list(), self: client ? client.id : null });
      if (m === 'POST' && seg.length === 3) { const b = await readBody(req); const c = clients.rename(seg[2], b.name); return c ? json(res, 200, { ok: true, client: c }) : fail(res, 404, 'No client with that id'); }
      if (m === 'POST' && seg[3] === 'revoke') return json(res, 200, { ok: clients.revoke(seg[2]) });
      if (m === 'POST' && seg[3] === 'rotate') { const r = clients.rotate(seg[2]); return r ? json(res, 200, { ok: true, ...r }) : fail(res, 404, 'No active client with that id'); }
      if (m === 'DELETE' && seg.length === 3) return json(res, 200, { ok: clients.remove(seg[2]) });
      return fail(res, 404, 'Not found');
    }
    if (m === 'GET' && p === '/v1/sessions') return json(res, 200, { ok: true, sessions: handlers.sessions.recent(Math.min(500, Number(u.searchParams.get('limit')) || 20), { before: Number(u.searchParams.get('before')) || 0, projectId: u.searchParams.get('project_id') || '' }) });
    if (m === 'GET' && seg[1] === 'sessions' && seg[2] && seg.length === 3) {
      const c = handlers.sessions.get(seg[2]);
      if (!c || c.incognito) return fail(res, 404, 'No session with that id');
      if (u.searchParams.get('full') === '1') { const running = hub.busy(c.id); return json(res, 200, { ok: true, chat: c, run: running ? hub.get(running.id) : null }); }
      const { chatTurns } = require('../chatsearch');
      return json(res, 200, { ok: true, id: c.id, title: c.title || '', updated_at: c.updatedAt || 0, turns: chatTurns(c, Math.min(200, Number(u.searchParams.get('last')) || 20)) });
    }
    if (m === 'GET' && seg[1] === 'media' && seg.length === 3) {
      if (!MEDIA_RE.test(seg[2]) || !handlers.media) return fail(res, 404, 'Not found');
      const f = handlers.media.file(seg[2]);
      if (!f || !serveFile(res, f, { cache: 'private, max-age=31536000, immutable' })) return fail(res, 404, 'Not found');
      return;
    }
    if (m === 'GET' && p === '/v1/search') return json(res, 200, { ok: true, hits: handlers.sessions.search(String(u.searchParams.get('q') || ''), Math.min(50, Number(u.searchParams.get('limit')) || 8)) });
    if (m === 'POST' && p === '/v1/chat') return chat(req, res, client);
    if (m === 'GET' && p === '/v1/runs') return json(res, 200, { ok: true, runs: hub.list({ sessionId: u.searchParams.get('session_id') || '', active: u.searchParams.get('active') === '1' }) });
    if (m === 'GET' && seg[1] === 'runs' && seg.length === 3) { const r = hub.get(seg[2]); return r ? json(res, 200, { ok: true, run: r }) : fail(res, 404, 'No run with that id (finished runs are kept for 15 minutes)'); }
    if (m === 'GET' && seg[1] === 'runs' && seg[3] === 'events') {
      if (!hub.get(seg[2])) return fail(res, 404, 'No run with that id (finished runs are kept for 15 minutes)');
      const after = Number(u.searchParams.get('after') || req.headers['last-event-id'] || 0) || 0;
      sseHead(res, { 'x-run-id': seg[2] });
      return follow(res, seg[2], after, null);
    }
    if (m === 'POST' && seg[1] === 'runs' && seg[3] === 'abort') return json(res, 200, { ok: !!hub.abort(seg[2]) });
    if (m === 'GET' && p === '/v1/approvals') return json(res, 200, { ok: true, approvals: hub.approvals() });
    if (m === 'POST' && seg[1] === 'approvals' && seg[2]) { const b = await readBody(req); const ok = !!handlers.approve(seg[2], b.approve === true); if (ok) hub.settled(seg[2]); return json(res, 200, { ok }); }
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
    if (seg[1] === 'teams' && handlers.teams) { // agent teams (the app follows and controls runs here while this process owns them)
      const T = handlers.teams;
      try {
        if (m === 'GET' && seg.length === 2) { const since = Number(u.searchParams.get('since')) || 0; return json(res, 200, { ok: true, teams: since ? T.since(since) : T.list() }); }
        if (m === 'POST' && seg.length === 2) return json(res, 200, { ok: true, team: T.save(await readBody(req)) });
        if (m === 'DELETE' && seg.length === 3) return json(res, 200, { ok: !!T.remove(seg[2]) });
        if (m === 'POST' && seg.length === 4) return json(res, 200, { ok: true, team: await T.act(seg[2], seg[3], await readBody(req)) });
      } catch (e) { throw Object.assign(e instanceof Error ? e : new Error(String(e)), { status: e && e.status ? e.status : 400 }); }
    }
    if (seg[1] === 'memory') {
      const mem = handlers.memory;
      if (!mem) return fail(res, 404, 'Memory is off');
      if (m === 'GET' && seg.length === 2) return json(res, 200, { ok: true, hits: await mem.search(String(u.searchParams.get('q') || ''), Math.min(20, Number(u.searchParams.get('limit')) || 6)) });
      if (m === 'GET' && seg[2] === 'list') return json(res, 200, { ok: true, entries: mem.list() });
      if (m === 'POST' && seg.length === 2) { const b = await readBody(req); if (!String(b.text || '').trim()) return fail(res, 400, 'text is required'); return json(res, 200, { ok: true, entry: mem.add(String(b.text)) }); }
      if (m === 'POST' && seg[2] === 'note') { const b = await readBody(req); if (!String(b.text || '').trim()) return fail(res, 400, 'text is required'); return json(res, 200, { ok: true, path: mem.note(String(b.text)) }); }
    }
    if (seg[1] === 'x' && seg[2] && handlers.extra) {
      let cached = null;
      const out = await handlers.extra(seg[2], { method: m, parts: seg.slice(3), query: u.searchParams, body: () => (cached || (cached = readBody(req, client ? MAX_CHAT_BODY : MAX_BODY))), req, res, client });
      if (out === null) return; // the handler answered itself (a stream or a file)
      if (out !== undefined) return json(res, 200, { ok: true, ...out });
    }
    return fail(res, 404, 'Not found');
  }

  function originAllowed(req) {
    const o = String(req.headers.origin || '').replace(/\/+$/, '').toLowerCase();
    if (!o) return true;
    if (origins.has(o) || origins.has('*')) return true;
    const own = String(req.headers.host || '').toLowerCase();
    return !!webRoot && (o === 'https://' + own || o === 'http://' + own); // the web app this gateway serves itself
  }

  async function onRequest(req, res) {
    try {
      const hostOk = !loopbackOnly || LOOPBACK.test(String(req.headers.host || '')) || hosts.has(hostName(req.headers.host)) || hosts.has('*');
      if (!hostOk) return fail(res, 403, 'Bad Host header');
      if (req.headers.origin) {
        if (!originAllowed(req)) return fail(res, 403, 'Browser requests are not allowed from this origin');
        res.setHeader('access-control-allow-origin', req.headers.origin); res.setHeader('vary', 'Origin');
        res.setHeader('access-control-expose-headers', 'x-run-id');
        if (req.method === 'OPTIONS') {
          res.writeHead(204, { 'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS', 'access-control-allow-headers': 'authorization, content-type, last-event-id', 'access-control-max-age': '600' });
          return res.end();
        }
      }
      const pth = String(req.url || '/').split('?')[0];
      if (!pth.startsWith('/v1/') && pth !== '/v1') return serveWeb(req, res, pth);
      if (req.method === 'GET' && /^\/v1\/ping\/?$/.test(pth)) return json(res, 200, { ok: true, name: 'artemis', version: (handlers.info && handlers.info().version) || '', pairing: !!clients });
      if (req.method === 'POST' && /^\/v1\/pair\/?$/.test(pth)) {
        if (!clients) return fail(res, 404, 'Pairing is off on this gateway');
        const b = await readBody(req);
        const out = clients.exchange(String(b.code || ''), { name: b.name, kind: b.kind, from: remoteOf(req) });
        const i = handlers.info ? handlers.info() : {};
        return json(res, 200, { ok: true, ...out, server: { name: i.serverName || 'Artemis', version: i.version || '', mode: i.mode || '' } });
      }
      // the end of a connector sign-in started from a paired app: the provider sends the browser here (the state is the secret)
      if (req.method === 'GET' && /^\/v1\/oauth\/callback\/?$/.test(pth) && handlers.oauthCallback) {
        const q = new URL(req.url, 'http://gateway.local').searchParams;
        const r = await handlers.oauthCallback({ code: q.get('code') || '', state: q.get('state') || '', error: q.get('error_description') || q.get('error') || '' });
        res.writeHead(r.ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" });
        return res.end(r.html);
      }
      const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      let client = null;
      if (!safeEqual(auth, token)) {
        client = clients ? clients.verify(auth) : null;
        if (!client) return fail(res, 401, 'Missing, wrong or revoked token');
      }
      await route(req, res, client);
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
    stop: () => new Promise((resolve) => { if (!server) return resolve(); hub.abortAll(); server.close(() => resolve()); try { server.closeAllConnections(); } catch {} server = null; }),
    address: () => (server ? server.address() : null),
    runs: () => hub.ids(),
    hub
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
