// Talking to the Artemis server: the saved connection (token in the iOS Keychain / Android Keystore through
// expo-secure-store; in the web app, in this browser's storage), JSON calls, and streaming with resume.
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { fetch as expoFetch } from 'expo/fetch';
import { normalizeUrl, sseParser, utf8Decoder } from './core';

const KEY = 'artemis.server.v1';
const isWeb = Platform.OS === 'web';
// native fetch in React Native cannot read a streamed body; expo/fetch can. The browser's own fetch can too.
const streamFetch = isWeb ? (...a) => globalThis.fetch(...a) : expoFetch;

export async function loadServer() {
  try {
    const raw = isWeb ? globalThis.localStorage && globalThis.localStorage.getItem(KEY) : await SecureStore.getItemAsync(KEY);
    const s = raw ? JSON.parse(raw) : null;
    return s && s.url && s.token ? s : null;
  } catch { return null; }
}
export async function saveServer(s) {
  const raw = JSON.stringify(s);
  if (isWeb) globalThis.localStorage.setItem(KEY, raw); else await SecureStore.setItemAsync(KEY, raw);
}
export async function clearServer() {
  if (isWeb) globalThis.localStorage.removeItem(KEY); else await SecureStore.deleteItemAsync(KEY);
}

export class ApiError extends Error {
  constructor(message, status = 0, code = '') { super(message); this.status = status; this.code = code; }
}

async function call(base, path, { method = 'GET', body, token, timeout = 20000 } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  let r;
  try {
    r = await globalThis.fetch(base + path, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal });
  } catch (e) {
    throw new ApiError(ctl.signal.aborted ? 'The server did not answer in time.' : 'Could not reach the server. Check the address and your connection.', 0, 'OFFLINE');
  } finally { clearTimeout(timer); }
  let j = null;
  try { j = await r.json(); } catch {}
  if (!j) throw new ApiError(`That address answered, but it is not an Artemis server (HTTP ${r.status}).`, r.status, 'NOT_ARTEMIS');
  if (!r.ok || j.ok === false) throw new ApiError(j.error || `HTTP ${r.status}`, r.status);
  return j;
}

/** Pairs this device: address + one-time code -> { url, token, client, server }. */
export async function pair(url, code, name, kind) {
  const base = normalizeUrl(url);
  const ping = await call(base, '/v1/ping');
  if (ping.name !== 'artemis') throw new ApiError('That address is not an Artemis server.');
  if (!ping.pairing) throw new ApiError('Pairing is off on that server.');
  try {
    const r = await call(base, '/v1/pair', { method: 'POST', body: { code: String(code || '').trim(), name, kind } });
    return { url: base, token: r.token, clientId: r.client.id, name: r.client.name, serverName: (r.server && r.server.name) || '', pairedAt: Date.now() };
  } catch (e) {
    if (e.status === 401) throw new ApiError('That code is wrong or has expired. Make a new one on the server.', 401);
    throw e;
  }
}

export function createApi(server) {
  const base = server.url, token = server.token;
  const req = (path, opts = {}) => call(base, path, { ...opts, token });

  /**
   * A streamed request (POST /v1/chat or GET /v1/runs/:id/events). onEvent({ type, seq, data }).
   * Resolves when the stream ends; rejects with ApiError (code OFFLINE when the connection dropped).
   */
  async function stream(path, { method = 'GET', body, onEvent, signal } = {}) {
    let r;
    try {
      r = await streamFetch(base + path, { method, headers: { authorization: `Bearer ${token}`, accept: 'text/event-stream', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal });
    } catch (e) {
      if (signal && signal.aborted) return;
      throw new ApiError('The connection to the server dropped.', 0, 'OFFLINE');
    }
    if (!r.ok) { let j = null; try { j = await r.json(); } catch {} throw new ApiError((j && j.error) || `HTTP ${r.status}`, r.status); }
    const feed = sseParser(onEvent);
    const dec = utf8Decoder();
    if (!r.body || !r.body.getReader) { feed(await r.text()); return; } // no streaming here: everything at the end
    const reader = r.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) { feed(dec(new Uint8Array(0), true)); break; }
        feed(typeof value === 'string' ? value : dec(value, false));
      }
    } catch (e) {
      if (signal && signal.aborted) return;
      throw new ApiError('The connection to the server dropped.', 0, 'OFFLINE');
    }
  }

  return {
    base, token, req, stream,
    get: (p) => req(p),
    post: (p, b) => req(p, { method: 'POST', body: b || {} }),
    del: (p) => req(p, { method: 'DELETE' }),
    mediaUrl: (name) => `${base}/v1/media/${encodeURIComponent(name)}`
  };
}
