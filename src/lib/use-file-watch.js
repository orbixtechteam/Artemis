import { useEffect, useRef } from 'react';

const api = window.api;

/**
 * Calls onChange({ path, gone }) when the file at `path` changes on disk (the assistant edited it, another app saved it).
 * quietMs: changes within this long after markSaved() are the viewer's own save and are ignored.
 * Returns markSaved(), to call right after the viewer writes the file itself.
 */
export function useFileWatch(path, onChange, { quietMs = 1500 } = {}) {
  const cb = useRef(onChange); cb.current = onChange;
  const savedAt = useRef(0);
  const real = useRef('');
  useEffect(() => {
    if (!path || !api || !api.watchFile) return undefined;
    let off = false;
    api.watchFile(path).then((abs) => { real.current = abs || path; });
    const stop = api.onFileChanged((d) => {
      if (off || !d || (d.path !== path && d.path !== real.current)) return;
      if (Date.now() - savedAt.current < quietMs) return;
      cb.current(d);
    });
    return () => { off = true; stop(); api.unwatchFile(path); };
  }, [path]);
  return () => { savedAt.current = Date.now(); };
}
