// Watches files open in a viewer so it can reload when the assistant (or another app) changes them.
// One fs.watch per folder, shared by every watched file in it; events are debounced and compared by mtime + size,
// so an atomic write (temp file + rename) or a burst of writes reports one change.
const fs = require('fs');
const path = require('path');

function createFileWatch({ onChange, debounceMs = 250 }) {
  const dirs = new Map(); // dir -> { watcher, files: Map<abs, { refs, sig, timer }> }
  const sigOf = (abs) => { try { const st = fs.statSync(abs); return st.mtimeMs + ':' + st.size; } catch { return 'gone'; } };
  function check(dir, abs) {
    const d = dirs.get(dir); const f = d && d.files.get(abs); if (!f) return;
    clearTimeout(f.timer);
    f.timer = setTimeout(() => { const s = sigOf(abs); if (s !== f.sig) { f.sig = s; onChange(abs, s === 'gone'); } }, debounceMs);
  }
  function watch(abs0) {
    const abs = path.resolve(String(abs0)); const dir = path.dirname(abs);
    let d = dirs.get(dir);
    if (!d) {
      d = { files: new Map(), watcher: null };
      try { d.watcher = fs.watch(dir, { persistent: false }, (_ev, name) => { if (!name) { for (const a of d.files.keys()) check(dir, a); return; } const a = path.join(dir, String(name)); if (d.files.has(a)) check(dir, a); }); } catch {}
      if (d.watcher) d.watcher.on('error', () => {});
      dirs.set(dir, d);
    }
    const f = d.files.get(abs);
    if (f) f.refs++; else d.files.set(abs, { refs: 1, sig: sigOf(abs), timer: null });
    return abs;
  }
  function unwatch(abs0) {
    const abs = path.resolve(String(abs0)); const dir = path.dirname(abs); const d = dirs.get(dir); if (!d) return;
    const f = d.files.get(abs); if (!f) return;
    if (--f.refs <= 0) { clearTimeout(f.timer); d.files.delete(abs); }
    if (!d.files.size) { try { d.watcher && d.watcher.close(); } catch {} dirs.delete(dir); }
  }
  /** After the app itself saved a file: remember its new state so it is not reported back as an outside change. */
  function touched(abs0) { const abs = path.resolve(String(abs0)); const d = dirs.get(path.dirname(abs)); const f = d && d.files.get(abs); if (f) f.sig = sigOf(abs); }
  function closeAll() { for (const d of dirs.values()) { try { d.watcher && d.watcher.close(); } catch {} for (const f of d.files.values()) clearTimeout(f.timer); } dirs.clear(); }
  return { watch, unwatch, touched, closeAll, size: () => [...dirs.values()].reduce((n, d) => n + d.files.size, 0) };
}

module.exports = { createFileWatch };
