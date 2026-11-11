import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { askConfirm } from '../lib/dialog.js';
import { createEvaluator, formatValue, isErr, colName, cellName } from '../lib/formula.mjs';
import { parseCsv } from '../lib/preview.js';
import {
  isFormula, coerce, rawText, norm, withCells, insertRows, deleteRows, insertCols, deleteCols,
  clearChanges, fillDownChanges, sortRows, rangeTsv, rangeStats
} from '../lib/sheet-ops.mjs';
import {
  DEFAULT_ROW, DEFAULT_COL, HEAD_H, ROWNUM_W, MIN_COL, MIN_ROW, FONT_SIZES, SWATCHES,
  formatOf, patchRange, commonValue, shiftFormats, shiftSizes, formatNumber, cellStyle, makeAxis
} from '../lib/sheet-format.mjs';
import FormulaBar from './sheet/FormulaBar.jsx';
import FormatBar from './sheet/FormatBar.jsx';
import SheetTabs from './sheet/SheetTabs.jsx';
import Menu from './ui/Menu.jsx';
import { useFileWatch } from '../lib/use-file-watch.js';

const api = window.api;
const EXTRA_ROWS = 40, EXTRA_COLS = 6, SAVE_MS = 800, HINT_KEY = 'artemis.sheet-hint-seen';
const emptyMeta = () => ({ formats: {}, colW: {}, rowH: {} });

/**
 * The spreadsheet editor, Claude Sheets style: formula bar, a quiet grid (resizable columns and rows), a floating
 * format bar with a ⋯ menu, right-click menus, sheet tabs at the bottom, autosave. Values live in the file
 * (CSV / XLSX via the main process); formats, sizes, zoom and the frozen header live next to it (sheet-meta).
 * props: path, name, onDirty(bool), onSaved(path).
 */
export default function SheetEditor({ path, name, onDirty, onSaved }) {
  // ---- document state
  const [state, setState] = useState({ loading: true });
  const [sheets, setSheets] = useState([]);           // [{ name, rows }]
  const [metas, setMetas] = useState({});             // sheet name -> { formats, colW, rowH }
  const [view, setView] = useState({ header: true, zoom: 100 });
  const [si, setSi] = useState(0);
  const [curPath, setCurPath] = useState(path);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState(null);         // { text, kind }
  const fileMeta = useRef({});                         // { delimiter, truncated, format }
  const undo = useRef([]); const redo = useRef([]);
  // ---- view state
  const [sel, setSel] = useState({ r: 0, c: 0 });
  const [rng, setRng] = useState({ r1: 0, c1: 0, r2: 0, c2: 0 });
  const [edit, setEdit] = useState(null);             // { r, c, value, from }
  const [scroll, setScroll] = useState({ top: 0, left: 0, w: 600, h: 400 });
  const [menu, setMenu] = useState(null);             // { anchor, items }
  const [find, setFind] = useState(null);             // { q, hit } | null
  const [hint, setHint] = useState(() => { try { return !localStorage.getItem(HINT_KEY); } catch { return false; } });
  const box = useRef(null); const dragging = useRef(false);

  // ---- loading
  useEffect(() => {
    let off = false;
    setState({ loading: true }); setDirty(false); setStatus(null); setSi(0); setEdit(null); setFind(null);
    setSel({ r: 0, c: 0 }); setRng({ r1: 0, c1: 0, r2: 0, c2: 0 });
    undo.current = []; redo.current = []; setCurPath(path);
    Promise.all([api.loadSheet(path), api.loadSheetMeta ? api.loadSheetMeta(path) : Promise.resolve({ ok: true, meta: {} })]).then(([r, m]) => {
      if (off) return;
      if (!r.ok) { setState({ error: r.error }); return; }
      fileMeta.current = { delimiter: r.delimiter, truncated: r.truncated, format: r.format };
      const meta = (m && m.ok && m.meta) || {};
      setSheets(r.sheets.length ? r.sheets : [{ name: 'Sheet1', rows: [] }]);
      setMetas(meta.sheets || {});
      setView({ header: meta.header !== false, zoom: meta.zoom || 100 });
      setState({ ok: true });
    });
    return () => { off = true; };
  }, [path]);
  useEffect(() => { onDirty && onDirty(dirty); }, [dirty]);
  // the assistant (or another app) changed the file: take its values, keep the selection; unsaved edits here win
  const markSaved = useFileWatch(curPath, ({ gone }) => {
    if (gone || latest.current.pendingSave) return;
    api.loadSheet(curPath).then((r) => { if (r && r.ok && r.sheets.length) { setSheets(r.sheets); setStatus({ text: 'Updated', kind: 'ok' }); } });
  });

  // ---- derived
  const sheet = sheets[si] || { name: '', rows: [] };
  const rows = sheet.rows;
  const meta = metas[sheet.name] || emptyMeta();
  const z = view.zoom / 100;
  const nCols = useMemo(() => Math.max(1, rows.reduce((m, r) => Math.max(m, r.length), 0)) + EXTRA_COLS, [rows]);
  const nRows = Math.max(rows.length + EXTRA_ROWS, 60);
  const cols = useMemo(() => makeAxis(nCols, meta.colW, DEFAULT_COL, z), [nCols, meta.colW, z]);
  const rowsAx = useMemo(() => makeAxis(nRows, meta.rowH, DEFAULT_ROW, z), [nRows, meta.rowH, z]);
  const ev = useMemo(() => createEvaluator(sheets), [sheets]);
  const raw = (r, c) => { const row = rows[r]; return row ? row[c] : undefined; };
  const valueAt = (r, c) => { const v = raw(r, c); return isFormula(v) ? ev(si, r, c) : v; };
  const shown = (r, c) => { const v = raw(r, c); const x = isFormula(v) ? ev(si, r, c) : v; const f = formatOf(meta.formats, r, c); return f.num ? formatNumber(isErr(x) ? x.code : x, f.num) : isFormula(v) ? formatValue(x) : rawText(v); };
  const R = norm(rng);
  const header = view.header;

  // ---- history (values and formats together)
  const snapshot = () => ({ sheets, metas });
  const commitDoc = useCallback((nextSheets, nextMetas) => {
    undo.current.push({ sheets, metas }); if (undo.current.length > 150) undo.current.shift();
    redo.current = [];
    if (nextSheets) setSheets(nextSheets);
    if (nextMetas) setMetas(nextMetas);
    setDirty(true);
  }, [sheets, metas]);
  const restore = (s) => { setSheets(s.sheets); setMetas(s.metas); setDirty(true); };
  const doUndo = () => { const p = undo.current.pop(); if (!p) return; redo.current.push(snapshot()); restore(p); };
  const doRedo = () => { const p = redo.current.pop(); if (!p) return; undo.current.push(snapshot()); restore(p); };
  const mutateRows = (fn, metaFn) => commitDoc(sheets.map((s, i) => (i === si ? { ...s, rows: fn(s.rows) } : s)), metaFn ? { ...metas, [sheet.name]: metaFn(meta) } : null);
  const setCells = (ch) => { if (ch.length) mutateRows((rs) => withCells(rs, ch)); };
  const setMeta = (fn) => commitDoc(null, { ...metas, [sheet.name]: fn(meta) });
  const patch = (p) => setMeta((m) => ({ ...m, formats: patchRange(m.formats, R, p) }));

  // ---- autosave: values to the file, formats and sizes to sheet-meta
  const latest = useRef({});
  const markSavedRef = useRef(() => {});
  latest.current = { sheets, metas, view, curPath, ev };
  const serialize = (list, evaluate) => list.map((s, k) => {
    const out = s.rows.map((row, r) => row.map((v, c) => { if (!isFormula(v)) return v; const val = evaluate(k, r, c); return { f: v, v: isErr(val) ? val.code : val }; }));
    while (out.length && out[out.length - 1].every((v) => v === '' || v === undefined)) out.pop();
    return { name: s.name, rows: out };
  });
  const saveNow = useCallback(async () => {
    const L = latest.current;
    if (fileMeta.current.truncated) { setStatus({ text: 'Too large to save', kind: 'warn' }); return; }
    setStatus({ text: 'Saving…' }); markSavedRef.current(); // our own write is not an outside change
    const [r] = await Promise.all([
      api.saveSheet(L.curPath, serialize(L.sheets, L.ev), { delimiter: fileMeta.current.delimiter }),
      api.saveSheetMeta ? api.saveSheetMeta(L.curPath, { sheets: L.metas, header: L.view.header, zoom: L.view.zoom }) : null
    ]);
    if (r && r.ok) { markSavedRef.current(); setDirty(false); setStatus({ text: r.note || 'Saved', kind: r.note ? 'warn' : 'ok' }); onSaved && onSaved(L.curPath); }
    else setStatus({ text: (r && r.error) || 'Could not save', kind: 'error' });
  }, [onSaved]);
  useEffect(() => { if (!dirty || !state.ok) return; const t = setTimeout(saveNow, SAVE_MS); return () => clearTimeout(t); }, [dirty, sheets, metas, view, state.ok]);
  useEffect(() => () => { if (latest.current.pendingSave) saveNow(); }, []);
  latest.current.pendingSave = dirty;
  markSavedRef.current = markSaved;
  const setViewSaved = (p) => { setView((v) => ({ ...v, ...p })); setDirty(true); };
  const saveAs = async () => {
    const base = (name || 'table').replace(/\.[^.]+$/, '');
    const r = await api.saveSheetAs(serialize(sheets, ev), base + (fileMeta.current.format === 'csv' ? '.csv' : '.xlsx'), { delimiter: fileMeta.current.delimiter, from: curPath });
    if (r.ok) { setCurPath(r.path); setDirty(false); setStatus({ text: `Saved as ${r.path.split(/[\\/]/).pop()}`, kind: 'ok' }); onSaved && onSaved(r.path); } else if (!r.canceled) setStatus({ text: r.error, kind: 'error' });
  };

  // ---- scrolling / visibility
  const frozenH = header ? rowsAx.size(0) : 0;
  const ensure = (r, c) => {
    const el = box.current; if (!el) return;
    const top = rowsAx.offset(r), bottom = top + rowsAx.size(r), left = cols.offset(c), right = left + cols.size(c);
    const head = HEAD_H * z + (header && r > 0 ? frozenH : 0);
    const vh = el.clientHeight - head, vw = el.clientWidth - ROWNUM_W * z;
    if (top < el.scrollTop + (header && r > 0 ? frozenH : 0)) el.scrollTop = Math.max(0, top - (header && r > 0 ? frozenH : 0));
    else if (bottom > el.scrollTop + vh) el.scrollTop = bottom - vh;
    if (left < el.scrollLeft) el.scrollLeft = left; else if (right > el.scrollLeft + vw) el.scrollLeft = right - vw;
  };
  const moveTo = (r, c, extend) => {
    r = Math.max(0, Math.min(nRows - 1, r)); c = Math.max(0, Math.min(nCols - 1, c));
    if (extend) setRng((g) => ({ ...g, r2: r, c2: c })); else { setSel({ r, c }); setRng({ r1: r, c1: c, r2: r, c2: c }); }
    ensure(r, c);
  };
  useEffect(() => {
    const el = box.current; if (!el) return undefined;
    const upd = () => setScroll({ top: el.scrollTop, left: el.scrollLeft, w: el.clientWidth, h: el.clientHeight });
    upd();
    const ro = new ResizeObserver(upd); ro.observe(el);
    el.addEventListener('scroll', upd, { passive: true });
    return () => { ro.disconnect(); el.removeEventListener('scroll', upd); };
  }, [state.ok]);
  useEffect(() => { const up = () => { dragging.current = false; }; window.addEventListener('mouseup', up); return () => window.removeEventListener('mouseup', up); }, []);
  useEffect(() => { setSel({ r: 0, c: 0 }); setRng({ r1: 0, c1: 0, r2: 0, c2: 0 }); setEdit(null); if (box.current) { box.current.scrollTop = 0; box.current.scrollLeft = 0; } }, [si]);
  const focusGrid = () => box.current && box.current.focus({ preventScroll: true });

  // ---- editing
  const startEdit = (r, c, value, from = 'cell') => setEdit({ r, c, value: value ?? rawText(raw(r, c)), from });
  const commit = (move) => {
    if (!edit) return;
    const { r, c, value } = edit;
    setEdit(null);
    const cur = raw(r, c), next = coerce(value);
    if (!(next === cur || (cur === undefined && next === ''))) setCells([[r, c, next]]);
    if (move) moveTo(r + move[0], c + move[1]);
    focusGrid();
  };
  const cancel = () => { setEdit(null); focusGrid(); };

  // ---- structure (formats and sizes move with their rows / columns)
  const addRows = (at, n = 1) => mutateRows((rs) => insertRows(rs, at, n), (m) => ({ ...m, formats: shiftFormats(m.formats, 'r', at, n), rowH: shiftSizes(m.rowH, at, n) }));
  const addCols = (at, n = 1) => mutateRows((rs) => insertCols(rs, at, n), (m) => ({ ...m, formats: shiftFormats(m.formats, 'c', at, n), colW: shiftSizes(m.colW, at, n) }));
  const dropRows = () => { const n = R.r2 - R.r1 + 1; mutateRows((rs) => deleteRows(rs, R.r1, R.r2), (m) => ({ ...m, formats: shiftFormats(m.formats, 'r', R.r1, -n), rowH: shiftSizes(m.rowH, R.r1, -n) })); };
  const dropCols = () => { const n = R.c2 - R.c1 + 1; mutateRows((rs) => deleteCols(rs, R.c1, R.c2), (m) => ({ ...m, formats: shiftFormats(m.formats, 'c', R.c1, -n), colW: shiftSizes(m.colW, R.c1, -n) })); };
  const sortBy = (dir) => mutateRows((rs) => sortRows(rs, sel.c, dir, header));
  const clearRange = () => setCells(clearChanges(rows, R));
  const fillDown = () => setCells(fillDownChanges(rows, R));
  const clearFormats = () => setMeta((m) => { const f = { ...m.formats }; for (let r = R.r1; r <= R.r2; r++) for (let c = R.c1; c <= R.c2; c++) delete f[r + ':' + c]; return { ...m, formats: f }; });

  // ---- clipboard
  const onCopy = (e) => { if (edit) return; e.preventDefault(); e.clipboardData.setData('text/plain', rangeTsv(R, shown)); };
  const onCut = (e) => { onCopy(e); if (!edit) clearRange(); };
  const onPaste = (e) => {
    if (edit) return;
    const t = e.clipboardData.getData('text/plain'); if (!t) return;
    e.preventDefault();
    const grid = parseCsv(t.replace(/\r\n/g, '\n').replace(/\n$/, ''), '\t');
    const ch = []; grid.forEach((row, i) => row.forEach((v, j) => ch.push([R.r1 + i, R.c1 + j, coerce(v)])));
    if (ch.length) { setCells(ch); setRng({ r1: R.r1, c1: R.c1, r2: R.r1 + grid.length - 1, c2: R.c1 + Math.max(...grid.map((g) => g.length)) - 1 }); }
  };

  // ---- formatting state of the selection
  const common = useMemo(() => ({
    b: commonValue(meta.formats, R, 'b'), i: commonValue(meta.formats, R, 'i'), u: commonValue(meta.formats, R, 'u'), s: commonValue(meta.formats, R, 's'),
    num: commonValue(meta.formats, R, 'num'), size: commonValue(meta.formats, R, 'size'), align: commonValue(meta.formats, R, 'align'),
    wrap: commonValue(meta.formats, R, 'wrap'), color: commonValue(meta.formats, R, 'color'), fill: commonValue(meta.formats, R, 'fill')
  }), [meta.formats, rng]); // eslint-disable-line

  // ---- find
  const needle = find ? find.q.trim().toLowerCase() : '';
  const matches = useMemo(() => {
    if (!needle) return [];
    const out = [];
    for (let r = 0; r < rows.length && out.length < 5000; r++) for (let c = 0; c < rows[r].length; c++) if (shown(r, c).toLowerCase().includes(needle)) out.push([r, c]);
    return out;
  }, [needle, rows, ev, meta.formats]); // eslint-disable-line
  const jumpFind = (d) => { if (!matches.length) return; const n = ((find.hit || 0) + d + matches.length) % matches.length; setFind((f) => ({ ...f, hit: n })); moveTo(matches[n][0], matches[n][1]); };

  // ---- menus
  const ask = () => {
    const label = R.r1 === R.r2 && R.c1 === R.c2 ? cellName(R.r1, R.c1) : `${cellName(R.r1, R.c1)}:${cellName(R.r2, R.c2)}`;
    const rowsN = R.r2 - R.r1 + 1;
    const body = rangeTsv(R, shown, 200) + (rowsN > 200 ? `\n…(first 200 of ${rowsN} rows)` : '');
    // goes above the composer as a chip (like Claude), not as text in the message
    window.dispatchEvent(new CustomEvent('artemis:ask-selection', { detail: { attachment: {
      kind: 'selection', icon: 'sheet', name: `${label} · ${sheet.name}`, title: `${label} in "${sheet.name}" of ${name || 'this sheet'}`,
      text: `Cells ${label} in sheet "${sheet.name}" of ${curPath || path || name} (tab-separated):\n${body}`, source: curPath || path || ''
    } } }));
    dismissHint();
  };
  const dismissHint = () => { setHint(false); try { localStorage.setItem(HINT_KEY, '1'); } catch {} };
  const insertItems = [
    { label: 'Row above', onClick: () => addRows(R.r1, R.r2 - R.r1 + 1) }, { label: 'Row below', onClick: () => addRows(R.r2 + 1, R.r2 - R.r1 + 1) },
    { sep: true }, { label: 'Column left', onClick: () => addCols(R.c1, R.c2 - R.c1 + 1) }, { label: 'Column right', onClick: () => addCols(R.c2 + 1, R.c2 - R.c1 + 1) }
  ];
  const moreItems = [
    { label: 'Font size', hint: String(common.size || 14), items: FONT_SIZES.map((n) => ({ label: String(n), checked: (common.size || 14) === n, onClick: () => patch({ size: n === 14 ? null : n }) })), width: 120 },
    { label: 'Text wrapping', hint: { wrap: 'Wrap', clip: 'Clip' }[common.wrap] || 'Overflow', items: [['overflow', 'Overflow'], ['wrap', 'Wrap'], ['clip', 'Clip']].map(([id, l]) => ({ label: l, checked: (common.wrap || 'overflow') === id, onClick: () => patch({ wrap: id === 'overflow' ? null : id }) })) },
    { sep: true },
    { label: 'Align', items: [['left', 'Left'], ['center', 'Center'], ['right', 'Right']].map(([id, l]) => ({ label: l, checked: common.align === id, onClick: () => patch({ align: id }) })) },
    { label: 'Text color', items: [{ swatches: SWATCHES, value: common.color, onPick: (c) => patch({ color: c }), clearLabel: 'Default color' }], width: 232 },
    { label: 'Cell color', items: [{ swatches: SWATCHES, value: common.fill, onPick: (c) => patch({ fill: c }), clearLabel: 'No fill' }], width: 232 },
    { label: 'Clear formatting', onClick: clearFormats },
    { sep: true },
    { label: 'Insert', items: insertItems },
    { label: 'Delete', items: [{ label: R.r2 > R.r1 ? `Rows ${R.r1 + 1}–${R.r2 + 1}` : `Row ${R.r1 + 1}`, danger: true, onClick: dropRows }, { label: R.c2 > R.c1 ? `Columns ${colName(R.c1)}–${colName(R.c2)}` : `Column ${colName(R.c1)}`, danger: true, onClick: dropCols }] },
    { label: 'Sort', items: [{ label: 'A → Z', onClick: () => sortBy(1) }, { label: 'Z → A', onClick: () => sortBy(-1) }] },
    { label: 'Fill down', hint: '⌘D', onClick: fillDown },
    { sep: true },
    { label: 'Freeze header row', checked: header, onClick: () => setViewSaved({ header: !header }) },
    { label: 'Find', hint: '⌘F', onClick: () => setFind({ q: '', hit: 0 }) },
    { label: 'Save a copy as…', onClick: saveAs }
  ];
  const cellMenu = (e) => {
    e.preventDefault();
    setMenu({ anchor: { x: e.clientX, y: e.clientY }, items: [
      { label: 'Cut', hint: '⌘X', onClick: () => document.execCommand('cut') }, { label: 'Copy', hint: '⌘C', onClick: () => document.execCommand('copy') },
      { label: 'Paste', hint: '⌘V', onClick: () => { focusGrid(); document.execCommand('paste'); } },
      { sep: true }, ...insertItems, { sep: true },
      { label: 'Delete row', danger: true, onClick: dropRows }, { label: 'Delete column', danger: true, onClick: dropCols },
      { label: 'Clear contents', hint: '⌫', onClick: clearRange }, { sep: true },
      { label: 'Ask Artemis about this', onClick: ask }
    ] });
  };

  // ---- keyboard
  const onKeyDown = (e) => {
    if (e.target.tagName === 'INPUT') return;
    const mod = e.metaKey || e.ctrlKey, k = e.key, lk = k.toLowerCase();
    if (mod && lk === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
    if (mod && lk === 'y') { e.preventDefault(); doRedo(); return; }
    if (mod && lk === 's') { e.preventDefault(); saveNow(); return; }
    if (mod && lk === 'd') { e.preventDefault(); fillDown(); return; }
    if (mod && lk === 'b') { e.preventDefault(); patch({ b: !common.b }); return; }
    if (mod && lk === 'i') { e.preventDefault(); patch({ i: !common.i }); return; }
    if (mod && lk === 'u') { e.preventDefault(); patch({ u: !common.u }); return; }
    if (mod && e.shiftKey && lk === 'x') { e.preventDefault(); patch({ s: !common.s }); return; }
    if (mod && lk === 'f') { e.preventDefault(); e.stopPropagation(); setFind({ q: '', hit: 0 }); return; }
    if (mod && lk === 'a') { e.preventDefault(); setRng({ r1: 0, c1: 0, r2: Math.max(rows.length - 1, 0), c2: nCols - 1 - EXTRA_COLS }); return; }
    if (mod) return; // c / x / v go to the clipboard events
    const ext = e.shiftKey;
    const at = ext ? { r: rng.r2, c: rng.c2 } : sel;
    if (k === 'ArrowDown') { e.preventDefault(); moveTo(at.r + 1, at.c, ext); }
    else if (k === 'ArrowUp') { e.preventDefault(); moveTo(at.r - 1, at.c, ext); }
    else if (k === 'ArrowRight') { e.preventDefault(); moveTo(at.r, at.c + 1, ext); }
    else if (k === 'ArrowLeft') { e.preventDefault(); moveTo(at.r, at.c - 1, ext); }
    else if (k === 'Tab') { e.preventDefault(); moveTo(sel.r, sel.c + (ext ? -1 : 1)); }
    else if (k === 'Enter') { e.preventDefault(); if (ext) moveTo(sel.r - 1, sel.c); else startEdit(sel.r, sel.c); }
    else if (k === 'F2') { e.preventDefault(); startEdit(sel.r, sel.c); }
    else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); clearRange(); }
    else if (k === 'Home') { e.preventDefault(); moveTo(sel.r, 0, ext); }
    else if (k === 'PageDown') { e.preventDefault(); moveTo(sel.r + 15, sel.c); }
    else if (k === 'PageUp') { e.preventDefault(); moveTo(sel.r - 15, sel.c); }
    else if (k === 'Escape' && find) { e.preventDefault(); setFind(null); }
    else if (k.length === 1 && !e.altKey) { e.preventDefault(); startEdit(sel.r, sel.c, k); }
  };
  const onEditKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit([e.shiftKey ? -1 : 1, 0]); }
    else if (e.key === 'Tab') { e.preventDefault(); commit([0, e.shiftKey ? -1 : 1]); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  };

  // ---- mouse: selection, header picks, resizing
  const down = (r, c, e) => {
    if (e.button === 2) { if (!(r >= R.r1 && r <= R.r2 && c >= R.c1 && c <= R.c2)) { setSel({ r, c }); setRng({ r1: r, c1: c, r2: r, c2: c }); } return; }
    if (edit && !(edit.r === r && edit.c === c)) commit(null);
    dragging.current = true;
    if (e.shiftKey) setRng((g) => ({ ...g, r2: r, c2: c })); else { setSel({ r, c }); setRng({ r1: r, c1: c, r2: r, c2: c }); }
    focusGrid();
  };
  const over = (r, c) => { if (dragging.current) setRng((g) => ({ ...g, r2: r, c2: c })); };
  const pickCol = (c, e) => { if (e.shiftKey) setRng((g) => ({ ...g, r1: 0, c2: c, r2: Math.max(rows.length - 1, 0) })); else { setSel({ r: 0, c }); setRng({ r1: 0, c1: c, r2: Math.max(rows.length - 1, 0), c2: c }); } focusGrid(); };
  const pickRow = (r, e) => { if (e.shiftKey) setRng((g) => ({ ...g, c1: 0, r2: r, c2: Math.max(nCols - 1 - EXTRA_COLS, 0) })); else { setSel({ r, c: 0 }); setRng({ r1: r, c1: 0, r2: r, c2: Math.max(nCols - 1 - EXTRA_COLS, 0) }); } focusGrid(); };
  /** Drag a column's right edge or a row's bottom edge; the size is stored unscaled (zoom 100%). */
  const startResize = (axis, i, e) => {
    e.preventDefault(); e.stopPropagation();
    const start = axis === 'c' ? e.clientX : e.clientY, size0 = (axis === 'c' ? cols.size(i) : rowsAx.size(i)) / z;
    const before = { sheets, metas };
    const key = axis === 'c' ? 'colW' : 'rowH', min = axis === 'c' ? MIN_COL : MIN_ROW;
    const move = (ev2) => {
      const v = Math.max(min, Math.round(size0 + ((axis === 'c' ? ev2.clientX : ev2.clientY) - start) / z));
      setMetas((ms) => { const m = ms[sheet.name] || emptyMeta(); return { ...ms, [sheet.name]: { ...m, [key]: { ...m[key], [i]: v } } }; });
    };
    const up = () => {
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); document.body.classList.remove(axis === 'c' ? 'col-resizing' : 'row-resizing');
      undo.current.push(before); redo.current = []; setDirty(true);
    };
    document.body.classList.add(axis === 'c' ? 'col-resizing' : 'row-resizing');
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };
  const autofit = (c) => {
    let m = 3;
    for (let r = 0; r < Math.min(rows.length, 1000); r++) m = Math.max(m, shown(r, c).length * ((formatOf(meta.formats, r, c).size || 14) / 14));
    setMeta((mm) => ({ ...mm, colW: { ...mm.colW, [c]: Math.max(MIN_COL, Math.min(600, Math.round(m * 7.8 + 22))) } }));
  };
  const resetRow = (r) => setMeta((mm) => { const h = { ...mm.rowH }; delete h[r]; return { ...mm, rowH: h }; });

  // ---- sheets
  const addSheet = () => { let n = sheets.length + 1; while (sheets.some((s) => s.name === 'Sheet' + n)) n++; commitDoc([...sheets, { name: 'Sheet' + n, rows: [] }]); setSi(sheets.length); };
  const dupSheet = (i) => { let nm = sheets[i].name + ' copy', k = 2; while (sheets.some((s) => s.name === nm)) nm = `${sheets[i].name} copy ${k++}`; commitDoc([...sheets.slice(0, i + 1), { name: nm, rows: sheets[i].rows.map((r) => r.slice()) }, ...sheets.slice(i + 1)], { ...metas, [nm]: metas[sheets[i].name] || emptyMeta() }); setSi(i + 1); };
  const delSheet = async (i) => { if (sheets.length < 2 || !(await askConfirm({ title: 'Delete sheet', message: `Delete sheet "${sheets[i].name}"?`, confirmLabel: 'Delete', danger: true }))) return; const { [sheets[i].name]: _gone, ...rest } = metas; commitDoc(sheets.filter((_, k) => k !== i), rest); setSi(Math.max(0, Math.min(si, sheets.length - 2))); };
  const renameSheet = (i, nm0) => {
    const nm = nm0.slice(0, 31);
    if (!nm || sheets.some((s, k) => k !== i && s.name.toLowerCase() === nm.toLowerCase())) return;
    const old = sheets[i].name; const { [old]: m, ...rest } = metas;
    commitDoc(sheets.map((s, k) => (k === i ? { ...s, name: nm } : s)), m ? { ...rest, [nm]: m } : null);
  };

  const stats = useMemo(() => rangeStats(R, valueAt, rows.length - 1), [rng, rows, ev]); // eslint-disable-line

  if (state.loading) return <div className="pdfv-msg">Loading…</div>;
  if (state.error) return <div className="error pad">{state.error}</div>;

  // ---- what is on screen
  const headH = HEAD_H * z, rnW = ROWNUM_W * z;
  const r0 = Math.max(0, rowsAx.indexAt(scroll.top) - 3), r1 = Math.min(nRows - 1, rowsAx.indexAt(scroll.top + scroll.h) + 3);
  const c0 = Math.max(0, cols.indexAt(Math.max(0, scroll.left - 80))), c1 = Math.min(nCols - 1, cols.indexAt(scroll.left + scroll.w + 80));
  const visRows = []; for (let r = r0; r <= r1; r++) visRows.push(r);
  const visCols = []; for (let c = c0; c <= c1; c++) visCols.push(c);
  const inRange = (r, c) => r >= R.r1 && r <= R.r2 && c >= R.c1 && c <= R.c2;
  const matchSet = needle ? new Set(matches.map(([r, c]) => r + ':' + c)) : null;
  const fontPx = 14 * z;

  const cell = (r, c, frozen) => {
    const v = raw(r, c), f = isFormula(v), val = f ? ev(si, r, c) : v, fmt = formatOf(meta.formats, r, c);
    const text = fmt.num ? formatNumber(isErr(val) ? val.code : val, fmt.num) : f ? formatValue(val) : rawText(v);
    const isNum = typeof val === 'number' || (!f && typeof v === 'string' && v !== '' && /^-?\d+([.,]\d+)?$/.test(v) && !/^0\d/.test(v));
    const cls = ['sh-cell', isNum ? 'num' : '', f && isErr(val) ? 'err' : '', inRange(r, c) && !(sel.r === r && sel.c === c) ? 'rng' : '', matchSet && matchSet.has(r + ':' + c) ? 'hit' : '', header && r === 0 ? 'hd' : ''].filter(Boolean).join(' ');
    const st = cellStyle(fmt);
    return (
      <div key={(frozen ? 'f' : '') + r + ':' + c} className={cls}
        style={{ left: cols.offset(c), width: cols.size(c), top: frozen ? 0 : rowsAx.offset(r), height: rowsAx.size(r), ...(st || {}), ...(fmt.size ? { fontSize: fmt.size * z + 'px' } : null) }}
        title={text.length > 24 ? text : undefined}
        onMouseDown={(e) => down(r, c, e)} onMouseEnter={() => over(r, c)} onDoubleClick={() => startEdit(r, c)} onContextMenu={cellMenu}>
        {text}
      </div>
    );
  };
  const selBox = { left: cols.offset(R.c1), top: rowsAx.offset(R.r1), width: cols.offset(R.c2 + 1) - cols.offset(R.c1), height: rowsAx.offset(R.r2 + 1) - rowsAx.offset(R.r1) };
  const editor = edit && edit.from === 'cell' && (
    <input className="sh-edit" autoFocus value={edit.value}
      style={{ left: cols.offset(edit.c), top: rowsAx.offset(edit.r), width: Math.max(cols.size(edit.c), 140 * z), height: rowsAx.size(edit.r), fontSize: fontPx }}
      onChange={(e) => setEdit({ ...edit, value: e.target.value })} onKeyDown={onEditKey} onBlur={() => commit(null)}
      onFocus={(e) => { const l = e.target.value.length; e.target.setSelectionRange(l, l); }} />
  );
  const barValue = edit ? edit.value : rawText(raw(sel.r, sel.c));
  const selLabel = R.r1 === R.r2 && R.c1 === R.c2 ? cellName(sel.r, sel.c) : `${cellName(R.r1, R.c1)}:${cellName(R.r2, R.c2)}`;
  const statsText = stats.cnt > 1 ? `Count ${stats.cnt}${stats.n > 1 ? ` · Sum ${formatValue(Number(stats.sum.toPrecision(12)))} · Avg ${formatValue(Number(stats.avg.toPrecision(8)))}` : ''}` : '';

  return (
    <div className="sheet" style={{ '--sh-font': fontPx + 'px' }}>
      <FormulaBar cellLabel={selLabel} value={barValue}
        onChange={(e) => setEdit({ r: sel.r, c: sel.c, value: e.target.value, from: 'bar' })}
        onKeyDown={onEditKey} onBlur={() => edit && edit.from === 'bar' && commit(null)}
        status={fileMeta.current.truncated ? { text: 'Read only: too large', kind: 'warn' } : dirty ? { text: 'Unsaved' } : status}
        zoom={view.zoom} onZoom={(v) => setViewSaved({ zoom: v })} onUndo={doUndo} onRedo={doRedo} canUndo={undo.current.length > 0} canRedo={redo.current.length > 0} />
      <div className="sh-grid">
        <div className="sh-scroll" ref={box} tabIndex={0} onKeyDown={onKeyDown} onCopy={onCopy} onCut={onCut} onPaste={onPaste} aria-label={`Sheet ${sheet.name}`}>
          <div className="sh-head" style={{ width: rnW + cols.total, height: headH }}>
            <div className="sh-corner" style={{ width: rnW, height: headH }} onMouseDown={() => { setRng({ r1: 0, c1: 0, r2: Math.max(rows.length - 1, 0), c2: nCols - 1 - EXTRA_COLS }); focusGrid(); }} />
            <div className="sh-cols" style={{ width: cols.total, height: headH }}>
              {visCols.map((c) => (
                <div key={c} className={`sh-ch ${c >= R.c1 && c <= R.c2 ? 'on' : ''}`} style={{ left: cols.offset(c), width: cols.size(c), height: headH, lineHeight: headH + 'px' }} onMouseDown={(e) => pickCol(c, e)} onContextMenu={cellMenu}>
                  {colName(c)}
                  <i className="sh-grip" onMouseDown={(e) => startResize('c', c, e)} onDoubleClick={(e) => { e.stopPropagation(); autofit(c); }} title="Drag to resize · double-click to fit" />
                </div>
              ))}
            </div>
          </div>
          {header && scroll.top > 0 && (
            <div className="sh-frozen" style={{ top: headH, width: rnW + cols.total, height: frozenH, marginBottom: -frozenH }}>
              <div className="sh-rn on" style={{ width: rnW, height: frozenH, lineHeight: frozenH + 'px' }}>1</div>
              <div className="sh-cells" style={{ width: cols.total, height: frozenH }}>{visCols.map((c) => cell(0, c, true))}</div>
            </div>
          )}
          <div className="sh-body" style={{ width: rnW + cols.total, height: rowsAx.total }}>
            <div className="sh-rns" style={{ width: rnW, height: rowsAx.total }}>
              {visRows.map((r) => (
                <div key={r} className={`sh-rn ${r >= R.r1 && r <= R.r2 ? 'on' : ''}`} style={{ top: rowsAx.offset(r), height: rowsAx.size(r), lineHeight: rowsAx.size(r) + 'px' }} onMouseDown={(e) => pickRow(r, e)} onContextMenu={cellMenu}>
                  {r + 1}
                  <i className="sh-rgrip" onMouseDown={(e) => startResize('r', r, e)} onDoubleClick={(e) => { e.stopPropagation(); resetRow(r); }} title="Drag to resize · double-click to reset" />
                </div>
              ))}
            </div>
            <div className="sh-cells" style={{ width: cols.total, height: rowsAx.total }}>
              {visRows.map((r) => visCols.map((c) => cell(r, c, false)))}
              <div className="sh-selbox" style={selBox}><i className="sh-fill" title="Fill down (⌘D)" onMouseDown={(e) => { e.stopPropagation(); fillDown(); }} /></div>
              {editor}
            </div>
          </div>
        </div>
        {find && (
          <div className="sh-find" role="search">
            <input autoFocus placeholder="Find in sheet" value={find.q} onChange={(e) => setFind({ q: e.target.value, hit: 0 })}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); jumpFind(e.shiftKey ? -1 : 1); } if (e.key === 'Escape') { setFind(null); focusGrid(); } }} />
            <span>{needle ? (matches.length ? `${(find.hit || 0) + 1} / ${matches.length}` : 'No match') : ''}</span>
            <button type="button" onClick={() => { setFind(null); focusGrid(); }} aria-label="Close find">×</button>
          </div>
        )}
        {hint && <button type="button" className="sh-hint" onClick={dismissHint}>Select any cells to ask Artemis about them.</button>}
        <FormatBar common={common} onPatch={patch} more={moreItems} onAsk={ask} />
      </div>
      {/\.(csv|tsv|tab)$/i.test(curPath || name || '') // a CSV is one table: no sheet tabs, only the selection's sum / average when there is one
        ? (statsText ? <div className="shstats-bar">{statsText}</div> : null)
        : <SheetTabs sheets={sheets} active={si} onSelect={setSi} onAdd={addSheet} onRename={renameSheet} onDuplicate={dupSheet} onDelete={delSheet} stats={statsText} />}
      {menu && <Menu anchor={menu.anchor} items={menu.items} onClose={() => setMenu(null)} width={230} />}
    </div>
  );
}
