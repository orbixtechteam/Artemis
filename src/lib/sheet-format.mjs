// Cell formatting and grid geometry for the sheet editor. Pure (no React, no DOM): scripts/test-sheet-format.js.
// formats: { "r:c": { b, i, u, s, align, color, fill, size, wrap, num } }, kept per sheet next to the file's values.

export const DEFAULT_ROW = 28, DEFAULT_COL = 110, HEAD_H = 28, ROWNUM_W = 44, MIN_COL = 36, MIN_ROW = 20;
export const FONT_SIZES = [9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 36];
export const NUM_FORMATS = [
  { id: 'auto', label: 'Automatic' }, { id: 'number', label: 'Number', sample: '1,000.12' }, { id: 'currency', label: 'Currency', sample: '$1,000.12' },
  { id: 'percent', label: 'Percent', sample: '10.12%' }, { id: 'date', label: 'Date', sample: '2026-11-11' }, { id: 'text', label: 'Plain text' }
];
export const SWATCHES = ['#1b1a17', '#5f6368', '#9aa0a6', '#d93025', '#e8710a', '#f9ab00', '#188038', '#1a73e8', '#7b1fa2', '#c2185b',
  '#fce8e6', '#feefe3', '#fef7e0', '#e6f4ea', '#e8f0fe', '#f3e8fd', '#fde7f3', '#f1f3f4'];

const key = (r, c) => r + ':' + c;
const clean = (f) => { const o = {}; for (const k in f) if (f[k] !== null && f[k] !== undefined && f[k] !== false && f[k] !== '') o[k] = f[k]; return o; };

/** The format of one cell ({} when none). */
export const formatOf = (formats, r, c) => (formats && formats[key(r, c)]) || EMPTY;
const EMPTY = Object.freeze({});

/** New formats with `patch` merged into every cell of range { r1, r2, c1, c2 }; null / false / '' removes a key. */
export function patchRange(formats, R, patch) {
  const out = { ...(formats || {}) };
  for (let r = R.r1; r <= R.r2; r++) for (let c = R.c1; c <= R.c2; c++) {
    const k = key(r, c);
    const next = clean({ ...(out[k] || {}), ...patch });
    if (Object.keys(next).length) out[k] = next; else delete out[k];
  }
  return out;
}

/** The value of `prop` when every cell of the range shares it (looks at most 2,000 cells), else undefined. */
export function commonValue(formats, R, prop) {
  let first, n = 0;
  for (let r = R.r1; r <= R.r2; r++) for (let c = R.c1; c <= R.c2; c++) {
    const v = formatOf(formats, r, c)[prop];
    if (n++ === 0) first = v; else if (v !== first) return undefined;
    if (n >= 2000) return first;
  }
  return first;
}

/** Inserting (delta > 0) or deleting (delta < 0) rows / columns at `at` moves the keyed formats or sizes with them. */
export function shiftFormats(formats, axis, at, delta) {
  const out = {};
  for (const k in formats || {}) {
    const [r, c] = k.split(':').map(Number);
    let p = axis === 'r' ? r : c;
    if (p >= at) { if (delta < 0 && p < at - delta) continue; p += delta; }
    out[axis === 'r' ? key(p, c) : key(r, p)] = formats[k];
  }
  return out;
}
/** The same for a size map { index: px }. */
export function shiftSizes(sizes, at, delta) {
  const out = {};
  for (const k in sizes || {}) { let i = Number(k); if (i >= at) { if (delta < 0 && i < at - delta) continue; i += delta; } out[i] = sizes[k]; }
  return out;
}

/** Excel serial day -> YYYY-MM-DD (1900 date system). */
export function serialToDate(n) {
  const ms = Math.round((Number(n) - 25569) * 86400000);
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? String(n) : d.toISOString().slice(0, 10);
}

/** A value as the number format shows it. Non-numbers pass through (except date strings). */
export function formatNumber(value, num) {
  if (value === null || value === undefined || value === '') return '';
  if (!num || num === 'auto' || num === 'text') return String(value);
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[$,%\s]/g, ''));
  if (!Number.isFinite(n)) return String(value);
  if (num === 'number') return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (num === 'currency') return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (num === 'percent') return (n * 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
  if (num === 'date') return n > 0 && n < 2958466 ? serialToDate(n) : String(value);
  return String(value);
}

/** Inline style for a formatted cell. */
export function cellStyle(f) {
  if (!f || f === EMPTY) return null;
  const s = {};
  if (f.b) s.fontWeight = 600;
  if (f.i) s.fontStyle = 'italic';
  if (f.u || f.s) s.textDecoration = [f.u && 'underline', f.s && 'line-through'].filter(Boolean).join(' ');
  if (f.align) s.textAlign = f.align;
  if (f.color) s.color = f.color;
  if (f.fill) s.background = f.fill;
  if (f.size) s.fontSize = f.size + 'px';
  if (f.wrap === 'wrap') { s.whiteSpace = 'normal'; s.lineHeight = 1.3; s.wordBreak = 'break-word'; }
  if (f.wrap === 'clip') s.textOverflow = 'clip';
  return s;
}

/**
 * One axis of the grid (rows or columns): default size, a few custom sizes, scaled by zoom.
 * offset(i) is where item i starts, size(i) its size, total the whole length, indexAt(px) the item under a position.
 */
export function makeAxis(count, sizes, def, zoom = 1) {
  const n = Math.max(0, count | 0);
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + ((sizes && sizes[i]) || def) * zoom;
  const indexAt = (px) => { // binary search: last i with pre[i] <= px
    let lo = 0, hi = n - 1;
    if (n === 0) return 0;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (pre[mid] <= px) lo = mid; else hi = mid - 1; }
    return lo;
  };
  return { count: n, offset: (i) => pre[Math.max(0, Math.min(n, i))], size: (i) => pre[i + 1] - pre[i], total: pre[n], indexAt };
}
