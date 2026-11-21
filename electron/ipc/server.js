// IPC: Settings → Server.
//   This Mac as a server: remote access (the tunnel's hostname, web app origins), pairing codes and paired devices.
//   While the headless gateway runs on this data folder it owns the API, so the calls go to it (headlessFetch).
//   This Mac as a client: the link to another Artemis server (electron/server-link.js).
const cleanHosts = (v) => [...new Set(String(Array.isArray(v) ? v.join(',') : v || '').split(/[\s,]+/).map((h) => h.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '')).filter((h) => /^[a-z0-9.-]{1,253}$/.test(h) && h.includes('.')))].slice(0, 10);
const cleanOrigins = (v) => [...new Set(String(Array.isArray(v) ? v.join(',') : v || '').split(/[\s,]+/).map((o) => o.trim().replace(/\/+$/, '')).filter((o) => { try { const u = new URL(o); return (u.protocol === 'https:' || (u.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(u.hostname))) && u.pathname === '/' && !u.search; } catch { return false; } }).map((o) => new URL(o).origin))].slice(0, 10);

module.exports = function registerServerIpc(deps) {
  const { ipcMain, getSettings, saveSettings, clients, gatewayInfo, syncGateway, headlessActive, headlessFetch, link, logger, exporter, afterMigration, progress } = deps;
  let migrating = false;
  const viaHeadless = () => headlessActive();
  const err = (e) => ({ ok: false, error: (e && e.message) || String(e) });

  async function hostInfo() {
    const st = getSettings();
    const g = gatewayInfo();
    let list = [];
    try { list = viaHeadless() ? (await headlessFetch('/v1/clients')).clients : clients.list(); } catch (e) { logger.warn('server', 'paired devices: ' + e.message); }
    return { ok: true, publicHosts: cleanHosts(st.serverPublicHosts), allowedOrigins: cleanOrigins(st.serverAllowedOrigins), gatewayOn: !!(g.running || g.headless), headless: !!g.headless, inApp: !!g.running, port: g.port, clients: list };
  }

  ipcMain.handle('server:host-info', async () => { try { return await hostInfo(); } catch (e) { return err(e); } });
  ipcMain.handle('server:host-set', async (_e, o = {}) => {
    try {
      const patch = {};
      if (o.publicHosts !== undefined) patch.serverPublicHosts = cleanHosts(o.publicHosts).join(',');
      if (o.allowedOrigins !== undefined) patch.serverAllowedOrigins = cleanOrigins(o.allowedOrigins).join(',');
      saveSettings(patch);
      await syncGateway();
      return { ...(await hostInfo()), restartHeadless: viaHeadless() };
    } catch (e) { return err(e); }
  });
  ipcMain.handle('server:pair-code', async (_e, label) => {
    try {
      const g = gatewayInfo();
      if (viaHeadless()) return { ok: true, ...(await headlessFetch('/v1/pairing', { method: 'POST', body: { label: label || 'from the desktop app' } })) };
      if (!g.running) return { ok: false, error: 'Turn on the gateway first (Settings → Privacy & safety → Access → Gateway), or start the server.' };
      return { ok: true, ...clients.createPairing({ label: label || 'from the desktop app' }) };
    } catch (e) { return err(e); }
  });
  ipcMain.handle('server:client', async (_e, id, action, name) => {
    try {
      if (!/^[a-f0-9]{16}$/.test(String(id)) || !['revoke', 'remove', 'rename'].includes(action)) return { ok: false, error: 'Bad request' };
      if (viaHeadless()) {
        if (action === 'revoke') await headlessFetch(`/v1/clients/${id}/revoke`, { method: 'POST', body: {} });
        else if (action === 'remove') await headlessFetch(`/v1/clients/${id}`, { method: 'DELETE' });
        else await headlessFetch(`/v1/clients/${id}`, { method: 'POST', body: { name } });
      } else if (action === 'revoke') clients.revoke(id);
      else if (action === 'remove') clients.remove(id);
      else clients.rename(id, name);
      return hostInfo();
    } catch (e) { return err(e); }
  });

  ipcMain.handle('server:link-status', async () => { try { return { ok: true, ...(await link.status()) }; } catch (e) { return err(e); } });
  ipcMain.handle('server:link-connect', async (_e, o = {}) => { try { const cfg = await link.connect(o); return { ok: true, ...(await link.status()), config: cfg }; } catch (e) { return err(e); } });
  ipcMain.handle('server:migrate-survey', async () => { try { return { ok: true, survey: exporter().survey() }; } catch (e) { return err(e); } });
  ipcMain.handle('server:migrate-run', async (_e, o = {}) => {
    if (migrating) return { ok: false, error: 'A move is already running.' };
    migrating = true;
    const opts = { areas: Array.isArray(o.areas) ? o.areas : undefined, secrets: true /* everything moves, keys and sign-ins too */, telegram: o.telegram === 'move' ? 'move' : 'keep', automations: o.automations === 'move' ? 'move' : 'keep' };
    try {
      const st = await link.status();
      if (!st.online) return { ok: false, error: st.error || 'The server is not reachable.' };
      const mig = await exporter().run(opts, (p) => progress && progress(p));
      afterMigration(opts);
      logger.info('server', `data moved to ${st.url}: ${JSON.stringify({ chats: mig.report && mig.report.chats })}`);
      return { ok: true, migration: mig };
    } catch (e) { logger.warn('server', 'moving data failed: ' + e.message); return err(e); }
    finally { migrating = false; }
  });
  ipcMain.handle('server:link-disconnect', async (_e, o = {}) => { try { return await link.disconnect({ revoke: o.revoke !== false }); } catch (e) { return err(e); } });
};
module.exports.cleanHosts = cleanHosts;
module.exports.cleanOrigins = cleanOrigins;
