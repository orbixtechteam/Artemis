// IPC: heartbeat and webhooks (the Scheduled page)
module.exports = function registerAutomationIpc(d) {
  const { ipcMain, heartbeat, heartbeatTools, hooks, hooksInfo, hookUrls, hookService, saveSettings, setSecret, headlessActive } = d;
  const wrap = (f) => async (...a) => { try { return { ok: true, ...(await f(...a)) }; } catch (e) { return { ok: false, error: (e && e.message) || String(e) }; } };
  const resync = () => { if (!headlessActive()) hookService.sync().catch(() => {}); }; // the headless gateway picks up settings by itself

  ipcMain.handle('heartbeat:status', wrap(() => ({ status: heartbeatTools.status(), headless: headlessActive() })));
  ipcMain.handle('heartbeat:set', wrap((_e, o = {}) => {
    const patch = {};
    if (o.model !== undefined) patch.heartbeatModel = String(o.model || '');
    if (o.phone !== undefined) patch.heartbeatPhone = !!o.phone;
    if (Object.keys(patch).length) saveSettings(patch);
    return { status: heartbeatTools.set(o) };
  }));
  ipcMain.handle('heartbeat:run', wrap(async () => {
    if (headlessActive()) throw new Error('The headless gateway runs the heartbeat now; it checks at the next interval.');
    return { result: await heartbeat.beat() };
  }));

  const withUrls = () => { const info = hooksInfo(); return { info, hooks: hooks.list().map((h) => ({ ...h, urls: hookUrls(h, info) })) }; };
  ipcMain.handle('hooks:list', wrap(() => withUrls()));
  ipcMain.handle('hooks:save', wrap((_e, h) => ({ hook: hooks.save(h || {}), ...withUrls() })));
  ipcMain.handle('hooks:delete', wrap((_e, id) => { hooks.remove(String(id)); return withUrls(); }));
  ipcMain.handle('hooks:secret', wrap((_e, id) => { hooks.newSecret(String(id)); return withUrls(); }));
  ipcMain.handle('hooks:set', wrap(async (_e, o = {}) => {
    const patch = {};
    if (o.enabled !== undefined) patch.hooksEnabled = !!o.enabled;
    if (o.port !== undefined) { const p = Number(o.port); if (!(p >= 1024 && p <= 65535)) throw new Error('Pick a port between 1024 and 65535.'); patch.hooksPort = p; }
    if (o.tunnel !== undefined) { if (!['off', 'quick', 'named'].includes(o.tunnel)) throw new Error('Unknown tunnel mode.'); patch.hooksTunnel = o.tunnel; }
    if (o.publicUrl !== undefined) { const u = String(o.publicUrl || '').trim().replace(/\/+$/, ''); if (u && !/^https:\/\/[^\s/]+(\/[^\s]*)?$/i.test(u)) throw new Error('The public address must start with https://'); patch.hooksPublicUrl = u; }
    if (typeof o.tunnelToken === 'string' && o.tunnelToken.trim()) setSecret('hooksTunnelToken', o.tunnelToken.trim());
    if (Object.keys(patch).length) saveSettings(patch);
    resync();
    await new Promise((r) => setTimeout(r, 300));
    return withUrls();
  }));
};
