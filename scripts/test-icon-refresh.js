const assert = require('assert');
const path = require('path');
const { createIconRefresh, bundleOf, LSREGISTER } = require('../electron/icon-refresh');

assert.strictEqual(bundleOf('/Applications/Artemis.app/Contents/MacOS/Artemis'), '/Applications/Artemis.app');
assert.strictEqual(bundleOf('/usr/local/bin/electron'), '');

function fakeFs(marker) {
  const files = {}; if (marker != null) files['/data/icon-registered.txt'] = marker;
  const touched = [];
  return {
    files, touched,
    readFileSync: (f) => { if (!(f in files)) throw new Error('ENOENT'); return files[f]; },
    writeFileSync: (f, v) => { files[f] = v; },
    mkdirSync: () => {},
    utimesSync: (f) => touched.push(f),
  };
}
const make = (fs, calls, over = {}) => createIconRefresh({
  fs, path, markerFile: '/data/icon-registered.txt', version: '1.7.18', exePath: '/Applications/Artemis.app/Contents/MacOS/Artemis', isPackaged: true, platform: 'darwin',
  execFile: (cmd, args, opts, cb) => { calls.push([cmd, args]); cb(over.fail ? new Error('boom') : null); }, ...over,
});

// first run of a new version: touch + lsregister -f, then remember the version
let fs = fakeFs('1.7.16'); let calls = [];
assert.strictEqual(make(fs, calls).run(), true);
assert.deepStrictEqual(calls, [[LSREGISTER, ['-f', '/Applications/Artemis.app']]]);
assert.deepStrictEqual(fs.touched, ['/Applications/Artemis.app']);
assert.strictEqual(fs.files['/data/icon-registered.txt'], '1.7.18');

// same version again: nothing
calls = [];
assert.strictEqual(make(fs, calls).run(), false);
assert.strictEqual(calls.length, 0);

// failure: version not remembered, so the next start tries again
fs = fakeFs(null); calls = [];
make(fs, calls, { fail: true }).run();
assert.strictEqual(fs.files['/data/icon-registered.txt'], undefined);

// dev runs and other platforms are left alone
calls = [];
assert.strictEqual(make(fakeFs(null), calls, { isPackaged: false }).run(), false);
assert.strictEqual(make(fakeFs(null), calls, { platform: 'linux' }).run(), false);
assert.strictEqual(calls.length, 0);

console.log('icon-refresh: ok');
