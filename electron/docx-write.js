// Writes a Word file from the Docs editor's document (TipTap / ProseMirror JSON): headings, paragraphs, bold / italic /
// underline / strike / code, links, bullet and numbered lists (nested), checklists, tables, quotes, code blocks, dividers,
// line breaks and images. Opening is mammoth (docx → HTML); together they let a .docx be edited in Artemis.
// Word-only details the editor does not model (fonts, page headers, comments) are not kept; files:docx-write backs up
// the original before the first save.
const d = require('docx');

const HEAD = [null, d.HeadingLevel.HEADING_1, d.HeadingLevel.HEADING_2, d.HeadingLevel.HEADING_3, d.HeadingLevel.HEADING_4, d.HeadingLevel.HEADING_5, d.HeadingLevel.HEADING_6];
const MAX_IMG_W = 600; // px, about the text width of an A4 / Letter page

/** Pixel size of a PNG / JPEG / GIF from its bytes, or null. */
function imageSize(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), type: 'png' };
  if (buf.length > 10 && buf[0] === 0x47 && buf[1] === 0x49) return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8), type: 'gif' };
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1], len = buf.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7), type: 'jpg' };
      i += 2 + len;
    }
  }
  return null;
}
function imageFrom(src, readLocal) {
  let buf = null;
  const m = /^data:image\/[a-z+.-]+;base64,(.*)$/i.exec(String(src || ''));
  if (m) buf = Buffer.from(m[1], 'base64');
  else if (readLocal) { try { buf = readLocal(String(src || '')); } catch { buf = null; } }
  const size = buf && imageSize(buf);
  if (!size || !size.w || !size.h) return null;
  const k = Math.min(1, MAX_IMG_W / size.w);
  return new d.ImageRun({ data: buf, type: size.type, transformation: { width: Math.round(size.w * k), height: Math.round(size.h * k) } });
}

function runs(nodes, opts, base = {}) {
  const out = [];
  for (const n of nodes || []) {
    if (n.type === 'hardBreak') { out.push(new d.TextRun({ text: '', break: 1 })); continue; }
    if (n.type === 'image') { const im = imageFrom(n.attrs && n.attrs.src, opts.readLocal); if (im) out.push(im); continue; }
    if (n.type !== 'text') continue;
    const marks = new Map((n.marks || []).map((mk) => [mk.type, mk.attrs || {}]));
    const style = {
      text: n.text || '', bold: base.bold || marks.has('bold') || undefined, italics: base.italics || marks.has('italic') || undefined,
      underline: marks.has('underline') ? {} : undefined, strike: marks.has('strike') || undefined,
      ...(marks.has('code') || base.code ? { font: 'Courier New', size: 20 } : {})
    };
    if (marks.has('link') && marks.get('link').href) out.push(new d.ExternalHyperlink({ link: marks.get('link').href, children: [new d.TextRun({ ...style, style: 'Hyperlink' })] }));
    else out.push(new d.TextRun(style));
  }
  return out;
}

/** Block nodes → docx paragraphs and tables. ctx: { list: { kind, level, instance }, quote, bold (header cells) } */
function blocks(nodes, opts, ctx = {}) {
  const out = [];
  for (const n of nodes || []) {
    const quote = ctx.quote ? { indent: { left: 567 }, border: { left: { style: d.BorderStyle.SINGLE, size: 12, color: 'BBBBBB', space: 8 } } } : {};
    switch (n.type) {
      case 'heading': out.push(new d.Paragraph({ heading: HEAD[Math.min(6, (n.attrs && n.attrs.level) || 1)], children: runs(n.content, opts) })); break;
      case 'paragraph': {
        const list = ctx.list;
        const p = { children: runs(n.content, opts, { bold: ctx.bold }), ...quote };
        if (list && list.first) {
          list.first = false;
          if (list.kind === 'bullet') p.bullet = { level: list.level };
          else if (list.kind === 'ordered') p.numbering = { reference: 'artemis-num', level: list.level, instance: list.instance };
          else if (list.kind === 'task') p.children.unshift(new d.TextRun({ text: list.checked ? '☑ ' : '☐ ' }));
        } else if (list) p.indent = { left: 720 * (list.level + 1) };
        out.push(new d.Paragraph(p));
        break;
      }
      case 'bulletList': case 'orderedList': case 'taskList': {
        const kind = n.type === 'bulletList' ? 'bullet' : n.type === 'orderedList' ? 'ordered' : 'task';
        const level = ctx.list ? Math.min(8, ctx.list.level + 1) : 0;
        const instance = kind === 'ordered' ? ++opts.counter : 0;
        for (const item of n.content || []) out.push(...blocks(item.content, opts, { ...ctx, list: { kind, level, instance, first: true, checked: !!(item.attrs && item.attrs.checked) } }));
        break;
      }
      case 'blockquote': out.push(...blocks(n.content, opts, { ...ctx, quote: true })); break;
      case 'codeBlock': {
        const lines = ((n.content || []).map((t) => t.text || '').join('')).split('\n');
        out.push(new d.Paragraph({ shading: { type: d.ShadingType.CLEAR, fill: 'F2F2F2', color: 'auto' }, children: lines.flatMap((l, i) => [new d.TextRun({ text: l, font: 'Courier New', size: 20, ...(i ? { break: 1 } : {}) })]) }));
        break;
      }
      case 'horizontalRule': out.push(new d.Paragraph({ border: { bottom: { style: d.BorderStyle.SINGLE, size: 6, color: 'CCCCCC', space: 1 } }, children: [] })); break;
      case 'image': { const im = imageFrom(n.attrs && n.attrs.src, opts.readLocal); if (im) out.push(new d.Paragraph({ children: [im] })); break; }
      case 'table': {
        const rows = (n.content || []).map((row) => new d.TableRow({
          tableHeader: (row.content || []).every((c) => c.type === 'tableHeader') || undefined,
          children: (row.content || []).map((cell) => new d.TableCell({
            columnSpan: (cell.attrs && cell.attrs.colspan) || 1, rowSpan: (cell.attrs && cell.attrs.rowspan) || 1,
            shading: cell.type === 'tableHeader' ? { type: d.ShadingType.CLEAR, fill: 'F2F2F2', color: 'auto' } : undefined,
            children: (() => { const b = blocks(cell.content, opts, { bold: cell.type === 'tableHeader' }); return b.length ? b : [new d.Paragraph('')]; })()
          }))
        }));
        if (rows.length) out.push(new d.Table({ rows, width: { size: 100, type: d.WidthType.PERCENTAGE } }), new d.Paragraph(''));
        break;
      }
      default: if (n.content) out.push(...blocks(n.content, opts, ctx));
    }
  }
  return out;
}

/** A .docx file (Buffer) from a TipTap JSON document. opts.readLocal(path) → Buffer for images given as file paths. */
async function docxFromDoc(json, opts = {}) {
  const o = { counter: 0, readLocal: opts.readLocal };
  const children = blocks((json && json.content) || [], o);
  const levels = Array.from({ length: 9 }, (_, i) => ({
    level: i, format: [d.LevelFormat.DECIMAL, d.LevelFormat.LOWER_LETTER, d.LevelFormat.LOWER_ROMAN][i % 3], text: `%${i + 1}.`, alignment: d.AlignmentType.START,
    style: { paragraph: { indent: { left: 720 * (i + 1), hanging: 360 } } }
  }));
  const doc = new d.Document({
    creator: 'Artemis', title: opts.title || '',
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    numbering: { config: [{ reference: 'artemis-num', levels }] },
    sections: [{ children: children.length ? children : [new d.Paragraph('')] }]
  });
  return d.Packer.toBuffer(doc);
}

module.exports = { docxFromDoc, imageSize };
