// Background service files (launchd plist, systemd unit) and the install / uninstall / status calls, with a fake launchctl/systemctl.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createService, LABEL } = require('../electron/core/service');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'artemis-svc-'));
const o = { runtime: '/Applications/Artemis.app/Contents/MacOS/Artemis', electronNode: true, entry: '/Applications/Artemis.app/Contents/Resources/app.asar/electron/core/cli-entry.js', dataDir: '/Users/me/Library/Application Support/AI Desktop', args: ['--no-browser'], logFile: path.join(home, '.artemis/logs/gateway.log') };

// macOS
let calls = [];
let loaded = false;
const mac = createService({ platform: 'darwin', home, uid: 501, exec: (cmd, args) => {
  calls.push([cmd, ...args]);
  if (args[0] === 'bootstrap') { loaded = true; return ''; }
  if (args[0] === 'bootout') { if (!loaded) throw Object.assign(new Error('x'), { stderr: 'No such process' }); loaded = false; return ''; }
  if (args[0] === 'print') { if (!loaded) throw new Error('not found'); return 'state = running\n\tpid = 4242\n'; }
  return '';
} });
let st = mac.status();
assert.deepStrictEqual([st.installed, st.running], [false, false]);
st = mac.install(o);
assert.deepStrictEqual([st.installed, st.running, st.pid], [true, true, 4242]);
const plist = fs.readFileSync(mac.plistPath, 'utf8');
assert.ok(plist.includes(`<string>${LABEL}</string>`));
assert.ok(plist.includes('<string>gateway</string>') && plist.includes('<string>--no-browser</string>'));
assert.ok(plist.includes('Application Support/AI Desktop'), 'paths with spaces stay one argument');
assert.ok(plist.includes('<key>ELECTRON_RUN_AS_NODE</key><string>1</string>'));
assert.ok(plist.includes('<key>RunAtLoad</key><true/>') && plist.includes('SuccessfulExit'));
assert.ok(calls.some((c) => c[1] === 'bootstrap' && c[2] === 'gui/501'));
assert.ok(fs.existsSync(path.dirname(o.logFile)));
st = mac.uninstall();
assert.deepStrictEqual([st.installed, st.running], [false, false]);
assert.ok(!fs.existsSync(mac.plistPath));
assert.ok(mac.plist({ ...o, dataDir: 'a&b<c' }).includes('a&amp;b&lt;c'), 'XML escaped');

// Linux
calls = [];
let active = false;
const lin = createService({ platform: 'linux', home, exec: (cmd, args) => {
  calls.push([cmd, ...args]);
  if (args.includes('enable')) { active = true; return ''; }
  if (args.includes('disable')) { active = false; return ''; }
  if (args.includes('show')) return active ? 'MainPID=777\nActiveState=active\n' : 'MainPID=0\nActiveState=inactive\n';
  return '';
} });
st = lin.install({ ...o, runtime: '/usr/bin/node', electronNode: false, entry: '/opt/artemis/electron/core/cli-entry.js', dataDir: '/srv/artemis data' });
assert.deepStrictEqual([st.installed, st.running, st.pid], [true, true, 777]);
const unit = fs.readFileSync(lin.unitPath, 'utf8');
assert.ok(unit.includes('ExecStart=/usr/bin/node /opt/artemis/electron/core/cli-entry.js gateway --data "/srv/artemis data" --no-browser'), unit);
assert.ok(!unit.includes('ELECTRON_RUN_AS_NODE') && unit.includes('Restart=on-failure'));
assert.ok(calls.some((c) => c.join(' ') === 'systemctl --user enable --now artemis-gateway.service'));
st = lin.uninstall();
assert.deepStrictEqual([st.installed, st.running], [false, false]);

// errors and unsupported systems
const bad = createService({ platform: 'darwin', home, uid: 1, exec: () => { throw Object.assign(new Error('boom'), { stderr: 'Bootstrap failed: 5: Input/output error' }); } });
assert.throws(() => bad.install(o), /launchctl could not start/);
assert.strictEqual(createService({ platform: 'win32', home }).status().supported, false);
assert.throws(() => createService({ platform: 'win32', home }).install(o), /macOS and Linux/);

fs.rmSync(home, { recursive: true, force: true });
console.log('test-service: ok');
