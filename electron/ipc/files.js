// IPC: files
module.exports = function registerFilesIpc(deps) {
  const { ipcMain, BrowserWindow, app, defaultFilesDir, dialog, files, tools, library, media, getWin, links, linkSensitive, shell } = deps;
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
  // ---- links the assistant wrote: a path relative to the project, then the Files folder; absolute, ~/ and file:// too
  const linkRoots = (folder) => [...new Set([folder, defaultFilesDir(), library ? library.root() : ''].filter(Boolean))]; // the project, then the default work folder chats without a project write to, then Files
  const resolve = (folder, href) => links.resolveLink(href, { roots: linkRoots(folder), isSensitive: linkSensitive });
  ipcMain.handle('files:resolve-link', (_e, folder, href) => {
    const r = resolve(folder, href);
    return r.error ? { ok: false, error: r.error } : { ok: true, path: r.abs, dir: !!r.dir, mime: r.mime || '', size: r.size || 0, url: r.mime ? links.urlFor(r.abs) : '' };
  });
  ipcMain.handle('files:open-link', async (_e, folder, href) => {
    const r = resolve(folder, href);
    if (r.error) return { name: String(href), kind: 'error', error: r.error };
    if (r.dir) { shell.openPath(r.abs); return null; }
    try { return { ...(await files.parseAttachment(r.abs, 400000)), path: r.abs }; } catch (e) { return { name: String(href), kind: 'error', error: e.message }; }
  });
  // A Word document as HTML for the document viewer (headings, lists, tables, images inline). mammoth escapes text and
  // emits no scripts; images become data URLs. Protected paths are refused like links.
  ipcMain.handle('files:docx-html', async (_e, abs) => {
    try {
      const fs = require('fs');
      const real = fs.realpathSync(String(abs || ''));
      if (linkSensitive(real)) return { ok: false, error: 'This file is in a protected location.' };
      if (fs.statSync(real).size > 60 * 1024 * 1024) return { ok: false, error: 'This document is too large to preview (60 MB limit).' };
      const mammoth = require('mammoth');
      const r = await mammoth.convertToHtml({ path: real }, { styleMap: ["p[style-name='Title'] => h1.doc-title:fresh", "p[style-name='Subtitle'] => p.doc-subtitle:fresh"] });
      return { ok: true, html: r.value, warnings: (r.messages || []).filter((m) => m.type === 'error').length };
    } catch (err) { return { ok: false, error: err.message }; }
  });
  // ---- open viewers follow their file: an outside change (the assistant, another app) reloads them
  const watcher = require('../file-watch').createFileWatch({
    onChange: (abs, gone) => { for (const w of BrowserWindow.getAllWindows()) { try { w.webContents.send('files:changed', { path: abs, gone }); } catch {} } }
  });
  ipcMain.handle('files:watch', (_e, abs) => { try { return watcher.watch(abs); } catch { return ''; } });
  ipcMain.handle('files:unwatch', (_e, abs) => { try { watcher.unwatch(abs); } catch {} return true; });
  app.on('will-quit', () => watcher.closeAll());
  // Text-like files the editors save in place (documents, whiteboards). Protected paths are refused.
  const TEXT_SAVE = /\.(md|markdown|txt|excalidraw|json)$/i;
  ipcMain.handle('files:write-text', (_e, abs, text) => {
    try {
      const fs = require('fs'), path = require('path');
      const target = path.resolve(String(abs || ''));
      if (!TEXT_SAVE.test(target)) return { ok: false, error: 'Only documents and whiteboards are saved here.' };
      const real = fs.existsSync(target) ? fs.realpathSync(target) : target;
      if (linkSensitive(real)) return { ok: false, error: 'This file is in a protected location.' };
      fs.mkdirSync(path.dirname(real), { recursive: true });
      files.atomicWrite(real, Buffer.from(String(text), 'utf8'));
      watcher.touched(real);
      return { ok: true, path: real };
    } catch (err) { return { ok: false, error: err.message }; }
  });
  // A Word file saved from the Docs editor (electron/docx-write.js). The original is copied to <userData>/doc-backups once per
  // session before the first save, because Word-only details (fonts, page headers, comments) are not kept.
  const backedUp = new Set();
  ipcMain.handle('files:docx-write', async (_e, abs, json) => {
    try {
      const fs = require('fs'), path = require('path');
      const target = path.resolve(String(abs || ''));
      if (!/\.docx$/i.test(target)) return { ok: false, error: 'Only .docx files are saved here.' };
      const real = fs.existsSync(target) ? fs.realpathSync(target) : target;
      if (linkSensitive(real)) return { ok: false, error: 'This file is in a protected location.' };
      if (fs.existsSync(real) && !backedUp.has(real)) {
        const dir = path.join(app.getPath('userData'), 'doc-backups'); fs.mkdirSync(dir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        fs.copyFileSync(real, path.join(dir, `${path.basename(real, '.docx')}-${stamp}.docx`));
        backedUp.add(real);
      }
      const readLocal = (src) => { // images given as paths: relative to the document, never from protected places
        const p = path.resolve(path.dirname(real), String(src).replace(/^file:\/\//i, ''));
        const rp = fs.realpathSync(p); if (linkSensitive(rp) || fs.statSync(rp).size > 20 * 1024 * 1024) return null;
        return fs.readFileSync(rp);
      };
      const buf = await require('../docx-write').docxFromDoc(json, { readLocal, title: path.basename(real, '.docx') });
      files.atomicWrite(real, buf);
      watcher.touched(real);
      return { ok: true, path: real };
    } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('files:read-text', (_e, abs) => {
    try {
      const fs = require('fs');
      const real = fs.realpathSync(String(abs || ''));
      if (linkSensitive(real)) return { ok: false, error: 'This file is in a protected location.' };
      if (fs.statSync(real).size > 20 * 1024 * 1024) return { ok: false, error: 'This file is too large to open here (20 MB).' };
      return { ok: true, text: fs.readFileSync(real, 'utf8'), path: real };
    } catch (err) { return { ok: false, error: err.message }; }
  });
  // A binary file's bytes for a viewer (PDF). Not fetch(artemis-file://): from the app page that is a cross-origin request and fails.
  ipcMain.handle('files:read-bytes', (_e, abs) => {
    try {
      const fs = require('fs');
      const real = fs.realpathSync(String(abs || ''));
      if (linkSensitive(real)) return { ok: false, error: 'This file is in a protected location.' };
      if (fs.statSync(real).size > 200 * 1024 * 1024) return { ok: false, error: 'This file is too large to open here (200 MB).' };
      return { ok: true, bytes: fs.readFileSync(real) };
    } catch (err) { return { ok: false, error: err.code === 'ENOENT' ? 'This file no longer exists.' : err.message }; }
  });
  // Save a copy of a file somewhere else (the viewer's Download / Save as)
  ipcMain.handle('files:save-as', async (e, abs) => {
    try {
      const fs = require('fs'); const path = require('path');
      if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) return { ok: false, error: 'File not found.' };
      const parent = BrowserWindow.fromWebContents(e.sender) || getWin();
      const r = await dialog.showSaveDialog(parent, { defaultPath: path.join(app.getPath('downloads'), path.basename(abs)) });
      if (r.canceled || !r.filePath) return { ok: true, canceled: true };
      if (path.resolve(r.filePath) !== path.resolve(abs)) fs.copyFileSync(abs, r.filePath);
      return { ok: true, path: r.filePath };
    } catch (err) { return { ok: false, error: err.message }; }
  });
  // Drag a file out of the app (file cards, the viewer title)
  ipcMain.on('files:drag-out', (e, abs) => {
    try { if (abs && require('fs').existsSync(abs)) e.sender.startDrag({ file: abs, icon: app.getAppPath() ? require('path').join(app.getAppPath(), 'build', 'icon.png') : undefined }); } catch {}
  });
  ipcMain.handle('files:preview-project', async (_e, folder, rel) => {
    try { return await files.parseAttachment(tools.resolveSafe(folder, rel), 400000); } catch (e) { return { name: String(rel), kind: 'error', error: e.message }; }
  });
};
