// Runs the headless gateway as a background service of this user: a launchd agent on macOS, a systemd user unit on Linux.
// It starts at login, restarts if it crashes, and keeps Telegram, scheduled tasks and the gateway API running while the app is closed.
// The service runs the app's own binary in Node mode (ELECTRON_RUN_AS_NODE=1), so no separate Node.js is needed; from source,
// any node (22.13+) works too. `artemis service install|uninstall|status`, or Settings → Privacy & safety → Gateway.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const LABEL = 'dev.orbixlabs.artemis.gateway';
const UNIT = 'artemis-gateway.service';
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * opts: { runtime (node or the app binary), electronNode (bool: set ELECTRON_RUN_AS_NODE), entry (cli entry .js), dataDir, args[], logFile }
 * deps (for tests): { platform, home, uid, exec(cmd, args) -> string, fs }
 */
function createService(deps = {}) {
  const platform = deps.platform || process.platform;
  const home = deps.home || os.homedir();
  const uid = deps.uid != null ? deps.uid : (process.getuid ? process.getuid() : 0);
  const exec = deps.exec || ((cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 }));
  const f = deps.fs || fs;
  const plistPath = path.join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`);
  const unitPath = path.join(home, '.config', 'systemd', 'user', UNIT);
  const supported = platform === 'darwin' || platform === 'linux';
  const tryExec = (cmd, args) => { try { return { ok: true, out: exec(cmd, args) }; } catch (e) { return { ok: false, out: String((e.stderr || e.message || '')).trim() }; } };

  function command({ runtime, entry, dataDir, args = [] }) {
    return [runtime, entry, 'gateway', '--data', dataDir, ...args];
  }

  function plist(o) {
    const argv = command(o).map((a) => `    <string>${xml(a)}</string>`).join('\n');
    const env = { ...(o.electronNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}), PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin' };
    const envXml = Object.entries(env).map(([k, v]) => `    <key>${xml(k)}</key><string>${xml(v)}</string>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${argv}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${envXml}
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${xml(o.logFile)}</string>
  <key>StandardErrorPath</key><string>${xml(o.logFile)}</string>
</dict>
</plist>
`;
  }

  function unit(o) {
    const q = (a) => (/[\s"'\\]/.test(a) ? `"${String(a).replace(/(["\\])/g, '\\$1')}"` : a);
    return `[Unit]
Description=Artemis gateway (headless agent, Telegram, scheduled tasks)
After=network-online.target

[Service]
ExecStart=${command(o).map(q).join(' ')}
${o.electronNode ? 'Environment=ELECTRON_RUN_AS_NODE=1\n' : ''}Restart=on-failure
RestartSec=10
StandardOutput=append:${o.logFile}
StandardError=append:${o.logFile}

[Install]
WantedBy=default.target
`;
  }

  function install(o) {
    if (!supported) throw new Error('Running the gateway as a background service is supported on macOS and Linux.');
    f.mkdirSync(path.dirname(o.logFile), { recursive: true });
    if (platform === 'darwin') {
      f.mkdirSync(path.dirname(plistPath), { recursive: true });
      tryExec('launchctl', ['bootout', `gui/${uid}/${LABEL}`]); // an older copy
      f.writeFileSync(plistPath, plist(o));
      const r = tryExec('launchctl', ['bootstrap', `gui/${uid}`, plistPath]);
      if (!r.ok && !/already|service is already loaded/i.test(r.out)) { const r2 = tryExec('launchctl', ['load', '-w', plistPath]); if (!r2.ok) throw new Error('launchctl could not start the service: ' + (r.out || r2.out)); }
    } else {
      f.mkdirSync(path.dirname(unitPath), { recursive: true });
      f.writeFileSync(unitPath, unit(o));
      tryExec('systemctl', ['--user', 'daemon-reload']);
      const r = tryExec('systemctl', ['--user', 'enable', '--now', UNIT]);
      if (!r.ok) throw new Error('systemctl could not start the service: ' + r.out);
    }
    return status();
  }

  function uninstall() {
    if (platform === 'darwin') {
      tryExec('launchctl', ['bootout', `gui/${uid}/${LABEL}`]);
      try { f.unlinkSync(plistPath); } catch {}
    } else if (platform === 'linux') {
      tryExec('systemctl', ['--user', 'disable', '--now', UNIT]);
      try { f.unlinkSync(unitPath); } catch {}
      tryExec('systemctl', ['--user', 'daemon-reload']);
    }
    return status();
  }

  /** { supported, installed, running, pid, file } */
  function status() {
    if (!supported) return { supported: false, installed: false, running: false, pid: 0, file: '' };
    if (platform === 'darwin') {
      const installed = f.existsSync(plistPath);
      const r = tryExec('launchctl', ['print', `gui/${uid}/${LABEL}`]);
      const pid = r.ok ? Number((/\bpid = (\d+)/.exec(r.out) || [])[1] || 0) : 0;
      return { supported: true, installed, running: !!pid, pid, file: plistPath };
    }
    const installed = f.existsSync(unitPath);
    const r = tryExec('systemctl', ['--user', 'show', UNIT, '--property=MainPID,ActiveState']);
    const pid = r.ok ? Number((/MainPID=(\d+)/.exec(r.out) || [])[1] || 0) : 0;
    return { supported: true, installed, running: r.ok && /ActiveState=active/.test(r.out) && pid > 0, pid, file: unitPath };
  }

  return { install, uninstall, status, plist, unit, LABEL, plistPath, unitPath };
}

module.exports = { createService, LABEL, UNIT };
