const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createFileWatch } = require('../electron/file-watch.js');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artemis-watch-'));
  const f = path.join(dir, 'a.csv'); fs.writeFileSync(f, 'a');
  const seen = [];
  const w = createFileWatch({ onChange: (abs, gone) => seen.push([path.basename(abs), gone]), debounceMs: 60 });
  w.watch(f); w.watch(f);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(50);
  fs.writeFileSync(f, 'ab'); fs.writeFileSync(f, 'abc'); // a burst: one change
  await wait(400);
  assert.deepStrictEqual(seen, [['a.csv', false]]);
  fs.writeFileSync(f, 'abcd'); w.touched(f); // the app's own save is not reported
  await wait(400);
  assert.strictEqual(seen.length, 1);
  w.unwatch(f); assert.strictEqual(w.size(), 1, 'still watched once');
  w.unwatch(f); assert.strictEqual(w.size(), 0);
  w.closeAll(); fs.rmSync(dir, { recursive: true, force: true });
  console.log('file-watch tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
