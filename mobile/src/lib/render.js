// Turns artifacts and files into a page the app shows in a web view, like the desktop's viewers:
// web pages as they are, SVG, Markdown documents, spreadsheets/CSV as tables (one per sheet), code.
// The page uses the Artemis colours of the current look.
import { marked } from 'marked';

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

/** Minimal CSV parser (quotes, delimiters, newlines), the same as the desktop's lib/preview.js. */
export function parseCsv(text, delim = ',') {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
export function detectDelimiter(text, name = '') {
  if (/\.tsv$|\.tab$/i.test(name)) return '\t';
  const first = String(text || '').split('\n', 3).join('\n');
  let best = ',', n = -1;
  for (const d of [',', ';', '\t', '|']) { const k = first.split(d).length; if (k > n) { n = k; best = d; } }
  return best;
}
/** "## Sheet: name\n<csv>" blocks (spreadsheet artifacts, xlsx files read by the server) -> [{ name, rows }]. */
export function splitSheets(text, name = '') {
  const t = String(text || '');
  const parts = /^## Sheet: /m.test(t) ? t.split(/^## Sheet: /m).filter(Boolean) : [];
  if (!parts.length) return [{ name: 'Data', rows: parseCsv(t, detectDelimiter(t, name)) }];
  return parts.map((p) => {
    const nl = p.indexOf('\n');
    const body = nl < 0 ? '' : p.slice(nl + 1);
    return { name: p.slice(0, nl < 0 ? p.length : nl).replace(/\s*\([^)]*\)\s*$/, ''), rows: parseCsv(body, detectDelimiter(body)) };
  });
}

const css = (c) => `
  :root { color-scheme: ${c.dark === false ? 'light' : 'dark'}; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 18px; background: ${c.bg}; color: ${c.text}; font: 16px/1.6 -apple-system, BlinkMacSystemFont, "SF Pro Text", Roboto, sans-serif; -webkit-text-size-adjust: 100%; word-wrap: break-word; }
  h1, h2, h3 { font-family: ui-serif, "New York", Georgia, serif; font-weight: 600; line-height: 1.25; margin: 1.2em 0 .5em; }
  h1 { font-size: 1.7em; } h2 { font-size: 1.35em; } h3 { font-size: 1.15em; }
  a { color: ${c.accent}; }
  p, ul, ol { margin: .6em 0; } li { margin: .2em 0; }
  code { font: 13px/1.5 ui-monospace, Menlo, monospace; background: ${c.code}; padding: 2px 5px; border-radius: 5px; }
  pre { background: ${c.code}; padding: 14px; border-radius: 12px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  blockquote { margin: .8em 0; padding: .2em 1em; border-left: 3px solid ${c.accent}; color: ${c.muted}; }
  hr { border: 0; border-top: 1px solid ${c.line}; margin: 1.4em 0; }
  img { max-width: 100%; border-radius: 10px; }
  table { border-collapse: collapse; font-size: 14px; }
  .tablewrap { overflow-x: auto; border: 1px solid ${c.line}; border-radius: 12px; margin: 10px 0 22px; }
  th, td { border-bottom: 1px solid ${c.line}; border-right: 1px solid ${c.line}; padding: 7px 11px; text-align: left; white-space: nowrap; vertical-align: top; }
  th { background: ${c.card}; font-weight: 600; position: sticky; top: 0; }
  td.n { text-align: right; font-variant-numeric: tabular-nums; }
  tr:last-child td { border-bottom: 0; } th:last-child, td:last-child { border-right: 0; }
  .rownum { color: ${c.muted}; text-align: right; }
  .sheet { color: ${c.muted}; font-size: 14px; margin: 4px 2px 0; }
  .meta { color: ${c.muted}; font-size: 13px; margin-top: 6px; }
  /* documents (Markdown, Word, extracted text): the desktop's document viewer (.docpage, Claude Docs type) */
  .docpage { max-width: 760px; margin: 0 auto; padding: 10px 4px 60px; font-size: 16px; line-height: 1.6; overflow-wrap: anywhere; }
  .docpage h1, .docpage .doc-title { font-family: ui-serif, "New York", Georgia, serif; font-weight: 500; font-size: 30px; line-height: 1.15; letter-spacing: -.01em; margin: 0 0 18px; }
  .docpage h2 { font-family: ui-serif, "New York", Georgia, serif; font-weight: 500; font-size: 24px; line-height: 1.25; margin: 30px 0 12px; }
  .docpage h3 { font-family: ui-serif, "New York", Georgia, serif; font-weight: 500; font-size: 20px; margin: 24px 0 10px; }
  .docpage h4, .docpage h5, .docpage h6 { font-family: inherit; font-size: 16px; font-weight: 600; margin: 20px 0 8px; }
  .docpage .doc-subtitle { color: ${c.muted}; font-size: 18px; margin-top: -8px; }
  .docpage p { margin: 0 0 12px; }
  .docpage ul, .docpage ol { margin: 0 0 12px; padding-left: 26px; }
  .docpage li { margin: 4px 0; }
  .docpage img { max-width: 100%; height: auto; border-radius: 8px; }
  .docpage table { border-collapse: separate; border-spacing: 0; width: 100%; margin: 16px 0; border: 1px solid ${c.line}; border-radius: 8px; overflow: hidden; font-size: 15px; }
  .docpage th, .docpage td { padding: 10px 14px; text-align: left; vertical-align: top; border-bottom: 1px solid ${c.line}; border-right: 1px solid ${c.line}; white-space: normal; position: static; }
  .docpage tr > :last-child { border-right: 0; }
  .docpage tr:last-child > td { border-bottom: 0; }
  .docpage thead th, .docpage table tr:first-child > th { background: ${c.fill}; font-weight: 500; color: ${c.text}; }
  .docpage blockquote { margin: 12px 0; padding: 2px 16px; border-left: 3px solid ${c.line}; color: ${c.muted}; }
  .docpage.plain { white-space: pre-wrap; font-size: 15px; }
  /* code and text files: a quiet code view */
  pre.codev { margin: 0; border-radius: 0; background: transparent; padding: 4px 0 40px; font: 13px/1.55 ui-monospace, Menlo, monospace; white-space: pre; }
  /* spreadsheet: the desktop's sheet editor (letters, row numbers, frozen first row, tabs at the bottom) */
  body.shbody { padding: 0; height: 100vh; overflow: hidden; }
  .shv { position: absolute; inset: 0 0 var(--shb, 34px) 0; overflow: auto; -webkit-overflow-scrolling: touch; background: ${c.bg}; }
  table.sh { border-collapse: separate; border-spacing: 0; font-size: 14px; table-layout: fixed; }
  table.sh td, table.sh th { box-sizing: border-box; height: 30px; padding: 0 8px; border: 0; border-right: 1px solid ${c.line}; border-bottom: 1px solid ${c.line}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 260px; min-width: 96px; font-weight: 400; vertical-align: middle; text-align: left; }
  table.sh th.ch { position: sticky; top: 0; z-index: 3; height: 26px; background: ${c.side}; color: ${c.muted}; font-size: 12.5px; text-align: center; }
  table.sh .rn { position: sticky; left: 0; z-index: 2; min-width: 44px; max-width: 44px; width: 44px; background: ${c.side}; color: ${c.muted}; font-size: 12.5px; text-align: center; font-variant-numeric: tabular-nums; }
  table.sh th.corner { position: sticky; top: 0; left: 0; z-index: 5; background: ${c.side}; min-width: 44px; width: 44px; }
  table.sh tr.frz td { position: sticky; top: 26px; z-index: 2; background: ${c.bg}; font-weight: 500; box-shadow: 0 1px 0 ${c.line}; }
  table.sh tr.frz td.rn { z-index: 4; background: ${c.side}; }
  table.sh td.n { text-align: right; font-variant-numeric: tabular-nums; }
  .shbar { position: fixed; left: 0; right: 0; bottom: 0; height: 34px; display: flex; align-items: center; gap: 4px; padding: 0 8px; background: ${c.side}; border-top: 1px solid ${c.line}; overflow-x: auto; font-size: 13px; }
  .shtab { border: 0; background: transparent; color: ${c.muted}; padding: 5px 12px; border-radius: 7px; font: inherit; white-space: nowrap; }
  .shtab.on { background: ${c.bg}; color: ${c.text}; box-shadow: inset 0 0 0 1px ${c.line}; }
  .shstat { margin-left: auto; color: ${c.muted}; white-space: nowrap; padding-left: 10px; font-variant-numeric: tabular-nums; }
`;

export function page(body, c, { title = '' } = {}) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5"><title>${esc(title)}</title><style>${css(c)}</style></head><body${String(body).startsWith('<div class="shv"') ? ' class="shbody"' : ''}>${body}</body></html>`;
}

const isNum = (v) => /^-?[\d\s.,]+%?$/.test(String(v).trim()) && /\d/.test(String(v));
const colName = (i) => { let s = ''; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
/** Sheets drawn like the desktop's sheet editor: column letters, row numbers, the first row frozen, sheet tabs and
 *  the row and column count at the bottom. A full page on its own (body.shbody). */
export function sheetGridHtml(sheets, { max = 3000 } = {}) {
  const views = sheets.map((s, si) => {
    const rows = s.rows.filter((r) => r.some((x) => String(x).trim() !== ''));
    const width = Math.max(1, ...rows.map((r) => r.length));
    const cols = width + 3; // a few empty columns and rows after the data, as in the editor
    const shown = rows.slice(0, max);
    const total = Math.max(shown.length + 6, 40);
    const line = (r, i) => `<tr${i === 0 && rows.length > 1 ? ' class="frz"' : ''}><td class="rn">${i + 1}</td>${Array.from({ length: cols }, (_, k) => { const v = r && r[k] != null ? String(r[k]) : ''; return `<td${isNum(v) ? ' class="n"' : ''}>${esc(v)}</td>`; }).join('')}</tr>`;
    const body = Array.from({ length: total }, (_, i) => line(shown[i], i)).join('');
    const stat = rows.length > max ? `${max} of ${rows.length} rows` : `${Math.max(0, rows.length - 1)} rows · ${rows.length ? width : 0} columns`;
    return { name: s.name, stat, html: `<div class="shv" id="shv${si}"${si ? ' style="display:none"' : ''}><table class="sh"><thead><tr><th class="corner"></th>${Array.from({ length: cols }, (_, k) => `<th class="ch">${colName(k)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>` };
  });
  const tabs = views.map((v, i) => `<button class="shtab${i ? '' : ' on'}" data-i="${i}">${esc(v.name || 'Sheet' + (i + 1))}</button>`).join('');
  const js = `<script>document.body.className='shbody';var st=${JSON.stringify(views.map((v) => v.stat))};document.querySelectorAll('.shtab').forEach(function(b){b.onclick=function(){var i=+b.dataset.i;document.querySelectorAll('.shv').forEach(function(d,k){d.style.display=k===i?'':'none'});document.querySelectorAll('.shtab').forEach(function(x){x.classList.toggle('on',x===b)});document.getElementById('shstat').textContent=st[i];};});</script>`;
  return `${views.map((v) => v.html).join('')}<div class="shbar">${tabs}<span class="shstat" id="shstat">${esc(views[0] ? views[0].stat : '')}</span></div>${js}`;
}
export function tablesHtml(sheets, { max = 2000 } = {}) {
  return sheets.map((s) => {
    const rows = s.rows.filter((r) => r.some((x) => String(x).trim() !== ''));
    if (!rows.length) return `<div class="sheet">${esc(s.name)} · empty</div>`;
    const [head, ...body] = rows;
    const width = Math.max(...rows.map((r) => r.length));
    const pad = (r) => [...r, ...Array(Math.max(0, width - r.length)).fill('')];
    const shown = body.slice(0, max);
    return `${sheets.length > 1 ? `<div class="sheet">${esc(s.name)}</div>` : ''}<div class="tablewrap"><table><thead><tr><th class="rownum"></th>${pad(head).map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${shown.map((r, i) => `<tr><td class="rownum">${i + 1}</td>${pad(r).map((v) => `<td${isNum(v) ? ' class="n"' : ''}>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${body.length > max ? `<div class="meta">${max} of ${body.length} rows shown</div>` : `<div class="meta">${body.length} rows · ${width} columns</div>`}`;
  }).join('');
}
export const markdownHtml = (text) => `<article class="docpage">${marked.parse(String(text || ''), { gfm: true })}</article>`;
export const docHtml = (html) => `<article class="docpage">${html}</article>`;
export const plainHtml = (text) => `<article class="docpage plain">${esc(text)}</article>`;
export const codeHtml = (text) => `<pre class="codev"><code>${esc(text)}</code></pre>`;

/** An artifact as a page. html runs as it is (scripts on, in its own web view); the rest is drawn here. */
export function artifactPage(a, c) {
  const t = String(a.content || '');
  if (a.type === 'html') return /<html[\s>]/i.test(t) ? t : `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${t}</body></html>`;
  if (a.type === 'svg') return page(`<div style="display:flex;justify-content:center;align-items:center;min-height:80vh">${t}</div>`, c, a);
  if (a.type === 'spreadsheet') return page(sheetGridHtml(splitSheets(t)), c, a);
  if (a.type === 'code') return page(codeHtml(t), c, a);
  return page(markdownHtml(t), c, a);
}

/** What kind of viewer a file needs, by its name. */
export function fileKind(name) {
  const ext = String(name || '').split('.').pop().toLowerCase();
  if (['csv', 'tsv', 'tab'].includes(ext)) return 'csv';
  if (['xlsx', 'xls', 'ods', 'numbers'].includes(ext)) return 'sheet';
  if (['md', 'markdown'].includes(ext)) return 'md';
  if (['html', 'htm'].includes(ext)) return 'html';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return 'image';
  if (ext === 'svg') return 'svg';
  if (ext === 'pdf') return 'pdf';
  if (['docx', 'doc', 'pptx', 'rtf', 'odt'].includes(ext)) return 'doc';
  if (['mp4', 'mov', 'm4v', 'webm', 'mp3', 'wav', 'm4a'].includes(ext)) return 'media';
  if (['zip', 'gz', 'tar', 'dmg', 'exe', 'bin'].includes(ext)) return 'binary';
  return 'text';
}
