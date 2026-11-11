// IPC: plugins (electron/plugins.js). The renderer lists them, switches them on and off, removes them and opens panels.
module.exports = function registerPluginsIpc({ ipcMain, shell, fs, plugins, pluginWindows }) {
  const pub = (p) => ({ slug: p.slug, name: p.name, description: p.description || '', version: p.version || '', ok: p.ok, error: p.error || '', enabled: p.enabled,
    tools: (p.tools || []).map((t) => ({ name: t.name, description: t.description })), panels: (p.panels || []).map((x) => ({ id: x.id, title: x.title, path: require('path').join(p.root, x.file) })) });
  ipcMain.handle('plugins:list', () => plugins.list().map(pub));
  ipcMain.handle('plugins:toggle', (_e, slug, on) => { plugins.setEnabled(String(slug), !!on); return true; });
  ipcMain.handle('plugins:remove', (_e, slug) => { if (pluginWindows) pluginWindows.closeFor(String(slug)); return plugins.remove(String(slug)); }); // its connector grants go with it (main.js clears pluginConnectors on the next approve)
  ipcMain.handle('plugins:open', (_e, slug, panelId) => (pluginWindows ? pluginWindows.openWindow(String(slug), panelId ? String(panelId) : '') : { ok: false, error: 'Plugin windows are not available.' }));
  ipcMain.handle('plugins:panel', (_e, slug, id) => { try { return plugins.panel(String(slug), String(id || '')); } catch (e) { return { error: e.message }; } });
  ipcMain.handle('plugins:reveal', () => { fs.mkdirSync(plugins.dir, { recursive: true }); shell.openPath(plugins.dir); return true; });
};
