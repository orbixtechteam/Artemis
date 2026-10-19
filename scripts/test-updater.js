// Updater: version rules, release parsing, the install script, and the check / download / install-on-quit flow with a fake network, disk and shell.
const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const fsReal = require('fs');
const os = require('os');
const { createUpdater, parseVersion, compareVersions, pickAsset, parseRelease, installScript } = require('../electron/updater');

// ---- versions
assert.deepStrictEqual(parseVersion('v1.4.0').n, [1, 4, 0]);
assert.strictEqual(parseVersion('1.4').n[2], 0);
assert.strictEqual(parseVersion('1.4.0-beta.1').pre, 'beta.1');
assert.strictEqual(parseVersion('latest'), null);
assert.strictEqual(compareVersions('1.10.0', '1.9.9'), 1);
assert.strictEqual(compareVersions('1.3.0', 'v1.3.0'), 0);
assert.strictEqual(compareVersions('1.4.0-beta.1', '1.4.0'), -1);
assert.strictEqual(compareVersions('1.4.0', '1.4.0-rc.1'), 1);
assert.strictEqual(compareVersions('abc', '1.0.0'), 0);

// ---- assets and releases
const assets = [
  { name: 'Artemis-1.4.0-arm64.dmg.blockmap', browser_download_url: 'u0' },
  { name: 'Artemis-1.4.0-x64.dmg', browser_download_url: 'u1' },
  { name: 'Artemis-1.4.0-arm64.dmg', browser_download_url: 'u2', size: 10, digest: 'sha256:' + 'a'.repeat(64) }
];
assert.strictEqual(pickAsset(assets, 'darwin', 'arm64').browser_download_url, 'u2');
assert.strictEqual(pickAsset(assets, 'darwin', 'x64').browser_download_url, 'u1');
assert.strictEqual(pickAsset(assets, 'win32', 'x64'), null);
assert.strictEqual(pickAsset([{ name: 'Artemis.dmg', browser_download_url: 'u' }], 'darwin', 'arm64').browser_download_url, 'u');
const rel = { tag_name: 'v1.4.0', name: 'One four', body: 'Notes', html_url: 'https://github.com/o/r/releases/tag/v1.4.0', assets };
const p = parseRelease(rel, '1.3.0', { platform: 'darwin', arch: 'arm64' });
assert.strictEqual(p.version, '1.4.0'); assert.strictEqual(p.asset.sha256, 'a'.repeat(64)); assert.strictEqual(p.asset.name, 'Artemis-1.4.0-arm64.dmg');
assert.strictEqual(parseRelease(rel, '1.4.0', {}), null, 'same version is not an update');
assert.strictEqual(parseRelease(rel, '1.5.0', {}), null, 'older release is not an update');
assert.strictEqual(parseRelease({ ...rel, draft: true }, '1.3.0', {}), null);
assert.strictEqual(parseRelease({ ...rel, prerelease: true }, '1.3.0', {}), null);
assert.ok(parseRelease({ ...rel, prerelease: true }, '1.3.0', { prerelease: true, platform: 'darwin', arch: 'arm64' }));
assert.strictEqual(parseRelease({ ...rel, assets: [{ ...assets[2], digest: 'md5:zz' }] }, '1.3.0', { platform: 'darwin', arch: 'arm64' }).asset.sha256, '', 'only a real sha256 digest is used');
assert.strictEqual(parseRelease({ ...rel, assets: [] }, '1.3.0', { platform: 'darwin', arch: 'arm64' }).asset, null);

// ---- install script: quoted paths, never kills the app, keeps the old app on failure
const sc = installScript({ pid: 42, dmg: "/tmp/it's a/Artemis.dmg", app: '/Applications/Artemis.app', relaunch: true, log: '/tmp/l.log' });
assert.ok(sc.includes(`DMG='/tmp/it'\\''s a/Artemis.dmg'`), 'a quote in a path is escaped');
assert.ok(sc.includes('PID=42') && sc.includes('RELAUNCH=1'));
assert.ok(!/kill -(9|KILL|TERM)|pkill/.test(sc), 'the installer waits, it does not kill Artemis');
assert.ok(/mv "\$OLD" "\$APP"/.test(sc), 'rolls back');
assert.strictEqual(installScript({ pid: 1, dmg: 'a', app: 'b', relaunch: false, log: 'c' }).includes('RELAUNCH=0'), true);
require('child_process').execFileSync('bash', ['-n'], { input: sc }); // valid bash

// ---- flow
const tmp = fsReal.mkdtempSync(path.join(os.tmpdir(), 'artemis-upd-'));
const dirp = path.join(tmp, 'updates');
const bytes = Buffer.from('x'.repeat(5000));
const sha = crypto.createHash('sha256').update(bytes).digest('hex');
const goodRelease = (over = {}) => ({ tag_name: '1.4.0', body: 'n', html_url: 'https://github.com/o/r/releases/tag/1.4.0', assets: [{ name: 'Artemis-1.4.0-arm64.dmg', size: bytes.length, browser_download_url: 'https://dl/x.dmg', digest: 'sha256:' + sha, ...over }] });
function net(json, body = bytes, status = 200) {
  const calls = [];
  const f = async (url) => {
    calls.push(url);
    if (/api\.github\.com/.test(url)) return json === null ? { ok: false, status: 404 } : { ok: true, status: 200, json: async () => json };
    return { ok: status === 200, status, headers: { get: () => String(body.length) }, body: (async function* () { for (let i = 0; i < body.length; i += 1000) yield body.subarray(i, i + 1000); })() };
  };
  f.calls = calls; return f;
}
function make(over = {}) {
  const events = []; const spawned = []; const notes = []; const settings = { updateAuto: true, updateDownload: true, updateInstall: true, ...(over.settings || {}) };
  const appDir = path.join(tmp, 'Applications'); fsReal.mkdirSync(appDir, { recursive: true });
  const u = createUpdater({
    fs: fsReal, path, dir: () => dirp, fetch: over.fetch || net(goodRelease()), spawn: (...a) => { spawned.push(a); return { unref() {} }; },
    version: '1.3.0', platform: over.platform || 'darwin', arch: 'arm64', isPackaged: over.isPackaged !== false, exePath: path.join(appDir, 'Artemis.app/Contents/MacOS/Artemis'),
    getSettings: () => settings, send: (s) => events.push(s), notify: (v) => notes.push(v), setTimer: over.setTimer || setTimeout, clearTimer: clearTimeout
  });
  return { u, events, spawned, notes, settings };
}
(async () => {
  // a newer release is found, downloaded, verified and announced once
  let m = make();
  let st = await m.u.check();
  assert.strictEqual(st.phase, 'ready'); assert.strictEqual(st.latest, '1.4.0'); assert.strictEqual(st.pct, 100);
  assert.ok(fsReal.existsSync(path.join(dirp, 'Artemis-1.4.0.dmg')) && !fsReal.existsSync(path.join(dirp, 'Artemis-1.4.0.dmg.part')));
  assert.deepStrictEqual(m.notes, ['1.4.0']);
  assert.ok(m.events.some((e) => e.phase === 'downloading') && m.events.some((e) => e.phase === 'checking'));
  assert.strictEqual(m.u.status().canInstall, true);
  // installing on quit starts the detached script once, without reopening the app
  assert.strictEqual(m.u.installOnQuit(), true);
  assert.strictEqual(m.spawned.length, 1); assert.strictEqual(m.spawned[0][0], '/bin/bash'); assert.strictEqual(m.spawned[0][2].detached, true);
  const script = fsReal.readFileSync(path.join(dirp, 'install-update.sh'), 'utf8');
  assert.ok(script.includes('RELAUNCH=0')); assert.ok(script.includes('Artemis.app'));
  // asked twice (before-quit can run again): still one script
  assert.strictEqual(m.u.installOnQuit(), true); assert.strictEqual(m.spawned.length, 1);
  // "Restart and update" reopens it
  m = make(); await m.u.check(); m.u.restartNow(); assert.strictEqual(m.u.installOnQuit(), true);
  assert.ok(fsReal.readFileSync(path.join(dirp, 'install-update.sh'), 'utf8').includes('RELAUNCH=1'));

  // install on quit off: nothing starts; restart now still works
  m = make({ settings: { updateInstall: false } }); await m.u.check();
  assert.strictEqual(m.u.installOnQuit(), false); assert.strictEqual(m.spawned.length, 0);
  m.u.restartNow(); assert.strictEqual(m.u.installOnQuit(), true);

  // download off: found but not downloaded
  m = make({ settings: { updateDownload: false } }); st = await m.u.check();
  assert.strictEqual(st.phase, 'available'); assert.strictEqual(m.u.ready, null);
  st = await m.u.download(); assert.strictEqual(st.phase, 'ready');

  // a wrong checksum is thrown away
  fsReal.rmSync(dirp, { recursive: true, force: true });
  m = make({ fetch: net(goodRelease({ digest: 'sha256:' + '0'.repeat(64) })) }); st = await m.u.check();
  assert.strictEqual(st.phase, 'error'); assert.ok(/checksum/.test(st.error)); assert.deepStrictEqual(fsReal.readdirSync(dirp), []);
  // a short download is refused
  m = make({ fetch: net(goodRelease(), bytes.subarray(0, 3000)) }); st = await m.u.check();
  assert.strictEqual(st.phase, 'error'); assert.ok(/incomplete/.test(st.error));
  // HTTP errors
  m = make({ fetch: net(goodRelease(), bytes, 500) }); st = await m.u.check(); assert.strictEqual(st.phase, 'error');
  m = make({ fetch: async () => ({ ok: false, status: 403 }) }); st = await m.u.check(); assert.ok(/limiting/.test(st.error));
  // no release, or nothing newer
  m = make({ fetch: net(null) }); st = await m.u.check(); assert.strictEqual(st.phase, 'uptodate');
  m = make({ fetch: net({ ...goodRelease(), tag_name: '1.3.0' }) }); st = await m.u.check(); assert.strictEqual(st.phase, 'uptodate'); assert.strictEqual(m.u.ready, null);
  // no file for this system: found, with nothing to download
  m = make({ platform: 'linux' }); st = await m.u.check(); assert.strictEqual(st.phase, 'available'); assert.strictEqual(st.asset, ''); assert.strictEqual(m.u.canInstall(), false);
  st = await m.u.download(); assert.strictEqual(st.phase, 'error');
  // a development run never installs
  fsReal.rmSync(dirp, { recursive: true, force: true });
  m = make({ isPackaged: false }); await m.u.check(); assert.strictEqual(m.u.installOnQuit(), false); assert.strictEqual(m.spawned.length, 0); assert.ok(/development/.test(m.u.status().error));
  // an app in a folder that cannot be written to: no install, with the reason
  m = make(); await m.u.check(); fsReal.chmodSync(path.join(tmp, 'Applications'), 0o555);
  if (process.getuid && process.getuid() !== 0) { assert.strictEqual(m.u.install(), false); assert.ok(/cannot replace itself/.test(m.u.status().error)); }
  fsReal.chmodSync(path.join(tmp, 'Applications'), 0o755);

  // tidy: old and half-finished downloads go, a newer one stays
  fsReal.rmSync(dirp, { recursive: true, force: true }); fsReal.mkdirSync(dirp, { recursive: true });
  for (const f of ['Artemis-1.2.0.dmg', 'Artemis-1.3.0.dmg', 'Artemis-1.9.0.dmg.part', 'Artemis-1.5.0.dmg', 'other.txt']) fsReal.writeFileSync(path.join(dirp, f), 'x');
  make().u.tidy();
  assert.deepStrictEqual(fsReal.readdirSync(dirp).sort(), ['Artemis-1.5.0.dmg', 'other.txt']);

  // background checks only run while "Check automatically" is on
  const timers = [];
  m = make({ settings: { updateAuto: false }, setTimer: (fn, ms) => { timers.push({ fn, ms }); return { unref() {} }; } });
  m.u.start(); assert.strictEqual(timers[0].ms, 45000);
  await timers[0].fn(); assert.strictEqual(m.events.filter((e) => e.phase === 'checking').length, 0, 'auto off: no check'); assert.strictEqual(timers[1].ms, 6 * 3600 * 1000);
  m.settings.updateAuto = true; await timers[1].fn(); assert.ok(m.events.some((e) => e.phase === 'checking'));
  m.u.stop();

  fsReal.rmSync(tmp, { recursive: true, force: true });
  console.log('updater tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
