// IPC: sheet
module.exports = function registerSheetIpc(deps) {
  const { ipcMain, BrowserWindow, dialog, files, sheetMeta } = deps;
  ipcMain.handle('sheet:load', (_e, p) => { try { return { ok: true, ...files.loadSheets(p) }; } catch (e) { return { ok: false, error: e.message }; } });
  ipcMain.handle('sheet:save', (_e, p, sheets, opts) => { try { return { ok: true, ...files.saveSheets(p, sheets, opts || {}) }; } catch (e) { return { ok: false, error: e.message }; } });
  ipcMain.handle('sheet:meta-load', (_e, p) => { try { return { ok: true, meta: sheetMeta.load(p) }; } catch (e) { return { ok: false, error: e.message }; } });
  ipcMain.handle('sheet:meta-save', (_e, p, meta) => { try { sheetMeta.save(p, meta); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; } });
  ipcMain.handle('sheet:save-as', async (e, sheets, suggested, opts) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showSaveDialog(w, { defaultPath: suggested || 'table.xlsx', filters: [{ name: 'Spreadsheet', extensions: ['xlsx', 'csv', 'tsv', 'xls', 'xlsb', 'ods'] }] });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    try {
      const out = files.saveSheets(r.filePath, sheets, { ...(opts || {}), backup: false });
      if (opts && opts.from) { try { sheetMeta.copy(opts.from, r.filePath); } catch {} }
      return { ok: true, path: r.filePath, ...out };
    } catch (err) { return { ok: false, error: err.message }; }
  });
};
