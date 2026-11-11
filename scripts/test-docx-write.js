// Docs editor → .docx → mammoth (what the viewer reads back): text, marks, headings, lists, tables survive a round trip.
const assert = require('assert');
const mammoth = require('mammoth');
const { docxFromDoc, imageSize } = require('../electron/docx-write');

(async () => {
  const t = (text, marks) => ({ type: 'text', text, ...(marks ? { marks: marks.map((m) => (typeof m === 'string' ? { type: m } : m)) } : {}) });
  const p = (...c) => ({ type: 'paragraph', content: c });
  const doc = { type: 'doc', content: [
    { type: 'heading', attrs: { level: 1 }, content: [t('Employees')] },
    p(t('Plain '), t('bold', ['bold']), t(' and '), t('italic', ['italic']), t(' and '), t('link', [{ type: 'link', attrs: { href: 'https://example.com' } }])),
    { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('one'))] }, { type: 'listItem', content: [p(t('two')), { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('two.a'))] }] }] }] },
    { type: 'orderedList', content: [{ type: 'listItem', content: [p(t('first'))] }] },
    { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [p(t('done'))] }] },
    { type: 'table', content: [
      { type: 'tableRow', content: [{ type: 'tableHeader', content: [p(t('ID'))] }, { type: 'tableHeader', content: [p(t('Name'))] }] },
      { type: 'tableRow', content: [{ type: 'tableCell', content: [p(t('1502'))] }, { type: 'tableCell', content: [p(t('Rashad'))] }] }
    ] },
    { type: 'blockquote', content: [p(t('quoted'))] },
    { type: 'codeBlock', content: [t('a = 1\nb = 2')] },
    { type: 'horizontalRule' },
    p()
  ] };
  const buf = await docxFromDoc(doc);
  assert.ok(buf.length > 1000 && buf[0] === 0x50 && buf[1] === 0x4b, 'a zip');
  const html = (await mammoth.convertToHtml({ buffer: buf })).value;
  assert.match(html, /<h1>Employees<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/); assert.match(html, /<em>italic<\/em>/);
  assert.match(html, /<a href="https:\/\/example.com">link<\/a>/);
  assert.match(html, /<ul><li>one<\/li><li>two<ul><li>two.a<\/li><\/ul><\/li><\/ul>/);
  assert.match(html, /<ol><li>first<\/li><\/ol>/);
  assert.match(html, /☑ done/);
  assert.match(html, /<table>.*ID.*Name.*<td><p>1502<\/p><\/td><td><p>Rashad<\/p><\/td>.*<\/table>/s);
  assert.match(html, /quoted/); assert.match(html, /a = 1<br \/>b = 2/);
  assert.ok((await docxFromDoc({ type: 'doc', content: [] })).length > 1000, 'an empty doc is still a valid file');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAEElEQVR4nGP4z8DwHxkzYAgArmIP8foXPOUAAAAASUVORK5CYII=', 'base64');
  assert.deepStrictEqual(imageSize(png), { w: 2, h: 3, type: 'png' });
  const withImg = await docxFromDoc({ type: 'doc', content: [{ type: 'image', attrs: { src: 'data:image/png;base64,' + png.toString('base64') } }] });
  assert.match((await mammoth.convertToHtml({ buffer: withImg })).value, /<img src="data:image\/png;base64,/);
  console.log('docx-write tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
