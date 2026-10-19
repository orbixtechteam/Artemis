// IPC for the app lock (Settings → Security, the lock screen) and for speaker recognition. These channels are never blocked while locked
// (electron/lock.js: isBlockedChannel), because the lock screen itself needs them.
module.exports = function registerLockIpc({ ipcMain, lock, speaker, voiceGate, lockAuthWaiting, snapWaiting, logger, testAlert }) {
  const auth = (a) => (a && typeof a === 'object' ? { password: a.password, touchid: !!a.touchid } : {});
  const bytes = (v) => (v instanceof ArrayBuffer ? Buffer.from(v) : Buffer.isBuffer(v) ? v : v && v.buffer ? Buffer.from(v.buffer, v.byteOffset, v.byteLength) : Buffer.alloc(0));
  // while locked only the lock screen's own calls work: nothing here may change settings, voices or passwords behind it
  const locked = () => lock.isLocked();
  const LOCKED = { ok: false, error: 'Artemis is locked.' };
  const status = () => ({ ...lock.state(), config: lock.getConfig() });

  // ---- lock ----
  ipcMain.handle('lock:status', () => status());
  ipcMain.handle('lock:lock', () => lock.lock('manual'));
  ipcMain.handle('lock:unlock', (_e, method, value) => lock.unlock(String(method || ''), value === undefined ? '' : String(value)));
  ipcMain.handle('lock:setup', async (_e, o) => { if (locked()) return LOCKED; const r = await lock.setPassword(o && o.password, auth(o && o.current)); return r.ok ? { ...r, status: status() } : r; });
  ipcMain.handle('lock:config', async (_e, patch, a) => { if (locked()) return LOCKED; const r = await lock.setConfig(patch, auth(a)); return r.ok ? { ...r, status: status() } : r; });
  ipcMain.handle('lock:recovery', async (_e, a) => (locked() ? LOCKED : lock.newRecoveryCode(auth(a))));
  ipcMain.handle('lock:activity', () => { lock.activity(); return true; });
  ipcMain.handle('lock:test-alert', async () => (locked() ? LOCKED : testAlert ? testAlert() : { ok: false, error: 'Not available.' }));
  // answers to what main asked the window: a password (to approve a sensitive action) and a webcam frame (for the alert)
  ipcMain.handle('lock:auth-answer', (_e, id, password) => { const r = lockAuthWaiting.get(id); if (r) { lockAuthWaiting.delete(id); r(password === null || password === undefined ? null : String(password)); } return true; });
  ipcMain.handle('lock:snap-result', (_e, id, dataUrl) => { const r = snapWaiting.get(id); if (r) { snapWaiting.delete(id); r(typeof dataUrl === 'string' && /^data:image\/jpeg;base64,/.test(dataUrl) ? dataUrl : null); } return true; });

  // ---- speaker recognition ----
  ipcMain.handle('speaker:status', () => speaker.status());
  ipcMain.handle('speaker:download', async (e) => {
    if (locked()) return LOCKED;
    const r = await speaker.download((pct, detail) => { try { e.sender.send('speaker:progress', { pct, detail }); } catch {} logger && logger.progress && logger.progress('speaker-download', 'Download voice recognition model', { pct, detail }); });
    if (logger && logger.progress) logger.progress('speaker-download', 'Download voice recognition model', r.ok ? { pct: 100, state: 'done' } : { state: 'error', detail: r.error });
    return r;
  });
  ipcMain.handle('speaker:enroll-add', (_e, wav) => locked() ? LOCKED : speaker.enrollAdd(bytes(wav)));
  ipcMain.handle('speaker:enroll-finish', () => locked() ? LOCKED : speaker.enrollFinish());
  ipcMain.handle('speaker:enroll-reset', () => locked() ? LOCKED : speaker.enrollReset());
  // removing the voice print or the model weakens the lock: with the lock on it needs the password (or Touch ID)
  ipcMain.handle('speaker:remove', async (_e, what, a) => {
    if (locked()) return LOCKED;
    if (lock.enabled() && !(await lock.authOk(auth(a)))) return { ok: false, error: 'Enter the current password first.' };
    if (what === 'model') speaker.removeModel(); else speaker.removePrint();
    if (!speaker.hasPrint()) await lock.setConfig({ voiceOnly: false }, auth(a)); // nothing left to check against
    return { ok: true, status: speaker.status() };
  });
  ipcMain.handle('speaker:test', (_e, wav) => locked() ? LOCKED : voiceGate.test(bytes(wav)));
  // Sentinel asks this before it acts on a recording: the decision (and the counting, the unlocking, the lockdown) is made here, not in the page
  // o.phase 'session' = inside an open conversation (another voice is ignored in silence); o.strict = a spoken yes/no to an approval (only the owner counts)
  ipcMain.handle('speaker:verify', async (_e, wav, o) => {
    try { return await voiceGate.verify(bytes(wav), { always: true, phase: o && o.phase === 'session' ? 'session' : 'wake', strict: !!(o && o.strict) }); } catch (e) { return { ok: false, reason: 'error', error: (e && e.message) || String(e) }; }
  });
};
