const assert = require('assert');
const { buildDiagram, wrap, rank } = require('../electron/diagram');
const spec = { title: 'Login', nodes: [
  { id: 'start', label: 'Start', shape: 'ellipse' }, { id: 'form', label: 'Enter email and password' }, { id: 'ok', label: 'Credentials valid?', shape: 'diamond' },
  { id: 'err', label: 'Show inline error', color: 'red' }, { id: 'dash', label: 'Dashboard', shape: 'ellipse' }
], edges: [{ from: 'start', to: 'form' }, { from: 'form', to: 'ok' }, { from: 'ok', to: 'dash', label: 'Yes' }, { from: 'ok', to: 'err', label: 'No' }, { from: 'err', to: 'form' }, { from: 'x', to: 'form' }] };
const s = buildDiagram(spec);
assert.strictEqual(s.type, 'excalidraw');
const shapes = s.elements.filter((e) => ['rectangle', 'diamond', 'ellipse'].includes(e.type));
const arrows = s.elements.filter((e) => e.type === 'arrow');
const texts = s.elements.filter((e) => e.type === 'text');
assert.strictEqual(shapes.length, 5); assert.strictEqual(arrows.length, 5, 'the edge to an unknown node is dropped');
assert.strictEqual(texts.length, 5 + 2 + 1, 'node labels, 2 edge labels, title');
for (const t of texts.filter((t) => t.containerId)) { const c = s.elements.find((e) => e.id === t.containerId); assert.ok(c && c.boundElements.some((b) => b.id === t.id), 'bound text'); }
for (const a of arrows) { assert.ok(s.elements.find((e) => e.id === a.startBinding.elementId).boundElements.some((b) => b.id === a.id)); }
// layered top to bottom: start above form above the decision; the back edge err -> form does not push form down
const y = (label) => { const t = texts.find((t) => t.text.replace(/\n/g, ' ') === label); return s.elements.find((e) => e.id === t.containerId).y; };
assert.ok(y('Start') < y('Enter email and password') && y('Enter email and password') < y('Credentials valid?') && y('Credentials valid?') < y('Dashboard'));
// shapes do not overlap
for (let i = 0; i < shapes.length; i++) for (let j = i + 1; j < shapes.length; j++) { const a = shapes[i], b = shapes[j]; assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y, 'overlap'); }
// text fits its box
for (const t of texts.filter((t) => t.containerId && shapes.some((sh) => sh.id === t.containerId))) { const c = s.elements.find((e) => e.id === t.containerId); assert.ok(t.width <= c.width && t.height <= c.height); }
assert.deepStrictEqual(wrap('a very long label that needs to wrap over lines'), ['a very long label that', 'needs to wrap over lines']);
assert.strictEqual(rank(['a', 'b'], [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }]).r.get('b'), 1);
const right = buildDiagram({ direction: 'right', nodes: [{ id: 1, label: 'A' }, { id: 2, label: 'B' }], edges: [{ from: 1, to: 2 }] });
const [r1, r2] = right.elements.filter((e) => e.type === 'rectangle'); assert.ok(r1.x + r1.width < r2.x);
assert.throws(() => buildDiagram({ nodes: [] }));
console.log('diagram tests passed');
