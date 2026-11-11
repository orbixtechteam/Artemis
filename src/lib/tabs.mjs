// Pure helpers for the tab strip: order, drag and keyboard moves, pinning. No React, so scripts/test-tabs.js can import them.

/** Pinned tabs first, each group in its own order. */
export function orderTabs(ts) {
  const list = Array.isArray(ts) ? ts : [];
  return [...list.filter((t) => t.pinned), ...list.filter((t) => !t.pinned)];
}

/** How many tabs are pinned (they are the first ones in the ordered list). */
export function pinnedCount(ts) {
  return (Array.isArray(ts) ? ts : []).filter((t) => t.pinned).length;
}

/**
 * A drop slot is a gap in the ordered list: 0 is before the first tab, n after the last.
 * A pinned tab can only land between pinned tabs, an unpinned one only between unpinned ones.
 * Returns the clamped slot, or -1 when the tab does not exist.
 */
export function clampSlot(ts, id, slot) {
  const order = orderTabs(ts);
  const t = order.find((x) => x.id === id);
  if (!t) return -1;
  const p = pinnedCount(order);
  const s = Math.max(0, Math.min(order.length, Math.round(Number(slot) || 0)));
  return t.pinned ? Math.min(s, p) : Math.max(s, p);
}

/** True when dropping the tab into this slot would not change anything. */
export function isNoopSlot(ts, id, slot) {
  const order = orderTabs(ts);
  const from = order.findIndex((x) => x.id === id);
  if (from < 0) return true;
  const s = clampSlot(ts, id, slot);
  return s === from || s === from + 1;
}

/** Move a tab into a drop slot (see clampSlot). Returns a new, ordered array. */
export function moveTab(ts, id, slot) {
  const order = orderTabs(ts);
  const from = order.findIndex((x) => x.id === id);
  if (from < 0) return order;
  const s = clampSlot(order, id, slot);
  const rest = order.filter((x) => x.id !== id);
  const to = s > from ? s - 1 : s;
  rest.splice(to, 0, order[from]);
  return rest;
}

/** Move a tab by d places (keyboard), staying inside its pinned / unpinned group. */
export function shiftTab(ts, id, d) {
  const order = orderTabs(ts);
  const from = order.findIndex((x) => x.id === id);
  if (from < 0 || !d) return order;
  return moveTab(order, id, d > 0 ? from + 1 + d : from + d);
}

/** Pin or unpin a tab. Either way it lands on the border between the groups (end of the pinned ones, start of the others). */
export function setPinned(ts, id, pinned) {
  const order = orderTabs(ts);
  const t = order.find((x) => x.id === id);
  if (!t || !!t.pinned === !!pinned) return order;
  const rest = order.filter((x) => x.id !== id);
  rest.splice(pinnedCount(rest), 0, { ...t, pinned: !!pinned });
  return rest;
}

/** Which tab becomes active when this one closes: the next one on the right, else the one on the left. */
export function nextAfterClose(ts, id) {
  const order = orderTabs(ts);
  const i = order.findIndex((x) => x.id === id);
  if (i < 0) return null;
  return order[i + 1] || order[i - 1] || null;
}

/** "Close other tabs": keeps this tab and every pinned one. */
export function closeOthers(ts, id) {
  return orderTabs(ts).filter((x) => x.id === id || x.pinned);
}

/**
 * A tab that shows a chat. Page tabs (Settings, Memory, Usage, Connectors) also carry view 'chat' and the id of the chat
 * that was open underneath them, so `view === 'chat'` alone is not enough: without the modal check, picking that chat
 * in the sidebar jumped to the Settings tab.
 */
export function isChatTab(t) {
  return !!t && !!t.s && t.s.view === 'chat' && !t.s.modal;
}

/** The tab that shows this chat (not a page tab sitting on top of it), skipping exceptId. */
export function findChatTab(ts, chatId, exceptId = null) {
  if (!chatId) return null;
  return (Array.isArray(ts) ? ts : []).find((t) => t.id !== exceptId && isChatTab(t) && t.s.chatId === chatId) || null;
}
