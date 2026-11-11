// Markdown → the document tree the Docs editor uses (TipTap / ProseMirror JSON), and that tree → printable HTML.
// create_document builds .docx (docx-write.js) and .pdf (HTML printed by Chromium) from it, so the model writes plain
// Markdown instead of a generator script. Covers: headings, paragraphs, **bold**, *italic*, ~~strike~~, `code`, links,
// images, nested bullet / numbered / task lists, tables, quotes, fenced code, dividers, hard breaks.

function inline(src) {
  const out = [];
  const push = (text, marks) => { if (!text) return; const last = out[out.length - 1]; const key = JSON.stringify(marks || []); if (last && last.type === 'text' && JSON.stringify(last.marks || []) === key) last.text += text; else out.push({ type: 'text', text, ...(marks && marks.length ? { marks } : {}) }); };
  const walk = (s, marks) => {
    let i = 0, buf = '';
    const flush = () => { push(buf, marks); buf = ''; };
    while (i < s.length) {
      const rest = s.slice(i);
      let m;
      if (rest[0] === '\\' && /[\\`*_~\[\]()#!|>-]/.test(rest[1] || '')) { buf += rest[1]; i += 2; continue; }
      if ((m = /^`([^`]+)`/.exec(rest))) { flush(); push(m[1], [...marks, { type: 'code' }]); i += m[0].length; continue; }
      if ((m = /^!\[([^\]]*)\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/.exec(rest))) { flush(); out.push({ type: 'image', attrs: { src: m[2], alt: m[1] } }); i += m[0].length; continue; }
      if ((m = /^\[([^\]]+)\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/.exec(rest))) { flush(); walk(m[1], [...marks, { type: 'link', attrs: { href: m[2] } }]); i += m[0].length; continue; }
      if ((m = /^(\*\*|__)(?=\S)([\s\S]*?\S)\1/.exec(rest))) { flush(); walk(m[2], [...marks, { type: 'bold' }]); i += m[0].length; continue; }
      if ((m = /^~~(?=\S)([\s\S]*?\S)~~/.exec(rest))) { flush(); walk(m[1], [...marks, { type: 'strike' }]); i += m[0].length; continue; }
      if ((m = /^(\*|_)(?=\S)([\s\S]*?\S)\1(?![*_\w])/.exec(rest)) && !(m[1] === '_' && /\w/.test(s[i - 1] || ''))) { flush(); walk(m[2], [...marks, { type: 'italic' }]); i += m[0].length; continue; }
      if ((m = /^(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/.exec(rest)) && !/\w/.test(s[i - 1] || '')) { flush(); push(m[1], [...marks, { type: 'link', attrs: { href: m[1] } }]); i += m[0].length; continue; }
      if ((m = /^ {2,}\n|^\\\n/.exec(rest))) { flush(); out.push({ type: 'hardBreak' }); i += m[0].length; continue; }
      buf += s[i] === '\n' ? ' ' : s[i]; i++;
    }
    flush();
  };
  walk(String(src || ''), []);
  return out;
}
const para = (text) => { const c = inline(text); return c.length ? { type: 'paragraph', content: c } : { type: 'paragraph' }; };
const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(\[[ xX]\]\s+)?(.*)$/;

/** Markdown text → { type: 'doc', content: [...] } */
function mdToDoc(md) {
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  const blocks = (stop) => {
    const out = [];
    while (i < lines.length && !(stop && stop(lines[i]))) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      let m;
      if ((m = /^\s*(```|~~~)\s*([\w+-]*)/.exec(line))) {
        const fence = m[1], code = []; i++;
        while (i < lines.length && !lines[i].trim().startsWith(fence)) code.push(lines[i++]);
        i++;
        out.push({ type: 'codeBlock', attrs: { language: m[2] || null }, content: code.length ? [{ type: 'text', text: code.join('\n') }] : [] });
        continue;
      }
      if ((m = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line))) { out.push({ type: 'heading', attrs: { level: m[1].length }, content: inline(m[2]) }); i++; continue; }
      if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push({ type: 'horizontalRule' }); i++; continue; }
      if (/^\s*>/.test(line)) {
        const q = []; while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''));
        out.push({ type: 'blockquote', content: mdToDoc(q.join('\n')).content });
        continue;
      }
      if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
        const head = cells(line); i += 2;
        const rows = [{ type: 'tableRow', content: head.map((c) => ({ type: 'tableHeader', content: [para(c)] })) }];
        while (i < lines.length && /^\s*\|/.test(lines[i])) {
          const r = cells(lines[i++]);
          rows.push({ type: 'tableRow', content: head.map((_, k) => ({ type: 'tableCell', content: [para(r[k] || '')] })) });
        }
        out.push({ type: 'table', content: rows });
        continue;
      }
      if (LIST_RE.test(line)) { out.push(list()); continue; }
      const p = [line.trim()]; i++;
      while (i < lines.length && lines[i].trim() && !/^\s*(```|~~~|#{1,6}\s|>|\|)/.test(lines[i]) && !LIST_RE.test(lines[i]) && !/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(lines[i])) p.push(lines[i++].trimStart());
      const text = p.join('\n').replace(/[ \t]+$/gm, (s) => (s.length >= 2 ? s : ''));
      const imgOnly = /^!\[([^\]]*)\]\(<?([^)\s>]+)>?\)$/.exec(text.trim());
      out.push(imgOnly ? { type: 'image', attrs: { src: imgOnly[2], alt: imgOnly[1] } } : para(text));
    }
    return out;
  };
  const list = () => {
    const first = LIST_RE.exec(lines[i]);
    const indent = first[1].length, ordered = /\d/.test(first[2]), task = !!first[3];
    const type = task ? 'taskList' : ordered ? 'orderedList' : 'bulletList';
    const node = { type, ...(ordered ? { attrs: { start: parseInt(first[2], 10) || 1 } } : {}), content: [] };
    while (i < lines.length) {
      const m = LIST_RE.exec(lines[i]);
      if (!m || m[1].length < indent) break;
      if (m[1].length > indent) { const last = node.content[node.content.length - 1]; if (last) last.content.push(list()); else i++; continue; }
      if ((/\d/.test(m[2]) !== ordered) || (!!m[3] !== task)) break;
      i++;
      const text = [m[4]];
      while (i < lines.length && lines[i].trim() && !LIST_RE.test(lines[i]) && /^\s+/.test(lines[i])) text.push(lines[i++].trim());
      const item = { type: task ? 'taskItem' : 'listItem', ...(task ? { attrs: { checked: /x/i.test(m[3]) } } : {}), content: [para(text.join(' '))] };
      node.content.push(item);
      while (i < lines.length && !lines[i].trim() && i + 1 < lines.length && LIST_RE.test(lines[i + 1]) && LIST_RE.exec(lines[i + 1])[1].length >= indent) i++;
    }
    return node;
  };
  const content = blocks();
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function inlineHtml(nodes, imgSrc) {
  return (nodes || []).map((n) => {
    if (n.type === 'hardBreak') return '<br>';
    if (n.type === 'image') return `<img src="${esc(imgSrc(n.attrs.src))}" alt="${esc(n.attrs.alt || '')}">`;
    let h = esc(n.text || '');
    for (const m of n.marks || []) {
      if (m.type === 'bold') h = `<strong>${h}</strong>`; else if (m.type === 'italic') h = `<em>${h}</em>`;
      else if (m.type === 'strike') h = `<s>${h}</s>`; else if (m.type === 'underline') h = `<u>${h}</u>`; else if (m.type === 'code') h = `<code>${h}</code>`;
      else if (m.type === 'link') h = `<a href="${esc(m.attrs.href)}">${h}</a>`;
    }
    return h;
  }).join('');
}
function blockHtml(nodes, imgSrc) {
  return (nodes || []).map((n) => {
    const kids = () => blockHtml(n.content, imgSrc);
    switch (n.type) {
      case 'heading': return `<h${n.attrs.level}>${inlineHtml(n.content, imgSrc)}</h${n.attrs.level}>`;
      case 'paragraph': return `<p>${inlineHtml(n.content, imgSrc) || '&nbsp;'}</p>`;
      case 'bulletList': return `<ul>${kids()}</ul>`;
      case 'orderedList': return `<ol start="${(n.attrs && n.attrs.start) || 1}">${kids()}</ol>`;
      case 'taskList': return `<ul class="tasks">${kids()}</ul>`;
      case 'listItem': return `<li>${kids()}</li>`;
      case 'taskItem': return `<li class="${n.attrs && n.attrs.checked ? 'done' : ''}"><span class="box">${n.attrs && n.attrs.checked ? '☑' : '☐'}</span> ${kids()}</li>`;
      case 'blockquote': return `<blockquote>${kids()}</blockquote>`;
      case 'codeBlock': return `<pre><code>${esc((n.content || []).map((t) => t.text).join(''))}</code></pre>`;
      case 'horizontalRule': return '<hr>';
      case 'image': return `<p><img src="${esc(imgSrc(n.attrs.src))}" alt="${esc(n.attrs.alt || '')}"></p>`;
      case 'table': return `<table>${kids()}</table>`;
      case 'tableRow': return `<tr>${kids()}</tr>`;
      case 'tableHeader': return `<th>${kids()}</th>`;
      case 'tableCell': return `<td>${kids()}</td>`;
      default: return kids();
    }
  }).join('\n');
}
const PRINT_CSS = `@page{size:A4;margin:22mm 20mm}body{font:11pt/1.55 -apple-system,"Segoe UI",Helvetica,Arial,sans-serif;color:#1f1f1f}
h1{font:600 24pt/1.2 Georgia,"Times New Roman",serif;margin:0 0 12pt}h2{font:600 17pt/1.25 Georgia,serif;margin:20pt 0 8pt}h3{font:600 13pt/1.3 Georgia,serif;margin:16pt 0 6pt}h4,h5,h6{font-size:11pt;margin:12pt 0 4pt}
p{margin:0 0 8pt}ul,ol{margin:0 0 8pt;padding-left:18pt}li>p{margin:0 0 3pt}ul.tasks{list-style:none;padding-left:4pt}li.done{color:#777;text-decoration:line-through}
table{border-collapse:collapse;width:100%;margin:6pt 0 12pt;font-size:10pt;page-break-inside:auto}tr{page-break-inside:avoid}th,td{border:1px solid #cfcfcf;padding:4pt 6pt;text-align:left;vertical-align:top}th{background:#f2f2f2;font-weight:600}td>p,th>p{margin:0}
blockquote{margin:8pt 0;padding-left:10pt;border-left:3px solid #ccc;color:#555}pre{background:#f5f5f5;padding:8pt;border-radius:4pt;font-size:9pt;white-space:pre-wrap}code{font-family:Menlo,Consolas,monospace;font-size:.9em}
hr{border:0;border-top:1px solid #ddd;margin:14pt 0}img{max-width:100%}a{color:#2456c9}`;

/** A whole printable page for PDF export. imgSrc(src) maps image paths to loadable URLs. */
function docToHtml(doc, { title = '', imgSrc = (s) => s } = {}) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${PRINT_CSS}</style></head><body>${blockHtml(doc.content, imgSrc)}</body></html>`;
}

module.exports = { mdToDoc, docToHtml, inline };
