// IPC: mcp
const crypto = require('crypto');
const { resolveOAuth } = require('../mcp-oauth');

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

module.exports = function registerMcpIpc(deps) {
  // readMcpList returns decrypted secrets; writeMcpList encrypts them at rest
  const { ipcMain, mcp, oauthCallbackServer, oauthPending, parseImport, readMcpList, writeMcpList, shell } = deps;
  // Refreshed OAuth tokens are saved here. replaced: id -> access token that a refresh made stale, so a later
  // mcp:save from a window that still holds the old tokens does not overwrite the new ones.
  const replaced = new Map();
  mcp.setTokenSaver?.((id, oauth) => {
    const list = readMcpList();
    const old = list.find((c) => c.id === id);
    if (!old) return;
    if (old.oauth?.accessToken && old.oauth.accessToken !== oauth.accessToken) replaced.set(id, old.oauth.accessToken);
    writeMcpList(list.map((c) => (c.id === id ? { ...c, oauth: { accessToken: oauth.accessToken, refreshToken: oauth.refreshToken || '', expiresAt: oauth.expiresAt || 0 } } : c)));
  });
  ipcMain.handle('mcp:status', () => mcp.status(readMcpList()));
  // Artemis's own built-in tools, shown as a connector card (names and short descriptions only)
  ipcMain.handle('artemis:tools', () => {
    const on = { makeEnabled: true, hasFolder: true, memoryEnabled: true, webEnabled: true, shellEnabled: true, computerEnabled: true, phoneEnabled: true, scheduleEnabled: true, notesEnabled: true, termEnabled: true, mediaEnabled: true, skillsEnabled: true, learnEnabled: true, chatsEnabled: true, delegateEnabled: true };
    return require('../tools').definitions(on).map((d) => { const f = d.function || d; return { name: f.name, description: String(f.description || '').replace(/\s+/g, ' ').trim().slice(0, 200) }; });
  });
  ipcMain.handle('mcp:list', () => readMcpList());
  ipcMain.handle('mcp:save', async (_e, list) => {
    const saved = new Map(readMcpList().map((c) => [c.id, c]));
    const fresh = (c) => (c.oauth && replaced.has(c.id) && c.oauth.accessToken === replaced.get(c.id) ? saved.get(c.id)?.oauth || c.oauth : c.oauth);
    const clean = (Array.isArray(list) ? list : []).map((c) => ({
      id: String(c.id || Math.random().toString(36).slice(2, 10)), name: String(c.name || 'server').slice(0, 60), type: c.type === 'http' ? 'http' : 'stdio',
      command: String(c.command || ''), args: Array.isArray(c.args) ? c.args.map(String) : [], env: c.env && typeof c.env === 'object' ? c.env : {},
      url: String(c.url || ''), headers: c.headers && typeof c.headers === 'object' ? c.headers : {}, oauth: c.oauth && typeof c.oauth === 'object' ? fresh(c) : undefined,
      authorizationUrl: String(c.authorizationUrl || ''), tokenUrl: String(c.tokenUrl || ''), clientId: String(c.clientId || ''), clientSecret: String(c.clientSecret || ''), scope: String(c.scope || ''), resource: String(c.resource || ''), dcr: !!c.dcr, enabled: c.enabled !== false
    }));
    writeMcpList(clean);
    await mcp.configure(clean);
    return mcp.status(clean);
  });
  ipcMain.handle('mcp:oauth-start', async (_e, cfg) => {
    try {
      const state = crypto.randomBytes(24).toString('hex');
      // PKCE (S256)
      const verifier = b64url(crypto.randomBytes(32));
      const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
      const redirectUri = `http://127.0.0.1:${oauthCallbackServer.address().port}/callback`;
      const config = await resolveOAuth(cfg || {}, redirectUri);
      const resource = config.resource ? { resource: config.resource } : {};
      const params = new URLSearchParams({ response_type: 'code', client_id: config.clientId || '', redirect_uri: redirectUri, state, code_challenge: challenge, code_challenge_method: 'S256', ...(config.scope ? { scope: config.scope } : {}), ...resource });
      if (!/^https?:\/\//i.test(config.authorizationUrl)) throw new Error('The sign-in address is not a web address.');
      await shell.openExternal(`${config.authorizationUrl}${config.authorizationUrl.includes('?') ? '&' : '?'}${params.toString()}`);
      const result = await new Promise((resolve, reject) => { oauthPending.set(state, { resolve, reject }); setTimeout(() => { if (oauthPending.delete(state)) reject(new Error('OAuth timed out.')); }, 180000); });
      const body = new URLSearchParams({ grant_type: 'authorization_code', code: result.code, client_id: config.clientId || '', redirect_uri: redirectUri, code_verifier: verifier, ...(config.clientSecret ? { client_secret: config.clientSecret } : {}), ...resource });
      const tokenRes = await fetch(config.tokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body, signal: AbortSignal.timeout(30000) });
      const token = await tokenRes.json().catch(() => ({}));
      if (!tokenRes.ok || !token.access_token) throw new Error(token.error_description || token.error || `Token request failed (${tokenRes.status})`);
      return { ok: true, config, oauth: { accessToken: token.access_token, refreshToken: token.refresh_token || '', expiresAt: token.expires_in ? Date.now() + Number(token.expires_in) * 1000 : 0 } };
    } catch (e) { return { ok: false, error: e.message || String(e) }; }
  });
  ipcMain.handle('mcp:oauth-callback-url', () => `http://127.0.0.1:${oauthCallbackServer.address().port}/callback`);
  ipcMain.handle('mcp:oauth-open', (_e, url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); return true; });
  ipcMain.handle('mcp:import', (_e, text) => { try { return { ok: true, servers: parseImport(String(text)) }; } catch (e) { return { ok: false, error: e.message }; } });
};
