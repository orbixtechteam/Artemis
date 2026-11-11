const assert = require('assert');
(async () => {
  const { parseScene, sceneKey, keepAppState } = await import('../src/lib/board-scene.mjs');
  assert.deepStrictEqual(parseScene('').scene.elements, []);
  const r = parseScene(JSON.stringify({ type: 'excalidraw', elements: [{ id: 'a', version: 1 }] }));
  assert.ok(r.ok); assert.strictEqual(r.scene.elements.length, 1); assert.deepStrictEqual(r.scene.files, {});
  assert.strictEqual(parseScene('{bad').ok, false);
  assert.strictEqual(parseScene(JSON.stringify({ type: 'other' })).ok, false);
  const a = [{ id: 'a', version: 1, versionNonce: 5 }];
  assert.strictEqual(sceneKey(a, {}), sceneKey([{ id: 'a', version: 1, versionNonce: 5 }], {}));
  assert.notStrictEqual(sceneKey(a, {}), sceneKey([{ id: 'a', version: 2, versionNonce: 9 }], {}));
  assert.notStrictEqual(sceneKey(a, {}), sceneKey([{ id: 'a', version: 1, versionNonce: 5, isDeleted: true }], {}));
  assert.deepStrictEqual(keepAppState({ viewBackgroundColor: '#fff', zoom: { value: 2 }, gridSize: 20 }), { viewBackgroundColor: '#fff', gridSize: 20 });
  console.log('board-scene tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
