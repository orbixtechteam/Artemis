import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../Icons.jsx';
import { stepScale, clampScale, wheelFactor } from '../../lib/zoom.mjs';

// pdf.js is loaded on first use, so the app starts without it. Package: pdfjs-dist (see docs/ARTEMIS_PLAN.md, section 10).
let pdfjsReady = null;
function loadPdfjs() {
  if (!pdfjsReady) {
    pdfjsReady = Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    });
    pdfjsReady.catch(() => { pdfjsReady = null; });
  }
  return pdfjsReady;
}
const GAP = 16, PAD = 24;
// pdf.js 6 dropped PDFDocumentProxy.destroy(); the document is closed through its loading task (older versions had both)
const closeDoc = (d) => { try { const t = d && (d.loadingTask || d); const p = t && typeof t.destroy === 'function' ? t.destroy() : null; if (p && p.catch) p.catch(() => {}); } catch {} };

/**
 * A PDF as pages: continuous scroll, pages drawn when they come near the view (sharp on Retina), selectable text,
 * zoom (buttons, ⌘-scroll / pinch, fit width), the current page and a page box to jump. The pages stay white like
 * paper; everything around them follows the app theme.
 */
export default function PdfView({ path }) {
  const [doc, setDoc] = useState(null);       // pdf.js document
  const [sizes, setSizes] = useState([]);      // [{ w, h }] at scale 1
  const [error, setError] = useState('');
  const [scale, setScale] = useState(0);       // 0 = not fitted yet
  const [page, setPage] = useState(1);
  const [jump, setJump] = useState('');
  const box = useRef(null);
  const pagesRef = useRef([]);

  useEffect(() => {
    let off = false, task = null;
    setDoc(null); setSizes([]); setError(''); setScale(0); setPage(1);
    (async () => {
      try {
        const pdfjs = await loadPdfjs();
        const r = await window.api.readFileBytes(path);
        if (!r || !r.ok) throw new Error((r && r.error) || 'could not read the file');
        if (off) return;
        task = pdfjs.getDocument({ data: new Uint8Array(r.bytes), isEvalSupported: false });
        const d = await task.promise;
        if (off) { closeDoc(d); return; }
        const n = d.numPages;
        const first = (await d.getPage(1)).getViewport({ scale: 1 });
        const list = Array.from({ length: n }, () => ({ w: first.width, h: first.height }));
        setDoc(d); setSizes(list);
        if (n <= 400) { // real sizes of mixed-size documents, in the background
          for (let i = 2; i <= n && !off; i++) { const v = (await d.getPage(i)).getViewport({ scale: 1 }); if (v.width !== first.width || v.height !== first.height) { list[i - 1] = { w: v.width, h: v.height }; setSizes([...list]); } }
        }
      } catch (e) {
        if (!off) setError(/Failed to fetch dynamically imported module|Cannot find module|pdfjs-dist/.test(String(e && e.message)) ? 'The PDF viewer needs the pdfjs-dist package. Run: pnpm add pdfjs-dist' : `Could not open this PDF: ${(e && e.message) || e}`);
      }
    })();
    return () => { off = true; if (task) closeDoc(task); };
  }, [path]);
  useEffect(() => () => { if (doc) closeDoc(doc); }, [doc]);

  const fitWidth = useCallback(() => {
    const el = box.current; if (!el || !sizes.length) return 1;
    return clampScale(Math.min(2, (el.clientWidth - PAD * 2) / Math.max(...sizes.slice(0, 20).map((s) => s.w))));
  }, [sizes]);
  useLayoutEffect(() => { if (!scale && sizes.length) setScale(fitWidth()); }, [sizes, scale, fitWidth]);

  // current page from the scroll position
  const onScroll = () => {
    const el = box.current; if (!el) return;
    const mid = el.scrollTop + el.clientHeight / 3;
    const nodes = pagesRef.current;
    let p = 1;
    for (let i = 0; i < nodes.length; i++) { const n = nodes[i]; if (n && n.offsetTop <= mid) p = i + 1; else if (n) break; }
    setPage(p);
  };
  const goTo = (n) => { const node = pagesRef.current[n - 1]; if (node && box.current) box.current.scrollTop = node.offsetTop - GAP; };
  const zoomTo = (s) => { // keep the current reading position while the scale changes
    const el = box.current; const ratio = el && el.scrollHeight ? el.scrollTop / el.scrollHeight : 0;
    setScale(clampScale(s));
    requestAnimationFrame(() => { if (el) el.scrollTop = ratio * el.scrollHeight; });
  };
  const onWheel = (e) => { if (!(e.ctrlKey || e.metaKey)) return; e.preventDefault(); zoomTo(scale * wheelFactor(e.deltaY, e.ctrlKey)); };
  useEffect(() => { // ⌘-scroll must not zoom the whole window: a non-passive listener is needed to prevent it
    const el = box.current; if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  if (error) return <div className="pdfv-msg">{error}</div>;
  if (!doc || !scale) return <div className="pdfv-msg"><Icon name="spinner" size={16} className="spin" /> Opening PDF…</div>;
  return (
    <div className="pdfv">
      <div className="pdfv-bar">
        <form className="pdfv-page" onSubmit={(e) => { e.preventDefault(); const n = Math.max(1, Math.min(sizes.length, parseInt(jump, 10) || page)); goTo(n); setJump(''); }}>
          <input value={jump || String(page)} onChange={(e) => setJump(e.target.value.replace(/\D/g, ''))} onFocus={(e) => e.target.select()} aria-label="Page" />
          <span>/ {sizes.length}</span>
        </form>
        <span className="pdfv-grow" />
        <button type="button" className="pdfv-btn" onClick={() => zoomTo(stepScale(scale, -1))} title="Zoom out" aria-label="Zoom out"><Icon name="minus" size={15} /></button>
        <button type="button" className="pdfv-pct" onClick={() => zoomTo(fitWidth())} title="Fit width">{Math.round(scale * 100)}%</button>
        <button type="button" className="pdfv-btn" onClick={() => zoomTo(stepScale(scale, 1))} title="Zoom in" aria-label="Zoom in"><Icon name="plus" size={15} /></button>
        <button type="button" className="pdfv-btn" onClick={() => zoomTo(fitWidth())} title="Fit width" aria-label="Fit width"><Icon name="fit" size={15} /></button>
      </div>
      <div className="pdfv-scroll" ref={box} onScroll={onScroll}>
        {sizes.map((s, i) => (
          <PdfPage key={i} doc={doc} index={i} size={s} scale={scale} rootRef={box} nodeRef={(n) => { pagesRef.current[i] = n; }} />
        ))}
      </div>
    </div>
  );
}

/** One page: a placeholder of the right size, drawn (canvas + text layer) when it comes within 1.5 screens of the view. */
function PdfPage({ doc, index, size, scale, rootRef, nodeRef }) {
  const holder = useRef(null);
  const [near, setNear] = useState(index < 2);
  useEffect(() => {
    const el = holder.current; if (!el || typeof IntersectionObserver === 'undefined') { setNear(true); return; }
    const io = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { root: rootRef.current, rootMargin: '150% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!near) return;
    let off = false, renderTask = null, textLayer = null;
    const el = holder.current;
    (async () => {
      const pdfjs = await loadPdfjs();
      const p = await doc.getPage(index + 1);
      if (off) return;
      const vp = p.getViewport({ scale });
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width * dpr); canvas.height = Math.floor(vp.height * dpr);
      canvas.style.width = vp.width + 'px'; canvas.style.height = vp.height + 'px';
      renderTask = p.render({ canvas, viewport: vp, // pdf.js 5+: pass the canvas (canvasContext is the old API)
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null });
      await renderTask.promise;
      if (off) return;
      const text = document.createElement('div');
      text.className = 'textLayer';
      text.style.setProperty('--scale-factor', String(vp.scale));
      el.replaceChildren(canvas, text);
      textLayer = new pdfjs.TextLayer({ textContentSource: p.streamTextContent(), container: text, viewport: vp });
      await textLayer.render().catch(() => {});
    })().catch(() => {});
    return () => { off = true; try { renderTask && renderTask.cancel(); } catch {} try { textLayer && textLayer.cancel(); } catch {} };
  }, [near, scale, doc, index]);
  useEffect(() => { if (!near && holder.current) holder.current.replaceChildren(); }, [near]); // free far-away pages
  return (
    <div className="pdfv-page-wrap" ref={nodeRef} style={{ paddingTop: GAP }}>
      <div className="pdfv-sheet" ref={holder} style={{ width: size.w * scale, height: size.h * scale }} aria-label={`Page ${index + 1}`} />
    </div>
  );
}
