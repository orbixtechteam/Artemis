const assert = require('assert');
(async () => {
  const F = await import('../src/lib/sheet-format.mjs');
  let f = F.patchRange({}, { r1: 0, r2: 1, c1: 0, c2: 0 }, { b: true, color: '#d93025' });
  assert.deepStrictEqual(F.formatOf(f, 1, 0), { b: true, color: '#d93025' });
  assert.strictEqual(F.commonValue(f, { r1: 0, r2: 1, c1: 0, c2: 0 }, 'b'), true);
  assert.strictEqual(F.commonValue(f, { r1: 0, r2: 2, c1: 0, c2: 0 }, 'b'), undefined);
  f = F.patchRange(f, { r1: 0, r2: 1, c1: 0, c2: 0 }, { b: false, color: null });
  assert.deepStrictEqual(f, {}, 'removing every key drops the cell');

  // insert / delete rows move the formats
  f = F.patchRange({}, { r1: 5, r2: 5, c1: 2, c2: 2 }, { i: true });
  assert.ok(F.shiftFormats(f, 'r', 3, 2)['7:2']);
  assert.deepStrictEqual(F.shiftFormats(f, 'r', 5, -1), {}, 'deleting the row deletes its format');
  assert.ok(F.shiftFormats(f, 'c', 0, -1)['5:1']);
  assert.deepStrictEqual(F.shiftSizes({ 2: 40, 6: 50 }, 3, 1), { 2: 40, 7: 50 });

  assert.strictEqual(F.formatNumber(1299, 'currency'), '$1,299.00');
  assert.strictEqual(F.formatNumber(-5, 'currency'), '-$5.00');
  assert.strictEqual(F.formatNumber(0.1012, 'percent'), '10.12%');
  assert.strictEqual(F.formatNumber('1234.5', 'number'), '1,234.50');
  assert.strictEqual(F.formatNumber(46337, 'date'), '2026-11-11');
  assert.strictEqual(F.formatNumber('abc', 'currency'), 'abc');
  assert.strictEqual(F.formatNumber(5, 'auto'), '5');

  const s = F.cellStyle({ b: true, u: true, s: true, align: 'center', size: 18 });
  assert.strictEqual(s.textDecoration, 'underline line-through'); assert.strictEqual(s.fontSize, '18px');

  const ax = F.makeAxis(5, { 1: 50 }, 30, 2);
  assert.strictEqual(ax.offset(2), 160); assert.strictEqual(ax.size(1), 100); assert.strictEqual(ax.total, 340);
  assert.strictEqual(ax.indexAt(0), 0); assert.strictEqual(ax.indexAt(59), 0); assert.strictEqual(ax.indexAt(60), 1); assert.strictEqual(ax.indexAt(10000), 4);
  console.log('sheet-format tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
{
  const fs = require('fs'), os = require('os'), path = require('path');
  const { createSheetMeta } = require('../electron/sheet-meta.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artemis-meta-'));
  const m = createSheetMeta({ dir });
  assert.deepStrictEqual(m.load('/x/a.csv'), {});
  m.save('/x/a.csv', { sheets: { S: { formats: { '0:0': { b: true } } } } });
  assert.strictEqual(m.load('/x/a.csv').sheets.S.formats['0:0'].b, true);
  m.copy('/x/a.csv', '/y/b.xlsx'); assert.ok(m.load('/y/b.xlsx').sheets);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('sheet-meta tests passed');
}
