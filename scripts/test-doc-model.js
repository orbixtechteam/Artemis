const assert = require('assert');
const { mdToDoc, docToHtml } = require('../electron/doc-model');
const md = `# Employees

Plain **bold** and *italic*, \`code\`, ~~old~~ and [a link](https://x.com).

- one
- two
  - two.a
1. first
2. second
- [x] done
- [ ] todo

| ID | Name |
|----|------|
| 1502 | Rashad |
| 1003 | Nigar \\| N |

> quoted line

\`\`\`js
a = 1
\`\`\`

---
![chart](chart.png)`;
const d = mdToDoc(md);
const types = d.content.map((n) => n.type);
assert.deepStrictEqual(types, ['heading', 'paragraph', 'bulletList', 'orderedList', 'taskList', 'table', 'blockquote', 'codeBlock', 'horizontalRule', 'image']);
const p = d.content[1].content;
assert.deepStrictEqual(p.find((x) => x.text === 'bold').marks, [{ type: 'bold' }]);
assert.deepStrictEqual(p.find((x) => x.text === 'a link').marks, [{ type: 'link', attrs: { href: 'https://x.com' } }]);
assert.strictEqual(d.content[2].content[1].content[1].type, 'bulletList', 'nested list');
assert.strictEqual(d.content[4].content[0].attrs.checked, true);
assert.strictEqual(d.content[5].content.length, 3);
assert.strictEqual(d.content[5].content[2].content[1].content[0].content[0].text, 'Nigar | N');
assert.strictEqual(d.content[7].content[0].text, 'a = 1');
const html = docToHtml(d, { title: 'T', imgSrc: (s) => 'file:///x/' + s });
assert.match(html, /<h1>Employees<\/h1>/); assert.match(html, /<th><p>ID<\/p><\/th>/); assert.match(html, /src="file:\/\/\/x\/chart.png"/);
assert.match(html, /<li class="done"><span class="box">☑/);
assert.deepStrictEqual(mdToDoc('').content, [{ type: 'paragraph' }]);
assert.strictEqual(mdToDoc('snake_case_name here').content[0].content[0].text, 'snake_case_name here');
console.log('doc-model tests passed');
