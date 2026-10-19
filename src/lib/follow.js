// "Read along": highlights the passage that is being read aloud inside a rendered message.
// Uses the CSS Custom Highlight API (no DOM changes), matching by words so markdown symbols don't matter.
const isWord = /[\p{L}\p{N}]/u;
// lower case without the dot that 'İ' (Turkish, Azerbaijani) gets as a combining mark: one letter stays one letter, so positions line up
const low = (s) => s.toLowerCase().replace(/̇/g, '');
const norm = (s) => low(String(s || '')).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * container: the message element, or a function that finds it (a message that is still streaming is re-rendered, so it is
 * looked up and its text re-mapped on every call; text is only ever appended, so positions found earlier stay valid).
 */
// When the reader scrolls by hand while a reply is read aloud, the page must stay where they put it. Any wheel / touch / paging key counts.
let lastManualScroll = 0;
if (typeof window !== 'undefined' && window.addEventListener) {
  const mark = () => { lastManualScroll = performance.now(); };
  window.addEventListener('wheel', mark, { passive: true, capture: true });
  window.addEventListener('touchmove', mark, { passive: true, capture: true });
  window.addEventListener('keydown', (e) => {
    if (['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown'].includes(e.key) && !(e.target && e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]'))) mark();
  }, true);
}

export function createFollower(container) {
  if (!container || !window.CSS || !CSS.highlights || typeof Highlight === 'undefined') return { follow() {}, clear() {} };
  const born = performance.now(); // a scroll after this moment means: stop moving the page for this reply
  let full = ''; let map = []; let lastEl = null; let lastLen = -1;
  const build = (force) => {
    const el = typeof container === 'function' ? container() : container;
    // Nothing new in the message (same element, same text length, nodes still in the page): the mapping below is still right. It is a walk over every character, so it must not run for every spoken chunk.
    if (!force && el && el === lastEl && el.textContent.length === lastLen && map.length && map[0].n.isConnected && map[map.length - 1].n.isConnected) return;
    lastEl = el; lastLen = el ? el.textContent.length : -1;
    full = ''; map = []; let lastSpace = true;
    if (!el) return;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement && n.parentElement.closest('.actions, .code-head, button, .thinkblock, .thinking-shimmer, .tool, .tool-group, .approval') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n.nodeValue;
      for (let i = 0; i < t.length; i++) {
        const ch = t[i];
        if (isWord.test(ch)) { full += low(ch).charAt(0) || ch; map.push({ n, o: i }); lastSpace = false; }
        else if (!lastSpace) { full += ' '; map.push({ n, o: i }); lastSpace = true; }
      }
    }
  };
  build();
  let cursor = 0;
  const clear = () => { try { CSS.highlights.delete('reading'); } catch {} };
  const follow = (chunk) => {
    if (typeof container === 'function') build(); // the live message may have new text and new DOM nodes
    const words = norm(chunk).split(' ').filter(Boolean);
    if (!words.length) return;
    let head = words.slice(0, 3).join(' '), start = full.indexOf(head, cursor);
    if (start < 0 && words.length > 1) { head = words.slice(0, 2).join(' '); start = full.indexOf(head, cursor); }
    if (start < 0 && words[0].length > 3) { head = words[0]; start = full.indexOf(head, cursor); }
    if (start < 0) return;
    const tail = words.slice(-3).join(' ');
    const tp = full.indexOf(tail, start);
    const end = tp >= 0 && tp - start < norm(chunk).length * 1.6 + 120 ? tp + tail.length : start + head.length;
    const a = map[start], b = map[Math.min(end, map.length) - 1];
    if (!a || !b) return;
    try {
      const r = document.createRange();
      r.setStart(a.n, a.o); r.setEnd(b.n, b.o + 1);
      CSS.highlights.set('reading', new Highlight(r));
      cursor = end;
      const el = a.n.parentElement;
      if (el && el.offsetParent && lastManualScroll <= born) { const rect = r.getBoundingClientRect(); if (rect.top < 80 || rect.bottom > window.innerHeight - 180) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    } catch {}
  };
  return { follow, clear };
}
