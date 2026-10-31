// Search and sort for simple list pages (Memory, Skills).
export const SORTS = [['new', 'Newest first'], ['old', 'Oldest first'], ['az', 'Name A-Z'], ['za', 'Name Z-A']];

/** items filtered by q (every word must appear) and sorted. text(x): searched and A-Z label; at(x, i): age, larger is newer. */
export function filterSort(items, { q = '', sort = 'new', text, at }) {
  const words = String(q).toLowerCase().split(/\s+/).filter(Boolean);
  const rows = items.map((item, i) => ({ item, label: String(text(item) || ''), at: Number(at(item, i)) || 0 }));
  const hits = rows.filter((r) => { const l = r.label.toLowerCase(); return words.every((w) => l.includes(w)); });
  const byName = (a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
  const cmp = { new: (a, b) => b.at - a.at, old: (a, b) => a.at - b.at, az: byName, za: (a, b) => byName(b, a) }[sort] || (() => 0);
  return hits.sort(cmp).map((r) => r.item);
}
