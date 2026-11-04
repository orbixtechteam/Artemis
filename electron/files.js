// File read/write helpers: text, CSV, Excel, Word, PDF, images.
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const JSZip = require('jszip');

const TEXT_EXT = new Set([
  '.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.jsonl', '.xml', '.html', '.htm', '.css', '.scss',
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.c', '.h',
  '.cpp', '.hpp', '.cs', '.php', '.sh', '.zsh', '.bash', '.yml', '.yaml', '.toml', '.ini', '.env', '.log',
  '.sql', '.svg', '.tex', '.vue', '.svelte', '.gitignore', '.conf', '.cfg'
]);
const SHEET_EXT = new Set(['.xlsx', '.xlsm', '.xls', '.xlsb', '.ods']);
const IMAGE_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_READ_BYTES = 150 * 1024 * 1024;
const LARGE_TEXT_BYTES = 20 * 1024 * 1024; // bigger text files are streamed, never read whole
const LARGE_TEXT_HEAD = 256 * 1024;
const SNIFF_BYTES = 8192;
const SHEET_TEXT_MAX_CELLS = 2000000;

const isZipBuffer = (buf) => buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 3 || buf[2] === 5);
const fmtSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

// ---------- text encodings ----------
// BOM, UTF-16 and invalid UTF-8 (decoded as the legacy windows-1254 code page) are detected and remembered so writes keep the encoding.
const LABELS = { utf8: 'utf-8', utf16le: 'utf-16le', utf16be: 'utf-16be', 'windows-1254': 'windows-1254' };
let cp1254 = null;
function cp1254Map() {
  if (cp1254) return cp1254;
  cp1254 = new Map();
  const dec = new TextDecoder('windows-1254');
  for (let i = 0x80; i < 256; i++) { const ch = dec.decode(Uint8Array.of(i)); if (ch !== '\ufffd' && !cp1254.has(ch)) cp1254.set(ch, i); }
  return cp1254;
}

/** Encoding of a buffer start from BOM or the zero-byte pattern of UTF-16 text without BOM. */
function sniffEncoding(head) {
  if (head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) return { encoding: 'utf8', bom: true };
  if (head[0] === 0xff && head[1] === 0xfe) return { encoding: 'utf16le', bom: true };
  if (head[0] === 0xfe && head[1] === 0xff) return { encoding: 'utf16be', bom: true };
  const n = Math.min(head.length, SNIFF_BYTES) & ~1;
  if (n >= 4) {
    let even = 0, odd = 0;
    for (let i = 0; i < n; i += 2) { if (head[i] === 0) even++; if (head[i + 1] === 0) odd++; }
    const half = n / 2;
    if (odd > half * 0.4 && even < half * 0.05) return { encoding: 'utf16le', bom: false };
    if (even > half * 0.4 && odd < half * 0.05) return { encoding: 'utf16be', bom: false };
  }
  return null;
}

function decodeText(buf) {
  const s = sniffEncoding(buf);
  if (s) {
    const body = s.bom ? buf.subarray(s.encoding === 'utf8' ? 3 : 2) : buf;
    return { text: new TextDecoder(LABELS[s.encoding], { ignoreBOM: true }).decode(body), ...s };
  }
  try { return { text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buf), encoding: 'utf8', bom: false }; } catch {}
  return { text: new TextDecoder('windows-1254').decode(buf), encoding: 'windows-1254', bom: false };
}

/** Encodes text back to its original encoding. A character windows-1254 cannot hold switches the file to UTF-8 (encoding tells which). */
function encodeText(text, { encoding = 'utf8', bom = false } = {}) {
  const s = String(text);
  if (encoding === 'utf16le' || encoding === 'utf16be') {
    const b = Buffer.from(s, 'utf16le');
    if (encoding === 'utf16be') b.swap16();
    const mark = bom ? Buffer.from(encoding === 'utf16le' ? [0xff, 0xfe] : [0xfe, 0xff]) : Buffer.alloc(0);
    return { buf: Buffer.concat([mark, b]), encoding, bom };
  }
  if (encoding === 'windows-1254') {
    const map = cp1254Map(); const out = Buffer.alloc(s.length);
    let ok = true;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 0x80) { out[i] = c; continue; }
      const b = map.get(s[i]);
      if (b === undefined) { ok = false; break; }
      out[i] = b;
    }
    if (ok) return { buf: out, encoding, bom: false };
    return { buf: Buffer.from(s, 'utf8'), encoding: 'utf8', bom: false, switched: true };
  }
  return { buf: Buffer.concat([bom ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0), Buffer.from(s, 'utf8')]), encoding: 'utf8', bom };
}

/** Encoding of an existing file (null if missing or too big to check). */
function fileEncoding(abs) {
  try {
    const st = fs.statSync(abs);
    if (!st.isFile() || st.size > LARGE_TEXT_BYTES) return null;
    const d = decodeText(fs.readFileSync(abs));
    return { encoding: d.encoding, bom: d.bom };
  } catch { return null; }
}

/** Writes through a temp file + fsync + rename so a crash never leaves half a file. Keeps the mode; a symlink is written through to its target. */
function atomicWrite(abs, data) {
  let target = abs;
  try { target = fs.realpathSync(abs); } catch {}
  let mode = null;
  try { mode = fs.statSync(target).mode & 0o7777; } catch {}
  const tmp = `${target}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const fd = fs.openSync(tmp, 'wx', mode === null ? 0o666 : mode);
  try {
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    if (mode !== null) fs.chmodSync(tmp, mode);
    fs.renameSync(tmp, target);
  } catch (e) {
    try { fs.closeSync(fd); } catch {}
    try { fs.unlinkSync(tmp); } catch {}
    throw e;
  }
}

function readHead(abs, n = SNIFF_BYTES) {
  const fd = fs.openSync(abs, 'r');
  try { const b = Buffer.alloc(n); const got = fs.readSync(fd, b, 0, n, 0); return b.subarray(0, got); } finally { fs.closeSync(fd); }
}

/**
 * Streams part of a big text file without loading it. Lines mode (startLine, endLine, 1-based) or character offset mode.
 * Returns { text, cut, eof, lastLine } where lastLine is the last line number reached.
 */
async function streamText(abs, { encoding = 'utf8', startLine = 0, endLine = 0, offset = 0, maxChars = 60000 } = {}) {
  const dec = new TextDecoder(LABELS[encoding] || 'utf-8');
  const fh = await fs.promises.open(abs, 'r');
  const buf = Buffer.alloc(1 << 20);
  let pos = 0, chars = 0, line = 1, out = '', cut = false, eof = false, stop = false;
  try {
    while (!stop) {
      const { bytesRead } = await fh.read(buf, 0, buf.length, pos);
      const s = bytesRead ? dec.decode(buf.subarray(0, bytesRead), { stream: true }) : dec.decode();
      if (!bytesRead) eof = true;
      pos += bytesRead;
      if (startLine) {
        let i = 0;
        while (i < s.length) {
          const nl = s.indexOf('\n', i);
          const end = nl < 0 ? s.length : nl + 1;
          if (line >= startLine) {
            out += s.slice(i, end);
            if (out.length > maxChars) { out = out.slice(0, maxChars); cut = true; stop = true; break; }
          }
          if (nl < 0) break;
          if (line >= endLine) { stop = true; break; }
          line++; i = end;
        }
      } else {
        if (chars + s.length > offset) out += s.slice(Math.max(0, offset - chars));
        chars += s.length;
        if (out.length >= maxChars) { cut = out.length > maxChars || !eof; out = out.slice(0, maxChars); stop = true; }
      }
      if (eof) break;
    }
  } finally { await fh.close(); }
  return { text: startLine ? out.replace(/\r?\n$/, '') : out, cut, eof, lastLine: line };
}

/** Files we cannot show as text (video, audio, apps, ...): the model still learns the name, size and location. */
function binaryInfo(abs, size, why = 'binary') {
  const name = path.basename(abs);
  return {
    kind: 'binary', size,
    text: `[${why === 'binary' ? 'Binary' : 'Large'} file "${name}", ${fmtSize(size)}, type ${path.extname(name) || 'unknown'}. Its contents cannot be shown as text (${why}). ` +
      `It is located at: ${abs}. If the task needs it, use the terminal tool (e.g. file, ffprobe, unzip) to inspect or convert it.]`
  };
}

const TEXT_IN_ZIP_BUDGET = 300000;
const ZIP_INFLATE_BUDGET = 50 * 1024 * 1024; // decompressed bytes actually read, whatever the headers claim
const TEXT_IN_ZIP_PER_FILE = 60000;
const ZIP_LIST_LIMIT = 500;

/** A ZIP: chat exports are converted, anything else is listed and its text files are included. */
async function readZip(buf, abs) {
  let zip;
  try { zip = await JSZip.loadAsync(buf); } catch (e) { throw new Error(`ZIP file could not be read: ${e.message}`); }
  const entries = Object.values(zip.files).filter((f) => !f.dir && !/(^|\/)(__MACOSX\/|\.DS_Store$)/.test(f.name));
  if (entries.some((f) => /(^|\/)conversations(-\d+)?\.json$/i.test(f.name))) {
    try {
      const { parseExport } = require('./importer');
      const imported = await parseExport(buf, 'imported');
      const text = imported.chats.map((c) => {
        const body = (c.messages || []).map((m) => (m.role === 'user' ? `USER:\n${m.content}` : `ASSISTANT:\n${(m.steps || []).map((s) => s.text).join('\n')}`)).join('\n\n');
        return `# ${c.title}\n\n${body}`;
      }).join('\n\n---\n\n');
      return { kind: 'text', text, size: buf.length, importedChats: imported.chats.length };
    } catch { /* not a readable export: fall through to the generic listing */ }
  }
  const size = (f) => (f._data && f._data.uncompressedSize) || 0;
  const lines = [`ZIP archive ${path.basename(abs)}: ${entries.length} file${entries.length === 1 ? '' : 's'}, ${fmtSize(buf.length)} compressed.`, '', 'Contents:'];
  entries.slice(0, ZIP_LIST_LIMIT).forEach((f) => lines.push(`- ${f.name} (${fmtSize(size(f))})`));
  if (entries.length > ZIP_LIST_LIMIT) lines.push(`… and ${entries.length - ZIP_LIST_LIMIT} more`);
  let budget = TEXT_IN_ZIP_BUDGET, inflated = 0;
  const included = [];
  for (const f of entries) {
    const ext = path.extname(f.name).toLowerCase();
    if (budget <= 0) break;
    if (ext === '.zip' || SHEET_EXT.has(ext) || ext === '.docx' || ext === '.pdf' || IMAGE_MIME[ext]) continue;
    if (!(TEXT_EXT.has(ext) || ext === '') || size(f) > 5 * 1024 * 1024) continue;
    if (inflated >= ZIP_INFLATE_BUDGET) break;
    const data = await readEntryCapped(f, Math.min(5 * 1024 * 1024, ZIP_INFLATE_BUDGET - inflated));
    if (!data) { inflated = ZIP_INFLATE_BUDGET; continue; } // lied about its size: stop inflating
    inflated += data.length;
    if (looksBinary(data)) continue;
    const text = decodeText(data).text.slice(0, Math.min(TEXT_IN_ZIP_PER_FILE, budget));
    budget -= text.length;
    included.push(`\n\n=== ${f.name} ===\n${text}${data.length > text.length ? '\n…[truncated]' : ''}`);
  }
  if (included.length) lines.push('', `Text files (${included.length}):`, ...included);
  return { kind: 'archive', text: lines.join('\n'), size: buf.length, entries: entries.length };
}

/** Inflates one zip entry, giving up (null) past cap bytes. */
function readEntryCapped(f, cap) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0, done = false;
    const s = f.nodeStream('nodebuffer');
    s.on('data', (c) => {
      if (done) return;
      n += c.length;
      if (n > cap) { done = true; s.pause(); resolve(null); return; }
      chunks.push(c);
    });
    s.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
    s.on('error', (e) => { if (!done) { done = true; reject(e); } });
  });
}

function kindOf(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.zip') return 'archive';
  if (SHEET_EXT.has(ext)) return 'sheet';
  if (ext === '.docx') return 'docx';
  if (ext === '.pptx') return 'pptx';
  if (ext === '.pdf') return 'pdf';
  if (IMAGE_MIME[ext]) return 'image';
  if (TEXT_EXT.has(ext) || ext === '') return 'text';
  return 'unknown';
}

function looksBinary(buf) {
  if (sniffEncoding(buf)) return false; // UTF-16 text has zero bytes too
  const n = Math.min(buf.length, SNIFF_BYTES);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

function sheetsToText(wb, onlySheet) {
  const names = onlySheet ? [onlySheet] : wb.SheetNames;
  return names.map((n) => {
    const ws = wb.Sheets[n];
    if (!ws) throw new Error(`Sheet not found: ${n}. Available sheets: ${wb.SheetNames.join(', ')}`);
    // show formulas without a cached value as "=formula"
    for (const addr of Object.keys(ws)) {
      if (addr[0] === '!') continue;
      const c = ws[addr];
      if (c && c.f && (c.t === 'z' || c.v === undefined || c.v === null)) { c.t = 's'; c.v = '=' + c.f; }
    }
    const cut = usedRange(ws, SHEET_TEXT_MAX_CELLS);
    return `## Sheet: ${n} (${ws['!ref'] || 'empty'})\n${XLSX.utils.sheet_to_csv(ws)}${cut ? `\n…[sheet cut after row ${cut.shown} of ${cut.rows}: too many cells to show]` : ''}`;
  }).join('\n\n');
}

/**
 * Sets !ref to the cells that really exist (a sheet can declare A1:XFD1048576) and caps it at maxCells.
 * Returns {shown, rows} when rows were cut.
 */
function usedRange(ws, maxCells) {
  let r1 = Infinity, c1 = Infinity, r2 = -1, c2 = -1;
  for (const k of Object.keys(ws)) {
    if (k[0] === '!') continue;
    const a = XLSX.utils.decode_cell(k);
    if (a.r < 0 || a.c < 0) continue;
    if (a.r < r1) r1 = a.r; if (a.c < c1) c1 = a.c; if (a.r > r2) r2 = a.r; if (a.c > c2) c2 = a.c;
  }
  if (r2 < 0) { delete ws['!ref']; return null; }
  r1 = 0; c1 = 0; // keep row/column positions as in the file
  const cols = c2 - c1 + 1, rows = r2 - r1 + 1;
  let cut = null;
  if (rows * cols > maxCells) { const keep = Math.max(1, Math.floor(maxCells / cols)); cut = { shown: keep, rows }; r2 = r1 + keep - 1; }
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: r1, c: c1 }, e: { r: r2, c: c2 } });
  return cut;
}

/** PowerPoint: the text of every slide (and its speaker notes), in slide order. */
async function readPptx(buf) {
  let zip;
  try { zip = await JSZip.loadAsync(buf); } catch (e) { throw new Error(`PowerPoint file could not be read: ${e.message}`); }
  const num = (n) => Number((n.match(/(\d+)\.xml$/) || [])[1]) || 0;
  const textOf = (xml) => xml.split(/<\/a:p>/).map((p) => (p.match(/<a:t>([^<]*)<\/a:t>/g) || []).map((t) => t.slice(5, -6)).join('')).filter((l) => l.trim())
    .join('\n').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => num(a) - num(b));
  const parts = [];
  for (const n of slides) {
    let t = textOf(await zip.file(n).async('string'));
    const notes = zip.file(`ppt/notesSlides/notesSlide${num(n)}.xml`);
    if (notes) { const nt = textOf(await notes.async('string')).replace(/^\d+$/m, '').trim(); if (nt) t += `\n[Notes] ${nt}`; }
    parts.push(`--- Slide ${num(n)} ---\n${t}`);
  }
  return { kind: 'pptx', text: parts.join('\n\n'), pages: slides.length, size: buf.length };
}

/** Turns a file's content into plain text. Returns a dataUrl for images. Big text files return only their start (large: true). */
async function readContent(abs, { sheet } = {}) {
  let kind = kindOf(abs);
  const size = fs.statSync(abs).size;
  if (kind === 'text' || kind === 'unknown') {
    const head = readHead(abs);
    if (kind === 'unknown' && isZipBuffer(head)) kind = 'archive';
    else if (looksBinary(head)) return binaryInfo(abs, size);
    else kind = 'text';
  }
  if (kind === 'text') {
    if (size <= LARGE_TEXT_BYTES) return { kind, size, ...decodeText(fs.readFileSync(abs)) };
    const head = readHead(abs, LARGE_TEXT_HEAD);
    const enc = sniffEncoding(head) || (() => { try { new TextDecoder('utf-8', { fatal: true }).decode(head.subarray(0, head.length - 4)); return { encoding: 'utf8', bom: false }; } catch { return { encoding: 'windows-1254', bom: false }; } })();
    const text = new TextDecoder(LABELS[enc.encoding]).decode(head);
    return { kind, size, large: true, text, ...enc };
  }
  if (size > MAX_READ_BYTES) return binaryInfo(abs, size, 'too large to read here');
  const buf = fs.readFileSync(abs);
  if (kind === 'archive') return readZip(buf, abs);
  if (kind === 'image') {
    if (buf.length > MAX_IMAGE_BYTES) throw new Error('Image exceeds the 8 MB limit.');
    const mime = IMAGE_MIME[path.extname(abs).toLowerCase()];
    return { kind, dataUrl: `data:${mime};base64,${buf.toString('base64')}`, size: buf.length };
  }
  if (kind === 'sheet') {
    const wb = XLSX.read(buf, { type: 'buffer', cellDates: true, sheetStubs: true });
    return { kind, text: sheetsToText(wb, sheet), sheets: wb.SheetNames, size: buf.length };
  }
  if (kind === 'docx') {
    const mammoth = require('mammoth');
    const r = await mammoth.extractRawText({ buffer: buf });
    return { kind, text: r.value, size: buf.length };
  }
  if (kind === 'pptx') return readPptx(buf);
  if (kind === 'pdf') {
    const pdfParse = require('pdf-parse/lib/pdf-parse.js');
    const r = await pdfParse(buf);
    return { kind, text: r.text, pages: r.numpages, size: buf.length };
  }
  return binaryInfo(abs, buf.length);
}

/** Prepares an attached file for the chat. */
async function parseAttachment(abs, maxChars = 200000) {
  const name = path.basename(abs);
  try {
    const r = await readContent(abs);
    if (r.kind === 'image') return { name, path: abs, kind: 'image', dataUrl: r.dataUrl, size: r.size };
    let text = r.text || '';
    const truncated = text.length > maxChars || !!r.large;
    if (truncated) text = text.slice(0, maxChars);
    return { name, path: abs, kind: r.kind, text, truncated, size: r.size };
  } catch (err) {
    return { name, path: abs, kind: 'error', error: err.message };
  }
}

/** An attachment that has no path on disk (pasted or dragged from an app): save it to a temp folder, then read it like any other file. */
async function parseBuffer(name, bytes, baseDir) {
  const clean = path.basename(String(name || 'file')).replace(/[\u0000-\u001f<>:"|?*\\]/g, '_').slice(0, 120) || 'file';
  const buf = Buffer.from(bytes || []);
  if (!buf.length) return { name: clean, kind: 'error', error: 'The file is empty.' };
  if (buf.length > MAX_READ_BYTES) return { name: clean, kind: 'error', error: 'The file is too large to attach this way (150 MB limit).' };
  const dir = path.join(baseDir || require('os').tmpdir(), 'artemis-attachments', `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`);
  fs.mkdirSync(dir, { recursive: true });
  const abs = path.join(dir, clean);
  fs.writeFileSync(abs, buf);
  return parseAttachment(abs);
}

function safeSheetName(name, fallback) {
  const n = String(name || fallback).replace(/[\[\]:*?/\\]/g, ' ').trim().slice(0, 31);
  return n || fallback;
}

function buildSheet(rows) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  // text starting with "=" is written as a formula
  for (const addr of Object.keys(ws)) {
    if (addr[0] === '!') continue;
    const c = ws[addr];
    if (c && c.t === 's' && typeof c.v === 'string' && c.v.startsWith('=') && c.v.length > 1) {
      ws[addr] = { f: c.v.slice(1) };
    }
  }
  return ws;
}

/** sheets: [{name, rows: any[][]}] — writes xlsx/xls/ods/csv/tsv depending on the extension. */
function writeSpreadsheet(abs, sheets) {
  if (!Array.isArray(sheets) || !sheets.length) throw new Error('At least one sheet is required: sheets=[{name, rows}]');
  const ext = path.extname(abs).toLowerCase();
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  if (ext === '.csv' || ext === '.tsv') {
    const ws = XLSX.utils.aoa_to_sheet(sheets[0].rows || []);
    const csv = XLSX.utils.sheet_to_csv(ws, { FS: ext === '.tsv' ? '\t' : ',' });
    atomicWrite(abs, '﻿' + csv); // BOM: so Excel opens non-ASCII characters correctly
    return { sheets: 1 };
  }
  if (!SHEET_EXT.has(ext)) throw new Error('Spreadsheet extension must be .xlsx, .xls, .ods, .csv or .tsv.');
  const wb = XLSX.utils.book_new();
  const used = new Set();
  sheets.forEach((s, i) => {
    let name = safeSheetName(s.name, `Sheet${i + 1}`);
    let k = 2; while (used.has(name)) name = safeSheetName(s.name, 'Sheet').slice(0, 28) + k++;
    used.add(name);
    XLSX.utils.book_append_sheet(wb, buildSheet(s.rows || []), name);
  });
  writeBook(wb, abs, ext);
  return { sheets: sheets.length };
}

function writeBook(wb, abs, ext) {
  atomicWrite(abs, XLSX.write(wb, { type: 'buffer', bookType: ext === '.xlsm' ? 'xlsx' : ext.slice(1) }));
}

/** Updates specific cells in an existing sheet. cells: [{cell:'A1', value}]. Returns {count, note}. */
function updateCells(abs, sheetName, cells) {
  const ext = path.extname(abs).toLowerCase();
  if (ext === '.csv' || ext === '.tsv' || ext === '.tab') {
    const d = decodeText(fs.readFileSync(abs)); // BOM stripped here, written back once
    const FS = ext === '.csv' ? detectFS(d.text) : '\t';
    const wb = XLSX.read(d.text, { type: 'string', raw: true, FS });
    const ws = wb.Sheets[wb.SheetNames[0]];
    applyCells(ws, cells);
    const out = encodeText(XLSX.utils.sheet_to_csv(ws, { FS }), d);
    atomicWrite(abs, out.buf);
    return { count: cells.length, note: out.switched ? 'The file was saved as UTF-8 because a new value does not fit its windows-1254 encoding.' : '' };
  }
  const wb = XLSX.read(fs.readFileSync(abs), { type: 'buffer', cellDates: true, sheetStubs: true });
  const name = sheetName || wb.SheetNames[0];
  const ws = wb.Sheets[name];
  if (!ws) throw new Error(`Sheet not found: ${name}. Available sheets: ${wb.SheetNames.join(', ')}`);
  applyCells(ws, cells);
  const bak = abs + '.bak';
  if (!fs.existsSync(bak)) fs.copyFileSync(abs, bak);
  writeBook(wb, abs, ext);
  return { count: cells.length, note: `The workbook was rewritten, so some formatting (styles, charts, macros) may be lost; the original is kept as ${path.basename(bak)}.` };
}

function applyCells(ws, cells) {
  if (!Array.isArray(cells) || !cells.length) throw new Error('cells=[{cell:"A1", value:...}] is required');
  for (const { cell, value } of cells) {
    if (!/^[A-Za-z]+[0-9]+$/.test(String(cell))) throw new Error(`Invalid cell address: ${cell}`);
    const addr = String(cell).toUpperCase();
    if (typeof value === 'string' && value.startsWith('=') && value.length > 1) ws[addr] = { f: value.slice(1) };
    else if (typeof value === 'number') ws[addr] = { t: 'n', v: value };
    else if (typeof value === 'boolean') ws[addr] = { t: 'b', v: value };
    else if (value === null || value === undefined || value === '') delete ws[addr];
    else ws[addr] = { t: 's', v: String(value) };
    const ref = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
    const c = XLSX.utils.decode_cell(addr);
    if (c.r > ref.e.r) ref.e.r = c.r;
    if (c.c > ref.e.c) ref.e.c = c.c;
    ws['!ref'] = XLSX.utils.encode_range(ref);
  }
}

// ---------- sheet editor ----------
const SHEET_MAX_ROWS = 200000;
const SHEET_MAX_COLS = 700;
const EDIT_EXT = new Set(['.csv', '.tsv', '.tab', '.xlsx', '.xlsm', '.xls', '.xlsb', '.ods']);

function detectFS(text) {
  const lines = text.split(/\r?\n/).slice(0, 5).filter(Boolean);
  const cands = [',', ';', '\t', '|'];
  let best = ',', top = 0;
  for (const c of cands) {
    const n = lines.reduce((t, l) => t + l.split(c).length - 1, 0);
    if (n > top) { top = n; best = c; }
  }
  return best;
}

function cellRaw(c) {
  if (!c) return '';
  if (c.f) return '=' + c.f;
  const v = c.v;
  if (v === undefined || v === null) return '';
  if (v instanceof Date) {
    const iso = v.toISOString();
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.slice(0, 19).replace('T', ' ');
  }
  if (c.t === 'e') return c.w || '#ERR';
  return v;
}

/** Loads the file as an editable cell matrix: {format, delimiter, sheets:[{name, rows}], truncated}. */
function loadSheets(abs) {
  const ext = path.extname(abs).toLowerCase();
  if (!EDIT_EXT.has(ext)) throw new Error('Not a spreadsheet file.');
  const size = fs.statSync(abs).size;
  if (size > MAX_READ_BYTES) throw new Error('File is too large to edit here.');
  let wb, delimiter = null;
  if (ext === '.csv' || ext === '.tsv' || ext === '.tab') {
    const { text } = decodeText(fs.readFileSync(abs));
    delimiter = ext === '.csv' ? detectFS(text) : '\t';
    wb = XLSX.read(text, { type: 'string', raw: true, FS: delimiter });
  } else {
    wb = XLSX.read(fs.readFileSync(abs), { type: 'buffer', cellDates: true, sheetStubs: true });
  }
  let truncated = false;
  const sheets = wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name] || {};
    if (usedRange(ws, SHEET_MAX_ROWS * 50)) truncated = true;
    const ref = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
    const endR = Math.min(ref.e.r, SHEET_MAX_ROWS - 1), endC = Math.min(ref.e.c, SHEET_MAX_COLS - 1);
    if (ref.e.r > endR || ref.e.c > endC) truncated = true;
    const rows = [];
    for (let r = 0; r <= endR; r++) {
      const row = [];
      let last = -1;
      for (let c = 0; c <= endC; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        const v = cellRaw(cell);
        row.push(v);
        if (v !== '') last = c;
      }
      row.length = last + 1;
      rows.push(row);
    }
    while (rows.length && !rows[rows.length - 1].length) rows.pop();
    return { name, rows };
  });
  return { format: ext.slice(1), delimiter, sheets, truncated, size };
}

/** A cell {f, v} is written as formula + cached value (the value is required for xls/ods). */
function buildEditedSheet(rows) {
  const objs = [];
  const plain = rows.map((row, r) => row.map((c, j) => {
    if (c && typeof c === 'object') { objs.push([r, j, c]); return c.v === undefined ? '' : c.v; }
    return c;
  }));
  const ws = buildSheet(plain);
  for (const [r, j, c] of objs) {
    const addr = XLSX.utils.encode_cell({ r, c: j });
    const v = c.v;
    const cell = { f: String(c.f).replace(/^=/, '') };
    if (typeof v === 'number') { cell.t = 'n'; cell.v = v; }
    else if (typeof v === 'boolean') { cell.t = 'b'; cell.v = v; }
    else { cell.t = 's'; cell.v = v == null ? '' : String(v); }
    ws[addr] = cell;
    const ref = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
    if (r > ref.e.r) ref.e.r = r; if (j > ref.e.c) ref.e.c = j;
    ws['!ref'] = XLSX.utils.encode_range(ref);
  }
  return ws;
}

const flatRows = (rows) => (rows || []).map((row) => row.map((c) => (c && typeof c === 'object' ? (c.f ? '=' + String(c.f).replace(/^=/, '') : c.v === undefined ? '' : c.v) : c)));

/** Writes the edited matrix to disk. When writing to the same path it makes a .bak backup the first time. */
function saveSheets(abs, sheets, { delimiter, backup = true } = {}) {
  const ext = path.extname(abs).toLowerCase();
  if (!EDIT_EXT.has(ext)) throw new Error('Choose a .csv, .tsv, .xlsx, .xls, .xlsb, .xlsm or .ods file name.');
  if (backup && fs.existsSync(abs) && !fs.existsSync(abs + '.bak')) fs.copyFileSync(abs, abs + '.bak');
  if (ext === '.csv' || ext === '.tsv' || ext === '.tab') {
    const fs_ = ext === '.csv' ? (delimiter || ',') : '\t';
    const ws = XLSX.utils.aoa_to_sheet((sheets[0] && sheets[0].rows) || []);
    atomicWrite(abs, '﻿' + XLSX.utils.sheet_to_csv(ws, { FS: fs_ }));
    return { sheets: 1, note: sheets.length > 1 ? 'Only the first sheet can be saved to a text file.' : '' };
  }
  const wb = XLSX.utils.book_new();
  const used = new Set();
  sheets.forEach((s, i) => {
    let name = safeSheetName(s.name, `Sheet${i + 1}`);
    let k = 2; while (used.has(name)) name = safeSheetName(s.name, 'Sheet').slice(0, 28) + k++;
    used.add(name);
    XLSX.utils.book_append_sheet(wb, buildEditedSheet(s.rows || []), name);
  });
  writeBook(wb, abs, ext);
  return { sheets: sheets.length, note: ext === '.xls' ? 'Old .xls files keep formula results only. Use .xlsx to keep formulas.' : ext === '.xlsm' ? 'Saved as a plain workbook (macros are not kept).' : '' };
}

module.exports = { kindOf, readContent, parseAttachment, parseBuffer, writeSpreadsheet, updateCells, loadSheets, saveSheets, decodeText, encodeText, fileEncoding, atomicWrite, streamText, usedRange, EDIT_EXT, TEXT_EXT, SHEET_EXT, LARGE_TEXT_BYTES };
