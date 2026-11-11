const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('../electron/links.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artemis-links-'));
const proj = path.join(dir, 'proj'), files = path.join(dir, 'Files');
fs.mkdirSync(path.join(proj, 'src'), { recursive: true }); fs.mkdirSync(files);
fs.writeFileSync(path.join(proj, 'src', 'a.js'), 'x');
fs.writeFileSync(path.join(files, 'report one.csv'), 'a,b');
fs.writeFileSync(path.join(files, 'pic.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
fs.mkdirSync(path.join(dir, '.ssh')); fs.writeFileSync(path.join(dir, '.ssh', 'id_rsa'), 'k');
const roots = [proj, files];
const isSensitive = (p) => /\/\.ssh(\/|$)/.test(p);
const real = (p) => fs.realpathSync(p);

assert.strictEqual(L.stripSuffix('src/a.js#L24-L30'), 'src/a.js');
assert.strictEqual(L.stripSuffix('src/a.js:24'), 'src/a.js');
assert.strictEqual(L.stripSuffix('<report one.csv>'), 'report one.csv');
assert.deepStrictEqual(L.candidates('https://x.com/a'), []);

assert.strictEqual(L.resolveLink('src/a.js#L3', { roots }).abs, real(path.join(proj, 'src', 'a.js')));
assert.strictEqual(L.resolveLink('report%20one.csv', { roots }).abs, real(path.join(files, 'report one.csv')), 'falls back to the Files folder');
assert.strictEqual(L.resolveLink('file://' + path.join(files, 'pic.png'), { roots }).mime, 'image/png');
assert.strictEqual(L.resolveLink(path.join(files, 'pic.png'), {}).mime, 'image/png');
assert.strictEqual(L.resolveLink('~/pic.png', { home: files }).abs, real(path.join(files, 'pic.png')));
assert.ok(L.resolveLink('nope.txt', { roots }).error);
assert.ok(/protected/.test(L.resolveLink(path.join(dir, '.ssh', 'id_rsa'), { isSensitive }).error));
assert.ok(L.resolveLink('src', { roots }).dir);

const u = L.urlFor('/a b/c.png');
assert.strictEqual(L.pathFromUrl(u), '/a b/c.png');
(async () => {
  const mk = (url, range) => ({ url, headers: { get: (k) => (k === 'range' ? range || null : null) } });
  let r = L.serve(mk(L.urlFor(path.join(files, 'pic.png'))));
  assert.strictEqual(r.status, 200); assert.strictEqual(r.headers.get('content-type'), 'image/png');
  r = L.serve(mk(L.urlFor(path.join(files, 'pic.png')), 'bytes=1-2'));
  assert.strictEqual(r.status, 206); assert.strictEqual(Buffer.from(await r.arrayBuffer()).length, 2);
  assert.strictEqual(L.serve(mk(L.urlFor(path.join(files, 'report one.csv')))).status, 404, 'only media types are served');
  assert.strictEqual(L.serve(mk(L.urlFor(path.join(dir, '.ssh', 'id_rsa.png'))), { isSensitive }).status, 404);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('links tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
