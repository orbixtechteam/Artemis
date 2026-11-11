// The outline of a document: its headings in order, from a ProseMirror / TipTap JSON tree. Pure: scripts/test-doc-outline.js.

/** [{ level, text, pos }] where pos is the heading's position in the document (for scrolling to it). */
export function headingsOf(doc) {
  const out = [];
  let pos = 0;
  const textOf = (n) => (n.text || '') + (n.content || []).map(textOf).join('');
  const size = (n) => (n.type === 'text' ? (n.text || '').length : n.content && n.content.length ? 2 + n.content.reduce((t, c) => t + size(c), 0) : 1);
  for (const node of (doc && doc.content) || []) {
    if (node.type === 'heading') out.push({ level: (node.attrs && node.attrs.level) || 1, text: textOf(node).trim(), pos });
    pos += size(node);
  }
  return out;
}

/** What an <img> in a document shows: web and data URLs as they are, a local path (absolute, or relative to the
 *  document's folder) through the artemis-file protocol. The Markdown keeps the path the author wrote. */
export function imageSrc(src, docPath) {
  const s = String(src || '');
  if (!s || /^(https?:|data:|blob:|artemis-file:)/i.test(s)) return s;
  let p = s.replace(/^file:\/\//i, '');
  try { p = decodeURI(p); } catch {}
  const abs = /^([A-Za-z]:[\\/]|[\\/])/.test(p);
  if (!abs && docPath) {
    const dir = String(docPath).replace(/[\\/][^\\/]*$/, '');
    const parts = (dir + '/' + p).split(/[\\/]+/), out = [];
    for (const x of parts) { if (x === '..') out.pop(); else if (x !== '.') out.push(x); }
    p = (/^[\\/]/.test(dir) ? '/' : '') + out.filter((x, i) => x || i === 0).join('/');
    p = p.replace(/^\/+/, /^[\\/]/.test(dir) ? '/' : '');
  }
  return `artemis-file://f/${encodeURIComponent(p)}`;
}
