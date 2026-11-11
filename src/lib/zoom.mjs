// Zoom and pan math shared by the image lightbox and (later) the PDF and whiteboard views. Pure: scripts/test-zoom.js.
// A view is { scale, x, y }: the content's top-left corner sits at (x, y) in the box, drawn at `scale`.

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 16;
export const STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8];

export const clampScale = (s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

/** The view that fits content (w x h) inside the box, never enlarging past 100% unless `grow`. */
export function fitView(content, box, { pad = 24, grow = false } = {}) {
  const aw = Math.max(1, box.w - pad * 2), ah = Math.max(1, box.h - pad * 2);
  let scale = Math.min(aw / content.w, ah / content.h);
  if (!grow) scale = Math.min(1, scale);
  scale = clampScale(scale);
  return { scale, x: (box.w - content.w * scale) / 2, y: (box.h - content.h * scale) / 2 };
}

/** The content at a given scale, centred in the box. */
export function centeredView(content, box, scale) {
  const s = clampScale(scale);
  return { scale: s, x: (box.w - content.w * s) / 2, y: (box.h - content.h * s) / 2 };
}

/** Zoom by `factor` keeping the point (px, py) of the box still. */
export function zoomAt(view, factor, px, py) {
  const scale = clampScale(view.scale * factor);
  const k = scale / view.scale;
  return { scale, x: px - (px - view.x) * k, y: py - (py - view.y) * k };
}

/** The next preset step above or below the current scale (toolbar + / − buttons). */
export function stepScale(scale, dir) {
  if (dir > 0) return STEPS.find((s) => s > scale + 1e-6) || MAX_SCALE;
  return [...STEPS].reverse().find((s) => s < scale - 1e-6) || MIN_SCALE;
}

/** Keeps at least `keep` px of the content inside the box so it cannot be dragged away. */
export function clampPan(view, content, box, keep = 48) {
  const w = content.w * view.scale, h = content.h * view.scale;
  const x = Math.min(box.w - Math.min(keep, w), Math.max(Math.min(keep, w) - w, view.x));
  const y = Math.min(box.h - Math.min(keep, h), Math.max(Math.min(keep, h) - h, view.y));
  return { ...view, x, y };
}

/** Wheel / trackpad delta to a zoom factor (pinch arrives as ctrl+wheel with small deltas). */
export const wheelFactor = (deltaY, pinch) => Math.exp(-deltaY * (pinch ? 0.01 : 0.0015));
