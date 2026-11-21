// The desktop app's connection to an Artemis server (a home server behind a Cloudflare Tunnel, or another machine).
// Pairing: the user types the server's address and a pairing code; the code is traded for this device's own token
// (POST /v1/pair), which is kept with the OS encryption (setToken). Nothing here needs Electron, so it is tested in Node.
//
// deps: { getConfig() -> {url, clientId, name, serverName, version, pairedAt} | null, setConfig(cfg|null),
//         getToken() -> string, setToken(string), fetch?, deviceName?(), log?(level, msg) }

const PRIVATE = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[\w-]+\.local|[\w-]+\.lan|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+)$/i;

/** "artemis.example.com" -> "https://artemis.example.com"; http only for this computer and the local network. */
function normalizeUrl(input) {
  let s = String(input || '').trim();
  if (!s) throw new Error('Enter the server address.');
  if (!/^[a-z]+:\/\//i.test(s)) s = (PRIVATE.test(s.split(/[/:]/)[0]) ? 'http://' : 'https://') + s;
  let u;
  try { u = new URL(s); } catch { throw new Error('That is not a valid address.'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('The address must start with https://');
  if (u.protocol === 'http:' && !PRIVATE.test(u.hostname)) throw new Error('Use https:// for a server on the internet (your Cloudflare Tunnel address). http:// is only allowed on this computer and your local network.');
  if (u.username || u.password) throw new Error('Leave the user name and password out of the address.');
  const p = u.pathname.replace(/\/+$/, '').replace(/\/v1$/, '');
  return `${u.protocol}//${u.host}${p}`;
}

function createServerLink({ getConfig, setConfig, getToken, setToken, fetch: f = globalThis.fetch, deviceName = () => 'Desktop', log = () => {} }) {
  async function call(base, path, { method = 'GET', body, token, timeout = 15000 } = {}) {
    let r;
    try {
      r = await f(base + path, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeout) });
    } catch (e) {
      const why = e && e.name === 'TimeoutError' ? 'it did not answer in time' : (e && e.cause && e.cause.code) || (e && e.message) || 'network error';
      throw Object.assign(new Error(`Could not reach ${base} (${why}). Check the address and that the server and its tunnel are running.`), { code: 'OFFLINE' });
    }
    let j = null;
    try { j = await r.json(); } catch {}
    if (!j) throw Object.assign(new Error(`${base} answered, but it is not an Artemis server (HTTP ${r.status}).`), { code: 'NOT_ARTEMIS', status: r.status });
    if (!r.ok || j.ok === false) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { status: r.status });
    return j;
  }

  /** Pairs this computer with a server. Returns the new config (without the token). */
  async function connect({ url, code, name }) {
    const base = normalizeUrl(url);
    const ping = await call(base, '/v1/ping');
    if (ping.name !== 'artemis') throw new Error(`${base} is not an Artemis server.`);
    if (!ping.pairing) throw new Error('Pairing is off on that server. Start it with "artemis gateway" (version with pairing) or turn on remote access there.');
    if (!String(code || '').trim()) throw new Error('Enter the pairing code the server shows.');
    let r;
    try { r = await call(base, '/v1/pair', { method: 'POST', body: { code: String(code).trim(), name: String(name || deviceName()).slice(0, 60), kind: 'desktop' } }); }
    catch (e) { if (e.status === 401) throw new Error('That pairing code is wrong or has expired. Make a new one on the server ("artemis pair").'); throw e; }
    setToken(r.token);
    const cfg = { url: base, clientId: r.client.id, name: r.client.name, serverName: (r.server && r.server.name) || '', version: (r.server && r.server.version) || ping.version || '', pairedAt: Date.now() };
    setConfig(cfg);
    log('info', `paired with ${base} as ${cfg.name}`);
    return cfg;
  }

  /** Where the link stands: { configured, online, revoked, url, serverName, version, client, error }. */
  async function status() {
    const cfg = getConfig();
    if (!cfg || !cfg.url) return { configured: false };
    const out = { configured: true, url: cfg.url, serverName: cfg.serverName || '', version: cfg.version || '', name: cfg.name || '', clientId: cfg.clientId || '', pairedAt: cfg.pairedAt || 0 };
    const token = getToken();
    if (!token) return { ...out, online: false, revoked: true, error: 'This computer has no saved credential for the server. Pair it again.' };
    try {
      const me = await call(cfg.url, '/v1/me', { token, timeout: 8000 });
      const h = await call(cfg.url, '/v1/health', { token, timeout: 8000 }).catch(() => ({}));
      if (h.version && h.version !== cfg.version) setConfig({ ...cfg, version: h.version });
      return { ...out, online: true, client: me.client, version: h.version || out.version, model: h.model || '', mode: h.mode || '' };
    } catch (e) {
      if (e.status === 401) return { ...out, online: false, revoked: true, error: 'The server no longer accepts this computer (it was revoked). Pair it again.' };
      return { ...out, online: false, error: e.message };
    }
  }

  /** Forgets the server. revoke: also tell the server to drop this device's token (best effort). */
  async function disconnect({ revoke = true } = {}) {
    const cfg = getConfig();
    const token = getToken();
    let revoked = false;
    if (revoke && cfg && cfg.url && token && cfg.clientId) {
      try { await call(cfg.url, `/v1/clients/${encodeURIComponent(cfg.clientId)}/revoke`, { method: 'POST', body: {}, token, timeout: 8000 }); revoked = true; }
      catch (e) { log('warn', 'could not revoke this device on the server: ' + e.message); }
    }
    setToken(''); setConfig(null);
    return { ok: true, revoked };
  }

  /** An authenticated API call to the paired server (used by the chat routing and the other server features). */
  async function request(path, opts = {}) {
    const cfg = getConfig();
    if (!cfg || !cfg.url) throw Object.assign(new Error('No server is connected.'), { code: 'NO_SERVER' });
    return call(cfg.url, path, { ...opts, token: getToken() });
  }

  /** Sends a file as the raw body of a PUT (migration and file transfer). */
  async function upload(path, file, size) {
    const cfg = getConfig();
    if (!cfg || !cfg.url) throw Object.assign(new Error('No server is connected.'), { code: 'NO_SERVER' });
    const { fileBody } = require('./migrate-export');
    let r;
    try {
      r = await f(cfg.url + path, { method: 'PUT', headers: { authorization: `Bearer ${getToken()}`, 'content-type': 'application/octet-stream', ...(size != null ? { 'content-length': String(size) } : {}) }, body: fileBody(file), duplex: 'half', signal: AbortSignal.timeout(30 * 60 * 1000) });
    } catch (e) { throw Object.assign(new Error(`Could not reach the server (${(e && e.cause && e.cause.code) || e.message})`), { code: 'OFFLINE' }); }
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || j.ok === false) throw Object.assign(new Error((j && j.error) || `HTTP ${r.status}`), { status: r.status });
    return j;
  }

  return { connect, status, disconnect, request, upload, config: () => getConfig(), token: () => getToken() };
}

module.exports = { createServerLink, normalizeUrl };
