// macOS keeps its own copy of an app's icon (LaunchServices, Notification Center). After an update
// with a new logo, notifications go on showing the old one until the bundle is registered again.
// Once per version: touch the bundle and re-register it with LaunchServices (-f forces a re-read).
const LSREGISTER = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';

function bundleOf(exePath) {
  const m = String(exePath || '').match(/^(.*?\.app)\/Contents\/MacOS\//);
  return m ? m[1] : '';
}

function createIconRefresh({ fs, path, execFile, markerFile, version, exePath, isPackaged, platform = process.platform, log = () => {} }) {
  const run = () => {
    if (platform !== 'darwin' || !isPackaged) return false;
    const bundle = bundleOf(exePath);
    if (!bundle) return false;
    let seen = '';
    try { seen = fs.readFileSync(markerFile, 'utf8').trim(); } catch {}
    if (seen === version) return false;
    try { const now = new Date(); fs.utimesSync(bundle, now, now); } catch (e) { log('touch failed: ' + e.message); }
    execFile(LSREGISTER, ['-f', bundle], { timeout: 20000 }, (e) => {
      if (e) { log('lsregister failed: ' + e.message); return; }
      try { fs.mkdirSync(path.dirname(markerFile), { recursive: true }); fs.writeFileSync(markerFile, version); } catch {}
      log('registered ' + bundle + ' again for v' + version);
    });
    return true;
  };
  return { run };
}

module.exports = { createIconRefresh, bundleOf, LSREGISTER };
