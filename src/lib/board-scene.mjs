// .excalidraw files: parsing what is on disk and telling a real drawing change from noise. Pure: scripts/test-board-scene.js.

export const EMPTY_SCENE = { type: 'excalidraw', version: 2, source: 'artemis', elements: [], appState: {}, files: {} };

/** { ok, scene } from file text; an empty file is a new, empty board. */
export function parseScene(text) {
  const t = String(text || '').trim();
  if (!t) return { ok: true, scene: { ...EMPTY_SCENE } };
  try {
    const j = JSON.parse(t);
    if (!j || typeof j !== 'object' || (j.type && j.type !== 'excalidraw') || (j.elements && !Array.isArray(j.elements))) return { ok: false, error: 'This is not an Excalidraw file.' };
    return { ok: true, scene: { ...EMPTY_SCENE, ...j, elements: j.elements || [], appState: j.appState || {}, files: j.files || {} } };
  } catch (e) { return { ok: false, error: 'This whiteboard file is damaged: ' + e.message }; }
}

/** A cheap fingerprint of the drawing (not the view): changes when an element is added, moved, edited or deleted. */
export function sceneKey(elements, files) {
  let h = 0;
  for (const el of elements || []) h = (h * 31 + (el.version || 0) * 7 + (el.versionNonce || 0) + (el.isDeleted ? 1 : 0)) | 0;
  return `${(elements || []).length}:${h}:${Object.keys(files || {}).length}`;
}

/** appState worth keeping in the file (background, grid); the rest is per-session view state. */
export function keepAppState(a) {
  const o = {};
  if (a && a.viewBackgroundColor) o.viewBackgroundColor = a.viewBackgroundColor;
  if (a && a.gridSize != null) o.gridSize = a.gridSize;
  return o;
}
