// Runs the webhook port (hooks.js) and its optional Cloudflare tunnel (tunnel.js) as the settings say, in whichever
// process owns the background jobs (the app, or the headless gateway while it runs). It writes what it is doing to
// <data>/hooks-state.json, so the app can show the public address even when the headless gateway serves it.
//   settings: hooksEnabled, hooksPort (8790), hooksTunnel ('off' | 'quick' | 'named'), hooksPublicUrl (named tunnels)
const { createHooksServer } = require('./hooks');
const { createTunnel } = require('./tunnel');

/** deps: { hooks, settings(), tunnelToken(), owner: 'desktop'|'headless', writeState?(info), log?, makeServer?, makeTunnel? } */
function createHookService(deps) {
  const log = deps.log || (() => {});
  const makeServer = deps.makeServer || createHooksServer;
  const makeTunnel = deps.makeTunnel || createTunnel;
  let server = null, port = null, tunnel = null, tunKey = '', error = '', busy = null;

  function info() {
    const st = deps.settings() || {};
    const t = tunnel ? tunnel.status() : { state: 'off', url: '', error: '' };
    return {
      owner: deps.owner, pid: process.pid, enabled: !!st.hooksEnabled, running: !!server, port: port || Number(st.hooksPort) || 8790, error,
      localUrl: server ? `http://127.0.0.1:${port}` : '', tunnel: { mode: st.hooksTunnel || 'off', ...t }, publicUrl: t.state === 'running' || (t.url && st.hooksTunnel === 'named') ? t.url : '',
      updatedAt: Date.now()
    };
  }
  const publish = () => { try { deps.writeState && deps.writeState(info()); } catch {} };

  async function doSync() {
    const st = deps.settings() || {};
    const want = !!st.hooksEnabled;
    const p = Math.min(65535, Math.max(1024, Number(st.hooksPort) || 8790));
    if (server && (!want || port !== p)) { await server.stop(); server = null; port = null; }
    if (want && !server) {
      const s = makeServer({ hooks: deps.hooks, host: '127.0.0.1', port: p, log: (lv, m) => log(lv, m) });
      try { await s.start(); server = s; port = p; error = ''; }
      catch (e) { error = e && e.code === 'EADDRINUSE' ? `Port ${p} is already in use. Pick another one.` : String((e && e.message) || e); log('warn', 'webhooks: ' + error); }
    }
    if (!want) error = '';
    const mode = want && server ? String(st.hooksTunnel || 'off') : 'off';
    const token = mode === 'named' ? String(deps.tunnelToken() || '') : '';
    const key = mode === 'off' ? '' : `${mode}|${p}|${mode === 'named' ? token + '|' + (st.hooksPublicUrl || '') : ''}`;
    if (tunnel && key !== tunKey) { tunnel.stop(); tunnel = null; }
    if (key && !tunnel) { tunnel = makeTunnel({ mode, port: p, token, publicUrl: st.hooksPublicUrl || '', log: (lv, m) => log(lv, m), onChange: publish }); tunnel.start(); }
    tunKey = key;
    publish();
    return info();
  }

  return {
    /** Applies the settings (safe to call often; calls never overlap). */
    sync() { if (!busy) busy = doSync().finally(() => { busy = null; }); return busy; },
    async stop() { if (tunnel) { tunnel.stop(); tunnel = null; tunKey = ''; } if (server) { await server.stop(); server = null; port = null; } publish(); },
    info
  };
}

module.exports = { createHookService };
