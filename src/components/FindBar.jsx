import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './Icons.jsx';
import { findMatches, stepIndex, keepIndex, countLabel, isFindKey, findStepKey } from '../lib/find.mjs';

// Find in page (⌘F) for a rendered message list: a small floating bar at the top right of its pane.
// Matches are painted with the CSS Custom Highlight API ('find-all', 'find-current'), so the DOM React renders is never touched.

const IS_MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent || '');
const SKIP = 'button, input, textarea, select, script, style, svg, noscript, [aria-hidden="true"], .actions, .jump-anchor, .find-bar, .thinkblock-copy';
const BLOCK = new Set(['P', 'LI', 'PRE', 'TD', 'TH', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'DIV', 'SECTION', 'ARTICLE', 'DT', 'DD', 'SUMMARY', 'DETAILS', 'FIGCAPTION', 'UL', 'OL', 'TABLE', 'TR']);
// focus in one of these means ⌘F is not ours (terminal keeps its own keys, pages and dialogs have no find)
const NOT_OURS = '.term-dock, .term-wrap-full, .xterm, webview, [data-page-pane], .overlay, .cmdk';

/**
 * The pane that ⌘F is for: the [data-find-scope] element that holds the focus, else the one under the mouse, else the first one
 * (the primary pane). null when the focus is somewhere ⌘F should do nothing (terminal, a settings page, a dialog, a text field outside the panes).
 * Shared by chat panes (FindBar) and the note editor.
 */
export function findOwner(doc = document) {
  if (doc.querySelector('.overlay, .cmdk')) return null;
  const scopes = Array.from(doc.querySelectorAll('[data-find-scope]')).filter((s) => s.getClientRects().length > 0);
  if (!scopes.length) return null;
  const a = doc.activeElement;
  if (a && a !== doc.body && a !== doc.documentElement) {
    const s = a.closest('[data-find-scope]');
    if (s) return s;
    if (a.closest(NOT_OURS)) return null;
    if (a.closest('.pane, .split-pane')) return null; // a page pane (settings, files…) has the focus
    if (a.matches('input, textarea, select, [contenteditable="true"], [contenteditable=""]')) return null;
  }
  let hovered = null;
  try { hovered = scopes.find((s) => s.matches(':hover')) || null; } catch {}
  // nothing focused (the last click landed on plain text): the pane that was clicked last, so ⌘F follows where you were reading
  const clicked = lastClicked && scopes.includes(lastClicked) ? lastClicked : null;
  return (!a || a === doc.body || a === doc.documentElement ? clicked : null) || hovered || scopes[0];
}

// the [data-find-scope] pane that got the last mouse press (a click on plain text leaves the focus on <body>)
let lastClicked = null;
if (typeof document !== 'undefined') {
  document.addEventListener('mousedown', (e) => { const t = e.target; lastClicked = t && t.closest ? t.closest('[data-find-scope]') : null; }, true);
}

/** The visible text nodes under root, as segments for findMatches (grouped by their block element). */
export function collectText(root) {
  const nodes = [], segments = [];
  if (!root) return { nodes, segments };
  const doc = root.ownerDocument;
  const skip = new Map(); // element -> hidden or skipped
  const hidden = (el) => {
    if (skip.has(el)) return skip.get(el);
    let v = !!el.closest(SKIP);
    if (!v && typeof el.checkVisibility === 'function') { try { v = !el.checkVisibility({ visibilityProperty: true, opacityProperty: false }); } catch {} }
    skip.set(el, v);
    return v;
  };
  const blockOf = (el) => { let b = el; while (b && b !== root && !BLOCK.has(b.tagName)) b = b.parentElement; return b || root; };
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */, {
    acceptNode: (n) => {
      const p = n.parentElement;
      if (!p || !n.nodeValue) return 2; // FILTER_REJECT
      return hidden(p) ? 2 : 1;
    }
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push(n);
    segments.push({ text: n.nodeValue, group: blockOf(n.parentElement) });
  }
  return { nodes, segments };
}

/** DOM ranges for the matches of query under root. */
export function findRanges(root, query) {
  if (!root || !query) return [];
  const { nodes, segments } = collectText(root);
  const doc = root.ownerDocument;
  return findMatches(segments, query).map((m) => {
    const r = doc.createRange();
    r.setStart(nodes[m.node], m.start);
    r.setEnd(nodes[m.endNode], m.end);
    return r;
  });
}

// every open bar's ranges; the two highlights are the union, so two panes can search at once
const painted = new Map();
const supported = () => typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined';
function paint() {
  if (!supported()) return;
  const all = [], cur = [];
  for (const v of painted.values()) { all.push(...v.all); if (v.cur) cur.push(v.cur); }
  try {
    if (all.length) CSS.highlights.set('find-all', new Highlight(...all)); else CSS.highlights.delete('find-all');
    if (cur.length) { const h = new Highlight(...cur); h.priority = 1; CSS.highlights.set('find-current', h); } else CSS.highlights.delete('find-current');
  } catch {}
}

/**
 * Scroll the match into the middle of the list (and of any scrolling box inside it, e.g. a wide code block), only when it is not already in view.
 * Scrolling up first tells the list's stick-to-bottom logic (lib/stick.js watchIntent) that the user scrolled away, so it does not snap back.
 */
function reveal(container, range) {
  if (!container || !range) return;
  const r0 = range.getBoundingClientRect();
  if (!r0.width && !r0.height) return;
  for (let el = range.startContainer.parentElement; el && el !== container; el = el.parentElement) {
    const cs = getComputedStyle(el);
    const box = el.getBoundingClientRect(), r = range.getBoundingClientRect();
    if (el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(cs.overflowX) && (r.left < box.left || r.right > box.right)) el.scrollLeft += r.left - box.left - (el.clientWidth - r.width) / 2;
    if (el.scrollHeight > el.clientHeight + 1 && /auto|scroll/.test(cs.overflowY) && (r.top < box.top || r.bottom > box.bottom)) el.scrollTop += r.top - box.top - (el.clientHeight - r.height) / 2;
  }
  const c = container.getBoundingClientRect(), r = range.getBoundingClientRect();
  const margin = 48;
  if (r.top >= c.top + margin && r.bottom <= c.bottom - margin) return;
  const max = container.scrollHeight - container.clientHeight;
  const top = Math.max(0, Math.min(max, container.scrollTop + (r.top - c.top) - (container.clientHeight - r.height) / 2));
  if (Math.abs(top - container.scrollTop) < 2) return;
  if (top < container.scrollTop) { try { container.dispatchEvent(new WheelEvent('wheel', { deltaY: -1 })); } catch {} }
  container.scrollTop = top;
}

let seq = 0;

/**
 * The find bar for one message list. targetRef: the scroll container whose text is searched; its closest [data-find-scope] ancestor is the
 * pane that ⌘F must be for (see findOwner). Closed by default; opened by ⌘F.
 */
export default function FindBar({ targetRef }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [dq, setDq] = useState(''); // debounced query
  const [n, setN] = useState(0);
  const [idx, setIdx] = useState(0);
  const [top, setTop] = useState(8);
  const id = useRef(0); if (!id.current) id.current = ++seq;
  const input = useRef(null);
  const st = useRef({ ranges: [], idx: 0 });

  const scope = () => { const t = targetRef.current; return t ? t.closest('[data-find-scope]') || t.parentElement : null; };

  const show = useCallback((ranges, i, scroll) => {
    st.current = { ranges, idx: i };
    setN(ranges.length); setIdx(i);
    painted.set(id.current, { all: ranges, cur: ranges[i] || null });
    paint();
    if (scroll && ranges[i]) {
      const t = targetRef.current;
      reveal(t, ranges[i]);
      // messages off screen are laid out lazily (content-visibility), so their real height can move the match: check once more
      requestAnimationFrame(() => reveal(t, st.current.ranges[st.current.idx]));
    }
  }, [targetRef]);

  // a new query: first match at or below the top of the visible part of the list
  const search = useCallback((query) => {
    const t = targetRef.current;
    const ranges = findRanges(t, query);
    let i = 0;
    if (t && ranges.length) {
      const ct = t.getBoundingClientRect().top;
      const k = ranges.findIndex((r) => r.getBoundingClientRect().bottom >= ct);
      i = k === -1 ? 0 : k;
    }
    show(ranges, i, true);
  }, [targetRef, show]);

  // the page changed (a reply streams in, a block was expanded): search again, keep the current match, do not scroll
  const refresh = useCallback(() => {
    const old = st.current.ranges[st.current.idx];
    const ranges = findRanges(targetRef.current, dq);
    const same = old ? (r) => r.startContainer === old.startContainer && r.startOffset === old.startOffset : null;
    show(ranges, keepIndex(ranges, same, st.current.idx), false);
  }, [targetRef, dq, show]);

  const step = useCallback((d) => {
    const { ranges, idx: i } = st.current;
    if (!ranges.length) return;
    show(ranges, stepIndex(i, ranges.length, d), true);
  }, [show]);

  const close = useCallback(() => {
    setOpen(false); setQ(''); setDq(''); setN(0); setIdx(0);
    st.current = { ranges: [], idx: 0 };
    painted.delete(id.current); paint();
    const t = targetRef.current, sc = t && t.closest('[data-find-scope]');
    const box = sc && sc.querySelector('textarea, [contenteditable="true"]');
    if (box) box.focus({ preventScroll: true });
  }, [targetRef]);

  const focusInput = () => requestAnimationFrame(() => { const el = input.current; if (el) { el.focus(); el.select(); } });

  // ⌘F opens (or selects the text when open), ⌘G / ⇧⌘G step, for the pane that owns the shortcut
  useEffect(() => {
    const k = (e) => {
      if (e.defaultPrevented) return;
      const mine = () => { const s = scope(); return s && findOwner() === s; };
      if (isFindKey(e, IS_MAC)) {
        if (!mine()) { try { console.debug('[find] ⌘F is not for this pane', { owner: (findOwner() || {}).dataset && findOwner().dataset.findScope, scope: (scope() || {}).dataset && scope().dataset.findScope, active: document.activeElement && document.activeElement.tagName }); } catch {} return; }
        e.preventDefault();
        const t = targetRef.current, sc = scope();
        if (t && sc) setTop(Math.max(8, t.getBoundingClientRect().top - sc.getBoundingClientRect().top + 8));
        if (!open) {
          const sel = window.getSelection && window.getSelection();
          const s = sel && sel.rangeCount && t && t.contains(sel.anchorNode) ? String(sel).trim() : '';
          if (s && s.length < 120 && !s.includes('\n')) { setQ(s); setDq(s); }
          setOpen(true);
        }
        focusInput();
        return;
      }
      const d = open ? findStepKey(e, IS_MAC) : 0;
      if (d && (mine() || (input.current && document.activeElement === input.current))) { e.preventDefault(); step(d); }
    };
    // capture phase: nothing inside the pane (the composer, a message, a widget) can swallow the key before it gets here
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [open, step, targetRef]);

  // debounce typing
  useEffect(() => {
    if (q === dq) return;
    const t = setTimeout(() => setDq(q), 120);
    return () => clearTimeout(t);
  }, [q, dq]);

  useLayoutEffect(() => { if (open) search(dq); }, [open, dq, search]);

  // keep the results current while the bar is open
  useEffect(() => {
    const t = targetRef.current;
    if (!open || !dq || !t || typeof MutationObserver === 'undefined') return;
    let timer = 0;
    const mo = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(refresh, 120); });
    mo.observe(t, { childList: true, subtree: true, characterData: true });
    return () => { clearTimeout(timer); mo.disconnect(); };
  }, [open, dq, refresh, targetRef]);

  useEffect(() => () => { painted.delete(id.current); paint(); }, []);

  if (!open) return null;
  const keys = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); if (q !== dq) { setDq(q); return; } step(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  };
  const label = countLabel(idx, n, dq);
  return (
    <div className="find-bar" role="search" style={{ top }} onMouseDown={(e) => e.stopPropagation()}>
      <Icon name="search" size={13} className="find-ico" />
      <input ref={input} type="text" placeholder="Find in chat" aria-label="Find in chat" value={q} spellCheck={false}
        onChange={(e) => setQ(e.target.value)} onKeyDown={keys} />
      <span className={'find-count' + (dq && !n ? ' none' : '')} aria-live="polite">{label}</span>
      <button type="button" title="Previous (⇧↵)" aria-label="Previous match" disabled={!n} onClick={() => step(-1)}><Icon name="arrowUp" size={13} /></button>
      <button type="button" title="Next (↵)" aria-label="Next match" disabled={!n} onClick={() => step(1)}><Icon name="arrowUp" size={13} style={{ transform: 'rotate(180deg)' }} /></button>
      <button type="button" title="Close (Esc)" aria-label="Close find" onClick={close}><Icon name="x" size={13} /></button>
    </div>
  );
}
