// IPC: app updates (see electron/updater.js). The state is pushed to the window as 'update:status'; the channels that download or install are blocked while the app is locked (electron/lock.js).
module.exports = function registerUpdateIpc({ ipcMain, updater, shell, app, getWin }) {
  ipcMain.handle('update:status', () => updater.status());
  ipcMain.handle('update:check', () => updater.check({ manual: true }));
  ipcMain.handle('update:download', () => updater.download());
  // "Restart and update": the installer starts when the app has quit, then opens the new version
  ipcMain.handle('update:install', () => {
    if (!updater.restartNow()) return { ok: false, error: (updater.target().why) || 'There is no downloaded update to install.' };
    setTimeout(() => { try { app.quit(); } catch {} }, 100);
    return { ok: true };
  });
  ipcMain.handle('update:open-release', () => {
    const st = updater.status();
    const url = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\//.test(st.page || '') ? st.page : `https://github.com/${st.repo}/releases`;
    try { shell.openExternal(url); return true; } catch { return false; }
  });
};
