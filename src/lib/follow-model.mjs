// Follow-the-end decisions for a scrolling message list, without the DOM (scripts/test-stick.js tests it).
// Rules, after DeepSeek Harness's ui-chat ScrollFollow (MIT):
// - only the reader changes follow intent; content that grows or shrinks never pins or unpins the list;
// - a reader gesture away from the end (wheel up, drag down on touch, PageUp/ArrowUp/Home) unpins at once;
// - other reader movement is decided when scrolling settles: following resumes only if it settled at the end;
// - positions written by the app itself are not reader movement.

export const NEAR_PX = 16;      // settled within this distance of the end counts as "at the end"
export const EXACT_PX = 1;      // reaching the end this closely pins at once, without waiting for the settle
export const INTENT_MS = 1200;  // a scroll this soon after a reader gesture belongs to that gesture

/** distance from the bottom of a { top, height, client } snapshot */
export const gap = (m) => Math.max(0, m.height - m.client - m.top);

export function createFollowModel({ following = true, now = () => Date.now() } = {}) {
  const st = { following, lastTop: null, intentAt: -Infinity, readerMoved: false };
  const recentIntent = () => now() - st.intentAt <= INTENT_MS;
  return {
    get following() { return st.following; },
    set following(v) { st.following = !!v; if (v) st.readerMoved = false; },
    /** A reader gesture. away: it points away from the end (unpins immediately). */
    intent(away = false) {
      st.intentAt = now();
      if (away) { st.following = false; st.readerMoved = true; }
    },
    /** The app moved the list itself (following the end, restoring a position): not reader movement. */
    wrote(top) { st.lastTop = top; },
    /** A scroll event. Returns the follow intent after it. */
    scrolled(m) {
      const moved = st.lastTop === null || Math.abs(m.top - st.lastTop) > 0.5;
      st.lastTop = m.top;
      if (!moved || !recentIntent()) return st.following; // layout clamping or our own write
      st.readerMoved = true;
      if (gap(m) <= EXACT_PX) { st.following = true; st.readerMoved = false; }
      return st.following;
    },
    /** Scrolling stopped (scrollend, or a short idle). Settles pending reader movement. */
    settled(m) {
      if (!st.readerMoved) return st.following;
      st.readerMoved = false;
      st.following = gap(m) <= NEAR_PX;
      return st.following;
    }
  };
}

/**
 * Binds the model to the shared `stick` ref that callers use to force following (send a message, switch chats).
 * A caller's write is told apart from our own by remembering what we last wrote: comparing with the model instead
 * re-pinned the list right after a wheel-up, because the ref still held the old `true` (the "throws me down" bug).
 */
export function createFollowController(stick, { now } = {}) {
  const model = createFollowModel({ following: stick.current !== false, ...(now ? { now } : {}) });
  let written = model.following;
  stick.current = written;
  const pull = () => { if (stick.current !== written) model.following = !!stick.current; };
  const push = () => { written = model.following; stick.current = written; return written; };
  return {
    /** A reader gesture; away: it points away from the end. Returns the follow intent. */
    gesture(away) { pull(); model.intent(away); return push(); },
    scroll(m) { pull(); model.scrolled(m); return push(); },
    settle(m) { pull(); model.settled(m); return push(); },
    /** The current intent, after any caller override. */
    following() { pull(); return push(); },
    /** The app moved the list itself. */
    wrote(top) { model.wrote(top); }
  };
}
