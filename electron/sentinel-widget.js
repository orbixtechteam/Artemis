// Sentinel widget: a small always-on-top window that shows what Sentinel is doing. It stays visible when the main
// window is minimized or hidden, can be dragged anywhere, and remembers where you left it.
const path = require('path');

// The widget grows and shrinks from the corner it sits in: near the bottom of the screen it grows upwards, near the right edge to the left,
// so the spot the user dragged it to stays put. Always kept fully on the screen.
function fitBounds(cur, size, wa, margin = 4) {
  const width = Math.round(Math.min(size.width, wa.width - margin * 2));
  const height = Math.round(Math.min(size.height, wa.height - margin * 2));
  const cw = cur.width || width, ch = cur.height || height;
  const relX = (cur.x + cw / 2 - wa.x) / wa.width, relY = (cur.y + ch / 2 - wa.y) / wa.height;
  let x = relX < 1 / 3 ? cur.x : relX > 2 / 3 ? cur.x + cw - width : cur.x + cw / 2 - width / 2;
  let y = relY > 0.5 ? cur.y + ch - height : cur.y;
  x = Math.min(Math.max(x, wa.x + margin), wa.x + wa.width - width - margin);
  y = Math.min(Math.max(y, wa.y + margin), wa.y + wa.height - height - margin);
  return { x: Math.round(x), y: Math.round(y), width, height };
}

/** Where "move the widget left / right / up / down" puts it, on the screen it is on now. */
function placeAt(cur, side, wa, margin = 12) {
  const b = { ...cur };
  if (side === 'left') b.x = wa.x + margin;
  else if (side === 'right') b.x = wa.x + wa.width - cur.width - margin;
  else if (side === 'up' || side === 'top') b.y = wa.y + margin;
  else if (side === 'down' || side === 'bottom') b.y = wa.y + wa.height - cur.height - margin;
  else if (side === 'center') { b.x = Math.round(wa.x + (wa.width - cur.width) / 2); b.y = wa.y + margin; }
  return fitBounds(b, { width: cur.width, height: cur.height }, wa, 0);
}

const SIZES = { compact: { width: 300, maxH: 380 }, expanded: { width: 590, maxH: 425 }, viewer: { width: 720, maxH: 640 } };
// The expanded card (mini chat) and the viewer (an artifact or a file) have a fixed size the user picks: S, M or L.
// The viewer is also capped to a share of the screen (frac), so a big preset never covers a small screen.
const PRESETS = {
  expanded: { S: { width: 480, height: 360 }, M: { width: 590, height: 425 }, L: { width: 760, height: 580 } },
  viewer: { S: { width: 560, height: 480, frac: 0.5 }, M: { width: 720, height: 640, frac: 0.6 }, L: { width: 960, height: 820, frac: 0.85 } }
};
const MIN_H = 48;

/**
 * How big the widget should be. mode: 'compact' (the pill, as tall as its content `h`), 'expanded' (the mini chat) or 'viewer'.
 * size: 'S' | 'M' | 'L'. wa: the work area of the screen it is on. Pure, so it can be tested.
 */
function sizeFor(mode, size, h, wa) {
  if (mode === true) mode = 'expanded'; // older callers sent "wide"
  if (mode === 'expanded' || mode === 'viewer') {
    const p = PRESETS[mode][size] || PRESETS[mode].M;
    let { width, height } = p;
    if (p.frac && wa) {
      width = Math.min(width, Math.max(SIZES.expanded.width, Math.floor(wa.width * p.frac)));
      height = Math.min(height, Math.max(SIZES.expanded.maxH * 0.8, Math.floor(wa.height * Math.min(0.9, p.frac + 0.2))));
    }
    return { width: Math.round(width), height: Math.round(height) };
  }
  return { width: SIZES.compact.width, height: Math.max(MIN_H, Math.min(SIZES.compact.maxH, Math.round(Number(h) || MIN_H))) };
}

function createSentinelWidget({ BrowserWindow, screen, isDev, getPos, setPos, getSizes, setSizes }) {
  let w = null; let moveTimer = null; let selfMoveUntil = 0;
  let curMode = 'compact'; let grip = null;
  const userSize = (() => { const o = (getSizes && getSizes()) || {}; const r = {}; for (const m of ['expanded', 'viewer']) if (o[m] && o[m].width > 0 && o[m].height > 0) r[m] = { width: Math.round(o[m].width), height: Math.round(o[m].height) }; return r; })();
  const WIDTH = SIZES.compact.width;
  const alive = () => !!w && !w.isDestroyed();
  const areaOf = (b) => screen.getDisplayNearestPoint({ x: Math.round(b.x + (b.width || 0) / 2), y: Math.round(b.y + (b.height || 0) / 2) }).workArea;

  function startPos() {
    const saved = getPos && getPos();
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      // keep it on a screen that still exists, anchored the way it was left
      const cur = { x: saved.x, y: saved.y, width: Number(saved.width) || WIDTH, height: Number(saved.height) || MIN_H };
      return fitBounds(cur, { width: WIDTH, height: MIN_H }, areaOf(cur));
    }
    const wa = screen.getPrimaryDisplay().workArea;
    return { x: Math.round(wa.x + (wa.width - WIDTH) / 2), y: wa.y + 12 };
  }

  function create() {
    const p = startPos();
    w = new BrowserWindow({
      width: WIDTH, height: MIN_H, x: p.x, y: p.y, frame: false, transparent: true, resizable: false, movable: true, alwaysOnTop: true,
      skipTaskbar: true, show: false, hasShadow: false, fullscreenable: false, minimizable: false, maximizable: false, focusable: true,
      backgroundColor: '#00000000',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
    });
    w.setAlwaysOnTop(true, 'screen-saver');
    try { w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true }); } catch {}
    if (isDev) w.loadURL('http://localhost:5173/#sentinel');
    else w.loadFile(path.join(__dirname, '..', 'dist', 'renderer', 'index.html'), { hash: 'sentinel' });
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    w.on('move', () => {
      clearTimeout(moveTimer);
      if (Date.now() < selfMoveUntil) return; // our own grow / shrink, not a drag
      moveTimer = setTimeout(() => { if (alive() && setPos && Date.now() >= selfMoveUntil) setPos(w.getBounds()); }, 400);
    });
    w.on('closed', () => { w = null; });
  }

  function show() {
    if (!alive()) create();
    const go = () => { if (alive() && !w.isVisible()) w.showInactive(); };
    if (w.webContents.isLoading()) w.webContents.once('did-finish-load', go); else go();
  }
  /** Shows the widget and gives it the keyboard (the shortcut / tray open it to type or search, not just to look at it). */
  function focus() {
    if (!alive()) create();
    const go = () => { if (!alive()) return; try { w.show(); w.focus(); } catch {} };
    if (w.webContents.isLoading()) w.webContents.once('did-finish-load', go); else go();
  }
  /** Like send, but waits for the page when the window was just created. */
  function sendWhenReady(channel, payload) {
    if (!alive()) return;
    const go = () => { if (alive()) w.webContents.send(channel, payload); };
    if (w.webContents.isLoading()) w.webContents.once('did-finish-load', () => setTimeout(go, 80)); else go();
  }
  /** Quick chat / Search opened from the shortcut: the widget starts in the middle of the screen the mouse is on, near the top, at its chat size. */
  function center() {
    if (!alive()) create();
    const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const mine = userSize.expanded || PRESETS.expanded.M;
    const width = Math.round(Math.min(mine.width, wa.width - 8)), height = Math.round(Math.min(mine.height, wa.height - 8));
    selfMoveUntil = Date.now() + 700;
    w.setResizable(true);
    w.setBounds({ x: Math.round(wa.x + (wa.width - width) / 2), y: Math.round(wa.y + Math.min(wa.height * 0.16, Math.max(4, wa.height - height - 4))), width, height });
    w.setResizable(false);
  }
  function hide() { if (alive()) w.hide(); }
  function destroy() { clearTimeout(resizeTimer); clearTimeout(moveTimer); resizeTimer = null; if (alive()) w.destroy(); w = null; }
  function send(channel, payload) { if (alive() && !w.webContents.isLoading()) w.webContents.send(channel, payload); }
  function apply(b) {
    const cur = w.getBounds();
    if (cur.x === b.x && cur.y === b.y && cur.width === b.width && cur.height === b.height) return;
    selfMoveUntil = Date.now() + 700;
    w.setResizable(true);
    w.setBounds(b); // not animated: the growing animation showed a half-sized card with cut-off content
    w.setResizable(false);
  }
  /** The page reports how tall its content is, its mode (the compact pill, the expanded chat or the viewer) and the S / M / L size. */
  // Reports come in bursts (every render of the page); the last one wins, applied at most ~20 times a second.
  let resizeTimer = null; let resizeArgs = null;
  function resize(h, mode, size) {
    resizeArgs = [h, mode, size];
    if (resizeTimer) return;
    resizeTimer = setTimeout(() => { resizeTimer = null; const a = resizeArgs; resizeArgs = null; if (a) resizeNow(...a); }, 50);
  }
  function resizeNow(h, mode, size) {
    if (!alive()) return;
    if (mode === true) mode = 'expanded';
    curMode = mode === 'expanded' || mode === 'viewer' ? mode : 'compact';
    if (grip && Date.now() - grip.t < 4000) return; // the user is dragging the corner right now (a drag whose end was lost does not block the widget for ever)
    grip = null;
    const cur = w.getBounds();
    const wa = areaOf(cur);
    const mine = userSize[curMode];
    // the pill's height jitters by a pixel while text wraps: not worth moving a native window for
    if (curMode === 'compact' && cur.width === WIDTH && Math.abs(cur.height - sizeFor('compact', size, h, wa).height) <= 1) return;
    apply(fitBounds(cur, mine ? { width: Math.min(mine.width, wa.width - 8), height: Math.min(mine.height, wa.height - 8) } : sizeFor(mode, size, h, wa), wa));
  }
  /** The corner handle: the user drags to make the widget as big or small as they want; the size is remembered per mode. */
  function gripStart() { if (!alive() || curMode === 'compact') return; grip = { b: w.getBounds(), t: Date.now() }; }
  function gripMove(dx, dy) {
    if (!alive() || !grip) return;
    grip.t = Date.now();
    const wa = areaOf(grip.b);
    const width = Math.round(Math.max(300, Math.min(wa.width - 8, grip.b.width + dx)));
    const height = Math.round(Math.max(180, Math.min(wa.height - 8, grip.b.height + dy)));
    const x = Math.min(grip.b.x, wa.x + wa.width - width - 4), y = Math.min(grip.b.y, wa.y + wa.height - height - 4);
    selfMoveUntil = Date.now() + 700;
    w.setResizable(true); w.setBounds({ x, y, width, height }); w.setResizable(false);
  }
  function gripEnd() {
    if (!alive() || !grip) return;
    const b = w.getBounds(); grip = null;
    userSize[curMode] = { width: b.width, height: b.height };
    if (setSizes) setSizes({ ...userSize });
    if (setPos) setPos(b);
  }
  /** Back to the S / M / L presets (the size button was clicked). */
  function gripReset(mode) { if (mode === 'expanded' || mode === 'viewer') { delete userSize[mode]; if (setSizes) setSizes({ ...userSize }); } }
  /** "Move the widget left": to that edge of the screen it is on. */
  function moveTo(side) {
    if (!alive()) return false;
    const cur = w.getBounds();
    const b = placeAt(cur, side, areaOf(cur));
    apply(b);
    if (setPos) setPos(b);
    return true;
  }
  return { show, focus, hide, destroy, send, sendWhenReady, resize, moveTo, center, gripStart, gripMove, gripEnd, gripReset, isVisible: () => alive() && w.isVisible(), get window() { return alive() ? w : null; } };
}

module.exports = { createSentinelWidget, fitBounds, placeAt, sizeFor, SIZES, PRESETS };
