// Grid operations of the sheet editor on plain arrays of rows. Pure: scripts/test-sheet-ops.js.

export const isFormula = (v) => typeof v === 'string' && v.length > 1 && v[0] === '=';
/** A typed value: numbers become numbers, everything else stays text. */
export const coerce = (s) => {
  if (typeof s !== 'string') return s;
  const t = s.trim();
  if (t === '') return '';
  return /^-?(0|[1-9]\d*)(\.\d+)?(e[+-]?\d+)?$/i.test(t) ? Number(t) : s;
};
export const rawText = (v) => (v == null ? '' : String(v));
/** { r1, r2, c1, c2 } with r1 <= r2 and c1 <= c2. */
export const norm = (g) => ({ r1: Math.min(g.r1, g.r2), r2: Math.max(g.r1, g.r2), c1: Math.min(g.c1, g.c2), c2: Math.max(g.c1, g.c2) });

/** Rows with [r, c, value] changes applied (copies only the touched rows). */
export function withCells(rows, changes) {
  const out = rows.slice(); const copied = new Set();
  for (const [r, c, v] of changes) {
    while (out.length <= r) out.push([]);
    if (!copied.has(r)) { out[r] = out[r].slice(); copied.add(r); }
    const row = out[r];
    while (row.length <= c) row.push('');
    row[c] = v;
  }
  return out;
}
export function insertRows(rows, at, n = 1) { const o = rows.slice(); while (o.length < at) o.push([]); o.splice(at, 0, ...Array.from({ length: n }, () => [])); return o; }
export function deleteRows(rows, r1, r2) { return rows.filter((_, i) => i < r1 || i > r2); }
export function insertCols(rows, at, n = 1) { return rows.map((row) => { if (row.length <= at) return row; const o = row.slice(); o.splice(at, 0, ...Array(n).fill('')); return o; }); }
export function deleteCols(rows, c1, c2) { return rows.map((row) => row.filter((_, j) => j < c1 || j > c2)); }

/** Changes that empty every non-empty cell of a range. */
export function clearChanges(rows, R) {
  const ch = [];
  for (let r = R.r1; r <= R.r2; r++) for (let c = R.c1; c <= R.c2; c++) { const v = rows[r] && rows[r][c]; if (v !== undefined && v !== '') ch.push([r, c, '']); }
  return ch;
}
/** Changes that copy the first row of a range down through the range. */
export function fillDownChanges(rows, R) {
  const ch = [];
  for (let c = R.c1; c <= R.c2; c++) { const v = rows[R.r1] && rows[R.r1][c]; for (let r = R.r1 + 1; r <= R.r2; r++) ch.push([r, c, v === undefined ? '' : v]); }
  return ch;
}
/** Rows sorted by column c (numbers numerically, text naturally, empty cells last); the header row stays on top. */
export function sortRows(rows, c, dir, header) {
  const start = header ? 1 : 0;
  const body = rows.slice(start).map((row, i) => ({ row, i }));
  const num = (x) => typeof x === 'number' || (x !== '' && x !== undefined && !Number.isNaN(Number(x)));
  body.sort((a, b) => {
    const x = a.row[c], y = b.row[c];
    const xe = x === undefined || x === '', ye = y === undefined || y === '';
    if (xe || ye) return xe && ye ? a.i - b.i : xe ? 1 : -1;
    const d = num(x) && num(y) ? Number(x) - Number(y) : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' });
    return d * dir || a.i - b.i;
  });
  return rows.slice(0, start).concat(body.map((o) => o.row));
}
/** A range as tab-separated text (Excel / Google Sheets clipboard format). shown(r, c) gives what the cell displays. */
export function rangeTsv(R, shown, maxRows = Infinity) {
  const lines = [];
  for (let r = R.r1; r <= Math.min(R.r2, R.r1 + maxRows - 1); r++) {
    const cells = [];
    for (let c = R.c1; c <= R.c2; c++) { const t = shown(r, c); cells.push(/[\t\n"]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t); }
    lines.push(cells.join('\t'));
  }
  return lines.join('\n');
}
/** Sum / count / average of the numbers in a range (shown in the bottom bar). value(r, c) gives the cell's value. */
export function rangeStats(R, value, lastRow) {
  let n = 0, sum = 0, cnt = 0;
  for (let r = R.r1; r <= Math.min(R.r2, lastRow); r++) for (let c = R.c1; c <= R.c2; c++) {
    const x = value(r, c); if (x === undefined || x === '' || x === null) continue; cnt++;
    if (typeof x === 'number' || (typeof x === 'string' && x.trim() !== '' && !Number.isNaN(Number(x)))) { n++; sum += Number(x); }
  }
  return { cnt, n, sum, avg: n ? sum / n : 0 };
}
