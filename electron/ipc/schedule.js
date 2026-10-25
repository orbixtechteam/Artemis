// IPC: schedule
module.exports = function registerScheduleIpc(deps) {
  const { ipcMain, scheduler } = deps;
  ipcMain.handle('schedule:list', () => scheduler.list());
  ipcMain.handle('schedule:save', (_e, job) => { try { return { ok: true, job: scheduler.save(job) }; } catch (e) { return { ok: false, error: e.message }; } });
  ipcMain.handle('schedule:toggle', (_e, id, enabled) => { scheduler.toggle(id, !!enabled); return true; });
  ipcMain.handle('schedule:delete', (_e, id) => { scheduler.remove(id); return true; });
  ipcMain.handle('schedule:preview', (_e, job) => { try { return { ok: true, ...require('../scheduler').preview(job || {}) }; } catch (e) { return { ok: false, error: e.message }; } });
  ipcMain.handle('schedule:run', (_e, id) => { scheduler.runNow(id); return true; });
};
