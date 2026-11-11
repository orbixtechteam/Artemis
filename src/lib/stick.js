import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createFollowController, gap } from './follow-model.mjs';

// Keeps a message list at its end while it grows, and leaves the reader alone once they scroll away.
// All decisions live in follow-model.mjs (tested by scripts/test-stick.js); this file only wires DOM events to them.
// `stick` is a ref shared with callers that force following (sending a message, switching chats): stick.current = true.

const metrics = (el) => ({ top: el.scrollTop, height: el.scrollHeight, client: el.clientHeight });
const NAV_AWAY = new Set(['PageUp', 'ArrowUp', 'Home']);
const NAV = new Set(['PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End', ' ']);
const controllers = new WeakMap(); // scroll container -> its controller, so useFollow's own writes are recorded too

/** Moves a list to its end and tells its controller that the app (not the reader) did it. */
function pinEnd(el) {
  const top = Math.max(0, el.scrollHeight - el.clientHeight);
  if (Math.abs(el.scrollTop - top) <= 0.5) return;
  const c = controllers.get(el); if (c) c.wrote(top);
  el.scrollTop = top;
}

/** Attaches follow behaviour to one scroll container. Returns a cleanup function. */
export function attachFollow(el, stick, onChange) {
  if (!el) return () => {};
  const ctrl = createFollowController(stick);
  controllers.set(el, ctrl);
  let raf = 0, idle = 0, last = ctrl.following();
  const apply = (following) => {
    // browser scroll anchoring keeps the reader's place while content changes; it must be off while we pin the end
    el.style.overflowAnchor = following ? 'none' : 'auto';
    if (following !== last) { last = following; if (onChange) onChange(following); }
    return following;
  };
  const toEnd = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => { if (apply(ctrl.following())) pinEnd(el); });
  };
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(toEnd) : null;
  const watchChildren = () => { if (ro) for (const c of el.children) ro.observe(c); };
  if (ro) { ro.observe(el); watchChildren(); }
  const mo = new MutationObserver(() => { watchChildren(); toEnd(); });
  mo.observe(el, { childList: true, subtree: true, characterData: true });

  const gesture = (away) => apply(ctrl.gesture(away));
  const onWheel = (e) => gesture(e.deltaY < 0);
  let touchY = null;
  const onTouchStart = (e) => { touchY = e.touches && e.touches[0] ? e.touches[0].clientY : null; gesture(false); };
  const onTouchMove = (e) => { const y = e.touches && e.touches[0] ? e.touches[0].clientY : null; gesture(y != null && touchY != null && y > touchY); touchY = y; };
  let held = false; // a press on the list: a scrollbar drag can outlast one gesture window
  const onPointer = () => { held = true; gesture(false); };
  const onPointerUp = () => { held = false; };
  const onKey = (e) => {
    if (e.target && e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (NAV.has(e.key)) gesture(NAV_AWAY.has(e.key));
  };
  const settle = () => apply(ctrl.settle(metrics(el)));
  const onScroll = () => {
    if (held) ctrl.gesture(false);
    apply(ctrl.scroll(metrics(el)));
    clearTimeout(idle); idle = setTimeout(settle, 160); // browsers without scrollend
  };
  const onScrollEnd = () => { clearTimeout(idle); settle(); };

  el.addEventListener('wheel', onWheel, { passive: true });
  el.addEventListener('touchstart', onTouchStart, { passive: true });
  el.addEventListener('touchmove', onTouchMove, { passive: true });
  el.addEventListener('pointerdown', onPointer, { passive: true });
  el.addEventListener('keydown', onKey);
  window.addEventListener('pointerup', onPointerUp, { passive: true });
  el.addEventListener('scroll', onScroll, { passive: true });
  el.addEventListener('scrollend', onScrollEnd);
  apply(last); toEnd();
  return () => {
    cancelAnimationFrame(raf); clearTimeout(idle); if (ro) ro.disconnect(); mo.disconnect();
    if (controllers.get(el) === ctrl) controllers.delete(el);
    el.removeEventListener('wheel', onWheel); el.removeEventListener('touchstart', onTouchStart); el.removeEventListener('touchmove', onTouchMove);
    el.removeEventListener('pointerdown', onPointer); el.removeEventListener('keydown', onKey); window.removeEventListener('pointerup', onPointerUp);
    el.removeEventListener('scroll', onScroll); el.removeEventListener('scrollend', onScrollEnd);
  };
}

/** Kept for callers that only need to know whether a box is at its end. */
export const atBottom = (el) => gap(metrics(el)) <= 4;

/**
 * Follow the end of a message list. ref: the scroll container, stick: a ref (shared with callers that force following),
 * resetKey: changes when another chat / tab is shown, content: the current chat's messages.
 * Returns { unseen, jump }: unseen is true when new content arrived while the user was reading above.
 */
export function useFollow(ref, stick, resetKey, content) {
  const [unseen, setUnseen] = useState(false);
  const lastKey = useRef(resetKey);
  useLayoutEffect(() => {
    const el = ref.current;
    const switched = lastKey.current !== resetKey; lastKey.current = resetKey;
    if (switched) stick.current = true;
    if (!el) return;
    if (stick.current) { pinEnd(el); setUnseen(false); }
    else if (!switched) setUnseen(true);
  }, [content, resetKey]);
  // (re)attach whenever the container element itself changes
  const attached = useRef({ el: null, off: null });
  useEffect(() => {
    const el = ref.current; const a = attached.current;
    if (el === a.el) return;
    if (a.off) a.off();
    a.el = el; a.off = el ? attachFollow(el, stick, (v) => { if (v) setUnseen(false); }) : null;
  });
  useEffect(() => () => { const a = attached.current; if (a.off) a.off(); a.el = null; a.off = null; }, []);
  const jump = () => {
    const el = ref.current; stick.current = true; setUnseen(false);
    if (!el) return;
    el.style.overflowAnchor = 'none';
    const c = controllers.get(el); if (c) c.wrote(Math.max(0, el.scrollHeight - el.clientHeight));
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    try { el.scrollTo({ top: el.scrollHeight, behavior: reduce ? 'auto' : 'smooth' }); } catch { el.scrollTop = el.scrollHeight; }
  };
  return { unseen, jump };
}
