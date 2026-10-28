// IPC: files
module.exports = function registerFilesIpc(deps) {
  const { ipcMain, BrowserWindow, app, defaultFilesDir, dialog, files, tools, library, media, getWin } = deps;
  // An image goes to the window as a media link (core/mediastore.js), never as base64 kept in the chat.
  const linkImage = (att) => {
    if (!media || !att || att.kind !== 'image' || typeof att.dataUrl !== 'string') return att;
    try { const url = media.putDataUrl(att.dataUrl); if (url === att.dataUrl) return att; const { dataUrl, ...rest } = att; return { ...rest, url }; } catch { return att; }
  };
  // Every attachment is kept in the Files library: its path points at the stored copy, so it can be found, edited and re-used later.
  const keep = (att0) => {
    const att = linkImage(att0);
    if (!library || !att || att.kind === 'error' || !att.path) return att;
    try { const r = library.ingest(att.path); return { ...att, path: r.abs, lib: r.path }; } catch { return att; }
  };
  ipcMain.handle('files:pick', async (e) => {
    const parent = BrowserWindow.fromWebContents(e.sender) || getWin();
    const r = await dialog.showOpenDialog(parent, { properties: ['openFile', 'multiSelections'] });
    if (r.canceled) return [];
    return (await Promise.all(r.filePaths.map((p) => files.parseAttachment(p)))).map(keep);
  });
  ipcMain.handle('files:parse-buffer', async (_e, name, bytes) => keep(await files.parseBuffer(name, bytes, app.getPath('temp'))));
  ipcMain.handle('files:parse', async (_e, paths) => (await Promise.all((paths || []).map((p) => files.parseAttachment(p)))).map(keep));
  ipcMain.handle('files:default-folder', () => defaultFilesDir());
  ipcMain.handle('files:preview-project', async (_e, folder, rel) => {
    try { return await files.parseAttachment(tools.resolveSafe(folder, rel), 400000); } catch (e) { return { name: String(rel), kind: 'error', error: e.message }; }
  });
};
