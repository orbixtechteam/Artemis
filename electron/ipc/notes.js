// IPC: notes
module.exports = function registerNotesIpc({ ipcMain, dialog, shell, notesStore, library, files, readJson, writeJson, getWin }) {
  const notesSafe = (fn) => async (_e, ...a) => { try { return { ok: true, ...(await fn(...a)) }; } catch (e) { return { ok: false, error: e.message }; } };
  ipcMain.handle('notes:root', () => notesStore.root());
  // a note as a chat attachment (its text goes to the model, like any attached file)
  ipcMain.handle('notes:attach', notesSafe(async (rel) => {
    const path = require('path');
    const base = path.resolve(notesStore.root());
    const abs = path.resolve(base, String(rel || ''));
    if (!abs.startsWith(base + path.sep)) throw new Error('That note is outside the Notes folder.');
    const a = await files.parseAttachment(abs);
    return { attachment: { ...a, path: abs, note: String(rel) } };
  }));
  ipcMain.handle('notes:pickRoot', async () => {
    const r = await dialog.showOpenDialog(getWin(), { title: 'Choose the Notes folder', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    writeJson('settings', { ...readJson('settings', {}), notesFolder: r.filePaths[0] });
    return r.filePaths[0];
  });
  ipcMain.handle('notes:list', notesSafe(() => ({ items: notesStore.list() })));
  ipcMain.handle('notes:read', notesSafe((p) => notesStore.read(p, { max: 2e6 })));
  ipcMain.handle('notes:write', notesSafe((p, t) => notesStore.write(p, t)));
  ipcMain.handle('notes:create', notesSafe((n, f, t) => notesStore.create(n, f, t)));
  ipcMain.handle('notes:createFolder', notesSafe((n, f) => notesStore.createFolder(n, f)));
  ipcMain.handle('notes:rename', notesSafe((p, n) => notesStore.rename(p, n)));
  ipcMain.handle('notes:move', notesSafe((p, f) => notesStore.move(p, f)));
  ipcMain.handle('notes:delete', notesSafe((p) => { notesStore.remove(p); return {}; }));
  let noteSeq = 0; // a newer query makes an older one stop
  ipcMain.handle('notes:search', notesSafe(async (q) => { const my = ++noteSeq; return { results: await notesStore.searchAsync(q, { isStale: () => my !== noteSeq }) }; }));
  ipcMain.handle('notes:graph', notesSafe(() => notesStore.graph()));
  // a file dropped into a note stays next to the note and is also kept in the Files library
  ipcMain.handle('notes:saveAsset', notesSafe((p, n, b) => {
    const r = notesStore.saveAsset(p, n, b);
    try { if (library) library.ingest(require('path').join(notesStore.root(), r.path)); } catch {}
    return r;
  }));
  ipcMain.handle('notes:asset', notesSafe((p, l) => notesStore.readAsset(p, l)));
  ipcMain.handle('notes:reveal', () => { shell.openPath(notesStore.root()); return true; });
};
