// Column facts for the table preview: which columns hold numbers, which is an id column, and a good starting width.
// Pure, so scripts/test-table-model.js tests it.

export const ROW_H = 44, HEAD_H = 32, MIN_W = 56, MAX_AUTO_W = 320, CHAR_W = 8.6, PAD_W = 36; // 15 px text: about 8.6 px per character, 16 px padding each side + slack
const SAMPLE = 300;
const NUM_RE = /^[-+(]?[$€£₼₺¥]?\s?\d{1,3}(?:[,\s]\d{3})*(?:\.\d+)?%?\)?$|^[-+]?\d+(?:\.\d+)?(?:e[-+]?\d+)?%?$/i;

/** True for "12", "-3.5", "$1,299.00", "45%", "(120)", "1e6". */
export const isNumeric = (v) => NUM_RE.test(String(v ?? '').trim());

/** Display width in px for a string, counting wide characters (CJK, emoji) twice. */
export function textWidth(s) {
  let n = 0;
  for (const ch of String(s ?? '')) n += ch.codePointAt(0) > 0x2e80 ? 2 : 1;
  return n * CHAR_W;
}

/**
 * [{ name, numeric, id, width }] for the columns of `rows` (array of arrays). header: the first row names the columns.
 * numeric: at least 80% of the sampled non-empty values are numbers; id: an "id"-like first column (shown muted).
 */
export function inferColumns(rows, { header = true } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const cols = list.reduce((m, r) => Math.max(m, Array.isArray(r) ? r.length : 0), 0);
  const head = header && list.length ? list[0] : null;
  const body = head ? list.slice(1, SAMPLE + 1) : list.slice(0, SAMPLE);
  const out = [];
  for (let c = 0; c < cols; c++) {
    const name = head ? String(head[c] ?? '') : colLetter(c);
    let filled = 0, nums = 0, widest = textWidth(name);
    for (const r of body) {
      const v = r && r[c];
      if (v === undefined || v === null || String(v).trim() === '') continue;
      filled++; if (isNumeric(v)) nums++;
      const w = textWidth(v); if (w > widest) widest = w;
    }
    const numeric = filled > 0 && nums / filled >= 0.8;
    const id = c === 0 && /^(id|#|no\.?|nr|row)$/i.test(name.trim());
    out.push({ name, numeric, id, width: Math.round(Math.min(MAX_AUTO_W, Math.max(MIN_W, widest + PAD_W))) });
  }
  return out;
}

/** A, B, … Z, AA, AB … */
export function colLetter(j) { let n = j, s = ''; do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0); return s; }

/** The row slice to render for a scroll position (virtualized rows of fixed height), with overscan. */
export function visibleRange(scrollTop, viewH, total, rowH = ROW_H, overscan = 8) {
  const first = Math.max(0, Math.floor(scrollTop / rowH) - overscan);
  const last = Math.min(total, Math.ceil((scrollTop + viewH) / rowH) + overscan);
  return { first, last, top: first * rowH, bottom: Math.max(0, (total - last) * rowH) };
}
