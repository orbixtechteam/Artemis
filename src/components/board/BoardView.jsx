import React, { useEffect, useRef, useState } from 'react';
import { Excalidraw, serializeAsJSON, MainMenu, restoreElements } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import { useFileWatch } from '../../lib/use-file-watch.js';
import { parseScene, sceneKey, keepAppState } from '../../lib/board-scene.mjs';
import { useScheme } from '../../lib/use-scheme.js';

const api = window.api;
const SAVE_MS = 900;
// fonts ship with the app (vite.config.mjs copies them next to index.html), never from a CDN
if (typeof window !== 'undefined' && !window.EXCALIDRAW_ASSET_PATH) window.EXCALIDRAW_ASSET_PATH = new URL('./excalidraw/', window.location.href).href;

/**
 * An .excalidraw file as a whiteboard: draw, autosave, follow the app theme, and reload when the assistant rewrites
 * the file (it writes plain Excalidraw JSON with write_file).
 */
export default function BoardView({ path }) {
  const scheme = useScheme();
  const [init, setInit] = useState(null);
  const [status, setStatus] = useState(null);
  const ex = useRef(null), key = useRef(''), timer = useRef(0), dirty = useRef(false), pending = useRef(null);

  useEffect(() => {
    let off = false;
    api.readTextFile(path).then((r) => {
      if (off) return;
      const p = r && r.ok ? parseScene(r.text) : { ok: false, error: (r && r.error) || 'Could not open this whiteboard.' };
      if (!p.ok) { setInit({ error: p.error }); return; }
      key.current = sceneKey(p.scene.elements, p.scene.files);
      setInit({ elements: p.scene.elements, appState: { ...p.scene.appState, theme: undefined }, files: p.scene.files, scrollToContent: true });
    });
    return () => { off = true; };
  }, [path]);

  const save = async () => {
    const s = pending.current; if (!s) return;
    pending.current = null; setStatus('Saving…'); markSaved();
    const text = serializeAsJSON(s.elements, keepAppState(s.appState), s.files, 'local');
    const r = await api.writeTextFile(path, text);
    dirty.current = !!pending.current;
    setStatus(r && r.ok ? 'Saved' : (r && r.error) || 'Could not save');
  };
  const onChange = (elements, appState, files) => {
    const k = sceneKey(elements, files);
    if (k === key.current) return; // a pan, zoom or selection: nothing to save
    key.current = k; dirty.current = true; pending.current = { elements, appState, files };
    setStatus('Unsaved'); clearTimeout(timer.current); timer.current = setTimeout(save, SAVE_MS);
  };
  useEffect(() => () => { clearTimeout(timer.current); if (pending.current) save(); }, []);

  const markSaved = useFileWatch(path, ({ gone }) => {
    if (gone || dirty.current || !ex.current) return;
    api.readTextFile(path).then((r) => {
      const p = r && r.ok ? parseScene(r.text) : null;
      if (!p || !p.ok) return;
      key.current = sceneKey(p.scene.elements, p.scene.files);
      const files = Object.values(p.scene.files || {});
      if (files.length) ex.current.addFiles(files);
      ex.current.updateScene({ elements: restoreElements(p.scene.elements, null, { repairBindings: true }) }); // fills fields the assistant left out
      setStatus('Updated');
    });
  });

  if (!init) return <div className="pdfv-msg">Opening…</div>;
  if (init.error) return <div className="pdfv-msg">{init.error}</div>;
  return (
    <div className="board">
      <Excalidraw initialData={init} theme={scheme === 'dark' ? 'dark' : 'light'} excalidrawAPI={(a) => { ex.current = a; }} onChange={onChange}
        UIOptions={{ canvasActions: { toggleTheme: false, changeViewBackgroundColor: true, export: { saveFileToDisk: true }, loadScene: false, saveToActiveFile: false } }}>
        <MainMenu>
          <MainMenu.DefaultItems.Export />
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.Separator />
          <MainMenu.DefaultItems.ChangeCanvasBackground />
        </MainMenu>
      </Excalidraw>
      {status && <span className="board-status" role="status">{status}</span>}
    </div>
  );
}
