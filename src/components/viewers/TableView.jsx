import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { inferColumns, visibleRange, ROW_H, HEAD_H, MIN_W, textWidth, PAD_W } from '../../lib/table-model.mjs';

/**
 * Read view of a table (CSV, TSV, one sheet of a workbook), styled like Claude's CSV preview: horizontal hairlines only,
 * a quiet sticky header, roomy 44 px rows, numbers right-aligned, an id column muted.
 * Columns resize by dragging the header edge (double-click fits the content). Rows are virtualized, so 100k rows stay fast.
 * props: rows (array of arrays, first row = header unless header is false), widthsKey (remembers widths per file).
 */
export default function TableView({ rows, header = true, widthsKey = '' }) {
  const cols = useMemo(() => inferColumns(rows, { header }), [rows, header]);
  const body = header && rows.length ? rows.length - 1 : rows.length;
  const [widths, setWidths] = useState(() => loadWidths(widthsKey));
  const [scroll, setScroll] = useState({ top: 0, h: 600 });
  const box = useRef(null);

  useEffect(() => { setWidths(loadWidths(widthsKey)); }, [widthsKey]);
  useEffect(() => { saveWidths(widthsKey, widths); }, [widths, widthsKey]);
  useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    const measure = () => setScroll({ top: el.scrollTop, h: el.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const wOf = (c) => widths[c] || cols[c].width;
  const total = cols.reduce((t, _c, i) => t + wOf(i), 0);
  const range = visibleRange(Math.max(0, scroll.top - HEAD_H), scroll.h, body);
  const at = (i) => rows[(header ? 1 : 0) + i] || [];

  const startResize = (c, e) => {
    e.preventDefault(); e.stopPropagation();
    const x0 = e.clientX, w0 = wOf(c);
    const move = (ev) => setWidths((w) => ({ ...w, [c]: Math.max(MIN_W, Math.round(w0 + ev.clientX - x0)) }));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); document.body.classList.remove('col-resizing'); };
    document.body.classList.add('col-resizing');
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const autofit = (c) => { // the widest value in the whole column (not only the sample), uncapped up to 640 px
    let m = textWidth(cols[c].name);
    for (let i = 0; i < body; i++) { const w = textWidth(at(i)[c]); if (w > m) m = w; }
    setWidths((w) => ({ ...w, [c]: Math.round(Math.min(640, Math.max(MIN_W, m + PAD_W))) }));
  };

  if (!cols.length) return <div className="tv-empty">This table is empty.</div>;
  const cell = (c, v, key) => (
    <div key={key} className={`tv-cell${cols[c].numeric ? ' num' : ''}${cols[c].id ? ' id' : ''}`} style={{ width: wOf(c) }} title={v == null ? '' : String(v)}>{v}</div>
  );
  return (
    <div className="tableview" ref={box} onScroll={(e) => setScroll({ top: e.currentTarget.scrollTop, h: e.currentTarget.clientHeight })} role="table" aria-rowcount={body + 1}>
      <div className="tv-inner" style={{ width: total }}>
        <div className="tv-head" role="row" style={{ height: HEAD_H }}>
          {cols.map((col, c) => (
            <div key={c} className={`tv-cell tv-hcell${col.numeric ? ' num' : ''}`} style={{ width: wOf(c) }} role="columnheader" title={col.name}>
              <span className="tv-hname">{col.name}</span>
              <i className="tv-grip" onPointerDown={(e) => startResize(c, e)} onDoubleClick={(e) => { e.stopPropagation(); autofit(c); }} title="Drag to resize · double-click to fit" />
            </div>
          ))}
        </div>
        <div style={{ height: range.top }} />
        {Array.from({ length: range.last - range.first }, (_, k) => {
          const i = range.first + k, r = at(i);
          return <div key={i} className="tv-row" role="row" style={{ height: ROW_H }}>{cols.map((_c, c) => cell(c, r[c], c))}</div>;
        })}
        <div style={{ height: range.bottom }} />
      </div>
    </div>
  );
}

const KEY = 'artemis.table-widths';
function loadWidths(k) { if (!k) return {}; try { return (JSON.parse(localStorage.getItem(KEY) || '{}')[k]) || {}; } catch { return {}; } }
function saveWidths(k, w) {
  if (!k) return;
  try {
    const all = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (Object.keys(w).length) all[k] = w; else delete all[k];
    const keys = Object.keys(all); if (keys.length > 200) delete all[keys[0]];
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {}
}
