// Updates from the project's GitHub Releases: checks in the background, downloads the new build, installs it when Artemis quits (or on "Restart and update").
// electron-updater is not used on purpose: on macOS it needs a signed app, and Artemis is distributed unsigned. This module does the same job with
// the release API and a small install script (mount the .dmg, copy the .app next to the old one, swap, keep the old one if anything fails).
// A factory like the other main-process modules: the network, files, process spawning and the clock are injected, so scripts/test-updater.js runs it without Electron.
const crypto = require('crypto');

const DEFAULT_REPO = 'orbixtechteam/Artemis';
const CHECK_EVERY_MS = 6 * 3600 * 1000;
const FIRST_CHECK_MS = 45 * 1000;
const STALL_MS = 30 * 1000;

/** "v1.4.0-beta.2" → { n: [1, 4, 0], pre: 'beta.2' }; null when it is not a version. */
function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(String(v || '').trim());
  return m ? { n: [Number(m[1]), Number(m[2]), Number(m[3] || 0)], pre: m[4] || '' } : null;
}
/** -1, 0 or 1; a pre-release (1.4.0-beta) is older than the release (1.4.0). Not a version: 0. */
function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x.n[i] !== y.n[i]) return x.n[i] > y.n[i] ? 1 : -1;
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre > y.pre ? 1 : -1;
}

/** The release file for this computer (what the installer can handle: the macOS .dmg; other systems only get the release page). */
function pickAsset(assets, platform = process.platform, arch = process.arch) {
  const list = (Array.isArray(assets) ? assets : []).filter((a) => a && a.name && a.browser_download_url);
  if (platform !== 'darwin') return null;
  const dmgs = list.filter((a) => /\.dmg$/i.test(a.name) && !/blockmap/i.test(a.name));
  const want = arch === 'arm64' ? /arm64|aarch64/i : /x64|x86_64|intel/i;
  const other = arch === 'arm64' ? /x64|x86_64|intel/i : /arm64|aarch64/i;
  return dmgs.find((a) => want.test(a.name)) || dmgs.find((a) => !other.test(a.name)) || null;
}

/** A GitHub release JSON → what the app needs, or null when it is a draft, a pre-release or not newer than `current`. */
function parseRelease(rel, current, { platform, arch, prerelease = false } = {}) {
  if (!rel || rel.draft || (rel.prerelease && !prerelease)) return null;
  const tag = String(rel.tag_name || '');
  if (!parseVersion(tag) || compareVersions(tag, current) <= 0) return null;
  const a = pickAsset(rel.assets, platform, arch);
  const digest = a && typeof a.digest === 'string' && /^sha256:[0-9a-f]{64}$/i.test(a.digest) ? a.digest.slice(7).toLowerCase() : '';
  return {
    version: tag.replace(/^v/, ''), tag, name: String(rel.name || tag), notes: String(rel.body || '').slice(0, 4000), page: String(rel.html_url || ''),
    asset: a ? { name: a.name, size: Number(a.size) || 0, url: a.browser_download_url, sha256: digest } : null
  };
}

const sh = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`; // one word for bash, whatever is in the path

/**
 * The script that installs a downloaded .dmg after Artemis has quit. It waits for the app to exit (it never kills it), copies the new .app next to the
 * old one, swaps them and opens the new one only when `relaunch` is set. If any step fails the old app stays (or is put back).
 */
function installScript({ pid, dmg, app, relaunch, log }) {
  return `#!/bin/bash
# Written by Artemis (electron/updater.js). Installs a downloaded update after Artemis has quit.
PID=${Number(pid) || 0}; DMG=${sh(dmg)}; APP=${sh(app)}; LOG=${sh(log)}; RELAUNCH=${relaunch ? 1 : 0}
exec >>"$LOG" 2>&1
echo; echo "== $(date '+%F %T') installing $DMG into $APP"
for i in $(seq 1 80); do kill -0 "$PID" 2>/dev/null || break; sleep 0.5; done
if kill -0 "$PID" 2>/dev/null; then echo "Artemis is still running: update not installed."; exit 1; fi
back() { [ "$RELAUNCH" = 1 ] && [ -e "$APP" ] && open "$APP"; }
MNT="$(mktemp -d /tmp/artemis-update.XXXXXX)"
if ! hdiutil attach -nobrowse -readonly -noverify -mountpoint "$MNT" "$DMG" >/dev/null; then echo "Could not open the download."; rmdir "$MNT" 2>/dev/null; back; exit 1; fi
SRC="$(ls -d "$MNT"/*.app 2>/dev/null | head -1)"
DIR="$(dirname "$APP")"; NEW="$DIR/.$(basename "$APP").new-$$"; OLD="$DIR/$(basename "$APP").old-$$"
if [ -z "$SRC" ]; then echo "No app inside the download."; hdiutil detach "$MNT" -quiet -force; back; exit 1; fi
rm -rf "$NEW"
if ! ditto "$SRC" "$NEW"; then echo "Copy failed: the old app is untouched."; rm -rf "$NEW"; hdiutil detach "$MNT" -quiet -force; back; exit 1; fi
xattr -dr com.apple.quarantine "$NEW" 2>/dev/null
hdiutil detach "$MNT" -quiet -force
if ! mv "$APP" "$OLD"; then echo "Could not move the old app aside."; rm -rf "$NEW"; back; exit 1; fi
if ! mv "$NEW" "$APP"; then echo "Install failed: putting the old app back."; mv "$OLD" "$APP"; rm -rf "$NEW"; back; exit 1; fi
rm -rf "$OLD"; rm -f "$DMG"
echo "Updated."
[ "$RELAUNCH" = 1 ] && open "$APP"
exit 0
`;
}

function createUpdater({
  fs, path, dir, fetch, spawn, version, platform = process.platform, arch = process.arch, isPackaged = true, exePath = '',
  getSettings, send = () => {}, notify = () => {}, log = () => {}, repo = DEFAULT_REPO, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout
}) {
  const cfg = (k, d = true) => { try { const v = (getSettings() || {})[k]; return v === undefined ? d : v !== false; } catch { return d; } };
  let st = { phase: 'idle', current: version, latest: '', notes: '', page: '', pct: 0, error: '', checkedAt: 0, asset: '', canInstall: false };
  let rel = null; let ready = null; let timer = null; let busy = null; let pendingRelaunch = false; let notified = ''; let started = false;
  const push = (patch) => { st = { ...st, ...patch }; try { send({ ...st }); } catch {} };
  const mkdir = () => { try { fs.mkdirSync(dir(), { recursive: true }); } catch {} return dir(); };
  const fileOf = (v) => path.join(dir(), `Artemis-${v}.dmg`);

  /** Where the .app lives and whether it can be replaced there (macOS, a packaged app, a writable folder). */
  function target() {
    if (platform !== 'darwin' || !isPackaged) return { ok: false, why: platform !== 'darwin' ? 'Automatic installing is for macOS; open the release page to get the new version.' : 'This is a development run: nothing is installed.' };
    const m = /^(.*\.app)\/Contents\/MacOS\//.exec(String(exePath || ''));
    if (!m) return { ok: false, why: 'Could not find where Artemis is installed.' };
    try { fs.accessSync(path.dirname(m[1]), fs.constants.W_OK); } catch { return { ok: false, why: `Artemis cannot replace itself in ${path.dirname(m[1])}: move it to Applications or update it by hand.` }; }
    return { ok: true, app: m[1] };
  }
  const canInstall = () => target().ok;

  async function api(url) {
    const ac = new AbortController(); const t = setTimer(() => ac.abort(), 20000);
    try {
      const res = await fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Artemis/${version}` }, signal: ac.signal });
      if (res.status === 403 || res.status === 429) throw new Error('GitHub is limiting requests right now. Try again later.');
      if (res.status === 404) return null; // no release yet
      if (!res.ok) throw new Error(`GitHub answered HTTP ${res.status}.`);
      return await res.json();
    } finally { clearTimer(t); }
  }

  /** Looks for a newer release. Returns the state. */
  async function check() {
    if (busy) return busy.then(() => st).catch(() => st);
    busy = (async () => {
      if (st.phase === 'downloading') return;
      if (ready && st.phase === 'ready') return;
      push({ phase: 'checking', error: '' });
      try {
        const json = await api(`https://api.github.com/repos/${repo}/releases/latest`);
        const found = parseRelease(json, version, { platform, arch });
        const checkedAt = now();
        if (!found) { rel = null; push({ phase: 'uptodate', latest: json && parseVersion(json.tag_name) ? String(json.tag_name).replace(/^v/, '') : '', notes: '', page: '', checkedAt, asset: '', canInstall: canInstall() }); log('info', `Update check: up to date (${version})`); return; }
        rel = found;
        log('info', `Update check: ${found.version} is available (this is ${version})`);
        push({ phase: 'available', latest: found.version, notes: found.notes, page: found.page, asset: found.asset ? found.asset.name : '', checkedAt, canInstall: canInstall() });
        if (found.asset && cfg('updateDownload')) await download();
      } catch (e) {
        const msg = e && e.name === 'AbortError' ? 'GitHub did not answer in time.' : String((e && e.message) || e);
        push({ phase: 'error', error: msg, checkedAt: now() }); log('warn', 'Update check failed: ' + msg);
      }
    })();
    try { await busy; } finally { busy = null; }
    return st;
  }

  /** Downloads the file of the release found by check(): to a .part file first, verified (size, SHA-256 when GitHub gives it), then renamed. */
  async function download() {
    if (!rel || !rel.asset) { push({ phase: 'error', error: 'There is no download for this computer. Open the release page.' }); return st; }
    if (st.phase === 'downloading') return st;
    const a = rel.asset; const final = fileOf(rel.version); const part = final + '.part';
    mkdir();
    push({ phase: 'downloading', pct: 0, error: '' });
    try {
      if (fs.existsSync(final) && (!a.size || fs.statSync(final).size === a.size)) { ready = { version: rel.version, file: final }; push({ phase: 'ready', pct: 100 }); announce(); return st; }
      const ac = new AbortController(); let stall = setTimer(() => ac.abort(), STALL_MS);
      const res = await fetch(a.url, { headers: { 'User-Agent': `Artemis/${version}`, Accept: 'application/octet-stream' }, signal: ac.signal });
      if (!res.ok || !res.body) { clearTimer(stall); throw new Error(`The download answered HTTP ${res.status}.`); }
      const total = Number(res.headers.get('content-length')) || a.size || 0;
      const hash = crypto.createHash('sha256'); const out = fs.createWriteStream(part); let got = 0; let lastPct = -1; let werr = null;
      out.on('error', (e) => { werr = e; });
      try {
        for await (const chunk of res.body) {
          clearTimer(stall); stall = setTimer(() => ac.abort(), STALL_MS);
          hash.update(chunk); got += chunk.length;
          if (werr) throw werr;
          if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
          const pct = total ? Math.min(99, Math.floor((got / total) * 100)) : 0;
          if (pct !== lastPct) { lastPct = pct; push({ pct }); }
        }
      } finally { clearTimer(stall); }
      await new Promise((r) => out.end(r));
      if (werr) throw werr;
      if (a.size && got !== a.size) throw new Error('The download is incomplete. It will be tried again.');
      if (a.sha256 && hash.digest('hex') !== a.sha256) throw new Error('The download does not match its checksum. It was thrown away.');
      fs.renameSync(part, final);
      ready = { version: rel.version, file: final };
      log('info', `Update ${rel.version} downloaded (${Math.round(got / 1048576)} MB)`);
      push({ phase: 'ready', pct: 100 }); announce();
    } catch (e) {
      try { fs.rmSync(part, { force: true }); } catch {}
      const msg = e && e.name === 'AbortError' ? 'The download stopped (no data for 30 seconds).' : String((e && e.message) || e);
      push({ phase: 'error', error: msg }); log('warn', 'Update download failed: ' + msg);
    }
    return st;
  }

  function announce() { if (ready && notified !== ready.version) { notified = ready.version; try { notify(ready.version); } catch {} } }

  /** Starts the install script for a downloaded update. It waits for this process to end. Returns true when it was started. */
  function install({ relaunch = false } = {}) {
    if (started) return true; // the script is already waiting for this process to end
    if (!ready || !fs.existsSync(ready.file)) return false;
    const t = target();
    if (!t.ok) { push({ error: t.why }); return false; }
    try {
      mkdir();
      const script = path.join(dir(), 'install-update.sh');
      fs.writeFileSync(script, installScript({ pid: process.pid, dmg: ready.file, app: t.app, relaunch, log: path.join(dir(), 'install.log') }), { mode: 0o700 });
      const child = spawn('/bin/bash', [script], { detached: true, stdio: 'ignore' });
      if (child && child.unref) child.unref();
      started = true;
      log('info', `Update ${ready.version} will be installed after Artemis quits${relaunch ? ' (and opened again)' : ''}`);
      return true;
    } catch (e) { push({ error: 'Could not start the installer: ' + ((e && e.message) || e) }); return false; }
  }

  /** Called while Artemis quits: installs a downloaded update when the user wants that (or asked to restart now). */
  function installOnQuit() {
    if (!ready) return false;
    if (!pendingRelaunch && !cfg('updateInstall')) return false;
    const ok = install({ relaunch: pendingRelaunch });
    pendingRelaunch = false;
    return ok;
  }
  /** "Restart and update": the caller quits the app next; the installer opens the new one. */
  function restartNow() { if (!ready || !canInstall()) return false; pendingRelaunch = true; return true; }

  /** Old downloads (this version or older) and half-finished ones are removed. A complete newer one is kept: the next check finds it and is ready at once. */
  function tidy() {
    try {
      for (const f of fs.readdirSync(dir())) {
        const m = /^Artemis-(.+)\.dmg(\.part)?$/.exec(f);
        if (m && (m[2] || compareVersions(m[1], version) <= 0)) { try { fs.rmSync(path.join(dir(), f), { force: true }); } catch {} }
      }
    } catch {}
  }

  function schedule(ms) {
    clearTimer(timer);
    timer = setTimer(async () => { if (cfg('updateAuto')) await check(); schedule(CHECK_EVERY_MS); }, ms);
    if (timer && timer.unref) timer.unref();
  }
  /** Background checks: soon after start, then every 6 hours, only while "Check automatically" is on. */
  function start() { tidy(); push({ canInstall: canInstall() }); schedule(FIRST_CHECK_MS); }
  function stop() { clearTimer(timer); timer = null; }

  return { status: () => ({ ...st, repo }), check, download, install, installOnQuit, restartNow, start, stop, tidy, canInstall, target, get ready() { return ready ? { ...ready } : null; } };
}

module.exports = { createUpdater, parseVersion, compareVersions, pickAsset, parseRelease, installScript, DEFAULT_REPO };
