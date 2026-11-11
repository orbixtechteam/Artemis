const assert = require('assert');
(async () => {
  const T = await import('../src/lib/table-model.mjs');
  for (const v of ['12', '-3.5', '$1,299.00', '45%', '(120)', '1e6', '1 000']) assert.ok(T.isNumeric(v), v);
  for (const v of ['abc', '2026-01-14', '+44 7700 900101', '', 'v1.2']) assert.ok(!T.isNumeric(v), v);
  const rows = [['id', 'name', 'spend', 'date'], ['1', 'Emma', '$49.00', '2026-01-14'], ['2', 'Liam', '$19.00', '2026-02-03'], ['3', 'A very long company name that goes on and on and on and on', '', '2026-02-21']];
  const c = T.inferColumns(rows);
  assert.deepStrictEqual(c.map((x) => x.name), ['id', 'name', 'spend', 'date']);
  assert.deepStrictEqual(c.map((x) => x.numeric), [true, false, true, false]);
  assert.strictEqual(c[0].id, true); assert.strictEqual(c[1].id, false);
  assert.strictEqual(c[1].width, T.MAX_AUTO_W, 'long text is capped'); assert.ok(c[0].width >= T.MIN_W);
  assert.deepStrictEqual(T.inferColumns([['a', 'b']], { header: false }).map((x) => x.name), ['A', 'B']);
  assert.strictEqual(T.colLetter(27), 'AB');
  const v = T.visibleRange(4400, 880, 100000);
  assert.ok(v.first <= 100 && v.last >= 120 && v.top === v.first * T.ROW_H);
  assert.deepStrictEqual(T.visibleRange(0, 500, 3), { first: 0, last: 3, top: 0, bottom: 0 });
  console.log('table-model tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
