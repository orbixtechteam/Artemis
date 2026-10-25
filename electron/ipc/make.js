// IPC: make
module.exports = function registerMakeIpc(deps) {
  const { ipcMain, MAKE_ZONES, cleanMakeZone, createMake, getSecret, getSettings, logger, make, makeReady, saveSettings, setSecret, validMakeZone } = deps;
  ipcMain.handle('make:save', (_e, { zone, token } = {}) => {
    const z = cleanMakeZone(zone || getSettings().makeZone || MAKE_ZONES[0]);
    if (!validMakeZone(z)) return { ok: false, error: 'The zone looks wrong. Use something like eu1.make.com (the address you see when you are logged in to Make).' };
    saveSettings({ makeZone: z });
    if (typeof token === 'string' && token.trim()) setSecret('makeToken', token.trim().replace(/^Token\s+/i, ''));
    if (typeof token === 'string' && token.trim()) logger.info('make', getSecret('makeToken') ? 'Make token saved' : 'Make token was saved but cannot be read back (Keychain / safeStorage)');
    return { ok: true, zone: z, hasToken: !!getSecret('makeToken') };
  });
  ipcMain.handle('make:clear', () => { setSecret('makeToken', ''); return { ok: true }; });
  ipcMain.handle('make:test', async (_e, { zone, token } = {}) => {
    const z = cleanMakeZone(zone || getSettings().makeZone);
    const t = (typeof token === 'string' && token.trim().replace(/^Token\s+/i, '')) || getSecret('makeToken');
    if (!validMakeZone(z)) return { ok: false, error: 'The zone looks wrong. Use something like eu1.make.com.' };
    if (!t) return { ok: false, error: 'Paste your Make API token first.' };
    try {
      const tmp = createMake({ getAuth: () => ({ token: t, zone: z }) });
      const orgs = await tmp.overview();
      return { ok: true, orgs };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('make:scenarios', async () => {
    if (!makeReady()) return { ok: false, notConnected: true, error: 'Make is not connected. Add your API token in Settings → Make.' };
    try { return { ok: true, ...(await make.listAll()) }; } catch (e) { logger.error('make', 'Listing scenarios failed: ' + e.message); return { ok: false, error: e.message }; }
  });
  ipcMain.handle('make:toggle', async (_e, { id, active } = {}) => {
    try { await make.actions.setActive({ id, active: !!active }); logger.info('make', `Scenario ${id} turned ${active ? 'on' : 'off'}`); return { ok: true }; } catch (e) { logger.error('make', 'Toggle failed: ' + e.message); return { ok: false, error: e.message }; }
  });
  ipcMain.handle('make:run', async (_e, { id } = {}) => {
    try { await make.actions.run({ id }); logger.info('make', `Scenario ${id} started`); return { ok: true }; } catch (e) { logger.error('make', 'Run failed: ' + e.message); return { ok: false, error: e.message }; }
  });
  ipcMain.handle('make:logs', async (_e, { id } = {}) => {
    try { return { ok: true, logs: await make.logs({ id, limit: 10 }) }; } catch (e) { return { ok: false, error: e.message }; }
  });
};
