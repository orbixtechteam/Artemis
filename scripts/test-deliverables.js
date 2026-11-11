const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const D = require('../electron/deliverables.js');
const tools = require('../electron/tools.js');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artemis-deliv-'));
  const root = path.join(dir, 'proj'); const lib = path.join(dir, 'Files');
  fs.mkdirSync(root); fs.mkdirSync(lib); fs.mkdirSync(path.join(dir, '.ssh'));
  fs.writeFileSync(path.join(root, 'report.csv'), 'a,b\n1,2');
  fs.writeFileSync(path.join(root, 'app.js'), 'x');
  fs.writeFileSync(path.join(lib, 'notes.docx'), 'x');
  fs.writeFileSync(path.join(dir, '.ssh', 'key.txt'), 'k');
  const library = { abs: (p) => path.join(lib, p) };

  assert.ok(D.isDeliverable('a/b.xlsx') && D.isDeliverable('x.PDF') && !D.isDeliverable('src/app.js'));
  assert.strictEqual(D.autoCard(path.join(root, 'app.js')), null, 'source files get no card');
  assert.strictEqual(D.autoCard(path.join(root, 'report.csv')).ext, 'csv');

  const events = [];
  const ctx = { root, library, send: (e) => events.push(e), userData: path.join(dir, 'ud') };
  let r = await tools.run('present_files', { files: ['report.csv', 'notes.docx'] }, ctx);
  assert.ok(r.ok, r.text);
  assert.deepStrictEqual(events[0].items.map((i) => i.name), ['report.csv', 'notes.docx'], 'project first, then the Files library');
  assert.ok(path.isAbsolute(events[0].items[0].path));
  r = await tools.run('present_files', { files: ['missing.csv'] }, ctx);
  assert.ok(!r.ok && /not found/i.test(r.text));
  r = await tools.run('present_files', { files: [path.join(dir, '.ssh', 'key.txt')] }, ctx);
  assert.ok(!r.ok && /protected/.test(r.text), r.text);
  r = await tools.run('present_files', { files: ['a', 'b', 'c', 'd', 'e'] }, ctx);
  assert.ok(!r.ok && /At most 4/.test(r.text));
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('deliverables tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
