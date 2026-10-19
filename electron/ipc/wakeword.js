// IPC: wake word engine (openWakeWord, see electron/wakeword.js). Sentinel starts it with a model, streams the microphone to it and is told when the phrase was heard.
// The channels that change what is on disk are blocked while the app is locked (electron/lock.js); start / feed / stop stay open so Sentinel can still hear its owner.
module.exports = function registerWakewordIpc({ ipcMain, wakeword, dialog, getWin }) {
  const send = (e, channel) => (pct, detail) => { try { e.sender.send(channel, { pct, detail }); } catch {} };
  ipcMain.handle('wakeword:status', () => wakeword.status());
  ipcMain.handle('wakeword:download', (e) => wakeword.download(send(e, 'wakeword:progress')));
  ipcMain.handle('wakeword:preset', (e, id) => wakeword.downloadPreset(String(id || ''), send(e, 'wakeword:progress')));
  ipcMain.handle('wakeword:import', async (e) => {
    const parent = (getWin && getWin()) || undefined;
    const r = await dialog.showOpenDialog(parent, { title: 'Pick a wake word model', properties: ['openFile'], filters: [{ name: 'openWakeWord model', extensions: ['onnx'] }] });
    if (r.canceled || !r.filePaths || !r.filePaths[0]) return { ok: false, canceled: true };
    return wakeword.importModel(r.filePaths[0]);
  });
  ipcMain.handle('wakeword:remove', (_e, id) => wakeword.removeModel(String(id || '')));
  ipcMain.handle('wakeword:start', (_e, o) => wakeword.start({ model: String((o && o.model) || ''), threshold: o && o.threshold }));
  ipcMain.handle('wakeword:feed', (_e, buf) => wakeword.feed(buf));
  ipcMain.handle('wakeword:stop', () => { wakeword.stop(); return true; });
};
