// IPC: Files library (everything attached to chats is stored here)
module.exports = function registerLibraryIpc({ ipcMain, BrowserWindow, dialog, shell, files, library, getWin }) {
  const safe = (fn) => async (_e, ...a) => { try { return { ok: true, ...(await fn(...a)) }; } catch (e) { return { ok: false, error: e.message }; } };
  const parentOf = (e) => BrowserWindow.fromWebContents(e.sender) || getWin();

  ipcMain.handle('library:root', () => library.root());
  ipcMain.handle('library:list', safe(() => ({ items: library.list() })));
  let libSeq = 0; // a newer query makes an older one stop (typing in the search box sends one per pause)
  ipcMain.handle('library:search', safe(async (q) => { const my = ++libSeq; return { results: await library.searchAsync(q, { isStale: () => my !== libSeq }) }; }));
  // pick files in a dialog and store them
  ipcMain.handle('library:add', async (e) => {
    try {
      const r = await dialog.showOpenDialog(parentOf(e), { properties: ['openFile', 'multiSelections'] });
      if (r.canceled) return { ok: true, items: [] };
      return { ok: true, items: r.filePaths.map((p) => library.describe(library.ingest(p).abs)) };
    } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('library:addPaths', safe((paths) => ({ items: (paths || []).map((p) => library.describe(library.ingest(p).abs)) })));
  ipcMain.handle('library:addBuffer', safe((name, bytes) => ({ item: library.addBuffer(name, bytes) })));
  // a library file as a chat attachment (text for the model, preview for the chip)
  ipcMain.handle('library:attach', safe(async (rel) => {
    const abs = library.abs(rel);
    const a = await files.parseAttachment(abs);
    return { attachment: { ...a, path: abs, lib: library.describe(abs).path } };
  }));
  ipcMain.handle('library:preview', safe(async (rel) => {
    const abs = library.abs(rel);
    const a = await files.parseAttachment(abs, 400000);
    return { file: { ...a, path: abs, lib: library.describe(abs).path } };
  }));
  ipcMain.handle('library:write', safe((rel, text) => ({ item: library.write(rel, text) })));
  ipcMain.handle('library:rename', safe((rel, name) => ({ item: library.rename(rel, name) })));
  ipcMain.handle('library:delete', safe((rel) => { library.remove(rel); return {}; }));
  ipcMain.handle('library:replace', async (e, rel) => {
    try {
      const r = await dialog.showOpenDialog(parentOf(e), { properties: ['openFile'], title: 'Choose the new version of this file' });
      if (r.canceled) return { ok: true, item: null };
      return { ok: true, item: library.replace(rel, r.filePaths[0]) };
    } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('library:open', safe(async (rel) => { const err = await shell.openPath(library.abs(rel)); if (err) throw new Error(err); return {}; }));
  ipcMain.handle('library:reveal', safe((rel) => { if (rel) shell.showItemInFolder(library.abs(rel)); else shell.openPath(library.root()); return {}; }));
  ipcMain.handle('library:abs', safe((rel) => ({ path: library.abs(rel) })));
};
