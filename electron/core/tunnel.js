// A Cloudflare tunnel for the webhook port, so services on the internet can reach it (cloudflared must be installed:
// `brew install cloudflared`). Two kinds:
//   quick  `cloudflared tunnel --url http://127.0.0.1:<port>`: no account, a random https://….trycloudflare.com address
//          that changes every time the tunnel starts
//   named  `cloudflared tunnel run --token <token>`: your own tunnel and hostname from the Cloudflare dashboard (stable);
//          its public address is the one you give (e.g. https://hooks.example.com), pointed at http://127.0.0.1:<port>
// The tunnel only ever points at the webhook port, never at the gateway.
const fs = require('fs');
const path = require('path');
const { spawn: realSpawn } = require('child_process');

const QUICK_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

function findCloudflared({ env = process.env, exists = fs.existsSync } = {}) {
  const dirs = [...String(env.PATH || '').split(path.delimiter), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', path.join(env.HOME || '', '.local', 'bin')];
  const names = process.platform === 'win32' ? ['cloudflared.exe'] : ['cloudflared'];
  for (const d of dirs) for (const n of names) { if (!d) continue; const f = path.join(d, n); if (exists(f)) return f; }
  return null;
}

/** opts: { mode: 'quick'|'named', port, token?, publicUrl?, bin?, spawn?, log?, onChange?(status) } */
function createTunnel(opts) {
  const log = opts.log || (() => {});
  const spawn = opts.spawn || realSpawn;
  let child = null, stopped = true, restarts = 0, timer = null;
  let st = { state: 'off', url: '', error: '' };
  const set = (p) => { st = { ...st, ...p }; try { opts.onChange && opts.onChange({ ...st }); } catch {} };

  function launch() {
    const bin = opts.bin || findCloudflared();
    if (!bin) { set({ state: 'error', url: '', error: 'cloudflared is not installed. Install it (on a Mac: brew install cloudflared) and switch the tunnel on again.' }); return; }
    if (opts.mode === 'named' && !opts.token) { set({ state: 'error', url: '', error: 'Paste the tunnel token from the Cloudflare dashboard.' }); return; }
    const args = opts.mode === 'named'
      ? ['tunnel', '--no-autoupdate', 'run', '--token', opts.token]
      : ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${opts.port}`];
    set({ state: 'starting', error: '', url: opts.mode === 'named' ? String(opts.publicUrl || '').replace(/\/+$/, '') : '' });
    let c;
    try { c = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { set({ state: 'error', error: e.message }); return; }
    child = c;
    let tail = '';
    const onData = (buf) => {
      const s = buf.toString();
      tail = (tail + s).slice(-2000);
      const m = QUICK_URL.exec(s);
      if (m && opts.mode !== 'named' && st.url !== m[0]) { set({ state: 'running', url: m[0] }); restarts = 0; log('info', `tunnel: ${m[0]}`); }
      if (opts.mode === 'named' && /Registered tunnel connection|Connection [0-9a-f-]+ registered/i.test(s) && st.state !== 'running') { set({ state: 'running' }); restarts = 0; log('info', 'tunnel: connected'); }
    };
    c.stdout && c.stdout.on('data', onData);
    c.stderr && c.stderr.on('data', onData);
    c.on('error', (e) => set({ state: 'error', error: e.message }));
    c.on('exit', (code) => {
      if (child === c) child = null;
      if (stopped) return;
      const last = tail.trim().split('\n').filter(Boolean).pop() || '';
      restarts++;
      if (restarts > 5) { set({ state: 'error', url: '', error: `cloudflared stopped (${code}). ${last.slice(0, 200)}` }); return; }
      set({ state: 'starting', error: `restarting (cloudflared stopped: ${code})` });
      timer = setTimeout(launch, Math.min(60000, 3000 * restarts));
      if (timer.unref) timer.unref();
    });
  }

  return {
    start() { if (!stopped) return; stopped = false; restarts = 0; launch(); },
    stop() { stopped = true; if (timer) clearTimeout(timer); timer = null; if (child) { try { child.kill(); } catch {} child = null; } set({ state: 'off', url: '', error: '' }); },
    status: () => ({ ...st })
  };
}

module.exports = { createTunnel, findCloudflared, QUICK_URL };
