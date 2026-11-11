// create_diagram: nodes + edges in, a laid-out Excalidraw whiteboard out. The model sends a few lines of structure
// instead of hundreds of coordinates; layout is layered (ranks by longest path, back edges ignored, barycenter ordering).
// Labels sit inside their shapes (bound text), arrows are bound to shapes so they follow when the user drags them.
const crypto = require('crypto');

const COLORS = { blue: '#d0e4ff', green: '#d3f9d8', red: '#ffe3e3', yellow: '#fff3bf', violet: '#e5dbff', gray: '#e9ecef', orange: '#ffe8cc', teal: '#c3fae8', none: 'transparent' };
const FONT = 18, CH_W = 9.6, LINE_H = FONT * 1.25, PAD_X = 28, PAD_Y = 22, RANK_GAP = 100, NODE_GAP = 56, MAX_CHARS = 26;
const rid = () => crypto.randomBytes(8).toString('hex');
const rint = () => crypto.randomInt(1, 2 ** 31 - 1);

function wrap(label) {
  const words = String(label || '').split(/\s+/).filter(Boolean), lines = [];
  let cur = '';
  for (const w of words) { if ((cur + ' ' + w).trim().length > MAX_CHARS && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}
function sizeOf(n) {
  const lines = wrap(n.label);
  const textW = Math.max(...lines.map((l) => l.length)) * CH_W, textH = lines.length * LINE_H;
  let w = Math.max(150, Math.min(360, textW + PAD_X * 2)), h = Math.max(64, textH + PAD_Y * 2);
  if (n.shape === 'diamond') { w = Math.max(190, w * 1.45); h = Math.max(110, h * 1.6); }
  if (n.shape === 'ellipse') { w *= 1.2; h = Math.max(70, h * 1.15); }
  return { w: Math.round(w), h: Math.round(h), lines };
}

/** Ranks (layers) by longest path from the sources, ignoring edges that close a cycle. */
function rank(ids, edges) {
  const out = new Map(ids.map((id) => [id, []]));
  for (const e of edges) if (out.has(e.from) && out.has(e.to) && e.from !== e.to) out.get(e.from).push(e.to);
  const state = new Map(), back = new Set(), order = [];
  const dfs = (v) => { state.set(v, 1); for (const w of out.get(v)) { if (state.get(w) === 1) back.add(v + '\u0000' + w); else if (!state.get(w)) dfs(w); } state.set(v, 2); order.push(v); };
  const indeg = new Map(ids.map((id) => [id, 0]));
  for (const [v, ws] of out) for (const w of ws) indeg.set(w, indeg.get(w) + 1);
  for (const id of ids) if (!indeg.get(id) && !state.get(id)) dfs(id);
  for (const id of ids) if (!state.get(id)) dfs(id);
  const r = new Map(ids.map((id) => [id, 0]));
  for (const v of order.reverse()) for (const w of out.get(v)) if (!back.has(v + '\u0000' + w)) r.set(w, Math.max(r.get(w), r.get(v) + 1));
  return { r, back };
}

/** spec: { nodes: [{ id, label, shape?, color? }], edges: [{ from, to, label? }], direction?: 'down' | 'right', title? } */
function buildDiagram(spec) {
  const nodes = (spec.nodes || []).filter((n) => n && n.id != null).map((n) => ({ id: String(n.id), label: String(n.label ?? n.id), shape: ['box', 'round', 'diamond', 'ellipse'].includes(n.shape) ? n.shape : 'round', color: COLORS[n.color] ? n.color : '' }));
  if (!nodes.length) throw new Error('nodes is empty');
  const known = new Set(nodes.map((n) => n.id));
  const edges = (spec.edges || []).filter((e) => e && known.has(String(e.from)) && known.has(String(e.to))).map((e) => ({ from: String(e.from), to: String(e.to), label: e.label ? String(e.label) : '' }));
  const down = spec.direction !== 'right';
  const { r } = rank(nodes.map((n) => n.id), edges);
  const layers = [];
  for (const n of nodes) { const k = r.get(n.id); (layers[k] = layers[k] || []).push(n); Object.assign(n, sizeOf(n)); }
  // a few barycenter sweeps so edges cross less
  const pos = new Map();
  const index = () => layers.forEach((L) => L && L.forEach((n, i) => pos.set(n.id, i)));
  index();
  for (let sweep = 0; sweep < 4; sweep++) {
    for (let k = 1; k < layers.length; k++) {
      if (!layers[k]) continue;
      const bc = (n) => { const ps = edges.filter((e) => e.to === n.id && r.get(e.from) < k).map((e) => pos.get(e.from)); return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : pos.get(n.id); };
      layers[k].sort((a, b) => bc(a) - bc(b)); index();
    }
  }
  // coordinates: each layer centred on the widest one
  const along = (n) => (down ? n.h : n.w), across = (n) => (down ? n.w : n.h);
  const spans = layers.map((L) => (L || []).reduce((t, n) => t + across(n), 0) + Math.max(0, ((L || []).length - 1) * NODE_GAP));
  const widest = Math.max(...spans);
  let depth = 0;
  layers.forEach((L, k) => {
    if (!L) return;
    const thick = Math.max(...L.map(along));
    let c = (widest - spans[k]) / 2;
    for (const n of L) {
      const a = depth + (thick - along(n)) / 2;
      if (down) { n.x = c; n.y = a; } else { n.x = a; n.y = c; }
      c += across(n) + NODE_GAP;
    }
    depth += thick + RANK_GAP;
  });

  const els = [], byId = new Map();
  const base = (o) => ({ angle: 0, strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid', roughness: 1, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: rint(), version: 1, versionNonce: rint(), isDeleted: false, boundElements: [], updated: Date.now(), link: null, locked: false, ...o });
  const text = (container, lines, cx, cy, w, size = FONT) => {
    const h = lines.length * size * 1.25;
    const t = base({ id: rid(), type: 'text', x: cx - w / 2, y: cy - h / 2, width: w, height: h, text: lines.join('\n'), originalText: lines.join(' '), fontSize: size, fontFamily: 5, textAlign: 'center', verticalAlign: 'middle', containerId: container.id, lineHeight: 1.25, autoResize: true });
    container.boundElements.push({ type: 'text', id: t.id });
    return t;
  };
  for (const n of nodes) {
    const type = n.shape === 'diamond' ? 'diamond' : n.shape === 'ellipse' ? 'ellipse' : 'rectangle';
    const el = base({ id: rid(), type, x: Math.round(n.x), y: Math.round(n.y), width: n.w, height: n.h, backgroundColor: COLORS[n.color || (n.shape === 'diamond' ? 'yellow' : n.shape === 'ellipse' ? 'green' : 'blue')], roundness: n.shape === 'round' ? { type: 3 } : n.shape === 'diamond' ? { type: 2 } : null });
    byId.set(n.id, { el, n });
    els.push(el, text(el, n.lines, el.x + el.width / 2, el.y + el.height / 2, Math.min(el.width - 16, Math.max(...n.lines.map((l) => l.length)) * CH_W + 8)));
  }
  // arrows: from the side of the source facing the target to the opposite side of the target
  const side = (el, toward) => {
    const cx = el.x + el.width / 2, cy = el.y + el.height / 2, dx = toward.x - cx, dy = toward.y - cy;
    if (Math.abs(dy) * el.width >= Math.abs(dx) * el.height) return { x: cx, y: dy > 0 ? el.y + el.height : el.y };
    return { x: dx > 0 ? el.x + el.width : el.x, y: cy };
  };
  for (const e of edges) {
    const a = byId.get(e.from).el, b = byId.get(e.to).el;
    const ac = { x: a.x + a.width / 2, y: a.y + a.height / 2 }, bc = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    const p1 = side(a, bc), p2 = side(b, ac);
    const arrow = base({ id: rid(), type: 'arrow', x: p1.x, y: p1.y, width: Math.abs(p2.x - p1.x), height: Math.abs(p2.y - p1.y), points: [[0, 0], [p2.x - p1.x, p2.y - p1.y]], lastCommittedPoint: null,
      startBinding: { elementId: a.id, focus: 0, gap: 6 }, endBinding: { elementId: b.id, focus: 0, gap: 6 }, startArrowhead: null, endArrowhead: 'arrow', elbowed: false, roundness: { type: 2 } });
    a.boundElements.push({ type: 'arrow', id: arrow.id }); b.boundElements.push({ type: 'arrow', id: arrow.id });
    els.push(arrow);
    if (e.label) els.push(text(arrow, [e.label], (p1.x + p2.x) / 2, (p1.y + p2.y) / 2, e.label.length * 8.4 + 8, 16));
  }
  if (spec.title) {
    const w = String(spec.title).length * 14 + 10;
    els.push(base({ id: rid(), type: 'text', x: widest / 2 - w / 2, y: -70, width: w, height: 35, text: String(spec.title), originalText: String(spec.title), fontSize: 28, fontFamily: 5, textAlign: 'center', verticalAlign: 'top', containerId: null, lineHeight: 1.25, autoResize: true }));
  }
  return { type: 'excalidraw', version: 2, source: 'artemis', elements: els, appState: { viewBackgroundColor: '#ffffff', gridSize: null }, files: {} };
}

module.exports = { buildDiagram, wrap, rank };
