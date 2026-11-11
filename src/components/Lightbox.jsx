import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './Icons.jsx';
import { onLightbox } from '../lib/viewer-bus.js';
import { fitView, centeredView, zoomAt, stepScale, clampPan, wheelFactor } from '../lib/zoom.mjs';

const api = window.api;

/** Copies an image as PNG (other formats are redrawn on a canvas so every app can paste them). */
async function copyImage(src) {
  const blob = await (await fetch(src)).blob();
  let png = blob;
  if (blob.type !== 'image/png') {
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    c.getContext('2d').drawImage(bmp, 0, 0);
    png = await new Promise((res) => c.toBlob(res, 'image/png'));
  }
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}

/**
 * Full-window image viewer: fit / 100%, wheel and pinch zoom at the cursor, drag to pan, arrows between images,
 * Copy, Save as, Show in folder. Opened through openLightbox() (lib/viewer-bus.js); mounted once in App.
 */
export default function Lightbox() {
  const [state, setState] = useState(null); // { items, index }
  const [view, setView] = useState(null);   // { scale, x, y }
  const [size, setSize] = useState(null);   // natural { w, h }
  const [note, setNote] = useState('');
  const box = useRef(null);
  const drag = useRef(null);
  const before = useRef(null);
  const noteT = useRef(0);

  useEffect(() => onLightbox((d) => { before.current = document.activeElement; setState(d); setView(null); setSize(null); }), []);
  const item = state ? state.items[state.index] : null;
  const boxSize = () => { const r = box.current ? box.current.getBoundingClientRect() : { width: 800, height: 600 }; return { w: r.width, h: r.height }; };
  const flash = (m) => { setNote(m); clearTimeout(noteT.current); noteT.current = setTimeout(() => setNote(''), 1800); };

  const close = useCallback(() => { setState(null); setView(null); setSize(null); try { before.current && before.current.focus(); } catch {} }, []);
  const go = useCallback((d) => setState((s) => {
    if (!s || s.items.length < 2) return s;
    setView(null); setSize(null);
    return { ...s, index: (s.index + d + s.items.length) % s.items.length };
  }), []);
  const fit = useCallback(() => { if (size) setView(fitView(size, boxSize())); }, [size]);
  const actual = useCallback(() => { if (size) setView(centeredView(size, boxSize(), 1)); }, [size]);
  const step = useCallback((dir) => { if (!size || !view) return; const b = boxSize(); setView(clampPan(zoomAt(view, stepScale(view.scale, dir) / view.scale, b.w / 2, b.h / 2), size, b)); }, [size, view]);

  useLayoutEffect(() => { if (state && box.current) box.current.focus(); }, [state]);
  useEffect(() => { // keep the image fitted while the window resizes, until the user zooms
    if (!state || !box.current || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setView((v) => (v && v.fitted && size ? { ...fitView(size, boxSize()), fitted: true } : v)));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, [state, size]);

  if (!state || !item) return null;

  const onLoad = (e) => {
    const s = { w: e.currentTarget.naturalWidth || 1, h: e.currentTarget.naturalHeight || 1 };
    setSize(s); setView({ ...fitView(s, boxSize()), fitted: true });
  };
  const onWheel = (e) => {
    if (!view || !size) return;
    const r = box.current.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) >= 50 && e.deltaMode === 0 && !e.deltaX) { // pinch, ⌘-scroll, or a mouse wheel notch
      setView(clampPan(zoomAt(view, wheelFactor(e.deltaY, e.ctrlKey), e.clientX - r.left, e.clientY - r.top), size, { w: r.width, h: r.height }));
    } else setView(clampPan({ ...view, x: view.x - e.deltaX, y: view.y - e.deltaY }, size, { w: r.width, h: r.height }));
  };
  const onDown = (e) => {
    if (e.button !== 0 || !view) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false, backdrop: e.target === e.currentTarget };
  };
  const onMove = (e) => {
    const d = drag.current; if (!d || !size) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    setView((v) => clampPan({ ...v, fitted: false, x: d.vx + dx, y: d.vy + dy }, size, boxSize()));
  };
  const onUp = (e) => {
    const d = drag.current; drag.current = null;
    if (d && !d.moved && d.backdrop) close(); // a click on the dark backdrop (not the image) closes
  };
  const onDouble = (e) => {
    if (!view || !size) return;
    const r = box.current.getBoundingClientRect();
    if (Math.abs(view.scale - 1) < 0.01 || view.scale > 1) setView({ ...fitView(size, { w: r.width, h: r.height }), fitted: true });
    else setView(clampPan(zoomAt(view, 1 / view.scale, e.clientX - r.left, e.clientY - r.top), size, { w: r.width, h: r.height }));
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); step(1); }
    else if (e.key === '-') { e.preventDefault(); step(-1); }
    else if (e.key === '0') { e.preventDefault(); fit(); }
    else if (e.key === '1') { e.preventDefault(); actual(); }
  };
  const copy = async () => { try { await copyImage(item.src); flash('Copied'); } catch { flash('Could not copy this image'); } };
  const saveAs = async () => { if (!item.path) return; const r = await api.saveFileAs(item.path); if (r && r.ok && !r.canceled) flash('Saved'); else if (r && !r.ok) flash(r.error); };
  const pct = view ? Math.round(view.scale * 100) + '%' : '';
  const many = state.items.length > 1;

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={item.name || 'Image'}>
      <div className="lb-bar">
        <div className="lb-title" title={item.path || item.name}>{item.name || 'Image'}{many && <span className="lb-count">{state.index + 1} / {state.items.length}</span>}</div>
        <div className="lb-tools">
          <button className="lb-btn" onClick={() => step(-1)} title="Zoom out (−)" aria-label="Zoom out"><Icon name="zoomOut" size={17} /></button>
          <button className="lb-pct" onClick={() => (view && Math.abs(view.scale - 1) < 0.01 ? fit() : actual())} title="Toggle fit / 100% (0 / 1)">{pct}</button>
          <button className="lb-btn" onClick={() => step(1)} title="Zoom in (+)" aria-label="Zoom in"><Icon name="zoomIn" size={17} /></button>
          <button className="lb-btn" onClick={fit} title="Fit to window (0)" aria-label="Fit to window"><Icon name="fit" size={17} /></button>
          <span className="lb-sep" />
          <button className="lb-btn" onClick={copy} title="Copy image" aria-label="Copy image"><Icon name="copy" size={17} /></button>
          {item.path && <button className="lb-btn" onClick={saveAs} title="Save as…" aria-label="Save as"><Icon name="download" size={17} /></button>}
          {item.path && <button className="lb-btn" onClick={() => api.revealPath(item.path)} title="Show in folder" aria-label="Show in folder"><Icon name="folderOpen" size={17} /></button>}
          <span className="lb-sep" />
          <button className="lb-btn" onClick={close} title="Close (Esc)" aria-label="Close"><Icon name="x" size={18} /></button>
        </div>
      </div>
      <div className="lb-stage" ref={box} tabIndex={-1} onKeyDown={onKey} onWheel={onWheel}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { drag.current = null; }} onDoubleClick={onDouble}>
        <img key={item.src} src={item.src} alt={item.name || ''} draggable={false} onLoad={onLoad}
          style={view ? { transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, opacity: 1 } : { opacity: 0 }} />
        {many && <button className="lb-nav prev" onClick={(e) => { e.stopPropagation(); go(-1); }} onPointerDown={(e) => e.stopPropagation()} aria-label="Previous image"><Icon name="chevronLeft" size={22} /></button>}
        {many && <button className="lb-nav next" onClick={(e) => { e.stopPropagation(); go(1); }} onPointerDown={(e) => e.stopPropagation()} aria-label="Next image"><Icon name="chevronRight" size={22} /></button>}
      </div>
      {item.caption && <div className="lb-caption">{item.caption}</div>}
      {note && <div className="lb-note" role="status">{note}</div>}
    </div>
  );
}
