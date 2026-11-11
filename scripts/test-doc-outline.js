const assert = require('assert');
(async () => {
  const { headingsOf } = await import('../src/lib/doc-outline.mjs');
  const doc = { type: 'doc', content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Report' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'abc' }] },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Results ' }, { type: 'text', text: 'Q3' }] },
    { type: 'horizontalRule' }
  ] };
  assert.deepStrictEqual(headingsOf(doc), [{ level: 1, text: 'Report', pos: 0 }, { level: 2, text: 'Results Q3', pos: 13 }]);
  assert.deepStrictEqual(headingsOf(null), []);
  console.log('doc-outline tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
(async () => {
  const { imageSrc } = await import('../src/lib/doc-outline.mjs');
  assert.strictEqual(imageSrc('https://x/y.png', '/a/b.md'), 'https://x/y.png');
  assert.strictEqual(imageSrc('/a/c.png', '/a/b.md'), 'artemis-file://f/' + encodeURIComponent('/a/c.png'));
  assert.strictEqual(imageSrc('img/c.png', '/a/b.md'), 'artemis-file://f/' + encodeURIComponent('/a/img/c.png'));
  assert.strictEqual(imageSrc('../c.png', '/a/d/b.md'), 'artemis-file://f/' + encodeURIComponent('/a/c.png'));
  assert.strictEqual(imageSrc('C:\\x\\c.png', 'C:\\x\\b.md'), 'artemis-file://f/' + encodeURIComponent('C:\\x\\c.png'));
  assert.strictEqual(imageSrc('c.png', 'C:\\x\\b.md'), 'artemis-file://f/' + encodeURIComponent('C:/x/c.png'));
  console.log('doc image tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
