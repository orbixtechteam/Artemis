const assert = require('assert');
(async () => {
  const Z = await import('../src/lib/zoom.mjs');
  const box = { w: 1000, h: 800 }, img = { w: 4000, h: 2000 };
  const f = Z.fitView(img, box, { pad: 0 });
  assert.strictEqual(f.scale, 0.25); assert.strictEqual(f.x, 0); assert.strictEqual(f.y, 150);
  assert.strictEqual(Z.fitView({ w: 100, h: 100 }, box).scale, 1, 'small images are not enlarged');
  const z = Z.zoomAt({ scale: 1, x: 0, y: 0 }, 2, 100, 100);
  assert.deepStrictEqual(z, { scale: 2, x: -100, y: -100 }, 'the point under the cursor stays still');
  assert.strictEqual(Z.stepScale(1, 1), 1.5); assert.strictEqual(Z.stepScale(1, -1), 0.75); assert.strictEqual(Z.stepScale(0.3, -1), 0.25);
  assert.strictEqual(Z.clampScale(100), Z.MAX_SCALE);
  const p = Z.clampPan({ scale: 1, x: -5000, y: 5000 }, { w: 400, h: 300 }, box);
  assert.ok(p.x > -400 && p.y < 800, 'content cannot be dragged out of view');
  assert.ok(Z.wheelFactor(-100, false) > 1 && Z.wheelFactor(100, true) < 1);
  console.log('zoom tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
