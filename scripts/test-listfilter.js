const assert = require('assert');
(async () => {
  const { filterSort } = await import('../src/lib/listfilter.mjs');
  const items = [{ n: 'beta note', t: 2 }, { n: 'Alpha', t: 3 }, { n: 'gamma note', t: 1 }];
  const run = (o) => filterSort(items, { text: (x) => x.n, at: (x) => x.t, ...o }).map((x) => x.n[0].toLowerCase()).join('');

  assert.strictEqual(run({ sort: 'new' }), 'abg');
  assert.strictEqual(run({ sort: 'old' }), 'gba');
  assert.strictEqual(run({ sort: 'az' }), 'abg');
  assert.strictEqual(run({ sort: 'za' }), 'gba');
  assert.strictEqual(run({ q: 'NOTE', sort: 'za' }), 'gb');
  assert.strictEqual(run({ q: 'note gamma' }), 'g');
  assert.strictEqual(run({ q: 'nothing' }), '');

  // memory has no real dates: the position in the file is the age
  const pos = filterSort(['first', 'last'], { text: (x) => x, at: (_, i) => i });
  assert.deepStrictEqual(pos, ['last', 'first']);
  assert.deepStrictEqual(items.map((x) => x.t), [2, 3, 1]); // input untouched
  console.log('listfilter ok');
})().catch((e) => { console.error(e); process.exit(1); });
