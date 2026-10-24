import React, { useEffect, useState } from 'react';
import CommandPalette from './components/CommandPalette.jsx';
import { applyTextSize, applySettingsTheme, loadThemes } from './lib/themes.js';

const api = window.api;

/** The Cmd/Ctrl+K palette in its own floating window. Picking an item hands it to the main window to run. */
export default function PaletteWindow() {
  const [snap, setSnap] = useState({ chats: [], actions: [] });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    document.documentElement.classList.add('palette-page');
    const load = () => {
      api.getSettings().then((s) => { applyTextSize(s.textSize); loadThemes(api).then((t) => applySettingsTheme(s, t)); });
      api.paletteGet().then((s) => setSnap(s || { chats: [], actions: [] }));
      setNonce((n) => n + 1); // remount so the search box is empty and focused every time
    };
    load();
    return api.onPaletteShown(load);
  }, []);

  const run = (item) => api.paletteRun(item);
  const actions = snap.actions.map((a) => ({ ...a, run: () => run({ kind: 'action', id: a.id }) }));
  return (
    <CommandPalette key={nonce} open chats={snap.chats} actions={actions} onClose={() => api.paletteHide()}
      onOpenChat={(id) => run({ kind: 'chat', id })} onOpenNote={(p) => run({ kind: 'note', path: p })} />
  );
}
