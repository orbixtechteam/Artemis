// Plugin apps: every plugin opens in its own window and runs on its own, apart from any chat. The window loads the
// plugin from artemis-plugin://<slug>/ (its first panel, or a form per tool when it has none), with the plugin preload as
// its only bridge: its own tools (in the code sandbox), the connectors (MCP) it was allowed to use, its own data, links. Scoped by the sender: a window
// can never reach another plugin or the app.
const path = require('path');
const fs = require('fs');

const SCHEME = 'artemis-plugin';
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com; "
  + "style-src 'self' 'unsafe-inline' https:; img-src * data: blob:; font-src 'self' data: https:; media-src * data: blob:; connect-src https: wss:; frame-src 'none'; object-src 'none'; base-uri 'none'";
const MIME = { '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };

function createPluginWindows({ BrowserWindow, shell, plugins, pluginWebFetch, allowPrivate = () => false, appJs, mcp = () => null, approve = async () => false }) {
  const open = new Map(); // slug -> BrowserWindow
  const owner = new Map(); // webContents id -> slug
  const asked = new Map(); // slug|server -> Promise<boolean>: one question at a time per plugin and connector

  /** A connector call from a plugin window or one of its tools: the plugin must be allowed to use that connector
   *  (asked once; "always" is remembered by approve()). Goes through the same MCP manager as chats. */
  async function connectorCall(slug, name, args) {
    const m = mcp();
    if (!m) return { ok: false, text: 'Connectors are off (Settings → Connectors).' };
    const info = m.info(name);
    if (!info) return { ok: false, text: m.explainMissing ? m.explainMissing(name) : 'Connector tool not found: ' + name };
    const key = slug + '|' + info.server;
    if (!asked.has(key)) asked.set(key, Promise.resolve(approve({ slug, server: info.server, serverName: info.serverName, tool: name, readOnly: info.readOnly })).then((ok) => { if (!ok) asked.delete(key); return ok; }));
    if (!(await asked.get(key))) return { ok: false, text: `Not allowed: this plugin may not use ${info.serverName || info.server}.` };
    try { const r = await m.call(name, args || {}); return { ok: r.ok !== false, text: r.text }; }
    catch (err) { return { ok: false, text: String(err && err.message || err) }; }
  }
  const connectorNames = () => { const m = mcp(); return m ? m.definitions().map((d) => d.function.name) : []; };

  /** Serves artemis-plugin://<slug>/<file> from the plugin folder; __app__.html / __app__.js are the generated tool app. */
  function serve(req) {
    let u; try { u = new URL(req.url); } catch { return new Response('Bad request', { status: 400 }); }
    const slug = u.hostname, rel = decodeURIComponent(u.pathname.replace(/^\/+/, ''));
    const headers = (type) => ({ 'content-type': type, 'x-content-type-options': 'nosniff', 'content-security-policy': CSP, 'cache-control': 'no-cache' });
    if (rel === '__app__.js') return new Response(appJs, { headers: headers(MIME['.js']) });
    if (rel === '__app__.html') { const html = plugins.appPage(slug); return html ? new Response(html, { headers: headers(MIME['.html']) }) : new Response('Not found', { status: 404 }); }
    const abs = plugins.fileOf(slug, rel);
    const type = abs && MIME[path.extname(abs).toLowerCase()];
    if (!abs || !type) return new Response('Not found', { status: 404 });
    return new Response(fs.readFileSync(abs), { headers: headers(type) });
  }

  /** Opens (or focuses) a plugin's window; panelId picks one of its panels. */
  function openWindow(slug, panelId) {
    const p = plugins.list().find((x) => x.slug === slug && x.ok);
    if (!p) return { ok: false, error: 'This plugin is missing or broken.' };
    const panel = (panelId && p.panels.find((x) => x.id === panelId)) || p.panels[0];
    const url = `${SCHEME}://${slug}/${panel ? panel.file.split('/').map(encodeURIComponent).join('/') : '__app__.html'}`;
    const old = open.get(slug);
    if (old && !old.isDestroyed()) { if (old.webContents.getURL() !== url) old.loadURL(url); if (old.isMinimized()) old.restore(); old.focus(); return { ok: true }; }
    const w = new BrowserWindow({
      width: 1080, height: 760, minWidth: 420, minHeight: 320, title: p.name, show: false, backgroundColor: '#1a1a19',
      webPreferences: { preload: path.join(__dirname, 'plugin-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: true }
    });
    open.set(slug, w); owner.set(w.webContents.id, slug);
    const wcId = w.webContents.id;
    w.once('ready-to-show', () => w.show());
    w.on('closed', () => { open.delete(slug); owner.delete(wcId); });
    w.webContents.setWindowOpenHandler(({ url: target }) => { if (/^https?:/i.test(target)) shell.openExternal(target); return { action: 'deny' }; });
    w.webContents.on('will-navigate', (e, target) => { if (!target.startsWith(`${SCHEME}://${slug}/`)) { e.preventDefault(); if (/^https?:/i.test(target)) shell.openExternal(target); } });
    w.webContents.on('page-title-updated', (e) => { e.preventDefault(); w.setTitle(p.name); });
    w.loadURL(url);
    return { ok: true };
  }

  function registerIpc(ipcMain) {
    const slugOf = (e) => owner.get(e.sender.id) || null;
    ipcMain.handle('plugin-win:info', (e) => { const s = slugOf(e); const p = s && plugins.list().find((x) => x.slug === s); return p ? { name: p.name, slug: p.slug, version: p.version, tools: p.tools.map((t) => t.name) } : null; });
    ipcMain.handle('plugin-win:tool', async (e, name, args) => {
      const s = slugOf(e); if (!s) return { ok: false, text: 'Not a plugin window.' };
      try {
        const full = require('./plugins').fullName(s, name);
        return await plugins.run(full, args || {}, { web: (url, o) => pluginWebFetch(url, o, { allowPrivate: allowPrivate() }), names: connectorNames(), call: (n, a) => connectorCall(s, n, a) });
      } catch (err) { return { ok: false, text: String(err && err.message || err) }; }
    });
    ipcMain.handle('plugin-win:call', async (e, name, args) => { const s = slugOf(e); if (!s) return { ok: false, text: 'Not a plugin window.' }; return connectorCall(s, String(name || ''), args); });
    ipcMain.handle('plugin-win:connectors', (e) => { if (!slugOf(e)) return []; const m = mcp(); return m ? m.index().map((x) => ({ server: x.slug, name: x.name, tools: x.tools })) : []; });
    ipcMain.handle('plugin-win:data-get', (e, key) => { const s = slugOf(e); if (!s) return null; const all = plugins.dataAll(s); return key == null ? all : (all[key] ?? null); });
    ipcMain.handle('plugin-win:data-set', (e, key, value) => { const s = slugOf(e); if (!s) return false; return plugins.dataSet(s, key, value); });
    ipcMain.handle('plugin-win:open-external', (e, url) => { if (slugOf(e) && /^https?:/i.test(url)) shell.openExternal(url); return true; });
  }
  const closeFor = (slug) => { const w = open.get(slug); if (w && !w.isDestroyed()) w.close(); };
  return { serve, openWindow, registerIpc, closeFor, connectorCall, SCHEME };
}

module.exports = { createPluginWindows, SCHEME, CSP };
