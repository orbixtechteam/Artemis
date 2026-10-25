const { app, BrowserWindow, ipcMain, safeStorage, shell, Menu, nativeTheme, dialog, session, screen, globalShortcut, Notification, Tray, nativeImage, protocol, systemPreferences, desktopCapturer } = require('electron');
try { protocol.registerSchemesAsPrivileged([{ scheme: 'artifact', privileges: { standard: true, secure: true } }]); } catch {}
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const { runAgent, summarizeAll } = require('./agent');
const { createBrowser } = require('./browser');
const brainsLib = require('./brains');
const { createSentinelWidget } = require('./sentinel-widget');
const { pttAccelerator } = require('./ptt-accel');
const { createLogger } = require('./logger');
const { createLock } = require('./lock');
const { createSpeaker } = require('./speaker');
const { createVoiceGate } = require('./voice-gate');
const { createWakeWord } = require('./wakeword');
// ---------- app lock: while locked, IPC calls that act or show content are refused (the list is in electron/lock.js) ----------
let lockGuard = () => true; // replaced as soon as the lock exists (further down)
// Read-only lists the window asks for while it starts behind the lock screen: they answer "nothing" instead of throwing (a throw prints an error in the terminal each time).
const LOCKED_QUIET = { 'mcp:status': [], 'schedule:list': [], 'notes:root': '', 'notes:list': { ok: false, error: 'locked', items: [] }, 'library:list': { ok: false, error: 'locked', items: [] } };
{ const handle = ipcMain.handle.bind(ipcMain); ipcMain.handle = (ch, fn) => handle(ch, (e, ...a) => { if (!lockGuard(ch)) { if (LOCKED_QUIET[ch] !== undefined) return JSON.parse(JSON.stringify(LOCKED_QUIET[ch])); throw new Error('Artemis is locked.'); } return fn(e, ...a); }); }
// ---------- app log (file + Logs page) ----------
const logger = createLogger({
  dir: path.join(app.getPath('home'), '.artemis', 'logs'),
  onEntry: (e) => { try { win?.webContents.send('log:entry', e); } catch {} },
  onProgress: (list) => { try { win?.webContents.send('log:progress', list); } catch {} }
});
process.on('uncaughtException', (err) => { logger.error('main', 'Uncaught exception: ' + ((err && err.message) || err), err); });
process.on('unhandledRejection', (err) => { logger.error('main', 'Unhandled rejection: ' + ((err && err.message) || err), err); });
for (const lv of ['warn', 'error']) { const orig = console[lv].bind(console); console[lv] = (...a) => { orig(...a); try { logger.log(lv, 'console', a.map((x) => (x instanceof Error ? x.message : typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); } catch {} }; }
logger.info('app', `Artemis started (v${app.getVersion()}, ${process.platform} ${process.arch}, Electron ${process.versions.electron})`);
const files = require('./files');
const web = require('./web');
const mediaGen = require('./media');
const { createComputer } = require('./computer');
const { createFloat } = require('./float');
const { createRemote } = require('./remote');
const { createMcpManager, parseImport } = require('./mcp');
const tools = require('./tools');
// core: SQLite sessions, the memory workspace and the gateway API (electron/core/)
const { openDb } = require('./core/db');
const { createSessions } = require('./core/sessions');
const { createWorkspace } = require('./core/workspace');
const { createMemIndex } = require('./core/memindex');
const { createMemoryApi, embedderFrom } = require('./core/memory-api');
const { flushMemory } = require('./core/memflush');
const gatewayLib = require('./core/gateway');
const { sandboxFromSettings, hideHostShellTools } = require('./core/sandbox');
const themes = require('./themes');

const IS_DEV = !!process.env.ELECTRON_DEV;
// .env (git-ignored): extra environment variables such as TELEGRAM_BOT_TOKEN
try {
  const envFile = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch {}

// ---------- storage ----------
// The app used to be called "AI Desktop", then "Zero"; keep reading the old data folder so chats and settings carry over.
try {
  for (const name of ['AI Desktop', 'Zero', 'Artemis']) {
    const legacy = path.join(app.getPath('appData'), name);
    if (fs.existsSync(legacy)) { app.setPath('userData', legacy); break; }
  }
} catch {}
// Dev only: run against a separate data folder (screenshots, UI work) without touching real chats and settings.
if (IS_DEV && process.env.ARTEMIS_USER_DATA) app.setPath('userData', path.resolve(process.env.ARTEMIS_USER_DATA));
const dataFile = (name) => path.join(app.getPath('userData'), `${name}.json`);
// Stores whose file did not parse: name -> where the bad file was moved. store:set for them is refused until the user has been told.
const corruptStores = new Map();
let corruptNotified = false;
function quarantine(name, err) {
  const file = dataFile(name);
  const dest = `${file}.corrupt-${Date.now()}`;
  try { fs.renameSync(file, dest); } catch { try { fs.copyFileSync(file, dest); } catch {} }
  corruptStores.set(name, dest);
  logger.error('store', `${name}.json is corrupt (${err.message}); kept as ${path.basename(dest)}`);
  setTimeout(notifyCorrupt, 0);
}
async function notifyCorrupt() {
  if (corruptNotified || !corruptStores.size || !app.isReady()) return;
  corruptNotified = 'pending';
  const lines = [...corruptStores].map(([n, p]) => `${n}.json → ${path.basename(p)}`).join('\n');
  try {
    const opts = { type: 'warning', buttons: ['OK', 'Show in Finder'], defaultId: 0, noLink: true, message: 'Some saved data could not be read',
      detail: `These files were damaged and have been set aside so nothing is overwritten:\n${lines}\n\nArtemis starts them empty. A recent copy of your chats may be in chats.json.bak in the same folder.` };
    const r = (win && !win.isDestroyed()) ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
    if (r.response === 1) shell.showItemInFolder([...corruptStores.values()][0]);
  } catch {}
  corruptNotified = true;
}
function readJson(name, fallback) {
  let raw;
  try { raw = fs.readFileSync(dataFile(name), 'utf8'); } catch (e) { if (e && e.code !== 'ENOENT') logger.error('store', `Could not read ${name}.json: ${e.message}`); return fallback; }
  try { return JSON.parse(raw); } catch (e) {
    if (name in STORES && !corruptStores.has(name)) quarantine(name, e);
    else logger.error('store', `Could not read ${name}.json: ${e.message}`);
    return fallback;
  }
}
const BAK_EVERY = 10 * 60 * 1000;
function writeJson(name, data) {
  const file = dataFile(name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (name === 'chats') { // rolling backup, at most one copy per 10 minutes
    try { const bak = file + '.bak'; let age = Infinity; try { age = Date.now() - fs.statSync(bak).mtimeMs; } catch {} if (age > BAK_EVERY && fs.existsSync(file)) fs.copyFileSync(file, bak); } catch (e) { logger.warn('store', 'chats backup failed: ' + e.message); }
  }
  const tmp = file + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, JSON.stringify(data)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}
const STORES = { chats: [], projects: [], memory: [] };

// ---------- usage stats (tokens per request; no message content is stored) ----------
// Kept in memory (loaded once) and written at most every 2 s, plus on quit.
const USAGE_MAX = 20000;
let usageList = null, usageTimer = null;
const getUsage = () => { if (!usageList) { const l = readJson('usage', []); usageList = Array.isArray(l) ? l : []; } return usageList; };
function flushUsage() {
  if (usageTimer) { clearTimeout(usageTimer); usageTimer = null; }
  if (!usageList) return;
  try { writeJson('usage', usageList); } catch (e) { logger.warn('usage', 'Could not save usage: ' + e.message); }
}
function setUsage(list) { usageList = Array.isArray(list) ? list : []; flushUsage(); }
function recordUsage(entry) {
  try {
    const list = getUsage();
    list.push(entry);
    if (list.length > USAGE_MAX) list.splice(0, list.length - USAGE_MAX);
    logger.debug('usage', `${entry.model} · ${entry.prompt || 0} in / ${entry.completion || 0} out${entry.source ? ' · ' + entry.source : ''}`);
    if (!usageTimer) usageTimer = setTimeout(flushUsage, 2000);
  } catch {}
}
const { checkLimits } = require('./limits');
const providersLib = require('./providers');
const titlesLib = require('./titles');
const { createSkills } = require('./skills');
const { createAgents } = require('./subagents');
const { createMake, ZONES: MAKE_ZONES, cleanZone: cleanMakeZone, validZone: validMakeZone } = require('./make');
const chatSearch = require('./chatsearch');
const { createScheduler } = require('./scheduler');
const { createPermissions } = require('./permissions');
const readProviders = () => { const l = readJson('providers', []); const list = Array.isArray(l) ? l : []; providersLib.registerHeaders(list); return list; };
const readProviderKeys = () => readJson('providerkeys', {});
const getProviderKey = (id) => decStr(readProviderKeys()[id]);
const limitState = () => checkLimits(allUsage(), getSettings(), Date.now(), providersLib.priceMap(readProviders()));
const skills = createSkills({
  userDir: path.join(app.getPath('userData'), 'skills'),
  getDisabled: () => getSettings().disabledSkills || [],
  setDisabled: (list) => saveSettings({ disabledSkills: list }),
  notify: () => { try { win?.webContents.send('skills:changed'); } catch {} }
});
const brains = brainsLib.createBrains({
  userDir: path.join(app.getPath('userData'), 'brains'),
  notify: () => { try { win?.webContents.send('brains:changed'); } catch {} }
});
const agents = createAgents({
  userDir: path.join(app.getPath('userData'), 'agents'),
  notify: () => { try { win?.webContents.send('agents:changed'); } catch {} }
});
const searchSaved = (q, n) => {
  const c = initCore();
  if (c.sessions) { try { return c.sessions.search(q, { limit: n, projects: readJson('projects', []) }); } catch (e) { logger.warn('db', 'Full-text chat search failed, using the simple search: ' + e.message); } }
  return chatSearch.searchChats(readChats(), q, { limit: n, projects: readJson('projects', []) });
};
const getSaved = (id) => { const c = initCore(); if (c.sessions) { try { return c.sessions.get(id); } catch {} } return (readChats() || []).find((x) => x.id === id) || null; };
const chatsApi = () => ({
  search: (q, n) => searchSaved(q, n),
  read: (id, last) => { const c = getSaved(id); return c && !c.incognito ? chatSearch.transcript(c, { last }) : null; }
});
const mcp = createMcpManager();
const oauthPending = new Map();
const oauthCallbackServer = http.createServer((req, res) => {
  if (!req.url.startsWith('/callback')) { res.writeHead(404); return res.end(); }
  const u = new URL(req.url, 'http://127.0.0.1');
  const state = u.searchParams.get('state'); const pending = oauthPending.get(state);
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end('<h2>Artemis OAuth complete</h2><p>You can close this window and return to Artemis.</p>');
  if (!pending) return;
  oauthPending.delete(state);
  if (u.searchParams.get('error')) return pending.reject(new Error(u.searchParams.get('error_description') || u.searchParams.get('error')));
  pending.resolve({ code: u.searchParams.get('code'), state });
});
oauthCallbackServer.listen(0, '127.0.0.1');
let shortcutError = '';
let shortcutErrors = {}; // per setting key, shown under each field in Settings → General
let quitting = false;
let tray = null;
let quick = null;

const DEFAULT_SETTINGS = {
  model: '', // set by picking a model from a provider; empty = the first model of the first enabled provider
  imageModel: '', // prov:<provider>:<model>; empty = image generation is off
  videoModel: '',
  systemPrompt: '',
  personality: '', personalityCustom: '', // how Artemis talks: a preset from electron/personality.json plus your own notes
  theme: 'system', // a single custom theme id; 'system' = use the palette below
  palette: 'artemis', // a theme family (electron/themes/<family>-light|dark.json)
  appearance: 'system', // system | light | dark
  accent: '', // '' = the palette's own accent, else a name from ACCENTS in src/lib/palette.mjs
  textSize: 'medium',
  maxTokens: 8192,
  reasoningEffort: '', // '' = leave it to the model; low / medium / high is sent as reasoning_effort. A chat can override it.
  dailyTokenLimit: 0,
  monthlyTokenLimit: 0,
  permissionsAsked: false,
  dailyUsdLimit: 0,
  monthlyUsdLimit: 0,
  toolsEnabled: true,
  autoApproveEdits: false,
  remoteContinueLast: true,
  memoryEnabled: true,
  webEnabled: true,
  shellEnabled: true,
  computerEnabled: true,
  browserTools: true, // the agent can drive the integrated browser
  telegramEnabled: false,
  telegramChatId: '',
  remoteFolder: '',
  remoteModel: '',
  remoteProjectId: '',
  remoteAllowDangerous: true,
  telegramTokenEnc: null,
  connectorsEnabled: true,
  quickChatShortcut: 'CommandOrControl+Shift+Space', // global: opens or hides the Quick window on its Chat tab
  quickSearchShortcut: '', // global: opens the Quick window on its Search tab; empty = off
  paletteShortcut: 'CommandOrControl+K', // in the main window only (matched in the renderer); empty = off
  paletteFromQuickShortcut: false, // the Quick chat shortcut opens the command palette while the Artemis window is in front
  sentinelShortcut: 'CommandOrControl+Shift+A', // global: turns Sentinel (voice mode) on or off without bringing the window up; empty = off
  lockShortcut: 'CommandOrControl+Alt+Shift+L', // global: locks Artemis (Settings → Security); empty = off
  closeToTray: true,
  makeEnabled: true,
  voiceSttProvider: '',
  searchEngine: '', searchProvider: '', searchModel: 'perplexity/sonar', // web_search through a provider (an online-search model) instead of the scraped engines
  voiceSttModel: 'whisper-1',
  voiceLanguage: 'auto',
  voiceAutoRead: false,
  connectorsLazy: true, fullFileAccess: true, toolsLazy: true, mcpServerEnabled: false, mcpServerPort: 8788, mcpTokenEnc: null,
  mcpAlwaysAllow: false, notesAi: true, sentinelPreload: false, sentinelAuto: false, sentinelPtt: '', sentinelInterrupt: false, sentinelStopWords: false, sentinelHideInApp: false, sentinelWake: 'wake up', sentinelEngine: 'vosk', sentinelOwwModel: '', sentinelOwwThreshold: 0.5, sentinelSensitivity: 'normal',
  sentinelModel: '', // empty = the default model; a fast model makes voice answers start sooner,
  sentinelPos: null, sentinelSizes: null,
  micDeviceId: '',
  speakerDeviceId: '',
  voiceName: '',
  voiceRate: 1,
  ttsEngine: 'system', ttsUrl: '', ttsModel: '', ttsVoice: '', ttsVoiceEn: '',
  ttsVoices: {}, // older Kokoro voice per reply language ({ es: 'ef_dora' }); read by langMapFrom when voiceLangMap has no entry
  voiceLangMap: {}, // engine per reply language ({ tr: { engine: 'piper', url: 'http://localhost:5100', voice: 'tr_TR-dfki-medium' } }); see src/lib/lang.mjs
  cbUrl: '', cbVoice: '', cbExaggeration: 0.5, cbCfg: 0.5, cbTemperature: 0.8, cbSpeed: 1, cbHybrid: false,
  defaultBrain: '',
  makeZone: 'eu1.make.com',
  launchAtLogin: false,
  updateAuto: true, updateDownload: true, updateInstall: true, // Settings → General → Updates (electron/updater.js)
  skillsEnabled: true,
  autoLearn: true,
  delegateEnabled: true,
  agentWriteApproval: true,
  profileName: '',
  profileAbout: '',
  profileLocation: '', // where the user is (city, country); used for "near me" questions
  chatSearchEnabled: true,
  autoTitles: true, // name chats from their topic after the first reply (and again as the topic drifts)
  titleModel: '', // empty = the chat's own model
  scheduleModel: '', // model for scheduled tasks that have none of their own; empty = the default model
  disabledSkills: [],
  sandbox: '', sandboxImage: 'node:22-bookworm', sandboxNetwork: true, sandboxMemory: '2g', sandboxCpus: '2', sandboxSshHost: '', sandboxSshDir: '', // run_command in Docker or over SSH instead of this computer
  sqliteStore: true, // chats live in artemis.db (SQLite, full-text search); chats.json is still written as a backup copy
  memoryV2: true, // long-term memory as Markdown files in the workspace folder (SOUL.md, USER.md, MEMORY.md, daily notes)
  memoryFlush: true, // before old messages are summarized, save what is worth keeping to memory
  memoryModel: '', // model for the memory flush; empty = the scheduled-task model, else the chat's model
  embeddingModel: '', // prov:<provider>:<model> for memory_search by meaning; empty = keywords only
  workspaceFolder: '', // empty = <userData>/workspace
  gatewayEnabled: false, gatewayPort: 8789, gatewayTokenEnc: null, gatewayModel: '', gatewayRestrict: false,
  // the first heartbeat before heartbeats.json exists (core/heartbeat.js fromSettings); the list itself lives in heartbeats.json
  heartbeatEnabled: false, heartbeatEvery: 30, heartbeatFrom: '', heartbeatTo: '', heartbeatModel: '', heartbeatPhone: true, // no hours = day and night
  // webhooks: their own port (only /hooks/<name>), optionally on the internet through a Cloudflare tunnel ('quick' or 'named')
  hooksEnabled: false, hooksPort: 8790, hooksTunnel: 'off', hooksPublicUrl: '', hooksTunnelTokenEnc: null
};
const getSettings = () => ({ ...DEFAULT_SETTINGS, ...readJson('settings', {}) });

// ---------- core: SQLite sessions + memory workspace (opened on first use) ----------
// SQLite (artemis.db) holds the chats and the search indexes; chats.json keeps being written as a backup copy, so going
// back to an older build loses nothing. If SQLite cannot open, everything falls back to the JSON files as before.
const coreState = { tried: false, db: null, sessions: null, ws: null, index: null };
const workspaceDir = () => getSettings().workspaceFolder || path.join(app.getPath('userData'), 'workspace');
const coreLog = (area) => (lv, m) => { try { (logger[lv] || logger.info)(area, m); } catch {} };
function initCore() {
  if (coreState.tried) return coreState;
  coreState.tried = true;
  const st = getSettings();
  if (st.sqliteStore !== false) {
    try {
      const db = openDb(path.join(app.getPath('userData'), 'artemis.db'), { log: coreLog('db') });
      if (db) {
        const sessions = createSessions({ db, log: coreLog('db'), writer: 'renderer' });
        if (db.getMeta('chatsImported') !== '1') {
          const arr = readJson('chats', []);
          if (Array.isArray(arr) && arr.length) sessions.sync(arr);
          if (!corruptStores.has('chats')) db.setMeta('chatsImported', '1');
          logger.info('db', `Chats moved into artemis.db (${Array.isArray(arr) ? arr.length : 0} chats); chats.json stays as a backup copy`);
        }
        try { const n = sessions.purge(30); if (n) logger.info('db', `${n} chats deleted more than 30 days ago were removed for good`); } catch {}
        coreState.db = db; coreState.sessions = sessions;
      }
    } catch (e) { logger.error('db', 'artemis.db could not be opened, chats stay in chats.json: ' + ((e && e.message) || e)); coreState.db = null; coreState.sessions = null; }
  }
  if (st.memoryV2 !== false) {
    try {
      const ws = createWorkspace({ dir: workspaceDir(), log: coreLog('memory') });
      ws.ensure(readJson('memory', []));
      coreState.ws = ws;
      if (coreState.db) coreState.index = createMemIndex({ db: coreState.db, workspace: ws, log: coreLog('memory'), embedder: embedderFrom({ getSettings, readProviders, getProviderKey }) });
    } catch (e) { logger.error('memory', 'The memory workspace could not be set up, memory stays in memory.json: ' + ((e && e.message) || e)); coreState.ws = null; }
  }
  return coreState;
}
/** The saved chats (SQLite when available, else chats.json). */
const readChats = () => { const c = initCore(); if (c.sessions) { try { return c.sessions.toArray(); } catch (e) { logger.error('db', 'Reading chats from artemis.db failed, using chats.json: ' + e.message); } } return readJson('chats', []); };
let mirrorTimer = null;
/** After a write that did not come from the window (gateway, phone without a window): refresh the chats.json backup copy. */
const mirrorChats = () => { if (mirrorTimer) return; mirrorTimer = setTimeout(() => { mirrorTimer = null; const c = initCore(); if (c.sessions) { try { writeJson('chats', c.sessions.toArray()); } catch (e) { logger.warn('db', 'chats.json backup copy failed: ' + e.message); } } }, 3000); };

const SECRET_FIELDS = { telegramToken: 'telegramTokenEnc', makeToken: 'makeTokenEnc', mcpToken: 'mcpTokenEnc', braveKey: 'braveKeyEnc', gatewayToken: 'gatewayTokenEnc', hooksTunnelToken: 'hooksTunnelTokenEnc' };
const cleanSecret = (v) => String(v == null ? '' : v).replace(/[\s\u00a0\u200b-\u200f\u2028\u2029\ufeff]+/g, '');
const encStr = (v0) => { const v = cleanSecret(v0); return (!v ? null : safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(v).toString('base64') : 'plain:' + v); };
let decWarned = false;
const decStr = (e) => {
  if (!e) return '';
  try {
    const v = cleanSecret(e.startsWith('plain:') ? e.slice(6) : safeStorage.decryptString(Buffer.from(e, 'base64')));
    // A key that was encrypted under another app identity can "decrypt" into garbage instead of failing: treat that as unreadable.
    if (/[^\x21-\x7e]/.test(v)) throw new Error('the saved key decrypts to garbage');
    return v;
  } catch (err) { if (!decWarned) { decWarned = true; logger.warn('secrets', `A saved key could not be decrypted (${(err && err.message) || err}). On a Mac this usually means the Keychain item "Electron Safe Storage" was denied or the app identity changed. Type the key again in Settings.`); } return ''; }
};
const getSecret = (name) => decStr(getSettings()[SECRET_FIELDS[name]]) || (name === 'telegramToken' ? process.env.TELEGRAM_BOT_TOKEN || '' : '');
const setSecret = (name, value) => writeJson('settings', { ...getSettings(), [SECRET_FIELDS[name]]: encStr(value) });
const saveSettings = (patch) => writeJson('settings', { ...getSettings(), ...patch });

const publicSettings = () => ({ ...getSettings(), telegramTokenEnc: undefined, makeTokenEnc: undefined, mcpTokenEnc: undefined, braveKeyEnc: undefined, gatewayTokenEnc: undefined, hooksTunnelTokenEnc: undefined, hasBraveKey: !!getSecret('braveKey'), hasMakeToken: !!getSecret('makeToken'), hasApiKey: readProviders().some((p) => p.enabled !== false && (p.models || []).length && (!p.needsKey || getProviderKey(p.id))), hasTelegramToken: !!getSecret('telegramToken'), shortcutError, shortcutErrors });

// ---------- app lock, voice recognition, unauthorized-access alerts (electron/lock.js, speaker.js, voice-gate.js) ----------
const lockAuthWaiting = new Map(); // id -> resolve(password | null): a password asked from the window (to approve a sensitive action)
const snapWaiting = new Map(); // id -> resolve(dataUrl | null): a webcam frame asked from the window (for the alert photo)
const lock = createLock({
  read: () => readJson('lock', {}), write: (d) => writeJson('lock', d),
  log: (lv, m) => logger[lv === 'warn' ? 'warn' : 'info']('lock', m),
  touchId: {
    available: () => { try { return process.platform === 'darwin' && systemPreferences.canPromptTouchID(); } catch { return false; } },
    prompt: (why) => systemPreferences.promptTouchID(why)
  },
  onState: (st) => onLockState(st),
  onAlert: (info) => { onLockAlert(info).catch((e) => logger.warn('lock', 'The alert failed: ' + ((e && e.message) || e))); },
  askPassword: (reason) => askPasswordInWindow(reason)
});
lockGuard = (ch) => lock.guard(ch);
const speaker = createSpeaker({ fs, path, dir: () => path.join(app.getPath('userData'), 'speaker'), safeStorage, log: (lv, m) => logger[lv === 'warn' ? 'warn' : 'info']('speaker', m) });
const { createUpdater } = require('./updater');
const updater = createUpdater({
  fs, path, dir: () => path.join(app.getPath('userData'), 'updates'), fetch: (...a) => fetch(...a), spawn: (...a) => require('child_process').spawn(...a),
  version: app.getVersion(), isPackaged: app.isPackaged, exePath: app.getPath('exe'), getSettings: () => getSettings(),
  send: (s) => { try { if (win && !win.isDestroyed()) win.webContents.send('update:status', s); rebuildTray && rebuildTray(); } catch {} },
  notify: (v) => { try { if (Notification.isSupported()) { const n = new Notification({ title: `Artemis ${v} is ready`, body: 'It installs when you quit Artemis, or press Restart and update in Settings → General → Updates.' }); n.on('click', () => showMain('update notification')); n.show(); } } catch {} },
  log: (lv, msg) => logger[lv === 'warn' ? 'warn' : 'info']('update', msg === undefined ? lv : msg)
});
const wakeword = createWakeWord({ fs, path, dir: () => path.join(app.getPath('userData'), 'wakeword'), log: (lv, msg) => logger[lv === 'warn' ? 'warn' : 'info']('wakeword', msg === undefined ? lv : msg) });
const voiceGate = createVoiceGate({ lock, speaker, log: (lv, m) => logger[lv === 'warn' ? 'warn' : 'info']('speaker', m) });

// ---------- themes (JSON palettes, so a new theme needs no rebuild) ----------
/** The project folder of the newest chat's project: where a project theme file would sit. */
const openProjectFolder = () => {
  try {
    const chats = readChats();
    const id = [...chats].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0] && [...chats].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0].projectId;
    const project = id && readJson('projects', []).find((p) => p.id === id);
    return project && project.folder ? project.folder : undefined;
  } catch { return undefined; }
};
const themeDirs = (folderArg) => {
  const folder = typeof folderArg === 'string' && folderArg ? folderArg : openProjectFolder();
  return { user: path.join(app.getPath('userData'), 'themes'), project: folder ? path.join(folder, '.artemis', 'themes') : undefined };
};
/** Settings reads the themes: the folder of project "latest", or the project the renderer names. */
const listThemes = (folderArg) => { const d = themeDirs(folderArg); return { ...themes.list(d), folders: { user: d.user, project: d.project || null } }; };
const nativeThemeFor = () => { nativeTheme.themeSource = themes.nativeSource(getSettings(), listThemes().themes); };
/** Palette changes have to reach the main window, the palette window and the sticky widget. */
const broadcastTheme = () => {
  try { win?.webContents.send('theme:changed'); } catch {}
  for (const w of BrowserWindow.getAllWindows()) { try { w.webContents.send('theme:changed'); } catch {} }
};

// ---------- window ----------
let win;
// The integrated browser: tabs on their own persistent session, laid over the renderer's browser panel (see electron/browser.js)
const browser = createBrowser({
  session, getWebContentsView: () => require('electron').WebContentsView, getWin: () => win, isDev: IS_DEV,
  downloadsDir: () => { try { return app.getPath('downloads'); } catch { return ''; } },
  emit: (ch, p) => { try { if (win && !win.isDestroyed()) win.webContents.send(ch, p); } catch {} },
  log: { warn: (area, m) => { try { logger.warn(area, m); } catch {} } }
});
function createWindow() {
  const isMac = process.platform === 'darwin';
  win = new BrowserWindow({
    width: 1240, height: 820, minWidth: 820, minHeight: 540,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#262624' : '#faf9f5',
    icon: process.platform === 'darwin' ? path.join(__dirname, '..', 'build', 'Artemis.icns') : path.join(__dirname, 'assets', 'tray.png'),
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      backgroundThrottling: false // Sentinel keeps listening while the window is minimized or hidden
    }
  });
  if (IS_DEV) win.loadURL('http://localhost:5173');
  else win.loadFile(path.join(__dirname, '..', 'dist', 'renderer', 'index.html'));

  // closing the window keeps the app (and the phone bot) running in the tray
  win.on('close', (e) => {
    if (!quitting && getSettings().closeToTray && tray) { e.preventDefault(); win.hide(); }
  });
  const keepDock = () => { if (process.platform === 'darwin' && app.dock) { try { app.dock.show(); } catch {} } };
  win.on('minimize', keepDock); win.on('hide', keepDock); win.on('restore', keepDock); win.on('show', keepDock);
  win.on('resize', () => browser.onWindowResize());
  win.webContents.on('devtools-opened', () => { if (lock.isLocked()) { try { win.webContents.closeDevTools(); } catch {} } });
  win.on('closed', () => { browser.destroy(); win = null; });
  // push-to-talk is a global shortcut only while the window is not in front (hold-to-talk in the window needs the key events)
  win.on('focus', () => syncPttShortcut()); win.on('blur', () => syncPttShortcut());
  for (const ev of ['focus', 'blur', 'show', 'hide', 'minimize', 'restore']) win.on(ev, syncSentinelSoon);

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    const cur = (() => { try { return win.webContents.getURL().split('#')[0]; } catch { return ''; } })();
    const internal = url.split('#')[0] === cur || (IS_DEV && url.startsWith('http://localhost:5173/')); // a dropped file must not replace the app page
    if (!internal) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); }
  });
}

// ---------- IPC: storage / settings ----------
// Ids of chats the window has had (loaded, or contained in one of its saves): a save without one of these means the user deleted it.
// Chats written meanwhile by another writer (the headless gateway) are not in it, so a save never deletes them.
const rendererKnown = new Set();
let pushedSeq = 0;
ipcMain.handle('store:get', (_e, name) => {
  if (name === 'chats') {
    const c = initCore();
    if (c.sessions) { try { pushedSeq = c.sessions.seq(); const list = c.sessions.toArray(); rendererKnown.clear(); for (const x of list) rendererKnown.add(String(x.id)); return list; } catch (e) { logger.error('db', 'Reading chats from artemis.db failed, using chats.json: ' + e.message); } }
    return readJson('chats', []);
  }
  if (name === 'memory') { const c = initCore(); if (c.ws) { try { return c.ws.list(); } catch (e) { logger.error('memory', 'Reading MEMORY.md failed: ' + e.message); } } }
  return name in STORES ? readJson(name, STORES[name]) : null;
});
ipcMain.handle('store:set', (_e, name, data) => {
  if (!(name in STORES)) return true;
  if (corruptStores.has(name) && corruptNotified !== true) { notifyCorrupt(); return false; } // keep the damaged file's slot untouched until the user knows
  if (name === 'chats') {
    const c = initCore();
    if (c.sessions) {
      try {
        if (Array.isArray(data)) for (const x of data) if (x && x.id != null) rendererKnown.add(String(x.id));
        c.sessions.sync(data, { writer: 'renderer', known: rendererKnown });
        setTimeout(pushExternal, 50); // merged chats go back to the window right away
      } catch (e) { logger.error('db', 'Saving chats to artemis.db failed (chats.json is still written): ' + e.message); }
    }
  }
  if (name === 'memory') { const c = initCore(); if (c.ws) { try { c.ws.replaceAll(data); return true; } catch (e) { logger.error('memory', 'Saving MEMORY.md failed: ' + e.message); return false; } } }
  writeJson(name, data);
  return true;
});
ipcMain.handle('settings:get', () => publicSettings());
ipcMain.handle('settings:set', async (_e, patch) => {
  // never let the renderer overwrite stored secrets: undefined values survive IPC and would wipe them
  const { apiKey, apiKeyEnc, telegramToken, telegramTokenEnc, makeTokenEnc, mcpTokenEnc, braveKey, braveKeyEnc, hasBraveKey, mcpServerEnabled, mcpServerPort, mcpAlwaysAllow, hasMakeToken, hasApiKey, hasTelegramToken, gatewayTokenEnc: _gwTok, gatewayEnabled: _gwOn, gatewayPort: _gwPort, sqliteStore: _sq, hooksTunnelTokenEnc: _htTok, ...rest } = patch;
  // an empty field means "unchanged", never "delete"
  if (typeof telegramToken === 'string' && telegramToken.trim()) setSecret('telegramToken', telegramToken.trim());
  if (typeof braveKey === 'string' && braveKey.trim()) setSecret('braveKey', braveKey.trim());
  const before = getSettings();
  saveSettings(rest);
  const looks = ['theme', 'appearance', 'palette', 'accent', 'textSize'].filter((k) => k in rest && rest[k] !== before[k]);
  if (looks.some((k) => k !== 'textSize')) nativeThemeFor();
  if (looks.length) broadcastTheme();
  // Restart the Telegram bot only when something about them changed, and never make the Save button wait for it
  // (stopping Telegram long-polling or a busy port can take a long time).
  const remoteKeys = ['telegramEnabled'];
  const remoteChanged = (typeof telegramToken === 'string' && telegramToken.trim()) || remoteKeys.some((k) => k in rest && String(rest[k]) !== String(before[k]));
  if (remoteChanged) remote.reconfigure().catch((e) => logger.error('app', 'Phone services restart failed: ' + ((e && e.message) || e)));
  try {
    if (SHORTCUT_KEYS.some((k) => k in rest && rest[k] !== before[k])) { applyShortcut(); buildAppMenu(); rebuildTray?.(); }
  } catch (e) { logger.error('app', 'Shortcut failed: ' + ((e && e.message) || e)); }
  try { if ('launchAtLogin' in rest && rest.launchAtLogin !== before.launchAtLogin) applyLoginItem(); } catch (e) { logger.error('app', 'Login item failed: ' + ((e && e.message) || e)); }
  logger.info('app', 'Settings saved', { keys: Object.keys(rest).length, phoneRestart: !!remoteChanged });
  return publicSettings();
});

// ---------- IPC: model providers (OpenAI-compatible endpoints) ----------
const publicProviders = () => readProviders().map((p) => ({ ...p, hasKey: !!getProviderKey(p.id) }));
const claudeUsage = require('./claude-usage').createClaudeUsage();
ipcMain.handle('claude:usage', (_e, o) => claudeUsage({ force: !!(o && o.force) }));

// ---------- IPC: skills ----------
const skillRoot = (rootArg) => (rootArg && fs.existsSync(rootArg) ? rootArg : null);
// ---------- IPC: themes ----------

// ---------- IPC: profile (about you + avatar in ~/.artemis/user/images) ----------
const profileDir = () => path.join(app.getPath('home'), '.artemis', 'user');
const avatarFile = (ext = 'png') => path.join(profileDir(), 'images', `avatar.${ext}`);
function avatarData() {
  for (const [ext, mime] of [['gif', 'image/gif'], ['png', 'image/png']]) {
    try { return `data:${mime};base64,` + fs.readFileSync(avatarFile(ext)).toString('base64'); } catch {}
  }
  return null;
}

// ---------- IPC: agents ----------
// Project logo: processed here, saved in <project folder>/.artemis/ (or ~/.artemis/project-logos) and returned as a data URL kept on the project.
const logoDir = (folder) => (folder && fs.existsSync(folder) ? path.join(folder, '.artemis') : path.join(os.homedir(), '.artemis', 'project-logos'));

// ---------- IPC: folders / files ----------

ipcMain.handle('import:chats', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Import chats (ChatGPT or Claude export)', properties: ['openFile'],
    filters: [{ name: 'Chat export', extensions: ['zip', 'json'] }]
  });
  if (r.canceled || !r.filePaths[0]) return { canceled: true };
  try {
    const st = fs.statSync(r.filePaths[0]);
    if (st.size > 1024 * 1024 * 1024) throw new Error('That file is too large.');
    const { parseExport } = require('./importer');
    const out = await parseExport(fs.readFileSync(r.filePaths[0]), getSettings().model);
    return { ok: true, source: out.source, chats: out.chats, projects: out.projects || [], memory: out.memory || [] };
  } catch (e) { return { ok: false, error: e.message || String(e) }; }
});
ipcMain.handle('dialog:folder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

// ---------- IPC: chat ----------
const runs = new Map();       // requestId -> AbortController
const approvals = new Map();  // toolId -> resolve(bool)
const approvalMeta = new Map(); // toolId -> { name, category }: what the approval is for (Touch ID is asked for the sensitive ones)

ipcMain.handle('tool:decision', async (_e, toolId, ok) => {
  if (ok) {
    const r = await lock.requireSensitive(approvalMeta.get(toolId));
    if (!r.ok) { logger.info('lock', 'A sensitive action was not confirmed' + (r.error ? ': ' + r.error : '')); decideTool(toolId, false); return { ok: false, denied: true, error: r.error || 'Not confirmed.' }; }
  }
  decideTool(toolId, ok);
});

/** Compares memory entries by their words only, so "Use X." and "use x" count as the same entry. */
const memKey = (t) => String(t || '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().slice(0, 500);
const memoryApi = (notify) => { const c = initCore(); return c.ws ? createMemoryApi({ workspace: c.ws, index: c.index, notify }) : jsonMemoryApi(notify); };
const jsonMemoryApi = (notify) => ({
  list: () => readJson('memory', []),
  add: (text) => {
    const list = readJson('memory', []);
    const same = list.find((m) => memKey(m.text) === memKey(text));
    if (same) return { ...same, duplicate: true }; // the model re-saving an entry it already has must not add a copy
    const item = { id: Math.random().toString(36).slice(2, 8), text: text.slice(0, 500), createdAt: Date.now() };
    list.push(item); writeJson('memory', list); notify();
    return item;
  },
  remove: (id) => {
    const list = readJson('memory', []);
    const next = list.filter((m) => m.id !== id);
    if (next.length === list.length) return false;
    writeJson('memory', next); notify();
    return true;
  }
});

// ---------- artifacts ----------
const staged = new Map(); // token -> html
const ARTIFACT_CSP = "default-src 'none'; script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com; style-src 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; img-src data: blob: https:; font-src https: data:; media-src data: blob: https:; connect-src 'none'; frame-src 'none'; form-action 'none'";
function artifactHtml(content, kind) {
  if (kind === 'svg') return `<!doctype html><meta charset="utf-8"><body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#fff">${content}</body>`;
  return /<html[\s>]|<!doctype/i.test(content) ? content : `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body>${content}</body>`;
}
ipcMain.handle('artifact:stage', (_e, content, kind) => {
  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  staged.set(token, artifactHtml(String(content || '').slice(0, 5e6), kind));
  while (staged.size > 40) staged.delete(staged.keys().next().value);
  return `artifact://view/${token}`;
});
ipcMain.handle('artifact:save', async (_e, { title, kind, language, content }) => {
  const parent = BrowserWindow.fromWebContents(_e.sender) || win; // the Sentinel widget saves too: its own dialog, the main window stays in the back
  if (kind === 'spreadsheet') {
    const XLSX = require('xlsx');
    const base = String(title || 'table').replace(/[^\w .-]+/g, '_').slice(0, 60);
    const r = await dialog.showSaveDialog(parent, { defaultPath: `${base}.xlsx`, filters: [{ name: 'Excel', extensions: ['xlsx'] }, { name: 'CSV', extensions: ['csv'] }, { name: 'Excel 97-2003', extensions: ['xls'] }, { name: 'OpenDocument', extensions: ['ods'] }] });
    if (r.canceled || !r.filePath) return { canceled: true };
    try {
      const parts = /^## Sheet: /m.test(String(content || '')) ? String(content).split(/^## Sheet: /m).filter(Boolean) : [];
      const secs = parts.length ? parts.map((p) => { const nl = p.indexOf('\n'); return { name: p.slice(0, nl < 0 ? p.length : nl).replace(/\s*\([^)]*\)\s*$/, '').trim() || 'Sheet', csv: nl < 0 ? '' : p.slice(nl + 1) }; }) : [{ name: 'Sheet1', csv: String(content || '') }];
      const sheets = secs.map((s) => { const wb = XLSX.read(s.csv, { type: 'string' }); const ws = wb.Sheets[wb.SheetNames[0]]; return { name: s.name, rows: ws ? XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) : [] }; });
      files.writeSpreadsheet(r.filePath, sheets);
      return { ok: true, path: r.filePath };
    } catch (e) { return { ok: false, error: e.message }; }
  }
  const ext = kind === 'html' ? 'html' : kind === 'svg' ? 'svg' : kind === 'markdown' ? 'md' : ({ python: 'py', javascript: 'js', typescript: 'ts', bash: 'sh', json: 'json', css: 'css', java: 'java', go: 'go', rust: 'rs' }[String(language).toLowerCase()] || 'txt');
  const r = await dialog.showSaveDialog(parent, { defaultPath: `${String(title || 'artifact').replace(/[^\w .-]+/g, '_').slice(0, 60)}.${ext}` });
  if (r.canceled || !r.filePath) return { canceled: true };
  fs.writeFileSync(r.filePath, String(content || ''));
  return { ok: true, path: r.filePath };
});

// ---------- Sentinel widget (floating status, tray) ----------
let sentinelInfo = { state: 'off' };
let sentinelWidget = null;
let computerWinWasUp = true; // the computer tool hides the main window while it works; it only comes back if it was up before (Sentinel works with it hidden)
/** A picture of the Artemis window itself (webContents.capturePage: no Screen Recording permission, works behind other windows).
 *  A minimized or hidden window is brought back for the capture only and put away again. View only. */
async function appScreenshot() {
  if (!win || win.isDestroyed()) throw new Error('The Artemis window is not open.');
  const wasMin = win.isMinimized();
  const wasHidden = !win.isVisible() && !wasMin;
  if (wasMin) win.restore(); else if (wasHidden) win.showInactive();
  if (wasMin || wasHidden) await new Promise((r) => setTimeout(r, 450));
  try {
    let img = await win.webContents.capturePage();
    if (!img || img.isEmpty()) throw new Error('Could not capture the Artemis window.');
    const { width, height } = img.getSize();
    const k = Math.min(1, 1024 / Math.max(width, height, 1));
    if (k < 1) img = img.resize({ width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) });
    const s = img.getSize();
    return { ok: true, text: `Screenshot of the Artemis window itself, ${s.width}x${s.height} pixels. View only: these coordinates do not match the screen, so do not click with them.`, image: 'data:image/jpeg;base64,' + img.toJPEG(80).toString('base64') };
  } finally {
    if (!win.isDestroyed()) { if (wasMin) win.minimize(); else if (wasHidden) win.hide(); }
  }
}

/** Runs fn (a screen capture) with the Artemis window in view: computer control normally minimizes it or hides it from screenshots. */
async function withArtemisVisible(fn) {
  if (!win || win.isDestroyed()) return fn();
  const wasMin = win.isMinimized();
  const wasHidden = !win.isVisible() && !wasMin;
  try { win.setContentProtection(false); } catch {}
  if (wasMin) win.restore(); else if (wasHidden) win.showInactive();
  if (!wasMin && !win.isFocused()) { try { win.moveTop(); } catch {} }
  await new Promise((r) => setTimeout(r, 450));
  try { return await fn(); }
  finally {
    if (!win.isDestroyed()) {
      if (wasMin) win.minimize(); else if (wasHidden) win.hide();
      if (!computerWinWasUp && computerRuns > 0) { try { win.setContentProtection(true); } catch {} }
    }
  }
}

const sentinelOn = () => sentinelInfo.state && sentinelInfo.state !== 'off';
const widgetInfo = () => (lock.isLocked() ? { state: sentinelInfo.state, locked: true } : sentinelInfo); // locked: no text of the conversation in the widget
// the floating widget duplicates the in-app voice UI, so it hides while the main window is up front
const appInFront = () => {
  if (getSettings().sentinelHideInApp !== true) return false;
  try { return !!(win && !win.isDestroyed() && win.isVisible() && !win.isMinimized() && win.isFocused()); } catch { return false; }
};
const appFocused = () => { try { return !!(win && !win.isDestroyed() && win.isVisible() && !win.isMinimized() && win.isFocused()); } catch { return false; } };
let frontTimer = null;
const syncSentinelSoon = () => { clearTimeout(frontTimer); frontTimer = setTimeout(() => { try { if (sentinelWidget) syncSentinel(); } catch {} }, 150); };
// One window for everything: the Quick chat / Quick search (shortcut, tray, menu) open the Sentinel widget on its Chat or Search tab.
// widgetQuick = the widget is up because of that (even with Sentinel off); the widget page tells us when to let go again ('hide-quick').
let widgetQuick = false, widgetQuickClosedAt = 0; // a tray click first blurs (closes) the widget, then arrives: that click means "close", not "open again"
function ensureWidget() {
  if (!sentinelWidget) sentinelWidget = createSentinelWidget({ BrowserWindow, screen, isDev: IS_DEV, getPos: () => getSettings().sentinelPos, setPos: (p) => saveSettings({ sentinelPos: p }), getSizes: () => getSettings().sentinelSizes, setSizes: (z) => saveSettings({ sentinelSizes: z }) });
  return sentinelWidget;
}
function openWidgetTab(tab, toggle) {
  if (lock.isLocked()) return;
  if (toggle && !widgetQuick && Date.now() - widgetQuickClosedAt < 350) return;
  ensureWidget();
  if (!widgetQuick && !sentinelWidget.isVisible()) sentinelWidget.center(); // a fresh Quick chat / Search opens in the middle of the screen
  widgetQuick = true;
  syncSentinel();
  sentinelWidget.focus();
  sentinelWidget.sendWhenReady('sentinel:cmd', { tab: tab === 'search' ? 'search' : 'chat', toggle: !!toggle });
}
function closeWidgetQuick() {
  if (!widgetQuick || !sentinelWidget) return;
  sentinelWidget.send('sentinel:cmd', { quick: 'close' });
  widgetQuick = false; widgetQuickClosedAt = Date.now(); syncSentinel();
}
/** Stands in for the old Quick window (electron/quick.js) for every caller: same methods, but they drive the Sentinel widget. */
const quickViaWidget = () => ({
  show: (on) => openWidgetTab(on === 'search' ? 'search' : 'chat', false),
  toggle: (on) => openWidgetTab(on === 'search' ? 'search' : 'chat', true),
  hide: () => closeWidgetQuick(),
  isVisible: () => widgetQuick && !!(sentinelWidget && sentinelWidget.isVisible()),
  resize: () => {}, keepOpen: () => {}, setMode: () => {},
  get window() { return sentinelWidget ? sentinelWidget.window : null; }
});
function syncSentinel() {
  ensureWidget();
  /* shown whether or not the Artemis window is in front (in front it only stops opening and closing by itself) */ if (sentinelOn() || sentinelInfo.err || widgetQuick) { sentinelWidget.show(); sentinelWidget.send('sentinel:state', widgetInfo()); sentinelWidget.send('sentinel:front', appFocused()); } // front: the widget stays put while you are in the app (no auto open / close)
  else sentinelWidget.hide();
  try { rebuildTray && rebuildTray(); } catch {}
}
ipcMain.on('sentinel:state', (_e, info) => { sentinelInfo = info && typeof info === 'object' ? info : { state: 'off' }; syncSentinel(); });
ipcMain.on('sentinel:level', (_e, v) => { sentinelWidget && sentinelWidget.send('sentinel:level', v); });
ipcMain.on('sentinel:grip', (_e, kind, a, b) => {
  if (!sentinelWidget) return;
  if (kind === 'start') sentinelWidget.gripStart();
  else if (kind === 'move') sentinelWidget.gripMove(Number(a) || 0, Number(b) || 0);
  else if (kind === 'end') sentinelWidget.gripEnd();
  else if (kind === 'reset') sentinelWidget.gripReset(String(a || ''));
});
ipcMain.on('sentinel:resize', (_e, h, mode, size) => { sentinelWidget && sentinelWidget.resize(h, mode, size); });
// The widget is a small chat client: it asks the main window's page (which owns the chats) for an artifact, a file preview, or to send
// a typed message to Sentinel's chat. The main window is never shown or focused for this.
const widgetAsks = new Map(); let widgetAskSeq = 0;
ipcMain.handle('sentinel:ask', (_e, what, arg) => new Promise((resolve) => {
  if (!win || win.isDestroyed() || win.webContents.isLoading()) { resolve(null); return; }
  const id = ++widgetAskSeq;
  const t = setTimeout(() => { widgetAsks.delete(id); resolve(null); }, 15000);
  widgetAsks.set(id, (v) => { clearTimeout(t); resolve(v); });
  win.webContents.send('sentinel:ask', { id, what: String(what || ''), arg });
}));
ipcMain.on('sentinel:answer', (_e, id, value) => { const f = widgetAsks.get(id); if (f) { widgetAsks.delete(id); f(value === undefined ? null : value); } });
// Voice control of the widget itself: move it to an edge of the screen, or expand / collapse / pin it (handled by the widget page).
// "Copy that": the clipboard from the main process (navigator.clipboard needs a focused window, and Sentinel works with it in the background).
ipcMain.handle('sentinel:copy', (_e, text) => { try { require('electron').clipboard.writeText(String(text || '').slice(0, 500000)); return true; } catch { return false; } });
ipcMain.handle('sentinel:widget', (_e, cmd) => {
  const c = String(cmd || '');
  if (!sentinelWidget) return false;
  if (/^(left|right|up|down|top|bottom|center)$/.test(c)) return sentinelWidget.moveTo(c);
  if (/^(expand|collapse|pin|unpin)$/.test(c)) { sentinelWidget.send('sentinel:cmd', c); return true; }
  if (c === 'hide-quick') { widgetQuick = false; widgetQuickClosedAt = Date.now(); syncSentinel(); return true; } // the widget page closed the Quick chat / Search
  return false;
});

// ---------- logs ----------

// ---------- voice ----------
/** Speech to text with the provider chosen in Settings → Voice. Used by the microphone, Sentinel, Telegram and the phone web chat. */
// The languages offered in Settings → Voice (src/lib/lang.mjs VOICE_LANGS). Whisper reports what it heard as a name ("turkish") or a code.
const STT_LANGS = { english: 'en', turkish: 'tr', azerbaijani: 'az', russian: 'ru', german: 'de', french: 'fr', spanish: 'es', italian: 'it', portuguese: 'pt', dutch: 'nl', polish: 'pl', ukrainian: 'uk', arabic: 'ar', persian: 'fa', hindi: 'hi', japanese: 'ja', chinese: 'zh', korean: 'ko' };
const sttLang = (v) => { const s = String(v || '').trim().toLowerCase(); if (STT_LANGS[s]) return STT_LANGS[s]; const c = s.split(/[-_]/)[0]; return Object.values(STT_LANGS).includes(c) ? c : ''; };
async function transcribeAudio({ audio, mime, language, hint } = {}) {
  try {
    const settings = getSettings();
    if (!settings.voiceSttProvider) return { ok: false, error: 'Pick a speech-to-text provider in Settings → Voice.' };
    const route = providersLib.resolve(`prov:${settings.voiceSttProvider}:x`, readProviders(), getProviderKey);
    if (route.error) return { ok: false, error: route.error };
    const buf = Buffer.from(audio || []);
    if (!buf.length) return { ok: false, error: 'Nothing was recorded.' };
    if (buf.length > 24 * 1024 * 1024) return { ok: false, error: 'The recording is too long (limit about 24 MB). Try a shorter message.' };
    const ext = /wav/.test(mime || '') ? 'wav' : /mp4|m4a|aac/.test(mime || '') ? 'mp4' : /mpeg|mp3/.test(mime || '') ? 'mp3' : /ogg|opus/.test(mime || '') ? 'ogg' : 'webm';
    const want = String(language || settings.voiceLanguage || '').trim().toLowerCase(); // '' or 'auto' = Whisper detects the language
    const fixed = /^[a-z]{2,3}$/.test(want) ? want : '';
    const url = providersLib.joinUrl(route.baseUrl, 'audio/transcriptions');
    // one request; verbose = also ask which language was heard
    const once = async (lang, verbose, prompt) => {
      const form = new FormData();
      form.append('file', new Blob([buf], { type: mime || 'audio/webm' }), `speech.${ext}`);
      form.append('model', settings.voiceSttModel || 'whisper-1');
      form.append('response_format', verbose ? 'verbose_json' : 'json');
      if (prompt) form.append('prompt', String(prompt).slice(0, 200));
      if (lang) form.append('language', lang);
      const tt = Date.now();
      logger.info('voice', `Speech-to-text started (${Math.round(buf.length / 1024)} KB, ${ext})`, { model: settings.voiceSttModel || 'whisper-1', language: lang || 'auto' });
      const res = await fetch(url, { method: 'POST', headers: { ...providersLib.headersFor(url), ...(route.key ? { authorization: `Bearer ${route.key}` } : {}) }, body: form, signal: AbortSignal.timeout(90000) });
      logger.info('voice', `Speech-to-text answered HTTP ${res.status} in ${((Date.now() - tt) / 1000).toFixed(1)}s`);
      const raw = await res.text();
      let j = null; try { j = JSON.parse(raw); } catch {}
      return { res, raw, j };
    };
    const fail = ({ res, raw, j }) => {
      const detail = (j && (j.error && (j.error.message || j.error) || j.message)) || raw.slice(0, 200);
      const h = res.status === 404 || res.status === 405 ? ' This endpoint does not support speech-to-text. Add OpenAI or Groq as a provider and choose it in Settings → Voice.' : res.status === 401 || res.status === 403 ? ' The key was rejected.' : '';
      logger.error('voice', `Speech-to-text failed HTTP ${res.status}`, { detail });
      return { ok: false, error: `Speech-to-text failed (HTTP ${res.status}): ${typeof detail === 'string' ? detail : JSON.stringify(detail)}.${h}` };
    };
    // language = the code of the language that was spoken when known (verbose_json or a fixed language); the renderer guesses it from the text otherwise
    const done = (j, lang) => { const text = String((j && j.text) ?? '').trim(); return text ? { ok: true, text, language: lang || '' } : { ok: false, error: 'No speech was recognised.' }; };
    if (fixed) { const r = await once(fixed, false, hint); return r.res.ok ? done(r.j, fixed) : fail(r); }
    // Automatic language: Whisper detects it (no language sent); verbose_json also says which language it heard.
    let r = await once('', true, hint);
    if (!r.res.ok && r.res.status === 400) r = await once('', false, hint); // a server without verbose_json
    if (!r.res.ok) return fail(r);
    const heard = r.j && r.j.language;
    const code = sttLang(heard);
    if (heard && !code) {
      // a short sentence is sometimes taken for Icelandic, Welsh or another language the user does not speak: redo it as English
      logger.info('voice', `Heard "${heard}", which is not one of the offered languages: trying English`);
      try { const x = await once('en', true, hint); if (x.res.ok && x.j && String(x.j.text || '').trim()) return done(x.j, 'en'); } catch {}
    }
    if (heard) logger.info('voice', `Speech-to-text language: ${code || heard}`);
    return done(r.j, code);
  } catch (e) { logger.error('voice', 'Speech-to-text failed: ' + ((e && e.message) || e)); return { ok: false, error: 'Speech-to-text failed: ' + ((e && e.message) || e) }; }
}

// ---------- Text-to-speech from a local or custom server (Kokoro, Piper, OpenAI-compatible /audio/speech) ----------

// ---------- Sentinel (wake phrase "Wake up", recognised offline on this computer) ----------
const SENTINEL_MODEL_URLS = [
  'https://ccoreilly.github.io/vosk-browser/models/vosk-model-small-en-us-0.15.tar.gz'
];
const sentinelFile = () => path.join(app.getPath('home'), '.artemis', 'models', 'vosk-small-en.tar.gz');
const sentinelReady = () => { try { return fs.statSync(sentinelFile()).size > 5 * 1024 * 1024; } catch { return false; } };
let sentinelBusy = false;

// ---------- Make.com ----------
const make = createMake({ getAuth: () => ({ token: getSecret('makeToken'), zone: getSettings().makeZone }) });

// Automations page: the user's own Make scenarios. These are the user's own clicks, so they do not need the chat approval step.
const makeReady = () => !!getSecret('makeToken');

const mediaDir = () => path.join(app.getPath('userData'), 'media');

/** Image/video generation through the providers picked in Settings → General (imageModel / videoModel = "prov:<provider>:<model>"). null when neither is set, so the tools stay hidden. */
function mediaApi(settings, signal) {
  const route = (id) => { const r = id ? providersLib.resolve(id, readProviders(), getProviderKey) : null; return r && !r.error ? r : null; };
  if (!route(settings.imageModel) && !route(settings.videoModel)) return null;
  const run = (kind, gen) => async (prompt, o = {}) => {
    const id = o.model && /^prov:/.test(o.model) ? o.model : (kind === 'video' ? settings.videoModel : settings.imageModel);
    const r = route(id);
    if (!r) throw new Error(`No ${kind} model is set up. Add a provider and pick a ${kind} model in Settings → General.`);
    const out = await gen({ baseUrl: r.baseUrl, key: r.key, dir: mediaDir(), signal: o.signal || signal, model: r.model, prompt, size: o.size, duration: o.duration });
    return { ...out, model: r.model };
  };
  return { image: run('image', mediaGen.generateImage), video: run('video', mediaGen.generateVideo) };
}


// ---------- learning pass: after a multi-step task a cheap model decides whether it is worth saving as a skill ----------
const learnLast = new Map(); // chat id -> time of the last proposal
function cheapModel(fallback) {
  const usable = readProviders().filter((p) => p.enabled !== false && p.baseUrl && (p.models || []).length && (!p.needsKey || getProviderKey(p.id)));
  const small = /(\b|[-_:.])(8b|7b|9b|mini|small|nano|haiku|flash|instant|lite|oss-20b|30b-a3b|gemma)(\b|[-_:.])/i;
  for (const p of usable) { const m = p.models.find((x) => small.test(x.id)); if (m) return `prov:${p.id}:${m.id}`; }
  return fallback;
}
const LEARN_SYSTEM = `You review a task that was just finished and decide whether it is worth saving as a reusable skill. A skill is short, specific, step-by-step instructions for a kind of task the user is likely to ask for again.
Be strict: most tasks are NOT worth saving (one-offs, simple questions, work already covered by an existing skill).
Never include secrets, passwords, API keys, personal data, or one-time values (specific names, dates, ids). Write general steps.
Answer in exactly one of these two formats and nothing else.
Format 1 (not worth it):
SAVE: no
Format 2 (worth it):
SAVE: yes
MODE: create
NAME: Short name
DESCRIPTION: ONE line saying when to use this skill
INSTRUCTIONS:
<markdown steps, at most 25 lines>
Use MODE: update only when the task clearly used or improved an existing skill from the list: NAME must then be exactly that skill's name and INSTRUCTIONS the COMPLETE improved text.`;
async function learnFromRun({ settings, root, userText, toolLog, finalText, signal, send, myApprovals, chatId, model, route }) {
  const chosen = settings.reflectModel ? liveModel(settings.reflectModel) : cheapModel(model);
  let r = providersLib.resolve(chosen, readProviders(), getProviderKey);
  if (r.error) r = route;
  const trace = toolLog.slice(0, 30).map((t, i) => `${i + 1}. ${t.name}${t.args ? ' ' + JSON.stringify(t.args).replace(/\s+/g, ' ').slice(0, 140) : ''}`).join('\n');
  const user = `Existing skills:\n${skills.indexText(root) || '(none)'}\n\nThe user asked:\n${String(userText).slice(0, 1500)}\n\nTools used, in order:\n${trace}\n\nThe final answer:\n${String(finalText).slice(0, 1500)}`;
  const res = await fetch(providersLib.joinUrl(r.baseUrl, 'chat/completions'), {
    method: 'POST', signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]),
    headers: { ...providersLib.headersFor(providersLib.joinUrl(r.baseUrl, 'chat/completions')), 'content-type': 'application/json', ...(r.key ? { authorization: `Bearer ${r.key}` } : {}) },
    body: JSON.stringify({ model: r.model, stream: false, max_tokens: 1200, temperature: 0.3, ...providersLib.routingBody(providersLib.joinUrl(r.baseUrl, 'chat/completions')), messages: [{ role: 'system', content: LEARN_SYSTEM }, { role: 'user', content: user }] })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  try { if (j.usage) recordUsage({ t: Date.now(), model: chosen, chat: chatId || '', project: '', source: 'learn', prompt: j.usage.prompt_tokens || 0, completion: j.usage.completion_tokens || 0, cached: 0, estimated: false }); } catch {}
  const text = String((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '').replace(/^```\w*\n?|```$/gm, '').trim();
  if (!/^\s*SAVE:\s*yes/i.test(text)) { logger.info('learn', 'Nothing worth saving from this task'); return; }
  const field = (k) => { const m = new RegExp('^' + k + ':[ \\t]*(.+)$', 'im').exec(text); return m ? m[1].trim() : ''; };
  const name = field('NAME'), description = field('DESCRIPTION');
  const body = (/^INSTRUCTIONS:[ \t]*\n?([\s\S]+)$/im.exec(text) || [])[1];
  const mode = /^update$/i.test(field('MODE')) && skills.find(name, root) ? 'update' : 'create';
  if (!name || !description || !body || !body.trim()) { logger.info('learn', 'The model answered without a usable skill'); return; }
  if (mode === 'create' && skills.find(name, root)) { logger.info('learn', `Skill "${name}" already exists`); return; }
  const toolName = mode === 'update' ? 'update_skill' : 'create_skill';
  const id = 'learn-' + Math.random().toString(36).slice(2, 8);
  send({ type: 'tool:call', id, name: toolName, args: { name, description, instructions: body.trim() } });
  const ok = await new Promise((resolve) => {
    myApprovals.add(id); approvals.set(id, resolve);
    send({ type: 'tool:approval', id, category: 'skill', summary: `${mode === 'update' ? 'Update' : 'Save new'} skill: ${name}` });
    setTimeout(() => { if (approvals.get(id) === resolve) { approvals.delete(id); resolve(false); } }, 120000);
  });
  if (!ok) { send({ type: 'tool:result', id, ok: true, denied: true, text: 'Not saved.' }); return; }
  const saved = skills.save({ name, description, body: body.trim(), scope: 'user', by: 'agent', mode }, root);
  if (!saved.ok) { send({ type: 'tool:result', id, ok: false, text: saved.error }); return; }
  send({ type: 'tool:result', id, ok: true, text: `${saved.updated ? 'Updated' : 'Saved'} skill "${saved.name}".` });
  send({ type: 'notice', text: `${saved.updated ? 'Updated' : 'Saved new'} skill: ${saved.name}` });
}

// A model id that does not belong to a provider (an old default, Telegram's or Sentinel's model) moves to the first enabled provider.
function liveModel(model) {
  const m = String(model || '');
  if (/^prov:/.test(m)) return model;
  const usable = readProviders().filter((p) => p.enabled !== false && p.baseUrl && (p.models || []).length && (!p.needsKey || getProviderKey(p.id)));
  const ok = usable.find((p) => p.needsKey && !p.local) || usable.find((p) => !p.local) || usable[0];
  if (!ok) return model;
  if (liveModel.last !== ok.id) { liveModel.last = ok.id; logger.info('chat', `Model "${m}" has no provider: using "${ok.name}" (${ok.models[0].id})`); }
  return `prov:${ok.id}:${ok.models[0].id}`;
}
// Pictures the user attaches, saved to disk for providers that cannot take them inline (a proxy in front of the Claude CLI): the model gets the file path and opens it with artemis_view_image.
const IMAGES_DIR = path.join(app.getPath('userData'), 'attachments');
function stashImages(messages) {
  return (messages || []).map((m) => {
    if (!Array.isArray(m.content)) return m;
    const parts = m.content.map((c) => {
      if (!c || c.type !== 'image_url') return c;
      const url = c.image_url && c.image_url.url;
      const mm = typeof url === 'string' ? /^data:image\/([a-z0-9+.-]+);base64,([\s\S]+)$/i.exec(url) : null;
      if (mm) {
        try {
          const buf = Buffer.from(mm[2], 'base64');
          const ext = { jpeg: 'jpg', jpg: 'jpg', png: 'png', gif: 'gif', webp: 'webp' }[mm[1].toLowerCase()] || 'png';
          const file = path.join(IMAGES_DIR, `img-${require('crypto').createHash('sha1').update(buf).digest('hex').slice(0, 16)}.${ext}`);
          fs.mkdirSync(IMAGES_DIR, { recursive: true });
          if (!fs.existsSync(file)) fs.writeFileSync(file, buf);
          return { type: 'text', text: `[Attached image: ${file}]` };
        } catch {}
      }
      return { type: 'text', text: '[Attached image]' };
    });
    // this proxy turns a list of parts into the text "[object Object]": hand it plain text only
    const flat = parts.every((c) => c && c.type === 'text');
    return { ...m, content: flat ? parts.map((c) => c.text).join('\n\n') : parts };
  });
}
async function executeRun({ requestId, model: model0, messages, project, system, maxTokens, send: rawSend, restrict, incognito, source, unattended, allowEdits, permMode, chatId, brain, brainPick, revote, agentsMode, toolsMode, effort, mentions, shellMode }) {
  const model = liveModel(model0);
  // where run_command goes in this run: the sandbox from Settings, unless the chat picked "this Mac" (only a chat in the window can)
  const sb = shellMode === 'host' && !unattended && !restrict ? null : currentSandbox();
  let usesFloat = false;
  const t0 = Date.now();
  const logEv = (ev) => {
    const who = ev.agent && ev.agent.name ? `${ev.agent.name}: ` : '';
    switch (ev.type) {
      case 'error': logger.error('chat', ev.message || 'Error', { chat: chatId, model }); break;
      case 'notice': logger.warn('chat', ev.text); break;
      case 'tool:call': { // only a short summary: args can hold file contents or secrets
        const a = ev.args && typeof ev.args === 'object' ? ev.args : {};
        let s = ''; try { s = typeof ev.args === 'string' ? ev.args : JSON.stringify(a); } catch {}
        logger.info('tool', `${who}${ev.name}`, { keys: Object.keys(a).slice(0, 12), preview: String(s || '').replace(/\s+/g, ' ').slice(0, 120) });
        break;
      }
      case 'tool:result': (ev.ok ? logger.info : logger.warn)('tool', `${who}${ev.denied ? 'denied' : ev.ok ? 'ok' : 'failed'}: ${String(ev.text || '').replace(/\s+/g, ' ').slice(0, 160)}`); break;
      case 'tool:approval': logger.info('approval', `${ev.agent ? (ev.agent.name || ev.agent) + ' · ' : ''}${ev.summary || ev.category}`); break;
      case 'agent:start': logger.info('agent', `${(ev.agent && ev.agent.name) || ev.name || 'agent'} started`, { task: ev.task }); break;
      case 'agent:done': logger.info('agent', `${(ev.agent && ev.agent.name) || ev.name || 'agent'} finished`); break;
      case 'council': logger.info('council', `Answerer: ${ev.verdict && ev.verdict.answerer} (${ev.verdict && ev.verdict.voters} voters)`, { votes: ev.votes, verdict: ev.verdict }); break;
      case 'brain': logger.info('council', `Brain: ${ev.name}${ev.model ? ' · ' + ev.model : ''}`); break;
      case 'done': logger.info('chat', `Run finished in ${((Date.now() - t0) / 1000).toFixed(1)}s`, { chat: chatId }); break;
      default:
    }
  };
  // A chat that Telegram is continuing: what you type here and the answer also go to Telegram.
  const mirror = (!incognito && !unattended && source !== 'phone' && source !== 'schedule' && chatId && typeof remote !== 'undefined' && remote && remote.mirrorTarget) ? (() => { try { return remote.mirrorTarget(chatId); } catch { return null; } })() : null;
  const mSteps = [''];
  const userText = (() => { const m = Array.isArray(messages) ? messages[messages.length - 1] : null; const c = m && m.content; return (typeof c === 'string' ? c : (c || []).filter((p) => p.type === 'text').map((p) => p.text).join(' ')).trim(); })();
  if (mirror && userText) mirror.send('💻 ' + userText).catch(() => {});
  const toolLog = []; let lastText = '', hadError = false, stopReason = '';
  const send = (ev) => {
    if (ev.type === 'error' && ev.message) stopReason = stopReason || String(ev.message);
    else if (ev.type === 'notice' && /^Stopped:/.test(String(ev.text || ''))) stopReason = String(ev.text).replace(/^Stopped:\s*/, '');
    try { logEv(ev); } catch {}
    if (ev.type === 'tool:call') toolLog.push({ name: ev.name, args: ev.args });
    else if (ev.type === 'step:new') lastText = '';
    else if (ev.type === 'chunk' && !ev.agent) lastText += ev.text;
    else if (ev.type === 'error') hadError = true;
    else if (ev.type === 'notice' && /^Stopped:/.test(String(ev.text || ''))) hadError = true; // a run that was cut short is not a model for a skill
    if (mirror) { if (ev.type === 'chunk' && !ev.agent) mSteps[mSteps.length - 1] += ev.text; else if (ev.type === 'step:new') mSteps.push(''); }
    rawSend(ev); if (usesFloat && floater?.isOpen()) floater.send(ev);
  };
  logger.info('chat', `Run started · ${model}${brain ? ' · brain: ' + brain : ''}${source ? ' · ' + source : ''}`, { chat: chatId, messages: Array.isArray(messages) ? messages.length : 0, incognito: !!incognito });
  const settings = getSettings();
  logger.info('chat', `Web search engine: ${settings.searchEngine === 'brave' ? (getSecret('braveKey') ? 'Brave (key saved)' : 'Brave (NO KEY saved)') : settings.searchProvider ? 'AI search model' : 'none'}`);
  const route = providersLib.resolve(model, readProviders(), getProviderKey);
  if (route.error) { send({ type: 'error', message: route.error }); send({ type: 'done' }); return; }
  const key = route.key;
  const controller = new AbortController();
  runs.set(requestId, controller);
  const myApprovals = new Set();
  controller.signal.addEventListener('abort', () => { for (const id of myApprovals) { const r = approvals.get(id); if (r) { approvals.delete(id); r(false); } } }, { once: true }); // Stop while a tool waits for approval: decline it so the run can end
  // per-chat switch: 'on' / 'off' overrides the global "Let Artemis use agents" setting
  const useAgents = agentsMode === 'on' ? true : agentsMode === 'off' ? false : settings.delegateEnabled !== false;
  const perm = ['ask', 'edits', 'auto'].includes(permMode) ? permMode : (settings.autoApproveEdits ? 'edits' : 'ask');
  const root = project?.folder && fs.existsSync(project.folder) ? project.folder : null;
  const fileRoot = root || defaultFilesDir();

  const lim0 = limitState();
  if (lim0.blocked) { send({ type: 'error', message: lim0.blocked }); send({ type: 'done' }); runs.delete(requestId); return; }
  if (lim0.warn) send({ type: 'notice', text: lim0.warn });

  try {
    // Brains: talk as one personality, or let the council vote on who answers and what to use.
    let persona = ''; let runRoute = route; let personaModel = model;
    const sel = brain !== undefined && brain !== null ? String(brain) : String(settings.defaultBrain || '');
    const wanted = unattended && sel === 'council' ? '' : sel;
    if (wanted) {
      const resolveFor = (id) => providersLib.resolve(id || model, readProviders(), getProviderKey);
      const brainUsage = (u) => { if (!incognito) recordUsage({ t: Date.now(), model: u.model, chat: chatId || '', project: project?.name || '', source: 'council', prompt: u.prompt, completion: u.completion, cached: 0, estimated: u.estimated }); };
      let chosen = null; let hint = '';
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      const lastText = lastUser ? (typeof lastUser.content === 'string' ? lastUser.content : Array.isArray(lastUser.content) ? lastUser.content.map((p) => p.text || '').join(' ') : '') : '';
      const stuck = wanted === 'council' && !revote && brainPick ? brains.find(brainPick) : null;
      if (stuck) { chosen = stuck; send({ type: 'notice', text: `Council: ${stuck.name} keeps answering. Use "Re-vote" to ask the council again.` }); }
      else if (wanted === 'council' && lastText.trim().split(/\s+/).length <= 3 && !(brainPick)) { chosen = brains.list()[0]; }
      else if (wanted === 'council') {
        const all = brains.list();
        let spent = 0;
        const tail = messages.slice(-4).map((m) => `${m.role === 'user' ? 'USER' : 'ASSISTANT'}: ${(typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? m.content.map((p) => p.text || '').join(' ') : '').slice(0, 1200)}`).filter((l) => l.length > 12).join('\n');
        send({ type: 'council:start' });
        const out = await brainsLib.deliberate({
          brains: all, conversation: tail,
          skillsIndex: settings.skillsEnabled !== false ? skills.indexText(root) : '', agentsIndex: useAgents ? agents.indexText(root) : '',
          call: async (b, sys, user) => {
            const r = resolveFor(b.model);
            if (r.error) throw new Error(r.error);
            return brainsLib.askJson({ url: providersLib.joinUrl(r.baseUrl, 'chat/completions'), key: r.key, model: r.model, system: sys, user, signal: controller.signal, onUsage: (u) => { spent += (u.prompt || 0) + (u.completion || 0); brainUsage({ ...u, model: b.model || model }); } });
          }
        });
        send({ type: 'council', votes: out.votes, verdict: out.verdict, tokens: spent });
        chosen = all.find((b) => b.name === out.verdict.answerer) || all[0];
        hint = brainsLib.verdictHint(out.verdict);
      } else chosen = brains.find(wanted);
      if (chosen) {
        persona = brainsLib.personaText(chosen) + (hint ? '\n\n' + hint : '');
        send({ type: 'brain', name: chosen.name, role: chosen.role, slug: chosen.slug, model: chosen.model || '', council: wanted === 'council' });
        if (chosen.model) {
          const r = resolveFor(chosen.model);
          if (r.error) send({ type: 'notice', text: `${chosen.name}'s model is not available (${r.error}) so the chat model was used.` });
          else { runRoute = r; personaModel = chosen.model; }
        }
      }
    }
    await runAgent({
      persona, sessionId: chatId || undefined, userData: app.getPath('userData'), mentions: Array.isArray(mentions) ? mentions.slice(0, 20) : [],
      baseUrl: runRoute.baseUrl, key: runRoute.key, model: runRoute.model, noToolCalls: !!runRoute.noTools, messages: runRoute.noTools ? stashImages(messages) : messages, maxTokens: maxTokens || settings.maxTokens, reasoningEffort: effort === 'auto' ? '' : (effort || settings.reasoningEffort || ''),
      custom: system, personality: require('./personality').text(settings), userName: settings.profileName || '', userAbout: settings.profileAbout || '', userLocation: settings.profileLocation || '', project, root: fileRoot, defaultRoot: !root,
      // with a sandbox, run_command never touches this computer, so it is also allowed in phone/gateway (restricted) and scheduled tasks
      sandbox: sb, webEnabled: settings.webEnabled, shellEnabled: settings.shellEnabled && (!restrict || !!sb),
      searchVia: (() => { if (settings.searchEngine === 'brave') { const k = getSecret('braveKey'); return k ? (q, sig) => require('./web').braveSearch({ key: k, query: q, signal: sig }) : async () => { throw new Error('Brave Search is selected but no key is saved. Open Settings → Tools → Search engine and paste the Brave key'); }; } if (!settings.searchProvider) return null; const r = providersLib.resolve(`prov:${settings.searchProvider}:x`, readProviders(), getProviderKey); if (r.error) return null; return (q, sig) => require('./web').endpointSearch({ baseUrl: r.baseUrl, key: r.key, query: q, signal: sig, model: settings.searchModel || 'perplexity/sonar' }); })(),
      computer: settings.computerEnabled && !restrict && process.platform === 'darwin' ? computer : null,
      schedule: unattended || restrict ? null : { list: () => scheduler.list(), save: (j) => scheduler.save({ ...j, projectId: j.projectId !== undefined ? j.projectId : (project?.id || null) }), remove: (id) => scheduler.remove(id), hooks: hooksTools, heartbeat: heartbeatTools },
      lockApp: unattended || restrict ? null : () => lock.lock('ai'),
      appShot: unattended || restrict ? null : appScreenshot, withArtemisVisible: unattended || restrict ? null : withArtemisVisible,
      notes: settings.notesAi !== false ? notesAi : null,
      library: settings.notesAi !== false ? library : null,
      term: settings.shellEnabled && !restrict && !unattended && !sb && process.platform !== 'win32' ? termApi : null, // the terminal panel is this computer's shell: off while the sandbox is on
      browser: settings.browserTools !== false && !restrict && !unattended ? browser.agent(requestId) : null,
      phone: phoneNow(), media: mediaApi(settings, controller.signal), mcp: settings.connectorsEnabled === false ? null : sb ? sandboxedMcp() : mcp, mcpLazy: settings.connectorsLazy !== false, fullFileAccess: settings.fullFileAccess !== false, lazyTools: settings.toolsLazy !== false,
      skills: settings.skillsEnabled !== false ? { index: () => skills.indexText(root), get: (n) => skills.get(n, root), save: (o) => skills.save(o, root) } : null,
      autoLearn: settings.autoLearn !== false && !incognito && !unattended,
      chats: settings.chatSearchEnabled !== false && !incognito ? chatsApi() : null,
      delegateEnabled: useAgents,
      agents: { find: (n) => agents.find(n, root), list: () => agents.list(root), index: () => agents.indexText(root) },
      resolveModel: (id) => providersLib.resolve(id, readProviders(), getProviderKey),
      usageModel: personaModel,
      make: settings.makeEnabled !== false && getSecret('makeToken') ? make : null,
      computerHooks: {
        onStart: () => {
          const viaWidget = sentinelOn(); // Sentinel is on: its widget shows the steps, the floating step panel stays closed
          usesFloat = !viaWidget;
          if (++computerRuns > 1) { if (!viaWidget) floater?.open(); return; }
          try { if (!viaWidget) new Notification({ title: 'Artemis is controlling your computer', body: 'Press Cmd/Ctrl+Shift+Esc to stop.' }).show(); } catch {}
          try { globalShortcut.register('CommandOrControl+Shift+Escape', stopAll); } catch {}
          // the widget stays visible to you but out of the screenshots the model takes (like the floating panel)
          try { const sw = sentinelWidget && sentinelWidget.window; if (sw) sw.setContentProtection(true); } catch {}
          if (viaWidget) { try { if (sentinelWidget) syncSentinel(); } catch {} } else floater?.open(); // the widget is shown, but stays compact (no auto-expand)
          quick?.hide();
          // You were working in Artemis: it steps aside (minimizes) so the screen behind it can be seen, and comes back at the end.
          // You were somewhere else (e.g. talking to Sentinel from another app): the window is never moved or brought forward;
          // it is only hidden from screenshots, so you stay exactly where you are.
          computerWinWasUp = !!win && !win.isDestroyed() && win.isVisible() && !win.isMinimized() && win.isFocused();
          if (win && !win.isDestroyed()) { if (computerWinWasUp) win.minimize(); else { try { win.setContentProtection(true); } catch {} } }
        },
        onEnd: () => {
          usesFloat = false;
          if (--computerRuns > 0) return;
          try { globalShortcut.unregister('CommandOrControl+Shift+Escape'); } catch {}
          setTimeout(() => { if (computerRuns === 0) floater?.close(); }, 600);
          try { const sw = sentinelWidget && sentinelWidget.window; if (sw) sw.setContentProtection(false); } catch {}
          if (win && !win.isDestroyed()) { try { win.setContentProtection(false); } catch {} if (computerWinWasUp) { logRaise('computer control finished; the window was in front when it started, so it comes back'); win.restore(); win.show(); } }
        }
      },
      shouldStop: () => limitState().blocked,
      runTokenBudget: Number(settings.runTokenBudget) || undefined, contextTokens: Number(settings.contextTokens) || undefined,
      toolsEnabled: toolsMode === 'on' ? true : toolsMode === 'off' ? false : settings.toolsEnabled, memoryEnabled: settings.memoryEnabled && !incognito, incognito: !!incognito,
      onUsage: incognito ? null : (u) => recordUsage({ t: Date.now(), model: u.model || model, chat: chatId || '', project: project?.name || '', source: source || 'app', prompt: u.prompt, completion: u.completion, cached: u.cached || 0, cacheWrite: u.cacheWrite || 0, estimated: u.estimated }),
      autoApprove: unattended ? !!allowEdits : perm !== 'ask',
      autoAll: !unattended && perm === 'auto',
      agentAutoApprove: !unattended && (perm === 'auto' || (perm === 'edits' && settings.agentWriteApproval === false)),
      memoryApi: memoryApi(() => send({ type: 'memory:changed' })),
      onCompact: incognito || settings.memoryEnabled === false || settings.memoryFlush === false || !initCore().ws ? null : (text) => flushFromRun(text, { model, chatId, project }),
      approve: (info) => unattended ? Promise.resolve(info.category === 'phone' || (info.name === 'run_command' && !!sb)) : new Promise((resolve) => {
        myApprovals.add(info.id);
        approvals.set(info.id, resolve);
        if (approvalMeta.size > 200) approvalMeta.clear();
        approvalMeta.set(info.id, { name: info.name, category: info.category });
        send({ type: 'tool:approval', id: info.id, category: info.category, session: !!info.session, summary: info.summary, agent: info.agent });
      }),
      send, signal: controller.signal
    });
    // Learning pass: only for ordinary app chats, after a real multi-step task, never when a skill was already saved in it.
    try {
      const work = toolLog.filter((t) => !/^(use_skill|create_skill|update_skill|memory_|search_chats|notes_search)/.test(t.name));
      const toolsOn = toolsMode === 'on' ? true : toolsMode === 'off' ? false : settings.toolsEnabled;
      if (settings.skillsEnabled !== false && settings.autoLearn !== false && toolsOn && !incognito && !unattended && !restrict && !source && !hadError && !controller.signal.aborted
        && work.length >= 3 && !toolLog.some((t) => /^(create|update)_skill$/.test(t.name)) && Date.now() - (learnLast.get(chatId || '') || 0) > 10 * 60 * 1000) {
        learnLast.set(chatId || '', Date.now());
        await learnFromRun({ settings, root, userText, toolLog, finalText: lastText, signal: controller.signal, send, myApprovals, chatId, model, route });
      }
    } catch (e) { if (e && e.name !== 'AbortError') logger.warn('learn', 'Learning pass failed: ' + ((e && e.message) || e)); }
  } catch (err) {
    if (err.name !== 'AbortError') send({ type: 'error', message: err.message || String(err) });
  } finally {
    for (const id of myApprovals) { const r = approvals.get(id); if (r) { approvals.delete(id); r(false); } }
    runs.delete(requestId);
    browser.agentDone(requestId);
    if (mirror) { const final = mSteps.filter(Boolean).join('\n\n').trim(); if (final) { mirror.addTurn(userText, final); mirror.send(final).catch(() => {}); } }
    send({ type: 'done' });
    // A task that stopped on its own (error, repeat guard, limit) while you were elsewhere: say so with a notification.
    // Not when you pressed Stop yourself, and not when the Artemis window is in front (you can see it there).
    try {
      const aborted = !!(controller && controller.signal && controller.signal.aborted);
      const looking = !!(win && !win.isDestroyed() && win.isFocused());
      if (stopReason && !aborted && !looking && !unattended && Notification.isSupported()) {
        new Notification({ title: 'Artemis stopped', body: stopReason.slice(0, 180), silent: false }).show();
        logger.info('chat', 'Stop notification shown: ' + stopReason.slice(0, 120));
      }
    } catch {}
  }
}

ipcMain.handle('chat:run', (e, { requestId, model, messages, project, system, maxTokens, incognito, permMode, chatId, brain, brainPick, revote, agentsMode, toolsMode, effort, mentions, shellMode }) => {
  const wc = e.sender;
  const send = (ev) => { if (!wc.isDestroyed()) wc.send('chat:event', { requestId, ...ev }); };
  return executeRun({ requestId, model, messages, project, system, maxTokens, send, incognito: !!incognito, permMode, chatId, brain, brainPick, revote, agentsMode, toolsMode, effort, mentions, shellMode });
});
ipcMain.handle('chat:compact', (_e, o = {}) => compactSummary(o));
async function compactSummary({ model, messages, chatId, incognito } = {}) {
  try {
    const settings = getSettings();
    const m = liveModel(model || settings.model);
    const route = providersLib.resolve(m, readProviders(), getProviderKey);
    if (route.error) return { ok: false, error: route.error };
    if (!Array.isArray(messages) || !messages.length) return { ok: false, error: 'Nothing to compact.' };
    const summary = await summarizeAll(messages, {
      url: providersLib.joinUrl(route.baseUrl, 'chat/completions'), key: route.key, model: route.model, signal: AbortSignal.timeout(120000),
      onUsage: incognito ? null : (u) => recordUsage({ t: Date.now(), model: m, chat: chatId || '', project: '', source: 'compact', prompt: u.prompt, completion: u.completion, cached: 0, estimated: u.estimated })
    });
    return { ok: true, summary };
  } catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
}
// Automatic chat title: one small completion with the first message and the start of the reply (see electron/titles.js).
// A failure keeps the old title; it is logged once per session.
let titleWarned = false;
ipcMain.handle('chat:title', async (_e, o = {}) => {
  try {
    const settings = getSettings();
    if (settings.autoTitles === false || o.incognito) return { ok: false, error: 'Automatic titles are off.' };
    const own = liveModel(o.model || settings.model);
    let m = settings.titleModel ? liveModel(settings.titleModel) : own;
    let route = providersLib.resolve(m, readProviders(), getProviderKey);
    if (route.error && m !== own) { m = own; route = providersLib.resolve(m, readProviders(), getProviderKey); }
    if (route.error) throw new Error(route.error);
    const url = providersLib.joinUrl(route.baseUrl, 'chat/completions');
    const r = await titlesLib.requestTitle({ url, key: route.key, model: route.model, headers: providersLib.headersFor(url), extraBody: providersLib.routingBody(url),
      first: String(o.first || ''), reply: String(o.reply || ''), recent: Array.isArray(o.recent) ? o.recent : [] });
    if (r.usage) recordUsage({ t: Date.now(), model: m, chat: o.chatId || '', project: '', source: 'title', prompt: r.usage.prompt, completion: r.usage.completion, cached: 0, estimated: false });
    return r.title ? { ok: true, title: r.title } : { ok: false, error: 'The model gave no usable title.' };
  } catch (e) {
    const msg = (e && e.message) || String(e);
    if (!titleWarned) { titleWarned = true; logger.warn('titles', 'Could not make a chat title (keeping the old one): ' + msg); } else logger.debug('titles', 'Title failed: ' + msg);
    return { ok: false, error: msg };
  }
});
ipcMain.handle('chat:abort', (_e, requestId) => { runs.get(requestId)?.abort(); });
function stopAll() { for (const c of runs.values()) c.abort(); computer?.stopRecording?.().catch(() => {}); } // a screen recording is finalized, not left running
ipcMain.handle('float:stop', () => stopAll());
let computer = null;
let floater = null;
let computerRuns = 0;
let remote = null;

// ---------- tray, quick chat, shortcuts ----------
// Every path that brings the main window forward goes through here (or logs itself), with the reason, so a report of
// "Artemis jumped to the front" can be traced in the logs. Nothing a run does on its own (Sentinel, agent browser, computer tools) may call it.
function logRaise(reason) { try { logger.info('window', `Bringing the main window forward: ${reason}${win && !win.isDestroyed() && !win.isFocused() ? ' (it was in the background)' : ''}`); } catch {} }
function showMain(reason) {
  logRaise(typeof reason === 'string' ? reason : 'user action');
  if (!win || win.isDestroyed()) createWindow();
  if (win.isMinimized()) win.restore();
  const mac = process.platform === 'darwin';
  // show on the current Space (even over a fullscreen app) instead of jumping back to the window's old Space
  if (mac) { try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true }); } catch {} }
  win.show(); win.focus();
  try { app.focus({ steal: true }); } catch {} // otherwise macOS can leave the window behind the app that was in front
  if (mac) setTimeout(() => { try { if (win && !win.isDestroyed()) win.setVisibleOnAllWorkspaces(false, { skipTransformProcessType: true }); } catch {} }, 300);
  quick?.hide();
}

// ---------- app lock: window state, password prompt, webcam photo, Telegram alert ----------
const lockHidden = new Set(); // windows hidden when the app locked, shown again on unlock
function hideForLock() {
  try { quick?.hide(); } catch {}
  try { browser.setCovered(false); } catch {} // the browser view floats above the page: hide it behind the lock screen
  for (const w of BrowserWindow.getAllWindows()) {
    if (w === win || (sentinelWidget && w === sentinelWidget.window) || w.isDestroyed() || !w.isVisible()) continue;
    lockHidden.add(w); try { w.hide(); } catch {}
  }
}
function showAfterUnlock() {
  try { browser.setCovered(true); } catch {}
  for (const w of lockHidden) { try { if (!w.isDestroyed()) w.show(); } catch {} }
  lockHidden.clear();
}
function onLockState(st) {
  for (const w of BrowserWindow.getAllWindows()) { try { w.webContents.send('lock:state', st); } catch {} }
  if (st.locked) hideForLock(); else showAfterUnlock();
  try { if (sentinelWidget) syncSentinel(); rebuildTray && rebuildTray(); } catch {}
}
/** Asks the main window for the password (to approve a sensitive action when Touch ID is not available). Resolves null when cancelled. */
function askPasswordInWindow(reason) {
  return new Promise((resolve) => {
    if (!win || win.isDestroyed()) return resolve(null);
    const id = crypto.randomUUID(); lockAuthWaiting.set(id, resolve);
    showMain('a password is needed to approve an action');
    try { win.webContents.send('lock:auth-request', { id, reason }); } catch { lockAuthWaiting.delete(id); return resolve(null); }
    setTimeout(() => { if (lockAuthWaiting.delete(id)) resolve(null); }, 90000);
  });
}
/** One frame from the webcam, asked of the main window's page (null when there is no camera, no permission, or no window). */
function snapPhoto() {
  return new Promise((resolve) => {
    if (!win || win.isDestroyed()) return resolve(null);
    const id = crypto.randomUUID(); snapWaiting.set(id, resolve);
    try { win.webContents.send('lock:snap', { id }); } catch { snapWaiting.delete(id); return resolve(null); }
    setTimeout(() => { if (snapWaiting.delete(id)) resolve(null); }, 10000);
  });
}
const alertQueue = []; let alertTimer = null;
async function flushAlerts() {
  alertTimer = null;
  while (alertQueue.length) {
    const a = alertQueue[0];
    const ph = phoneNow();
    try {
      if (!ph) throw new Error('Telegram is not connected and paired (Settings → Phone)');
      if (a.photo) { try { await ph.sendPhoto(a.photo, a.text); } catch { await ph.send(a.text + '\n(The photo could not be sent.)'); } } else await ph.send(a.text);
      alertQueue.shift(); logger.info('lock', 'Unauthorized-access alert sent to Telegram');
    } catch (e) {
      a.tries = (a.tries || 0) + 1;
      if (a.tries >= 30) { alertQueue.shift(); logger.error('lock', 'Giving up on an alert: ' + ((e && e.message) || e)); continue; }
      logger.warn('lock', 'The alert is not sent yet (' + ((e && e.message) || e) + '); trying again in a minute');
      alertTimer = setTimeout(flushAlerts, 60000); return;
    }
  }
}
/** Too many failed attempts: a notice on this Mac, and a Telegram message (with a webcam photo when that is on). */
async function onLockAlert(info) {
  const cfg = lock.getConfig();
  logger.warn('lock', `Unauthorized access: ${info.attempts} failed ${info.kind} attempts, locked for ${info.minutes} min`);
  try { if (Notification.isSupported()) new Notification({ title: 'Artemis is locked', body: `${info.attempts} failed attempts. Locked for ${info.minutes} min.` }).show(); } catch {}
  if (!cfg.alertTelegram) return;
  const what = { voice: 'a voice that is not yours', password: 'a wrong password or recovery code', touchid: 'Touch ID' }[info.kind] || info.kind;
  const when = new Date(info.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const text = `Unauthorized access attempt on ${os.hostname()}\n${info.attempts} failed attempts (${what}) at ${when}. Artemis is locked for ${info.minutes} min.`;
  const photo = cfg.photoOnLockdown ? await snapPhoto() : null;
  alertQueue.push({ text, photo, tries: 0 });
  if (!alertTimer) await flushAlerts();
}

/** Settings → Security "Send test": the same message and photo as a real alert, sent now (not queued), so a wrong setup shows up here. */
async function testLockAlert() {
  const ph = phoneNow();
  if (!ph) return { ok: false, error: 'Telegram is not connected and paired yet (Settings → Phone).' };
  const cfg = lock.getConfig();
  const text = `Test alert from Artemis on ${os.hostname()}. This is how an unauthorized-access alert will look.`;
  try {
    const photo = cfg.photoOnLockdown ? await snapPhoto() : null;
    if (photo) { try { await ph.sendPhoto(photo, text); } catch { await ph.send(text + '\n(The photo could not be sent.)'); } } else await ph.send(text + (cfg.photoOnLockdown ? '\n(No camera photo: allow the camera in Settings → Access.)' : ''));
    return { ok: true };
  } catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
}

const SHORTCUT_KEYS = ['quickChatShortcut', 'quickSearchShortcut', 'paletteShortcut', 'paletteFromQuickShortcut', 'sentinelShortcut', 'lockShortcut', 'sentinelPtt'];
let registeredAccels = []; // global shortcuts Artemis registered, unregistered before re-registering and on quit
let paletteSnap = { chats: [], actions: [] }; // last chats and actions the main window sent; the Quick window's Search tab shows them
// Same rules as src/lib/shortcuts.mjs (main cannot load the renderer's ESM): one form per platform, '' = invalid
const ACCEL_MODS = { command: 'Meta', cmd: 'Meta', super: 'Meta', meta: 'Meta', control: 'Ctrl', ctrl: 'Ctrl', alt: 'Alt', option: 'Alt', altgr: 'Alt', shift: 'Shift' };
function normAccel(accel) {
  const parts = String(accel || '').trim().replace(/\+\+$/, '+Plus').split('+').map((x) => x.trim());
  if (!parts[0] || parts.some((x) => !x)) return '';
  const mods = new Set(); let key = '';
  for (const x of parts) {
    const l = x.toLowerCase();
    if (l === 'commandorcontrol' || l === 'cmdorctrl') mods.add(process.platform === 'darwin' ? 'Meta' : 'Ctrl');
    else if (ACCEL_MODS[l]) mods.add(ACCEL_MODS[l]);
    else if (key || !ACCEL_KEY.test(l)) return '';
    else key = l === 'return' ? 'enter' : l === 'esc' ? 'escape' : l === 'del' ? 'delete' : l;
  }
  return key ? ['Meta', 'Ctrl', 'Alt', 'Shift'].filter((m) => mods.has(m)).concat(key).join('+') : '';
}
const ACCEL_KEY = /^([a-z0-9,./`[\]\\;'=-]|f([1-9]|1\d|2[0-4])|space|tab|backspace|delete|del|insert|return|enter|escape|esc|up|down|left|right|home|end|pageup|pagedown|plus)$/;
/** A menu item only shows a valid accelerator: Menu.buildFromTemplate throws on a bad one. */
const menuAccel = (a) => (normAccel(a) ? String(a).trim() : undefined);
/**
 * The Quick chat shortcut (default Cmd/Ctrl+Shift+Space) opens or hides the Quick window on its Chat tab, from any app.
 * With "paletteFromQuickShortcut" on and the Artemis window in front it opens the command palette instead (the old behaviour).
 */
function onQuickChatShortcut() {
  logger.info('shortcut', 'Quick chat shortcut pressed' + (appFocused() ? ' (Artemis in front)' : ''));
  if (lock.isLocked()) return; // locked: no Quick window
  quick.toggle(appFocused() && !quick.isVisible() ? 'search' : 'chat'); // inside Artemis the shortcut opens Search (to jump somewhere); from another app it opens the chat
}
/** The Quick search shortcut (off by default) opens the Quick window straight on its Search tab. */
function onQuickSearchShortcut() { if (lock.isLocked()) return; quick.toggle('search'); }
/** The lock shortcut (default ⇧⌥⌘L) locks Artemis from any app. */
function onLockShortcut() { const r = lock.lock('shortcut'); logger.info('shortcut', r.ok ? 'Lock shortcut pressed: locked' : 'Lock shortcut pressed: ' + r.error); }
/** The Sentinel shortcut (default Cmd/Ctrl+Shift+A) turns Sentinel on or off from any app. The window stays where it is (hidden or minimized is fine). */
function onSentinelShortcut() { logger.info('shortcut', 'Sentinel on/off shortcut pressed'); if (win && !win.isDestroyed()) win.webContents.send('sentinel:action', 'toggle'); else logger.warn('shortcut', 'Sentinel shortcut: no main window'); }
/**
 * Push-to-talk from any app (Settings → Voice, "sentinelPtt"). globalShortcut only reports the key press, never the release, and
 * on macOS a registered accelerator is consumed system-wide, our own window included. So:
 * - while the Artemis main window is focused the accelerator is unregistered, and the renderer's keydown/keyup handler does
 *   hold-to-talk (hold to speak, let go to send);
 * - in any other app it is registered and works as tap-to-talk: the renderer gets "ptt" and starts listening (turning Sentinel on
 *   if needed), the next press sends, and a pause in speech also ends it.
 * Settings records only combinations (⌘ / ⌥ / ⌃ + a key, e.g. Alt+Space -> accelerator "Alt+Space"), which can all be global. An
 * older single-key or lone-modifier setting (Right Option, a key without Cmd/Ctrl/Alt) still works, but only in the window.
 */
let pttAccel = ''; // the accelerator to register while the main window is not focused ('' = none)
let pttOn = false; // registered right now
function onPttShortcut() { logger.info('shortcut', 'Push-to-talk shortcut pressed (another app in front)'); if (win && !win.isDestroyed()) win.webContents.send('sentinel:action', 'ptt'); }
function syncPttShortcut() {
  const focused = !!(win && !win.isDestroyed() && win.isFocused && win.isFocused());
  const want = !!pttAccel && !focused;
  if (want === pttOn) return;
  try {
    if (want) pttOn = globalShortcut.register(pttAccel, onPttShortcut);
    else { globalShortcut.unregister(pttAccel); pttOn = false; }
  } catch { pttOn = false; }
}
function unregisterShortcuts() {
  for (const a of registeredAccels) { try { globalShortcut.unregister(a); } catch {} }
  registeredAccels = [];
  if (pttOn) { try { globalShortcut.unregister(pttAccel); } catch {} }
  pttAccel = ''; pttOn = false; // also while a shortcut box in Settings records (shortcuts:pause): no window focus change brings it back
}
/** (Re-)registers the global shortcuts from settings. Failures end up in shortcutError / shortcutErrors, which Settings shows. */
function applyShortcut() {
  shortcutError = ''; shortcutErrors = {};
  unregisterShortcuts();
  const st = getSettings();
  const taken = new Map(); // normalized accelerator -> setting key that has it
  const fail = (k, msg) => { shortcutErrors[k] = msg; shortcutError = (shortcutError ? shortcutError + ' ' : '') + msg; logger.warn('shortcut', `${k}: ${msg}`); };
  const globals = [['quickChatShortcut', 'Quick chat', onQuickChatShortcut], ['quickSearchShortcut', 'Quick search', onQuickSearchShortcut], ['sentinelShortcut', 'Sentinel on/off', onSentinelShortcut], ['lockShortcut', 'Lock Artemis', onLockShortcut]];
  for (const [k, label, fn] of globals) {
    const accel = String(st[k] || '').trim();
    if (!accel) continue;
    const norm = normAccel(accel);
    if (!norm) { fail(k, `Invalid shortcut "${accel}". Example: CommandOrControl+Shift+Space`); continue; }
    if (taken.has(norm)) { fail(k, `"${accel}" is already the ${taken.get(norm)} shortcut.`); continue; }
    try {
      if (globalShortcut.register(accel, fn)) { registeredAccels.push(accel); taken.set(norm, label); logger.info('shortcut', `${label}: ${accel} registered`); }
      else fail(k, `Could not register "${accel}". Another app may be using it.`);
    } catch (e) { fail(k, `Invalid shortcut "${accel}". Example: CommandOrControl+Shift+Space`); }
  }
  // the palette shortcut is matched in the renderer, so it is not registered; a global shortcut with the same keys would swallow it
  const pal = String(st.paletteShortcut || '').trim();
  if (pal) {
    const norm = normAccel(pal);
    if (!norm) fail('paletteShortcut', `Invalid shortcut "${pal}". Example: CommandOrControl+K`);
    else if (taken.has(norm)) fail('paletteShortcut', `"${pal}" is already the ${taken.get(norm)} shortcut.`);
    else if (norm) taken.set(norm, 'Command palette');
  }
  // push-to-talk: registered only while the main window is not focused (see syncPttShortcut); tried once here so a clash shows in Settings
  const accel = pttAccelerator(st.sentinelPtt);
  if (accel) {
    const norm = normAccel(accel);
    if (taken.has(norm)) fail('sentinelPtt', `This key is already the ${taken.get(norm)} shortcut.`);
    else {
      try {
        if (globalShortcut.register(accel, onPttShortcut)) { pttAccel = accel; pttOn = true; syncPttShortcut(); logger.info('shortcut', `Push-to-talk: ${accel} registered for other apps`); }
        else fail('sentinelPtt', 'Could not use this key from other apps: another app may be using it. It still works while Artemis is in front.');
      } catch { fail('sentinelPtt', 'Could not use this key from other apps. It still works while Artemis is in front.'); }
    }
  }
}

/** The application menu. Rebuilt when a shortcut setting changes, so the File menu shows the configured keys. */
function buildAppMenu() {
  const st = getSettings();
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [
      { label: 'New chat', accelerator: 'CmdOrCtrl+N', click: () => win?.webContents.send('menu', 'new-chat') },
      { label: 'New tab', accelerator: 'CmdOrCtrl+T', click: () => win?.webContents.send('menu', 'new-tab') },
      { label: 'Close tab', accelerator: 'CmdOrCtrl+W', click: () => win?.webContents.send('menu', 'close-tab') },
      { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: () => win?.webContents.send('menu', 'settings') },
      { type: 'separator' },
      // the renderer handles the palette shortcut itself (registerAccelerator: false), the menu only shows the key and works by click
      { label: 'Command palette', accelerator: menuAccel(st.paletteShortcut), registerAccelerator: false, click: () => win?.webContents.send('menu', 'palette') },
      { label: 'Quick chat', accelerator: menuAccel(st.quickChatShortcut), registerAccelerator: false, click: () => quick?.show('chat') },
      { label: 'Quick search', accelerator: menuAccel(st.quickSearchShortcut), registerAccelerator: false, click: () => quick?.show('search') },
      { type: 'separator' },
      { role: process.platform === 'darwin' ? 'close' : 'quit', accelerator: process.platform === 'darwin' ? 'CmdOrCtrl+Shift+W' : undefined }
    ] },
    { role: 'editMenu' }, { role: 'viewMenu' },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, ...(process.platform === 'darwin' ? [{ type: 'separator' }, { role: 'front' }] : [])] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function applyLoginItem() {
  // macOS refuses this for the unsigned dev build (prints "Operation not permitted"), so only the installed app sets it.
  if (!app.isPackaged) return;
  try { app.setLoginItemSettings({ openAtLogin: !!getSettings().launchAtLogin }); } catch (e) { logger.warn('app', 'Could not change the launch-at-login setting: ' + ((e && e.message) || e)); }
}

let rebuildTray = null;
function createTray() {
  const dir = path.join(__dirname, 'assets');
  const mac = process.platform === 'darwin';
  // nativeImage cannot read SVG; use PNG (on macOS as a template image: fits light/dark menu bars, @2x is automatic)
  let img = nativeImage.createFromPath(path.join(dir, mac ? 'trayTemplate.png' : 'tray.png'));
  if (img.isEmpty()) img = nativeImage.createFromPath(path.join(dir, 'tray.png')).resize({ width: 18, height: 18 });
  if (mac) img.setTemplateImage(true);
  tray = new Tray(img);
  tray.setToolTip('Artemis');
  const menu = () => Menu.buildFromTemplate([
    { label: 'Quick chat', accelerator: menuAccel(getSettings().quickChatShortcut), registerAccelerator: false, click: () => { if (!lock.isLocked()) quick.show('chat'); } },
    { label: 'Quick search', accelerator: menuAccel(getSettings().quickSearchShortcut), registerAccelerator: false, click: () => { if (!lock.isLocked()) quick.show('search'); } },
    { label: 'Open Artemis', click: () => showMain('tray menu: Open Artemis') },
    { label: 'New chat', click: () => { showMain('tray menu: New chat'); win?.webContents.send('menu', 'new-chat'); } },
    { type: 'separator' },
    { label: sentinelOn() ? 'Turn Sentinel off' : 'Turn Sentinel on (say "Wake up")', click: () => win?.webContents.send('sentinel:action', 'toggle') },
    { label: lock.isLocked() ? 'Locked' : 'Lock Artemis', enabled: lock.enabled() && !lock.isLocked(), click: () => lock.lock('tray') },
    ...(updater.ready && updater.canInstall() ? [{ label: `Restart to update to ${updater.ready.version}`, click: () => { if (updater.restartNow()) { quitting = true; app.quit(); } } }] : []),
    { label: 'Stop all running tasks', click: () => stopAll() },
    { type: 'separator' },
    { label: 'Quit Artemis', click: () => { quitting = true; app.quit(); } }
  ]);
  rebuildTray = () => { try { if (process.platform === 'linux') tray.setContextMenu(menu()); tray.setToolTip(sentinelOn() ? 'Artemis · Sentinel is listening' : 'Artemis'); } catch {} };
  if (process.platform === 'linux') tray.setContextMenu(menu());
  else {
    tray.on('click', () => { if (!lock.isLocked()) quick.toggle(); });
    tray.on('right-click', () => tray.popUpContextMenu(menu()));
  }
}


// ---------- connectors (MCP) ----------
// Connector secrets (env values, headers, client secret, OAuth tokens) are stored as 'enc:<base64>' via safeStorage.
// Plain values from older files still load. Not encStr/decStr: those strip whitespace, which header values need.
const MCP_ENC = 'enc:';
const mcpEnc = (v) => {
  if (typeof v !== 'string' || !v || v.startsWith(MCP_ENC)) return v;
  try { return safeStorage.isEncryptionAvailable() ? MCP_ENC + safeStorage.encryptString(v).toString('base64') : v; } catch { return v; }
};
const mcpDec = (v) => {
  if (typeof v !== 'string' || !v.startsWith(MCP_ENC)) return v;
  try { return safeStorage.decryptString(Buffer.from(v.slice(MCP_ENC.length), 'base64')); } catch (e) { logger.warn('mcp', 'A connector secret could not be decrypted: ' + e.message); return ''; }
};
const mapVals = (o, f) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, f(v)])) : o);
const mapMcpSecrets = (c, f) => (!c || typeof c !== 'object' ? c : {
  ...c, env: mapVals(c.env, f), headers: mapVals(c.headers, f),
  ...(c.clientSecret !== undefined ? { clientSecret: f(c.clientSecret) } : {}),
  ...(c.oauth && typeof c.oauth === 'object' ? { oauth: { ...c.oauth, accessToken: f(c.oauth.accessToken), refreshToken: f(c.oauth.refreshToken) } } : {})
});
const readMcpList = () => { const l = readJson('mcp', []); return Array.isArray(l) ? l.map((c) => mapMcpSecrets(c, mcpDec)) : []; };
const writeMcpList = (list) => writeJson('mcp', (list || []).map((c) => mapMcpSecrets(c, mcpEnc)));

const decideTool = (id, ok) => { const r = approvals.get(id); approvalMeta.delete(id); if (r) { approvals.delete(id); r(!!ok); } };
ipcMain.handle('phone:send-file', async (_e, p) => {
  const phone = phoneNow();
  if (!phone) return { ok: false, error: 'No phone paired. Pair Telegram in Settings → Phone.' };
  if (!p || !fs.existsSync(p) || !fs.statSync(p).isFile()) return { ok: false, error: 'File not found.' };
  try { await phone.sendFile(p, path.basename(p)); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
});
function defaultFilesDir() { const docs = app.getPath('documents'); const old = path.join(docs, 'Artemis'); const d = fs.existsSync(old) ? old : path.join(docs, 'Artemis'); try { fs.mkdirSync(d, { recursive: true }); } catch {} return d; }


// ---------- scheduled tasks ----------
const toWinSafe = (ch, p) => { try { if (win && !win.isDestroyed()) win.webContents.send(ch, p); } catch {} };
async function runScheduled(job) {
  const st = getSettings();
  const requestId = 'sch-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const proj = job.projectId ? (readJson('projects', []).find((p) => p.id === job.projectId) || null) : null;
  const project = proj ? { name: proj.name, instructions: proj.instructions, ...(proj.folder && fs.existsSync(proj.folder) ? { folder: proj.folder } : {}) } : null;
  const model = job.model || (st.scheduleModel ? liveModel(st.scheduleModel) : '') || st.model; // the task's own model, else the one set for scheduled tasks, else the default
  let text = '', error = '';
  toWinSafe('schedule:start', { requestId, jobId: job.id, name: job.name, prompt: job.prompt, model, projectId: job.projectId || null });
  const send = (ev) => {
    if (ev.type === 'step:new') text = '';
    if (ev.type === 'chunk') text += ev.text;
    if (ev.type === 'error') error = ev.message;
    toWinSafe('chat:event', { ...ev, requestId });
  };
  // A job marked as a plain reminder is just delivered: no model runs. Every other job is a task for the AI.
  if (job.reminder) {
    text = String(job.prompt || '').trim();
    send({ type: 'chunk', text }); send({ type: 'done' });
  } else await executeRun({ requestId, messages: [{ role: 'user', content: job.prompt }], send, restrict: true, source: 'schedule', unattended: true, allowEdits: job.allowEdits,
    model, system: (st.systemPrompt || '') + '\n\nThis is a scheduled task and it is running right now. Do it directly and report the result. The task text is an instruction for you, even when it reads like a message to the user: carry it out (for a reminder, state the reminder to the user) and never reply to it as if it were a chat message. Nobody is there to answer: never ask questions, never ask which method to use, and do not write notes or files unless the task says so. If the task is only a reminder, state the reminder. send_to_phone (Telegram) works in scheduled tasks without asking: use it when the task says to send something to the phone.', maxTokens: st.maxTokens, project });
  const summary = (error ? `Failed: ${error}` : text.trim() || 'Finished.').slice(0, 600);
  try { if (Notification.isSupported()) { const n = new Notification({ title: job.name, body: summary.slice(0, 160) }); n.on('click', () => showMain('scheduled task notification clicked')); n.show(); } } catch {}
  if (job.notifyPhone) {
    try {
      const ph = phoneNow();
      if (ph) await ph.send(`⏰ ${job.name}\n\n${summary}`);
      else logger.warn('app', 'A scheduled task should be sent to the phone, but Telegram is not connected and paired', { job: job.name });
    } catch (e) { logger.error('app', 'Sending a scheduled task result to Telegram failed: ' + ((e && e.message) || e), { job: job.name }); }
  }
  return error ? { ok: false, error } : { ok: true };
}
const scheduler = createScheduler({
  read: () => readJson('schedules', []), write: (l) => writeJson('schedules', l),
  changed: () => toWinSafe('schedule:changed', {}), run: (job) => runScheduled(job)
});

// ---------- heartbeat and webhooks (electron/core/heartbeat.js, hooks.js, hookservice.js) ----------
// Both run unattended, like scheduled tasks, and only where the background jobs run (here, unless the headless gateway does).
const BG_NOTE = 'This run was started by Artemis itself (a heartbeat check or a webhook), not by a message from the user. Nobody is there to answer: never ask questions and never wait for approval. Do what the instructions say, keep the answer short, and do not write notes or files unless the instructions say so.';
/** One unattended run without window events. Returns the final text. */
async function backgroundRun({ prompt, model: m0, allowEdits, projectId, source }) {
  const st = getSettings();
  const model = (m0 ? liveModel(m0) : '') || (st.scheduleModel ? liveModel(st.scheduleModel) : '') || st.model;
  const requestId = 'bg-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  let text = '', error = '';
  const send = (ev) => { if (ev.type === 'step:new') text = ''; if (ev.type === 'chunk') text += ev.text; if (ev.type === 'error') error = ev.message; };
  await executeRun({ requestId, messages: [{ role: 'user', content: prompt }], send, restrict: true, source, unattended: true, allowEdits: !!allowEdits, model, system: (st.systemPrompt || '') + '\n\n' + BG_NOTE, maxTokens: st.maxTokens, project: projectFor(projectId) });
  return { text: text.trim(), error, model };
}
/** Tells the user: a saved chat, a notification and (when asked) Telegram. */
async function backgroundTell({ title, user, text, model, source, phone, icon }) {
  const c = initCore();
  if (c.sessions) { try { c.sessions.appendTurn('bg-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), { writer: 'desktop', user, assistant: text, title, via: source, source, model }); mirrorChats(); } catch (e) { logger.warn('db', 'Could not save the ' + source + ' chat: ' + e.message); } }
  try { if (Notification.isSupported()) { const n = new Notification({ title, body: text.slice(0, 160) }); n.on('click', () => showMain(source + ' notification clicked')); n.show(); } } catch {}
  if (phone) {
    const ph = phoneNow();
    if (ph) await ph.send(`${icon} ${title}\n\n${text.slice(0, 3500)}`);
    else logger.warn('app', `${title}: should go to the phone, but Telegram is not connected and paired`);
  }
}
const hbLib = require('./core/heartbeat');
const wsFile = (rel) => { const c = initCore(); return c.ws ? c.ws.abs(rel) : null; };
const heartbeat = hbLib.createHeartbeats({
  list: () => readJson('heartbeats', null) || hbLib.fromSettings(getSettings()), // the old single heartbeat (settings) until the list is first saved
  saveList: (l) => { writeJson('heartbeats', l); toWinSafe('automation:changed', {}); },
  checklist: (hb) => { const c = initCore(); return c.ws ? (c.ws.readText(hbLib.fileOf(hb)) || '') : null; },
  writeChecklist: (hb, text) => { const f = wsFile(hbLib.fileOf(hb)); if (!f) throw new Error('Heartbeats need the memory workspace (Settings → Tools → Memory).'); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.tmp', text.endsWith('\n') ? text : text + '\n'); fs.renameSync(f + '.tmp', f); },
  removeChecklist: (hb) => { const f = wsFile(hbLib.fileOf(hb)); if (f) fs.rmSync(f, { force: true }); },
  run: ({ prompt, model }) => backgroundRun({ prompt, model, source: 'heartbeat' }),
  deliver: ({ text, model, hb }) => backgroundTell({ title: hb.name === 'Heartbeat' ? 'Heartbeat' : `Heartbeat: ${hb.name}`, user: `Heartbeat check (${hbLib.fileOf(hb)})`, text, model, source: 'heartbeat', phone: hb.phone !== false, icon: '💓' }),
  readState: () => readJson('heartbeat-state', {}), writeState: (x) => { writeJson('heartbeat-state', x); toWinSafe('automation:changed', {}); },
  log: coreLog('heartbeat')
});
const hooksLib = require('./core/hooks');
const hooks = hooksLib.createHooks({
  read: () => readJson('hooks', []), write: (l) => { writeJson('hooks', l); try { fs.chmodSync(dataFile('hooks'), 0o600); } catch {} toWinSafe('automation:changed', {}); },
  run: (hook, ev) => backgroundRun({ prompt: ev.prompt, model: hook.model, allowEdits: hook.allowEdits, projectId: hook.projectId, source: 'webhook' }),
  deliver: (hook, { text, event }) => backgroundTell({ title: `Webhook: ${hook.name}`, user: `Webhook "${hook.name}"${event ? ` · ${event}` : ''}`, text, source: 'webhook', phone: hook.notifyPhone !== false, icon: '🔔', model: hook.model }),
  log: coreLog('webhooks')
});
const hookService = require('./core/hookservice').createHookService({
  hooks, owner: 'desktop', settings: () => getSettings(), tunnelToken: () => getSecret('hooksTunnelToken'),
  writeState: (x) => { writeJson('hooks-state', x); toWinSafe('automation:changed', {}); }, log: coreLog('webhooks')
});
/** What the Scheduled page shows: the state written by whichever process serves the webhooks. */
function hooksInfo() {
  const st = getSettings();
  let x = readJson('hooks-state', null);
  if (x && x.pid !== process.pid && !gatewayLib.alive(x.pid)) x = null; // written by a process that is gone
  if (x && x.pid === process.pid) x = hookService.info();
  return { enabled: !!st.hooksEnabled, port: Number(st.hooksPort) || 8790, tunnelMode: st.hooksTunnel || 'off', publicUrlSetting: st.hooksPublicUrl || '', hasTunnelToken: !!getSecret('hooksTunnelToken'),
    running: !!(x && x.running), owner: x ? x.owner : null, error: x ? x.error : '', localUrl: x ? x.localUrl : '', publicUrl: x ? x.publicUrl : '', tunnel: x ? x.tunnel : { mode: 'off', state: 'off' },
    cloudflared: !!require('./core/tunnel').findCloudflared() };
}
const hookUrls = (h, info = hooksInfo()) => ({ local: `http://127.0.0.1:${info.port}/hooks/${h.name}`, public: info.publicUrl ? `${info.publicUrl}/hooks/${h.name}` : '' });
// what the agent's tools see (schedule group): create / list / delete webhooks, change the heartbeat
const hooksTools = {
  list: () => hooks.list().map((h) => ({ ...h, urls: hookUrls(h) })),
  save: (o) => { const h = hooks.save(o); if (!getSettings().hooksEnabled) { saveSettings({ hooksEnabled: true }); hookService.sync().catch(() => {}); } return { ...h, urls: hookUrls(h, { ...hooksInfo(), port: Number(getSettings().hooksPort) || 8790 }) }; },
  remove: (id) => hooks.remove(id), info: () => hooksInfo()
};
const heartbeatTools = {
  list: () => heartbeat.status(),
  save: (o) => { const hb = heartbeat.save(o); toWinSafe('automation:changed', {}); return heartbeat.status().find((x) => x.id === hb.id); },
  remove: (id) => { heartbeat.remove(id); toWinSafe('automation:changed', {}); }
};

// ---------- built-in terminal ----------
const { createTerminals } = require('./terminal');
const termLast = new Map(); // session id -> time of last output
const terminals = createTerminals({
  emit: (ch, p) => { if (ch === 'term:data' && p) termLast.set(p.id, Date.now()); for (const w of BrowserWindow.getAllWindows()) { try { if (!w.isDestroyed()) w.webContents.send(ch, p); } catch {} } },
  defaultCwd: () => app.getPath('home')
});
const termWindows = new Map(); // session id -> its own window

// The agent shares one visible terminal session with the user (opened on demand, shown as a dock tab).
let agentTerm = null;
const stripAnsi = (t) => String(t).replace(/\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[()][A-Za-z0-9]|\x1b[=>]|\r(?!\n)/g, '');
const tailLines = (id, n) => { const sn = terminals.snapshot(id); if (!sn.ok) return ''; const l = stripAnsi(sn.data).split('\n'); return l.slice(-n).join('\n').trim(); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function ensureAgentTerm() {
  if (agentTerm) { const sn = terminals.snapshot(agentTerm); if (sn.ok && !sn.exited) return agentTerm; }
  const r = terminals.open({ cols: 120, rows: 32, cwd: undefined });
  if (!r.ok) throw new Error(r.error || 'Could not start the terminal.');
  agentTerm = r.id;
  if (win && !win.isDestroyed()) win.webContents.send('term:docked', { id: r.id }); // shown in the window, which is not brought forward
  return r.id;
}
const termApi = {
  async run(text, waitMs) {
    const id = ensureAgentTerm();
    await sleep(agentTerm && !terminals.snapshot(id).data ? 700 : 0);
    termLast.set(id, Date.now());
    terminals.input(id, text);
    const t0 = Date.now();
    await sleep(350);
    while (Date.now() - t0 < waitMs && Date.now() - (termLast.get(id) || 0) < 700) await sleep(150);
    return tailLines(id, 80);
  },
  // Waits at most waitMs, but returns as soon as the terminal has been quiet for 2 s: a command that already finished must not keep the tool "running" for the whole wait.
  async read(n, waitMs) {
    const id = ensureAgentTerm();
    if (waitMs) { const t0 = Date.now(); while (Date.now() - t0 < waitMs && Date.now() - (termLast.get(id) || 0) < 2000) await sleep(200); }
    return tailLines(id, n);
  }
};

// ---------- Files library (everything you attach is kept here) ----------
const { createLibrary } = require('./library');
const library = createLibrary({ getRoot: () => getSettings().filesFolder || path.join(defaultFilesDir(), 'Files'), files });

// ---------- notes (markdown knowledge base) ----------
const { createNotes } = require('./notes');
const notesStore = createNotes({ getRoot: () => getSettings().notesFolder || (fs.existsSync(path.join(app.getPath('documents'), 'Ares Notes')) ? path.join(app.getPath('documents'), 'Ares Notes') : path.join(app.getPath('documents'), 'Artemis Notes')) });
// Notes changed outside the Notes page (the AI, Sentinel, a connector, the phone): tell the window so the list and an open note update without a reload.
let notesTimer = null; const notesTouched = new Set();
const notifyNotes = (p) => {
  if (p) notesTouched.add(String(p));
  clearTimeout(notesTimer);
  notesTimer = setTimeout(() => { const paths = [...notesTouched]; notesTouched.clear(); try { if (win && !win.isDestroyed()) win.webContents.send('notes:changed', paths); } catch {} }, 100);
};
const notesAi = { ...notesStore };
for (const k of ['write', 'create', 'createFolder', 'rename', 'move', 'remove', 'saveAsset']) {
  notesAi[k] = (...a) => { const r = notesStore[k](...a); notifyNotes(k === 'create' || k === 'createFolder' ? '' : a[0]); if (r && r.path) notifyNotes(r.path); return r; };
}
function openTermWindow(id, float) {
  const old = termWindows.get(id);
  if (old && !old.isDestroyed()) { old.show(); old.focus(); return old; }
  const tw = new BrowserWindow({
    width: 860, height: 500, minWidth: 360, minHeight: 200, title: 'Artemis Terminal', backgroundColor: '#101010',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default', trafficLightPosition: { x: 12, y: 11 }, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  if (float) { tw.setAlwaysOnTop(true, 'floating'); try { tw.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true }); } catch {} }
  tw.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  if (IS_DEV) tw.loadURL('http://localhost:5173/#terminal=' + id);
  else tw.loadFile(path.join(__dirname, '..', 'dist', 'renderer', 'index.html'), { hash: 'terminal=' + id });
  termWindows.set(id, tw);
  tw.on('closed', () => { if (termWindows.get(id) === tw) { termWindows.delete(id); if (!tw.__docked) terminals.close(id); } });
  return tw;
}

// ---------- macOS permissions ----------
const permissions = createPermissions({ systemPreferences, desktopCapturer, Notification, shell });

// ---------- Artemis as an MCP server (other apps can control Artemis) ----------
const { createMcpServer } = require('./mcp-server');
const { buildArtemisTools } = require('./artemis-tools');
let mcpServerError = '';
const mcpToken = () => { let t = getSecret('mcpToken'); if (!t) { t = require('crypto').randomBytes(24).toString('hex'); setSecret('mcpToken', t); } return t; };
// Settings changed from outside the window: save, apply the native theme and tell the window to reload them.
function applyOutsideSettings(patch) {
  saveSettings(patch);
  if (['theme', 'palette', 'appearance', 'accent', 'textSize'].some((k) => k in patch)) { nativeThemeFor(); broadcastTheme(); }
  toWinSafe('app:changed', {});
}
async function confirmOutside({ title, detail }) {
  if (getSettings().mcpAlwaysAllow) return 'once'; // the user chose "Always allow" in an earlier prompt
  // The question must be seen even when Artemis is in the background: bring it up and show a free-standing dialog.
  // The main window itself stays where it is (minimized / hidden / behind your app); only the free-standing dialog comes up.
  logRaise('an outside app asked for approval through the Artemis MCP server (dialog only)');
  try { app.focus({ steal: true }); } catch {}
  try { new Notification({ title: 'Artemis needs your answer', body: String(title || '').slice(0, 120) }).show(); } catch {}
  const r = await dialog.showMessageBox({
    type: 'question', buttons: ['Allow once', 'Allow for 10 minutes', 'Always allow', 'Deny'], defaultId: 3, cancelId: 3, noLink: true,
    message: title, detail: String(detail || '').slice(0, 800) + '\n\nAn outside app is asking through the Artemis MCP server.\n"Always allow" stops these questions (you can turn them back on in Settings → Access).'
  });
  if (r.response === 2) { saveSettings({ mcpAlwaysAllow: true }); return 'once'; }
  return r.response === 0 ? 'once' : r.response === 1 ? 'grant' : false;
}
const mcpServer = createMcpServer({
  isLocked: () => lock.isLocked(),
  getToken: () => (getSettings().mcpServerEnabled ? getSecret('mcpToken') : ''),
  log: (lvl, msg) => logger[lvl === 'warn' ? 'warn' : 'info']('mcp-server', msg),
  tools: () => buildArtemisTools({
    control: remote.control, getSettings, applySettings: applyOutsideSettings, notes: notesAi, term: termApi, lockNow: () => lock.lock('mcp'),
    skills: () => skills.list(null).map((x) => ({ name: x.name, description: x.description, enabled: x.enabled })), confirm: confirmOutside,
    imagesDir: IMAGES_DIR,
    files: {
      defs: () => tools.definitions({ hasFolder: true, shellEnabled: true }).filter((x) => ['list_dir', 'read_file', 'search_files', 'write_file', 'edit_file', 'create_folder', 'move_file', 'delete_file', 'run_command'].includes(x.function.name)),
      projects: () => readJson('projects', []).filter((p) => p.folder).map((p) => ({ name: p.name, folder: p.folder, instructions: p.instructions || '' })),
      rootOf: (ref) => {
        const ps = readJson('projects', []).filter((p) => p.folder); const q = String(ref || '').trim().toLowerCase();
        const p = q ? (ps.find((x) => x.id === ref || String(x.name).toLowerCase() === q) || ps.find((x) => String(x.name).toLowerCase().includes(q))) : (ps.length === 1 ? ps[0] : null);
        if (!p) throw new Error(ps.length ? 'Pass "project": one of ' + ps.map((x) => `"${x.name}"`).join(', ') : 'No project with a folder yet. The user can create one in Artemis (Projects).');
        return p.folder;
      },
      run: (name, args, o) => tools.run(name, args, { root: o.root, approve: o.approve, session: new Set(), autoApprove: false, userData: app.getPath('userData') })
    },
    computer: { run: (a) => { if (!computer) throw new Error('Computer control is only available on macOS.'); return computer.run(a); } },
    themes: () => listThemes().themes.map((t) => ({ id: t.id, name: t.name, group: t.group, dark: t.dark, family: t.family }))
  })
});
async function syncMcpServer() {
  const st = getSettings();
  try {
    if (mcpServer.running() && (!st.mcpServerEnabled || mcpServer.port() !== Number(st.mcpServerPort))) await mcpServer.stop();
    if (st.mcpServerEnabled && !mcpServer.running()) { mcpToken(); await mcpServer.start(Math.min(65535, Math.max(1024, Number(st.mcpServerPort) || 8788))); logger.info('mcp-server', `Listening on 127.0.0.1:${mcpServer.port()}`); }
    mcpServerError = '';
  } catch (e) { mcpServerError = e && e.code === 'EADDRINUSE' ? `Port ${st.mcpServerPort} is already in use. Pick another one.` : String((e && e.message) || e); logger.error('mcp-server', mcpServerError); }
}
const mcpServerInfo = () => {
  const st = getSettings();
  return { enabled: !!st.mcpServerEnabled, running: mcpServer.running(), alwaysAllow: !!st.mcpAlwaysAllow, port: Number(st.mcpServerPort) || 8788, token: st.mcpServerEnabled ? getSecret('mcpToken') : '', error: mcpServerError };
};

// ---------- sharing the data folder with the headless gateway ----------
// The desktop app and `artemis gateway` can run at the same time on one data folder. Chats: both write artemis.db,
// and changes made by the other side are pushed to the window (chats:external), merged by message id.
// Background services (scheduled tasks, the Telegram bot, the gateway API) run in one place only: in the headless
// gateway while it runs, otherwise here. The lock files say who is alive.
const lockFile = (mode) => path.join(app.getPath('userData'), `${mode}.lock`);
const readLock = (mode) => { try { const l = JSON.parse(fs.readFileSync(lockFile(mode), 'utf8')); return l && l.pid && gatewayLib.alive(l.pid) ? l : null; } catch { return null; } };
const headlessActive = () => !!readLock('headless');
/** While the headless gateway owns the Telegram bot, the app sends to the phone through it (POST /v1/phone/send). */
function headlessPhone() {
  if (!headlessActive()) return null;
  const d = gatewayLib.readDiscovery(gatewayFile());
  if (!d || d.mode !== 'headless') return null;
  const post = async (body) => {
    const r = await fetch(`http://${d.host || '127.0.0.1'}:${d.port}/v1/phone/send`, { method: 'POST', headers: { authorization: `Bearer ${d.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
  };
  return { send: (text) => post({ text }), sendMd: (markdown) => post({ markdown }), sendFile: (file, caption) => post({ file, caption }), sendPhoto: (photo, caption) => post({ photo, caption }) };
}
const phoneNow = () => (remote && remote.phone()) || headlessPhone();
function pushExternal() {
  const c = coreState.db ? coreState : null;
  if (!c || !c.sessions || !win || win.isDestroyed()) return;
  try {
    if (c.sessions.seq() === pushedSeq) return;
    const ch = c.sessions.changesSince(pushedSeq, { exclude: 'renderer' });
    pushedSeq = ch.seq;
    if (!ch.chats.length && !ch.deleted.length) return;
    // pushed chats count as the window's only once a save from the window contains them (a save already on its way does not)
    for (const id of ch.deleted) rendererKnown.delete(String(id));
    win.webContents.send('chats:external', { chats: ch.chats.filter((x) => !x.incognito), deleted: ch.deleted });
  } catch (e) { logger.warn('db', 'Could not pass chat changes to the window: ' + e.message); }
}
let bgOwner = null, schedWatch = 0;
/** Moves scheduled tasks, Telegram and the gateway to wherever they should run now. */
function roleTick() {
  const owner = headlessActive() ? 'headless' : 'desktop';
  if (owner === 'desktop' && bgOwner === 'desktop') hookService.sync().catch(() => {}); // follows the settings (port, tunnel)
  try { const m = fs.statSync(dataFile('schedules')).mtimeMs; if (schedWatch && m !== schedWatch) toWinSafe('schedule:changed', {}); schedWatch = m; } catch {}
  if (owner === bgOwner) return;
  const first = bgOwner === null;
  bgOwner = owner;
  if (owner === 'headless') {
    logger.info('app', 'The headless gateway is running on this data folder: scheduled tasks, Telegram and the gateway API run there now');
    try { scheduler.stop(); } catch {}
    try { heartbeat.stop(); } catch {}
    hookService.stop().catch(() => {});
  } else {
    if (!first) logger.info('app', 'The headless gateway stopped: scheduled tasks, Telegram and the gateway API run in the app again');
    try { scheduler.start(); } catch {}
    try { heartbeat.start(); } catch {}
  }
  if (!first || owner === 'headless') { try { remote && remote.reconfigure().catch(() => {}); } catch {} }
  syncGateway().catch(() => {});
  if (owner === 'desktop') setTimeout(() => hookService.sync().catch(() => {}), first ? 0 : 3000); // give the headless one time to let go of the port
  toWinSafe('app:changed', {});
}
// usage written by the headless gateway (its own file, so neither side overwrites the other)
let hlUsage = { mtime: 0, list: [] };
const headlessUsage = () => { try { const m = fs.statSync(dataFile('usage-headless')).mtimeMs; if (m !== hlUsage.mtime) { const l = readJson('usage-headless', []); hlUsage = { mtime: m, list: Array.isArray(l) ? l : [] }; } } catch { hlUsage = { mtime: 0, list: [] }; } return hlUsage.list; };
const allUsage = () => { const h = headlessUsage(); return h.length ? [...getUsage(), ...h].sort((a, b) => (a.t || 0) - (b.t || 0)) : getUsage(); };

// ---------- sandbox for run_command (electron/core/sandbox.js) ----------
const sandboxedMcp = () => hideHostShellTools(mcp);
let sbCache = { key: null, sb: null };
function currentSandbox() {
  const st = getSettings();
  const key = JSON.stringify([st.sandbox, st.sandboxImage, st.sandboxNetwork, st.sandboxMemory, st.sandboxCpus, st.sandboxSshHost, st.sandboxSshDir]);
  if (key !== sbCache.key) sbCache = { key, sb: sandboxFromSettings(st, coreLog('sandbox')) };
  return sbCache.sb;
}
ipcMain.handle('sandbox:test', async (e) => {
  const sb = currentSandbox();
  if (!sb) return { ok: false, error: 'The sandbox is off.' };
  const say = (line) => { try { if (!e.sender.isDestroyed()) e.sender.send('sandbox:log', String(line)); } catch {} logger.info('sandbox', String(line).slice(0, 300)); };
  const r = await sb.runCommand({ command: 'uname -srm; id -un; pwd; (node -v || true) 2>/dev/null; (python3 -V || true) 2>/dev/null', timeout_seconds: 120 }, { defaultCwd: defaultFilesDir(), onLog: say });
  return { ok: r.ok, text: r.text };
});
ipcMain.handle('sandbox:cleanup', async () => { const sb = currentSandbox(); if (!sb) return { ok: true, removed: 0 }; try { return { ok: true, removed: await sb.cleanup() }; } catch (e) { return { ok: false, error: e.message }; } });

// ---------- memory flush (before compaction) ----------
/** Saves what is worth keeping from messages that are about to be summarized (electron/core/memflush.js). Never throws. */
async function flushFromRun(text, { model, chatId, project }) {
  try {
    const c = initCore(); if (!c.ws) return;
    const st = getSettings();
    const own = liveModel(model || st.model);
    const pick = st.memoryModel ? liveModel(st.memoryModel) : st.scheduleModel ? liveModel(st.scheduleModel) : own;
    let r = providersLib.resolve(pick, readProviders(), getProviderKey);
    let used = pick;
    if (r.error && pick !== own) { used = own; r = providersLib.resolve(own, readProviders(), getProviderKey); }
    if (r.error) return;
    const ask = (system, user) => brainsLib.askJson({ url: providersLib.joinUrl(r.baseUrl, 'chat/completions'), key: r.key, model: r.model, system, user, signal: AbortSignal.timeout(90000),
      onUsage: (u) => recordUsage({ t: Date.now(), model: used, chat: chatId || '', project: (project && project.name) || '', source: 'memory', prompt: u.prompt, completion: u.completion, cached: 0, estimated: false }) });
    const out = await flushMemory({ transcript: text, ask, workspace: c.ws, log: coreLog('memory') });
    if (out.facts || out.notes) toWinSafe('chat:event', { type: 'memory:changed' });
  } catch (e) { logger.warn('memory', 'Memory flush failed: ' + ((e && e.message) || e)); }
}

// ---------- gateway: local HTTP API for the CLI and other clients (electron/core/gateway.js) ----------
let gateway = null, gatewayError = '';
const gatewayFile = () => path.join(app.getPath('userData'), 'gateway.json');
const gatewayToken = () => { let t = getSecret('gatewayToken'); if (!t) { t = gatewayLib.newToken(); setSecret('gatewayToken', t); } return t; };
const gatewayPort = () => Math.min(65535, Math.max(1024, Number(getSettings().gatewayPort) || 8789));
const projectFor = (id) => { const p = id ? readJson('projects', []).find((x) => x.id === id) : null; return p ? { name: p.name, instructions: p.instructions, ...(p.folder && fs.existsSync(p.folder) ? { folder: p.folder } : {}) } : null; };
const gatewayHandlers = {
  info: () => ({ mode: 'desktop', version: app.getVersion(), model: liveModel(getSettings().gatewayModel || getSettings().model), sqlite: !!initCore().sessions, memory: !!initCore().ws }),
  async chat({ runId, sessionId, message, model, projectId }, emit) {
    const st = getSettings();
    const sid = sessionId || 'gw-' + crypto.randomBytes(5).toString('hex');
    const prev = getSaved(sid);
    if (prev && prev.incognito) throw new Error('That chat is incognito and cannot be continued from outside.');
    const prior = prev ? chatSearch.chatTurns(prev, 30) : [];
    const m = liveModel(model || st.gatewayModel || st.model);
    const pid = projectId || (prev && prev.projectId) || null;
    const winOpen = !!(win && !win.isDestroyed());
    // with the window open the turn streams into the chat list live (and the window saves it); otherwise it is written here
    if (winOpen) toWinSafe('phone:start', { requestId: runId, session: sid, prefix: '', via: 'gateway', source: 'gateway', text: message, images: [], model: m, projectId: pid, chatId: prev ? sid : null });
    const steps = [''];
    let error = '';
    const send = (ev) => {
      if (ev.type === 'chunk' && !ev.agent) steps[steps.length - 1] += ev.text;
      else if (ev.type === 'step:new') steps.push('');
      else if (ev.type === 'error') error = ev.message || 'Error';
      emit(ev);
      if (winOpen) toWinSafe('chat:event', { ...ev, requestId: runId });
    };
    await executeRun({ requestId: runId, messages: [...prior, { role: 'user', content: message }], send, restrict: !!st.gatewayRestrict, source: 'gateway',
      model: m, system: st.systemPrompt, maxTokens: st.maxTokens, project: projectFor(pid), chatId: sid });
    const texts = steps.map((t) => t.trim()).filter(Boolean);
    if (!winOpen) {
      const c = initCore();
      if (c.sessions) { try { c.sessions.appendTurn(sid, { writer: 'desktop', user: message, steps: texts.map((t) => ({ text: t, toolCalls: [] })), assistant: error ? `Error: ${error}` : '', via: 'gateway', source: 'gateway', model: m, projectId: pid, title: message }); mirrorChats(); } catch (e) { logger.warn('gateway', 'Could not save the turn: ' + e.message); } }
    }
    if (error && !texts.length) throw new Error(error);
    return { sessionId: sid, text: texts[texts.length - 1] || '' };
  },
  abort: (rid) => { const r = runs.get(rid); if (!r) return false; r.abort(); return true; },
  approve: (id, ok) => { if (!approvals.has(id)) return false; decideTool(id, ok); return true; },
  sessions: {
    recent: (n) => { const c = initCore(); if (c.sessions) return c.sessions.recent(n, readJson('projects', [])); return chatSearch.recentChats(readChats(), n, readJson('projects', [])); },
    get: (id) => getSaved(id),
    search: (q, n) => searchSaved(q, n)
  },
  memory: {
    search: async (q, n) => { const mem = memoryApi(() => toWinSafe('chat:event', { type: 'memory:changed' })); return mem.search ? mem.search(q, n) : (mem.list() || []).filter((x) => String(x.text).toLowerCase().includes(String(q).toLowerCase())).slice(0, n).map((x) => ({ path: 'memory', from: 0, to: 0, text: x.text, score: 1 })); },
    list: () => memoryApi(() => {}).list(),
    add: (text) => memoryApi(() => toWinSafe('chat:event', { type: 'memory:changed' })).add(text),
    note: (text) => { const c = initCore(); if (!c.ws) throw new Error('Daily notes need the memory workspace (Settings → Tools → Memory)'); return c.ws.note(text); }
  }
};
async function syncGateway() {
  const st = getSettings();
  try {
    const want = !!st.gatewayEnabled && !headlessActive(); // the headless gateway serves the API while it runs
    const port = gatewayPort();
    if (gateway && (!want || gateway.address().port !== port)) { await gateway.stop(); gateway = null; gatewayLib.removeDiscovery(gatewayFile()); }
    if (want && !gateway) {
      const g = gatewayLib.createGateway({ host: '127.0.0.1', port, token: gatewayToken(), log: coreLog('gateway'), handlers: gatewayHandlers });
      await g.start();
      gateway = g;
      gatewayLib.writeDiscovery(gatewayFile(), { mode: 'desktop', host: '127.0.0.1', port, token: gatewayToken(), version: app.getVersion() });
    }
    gatewayError = '';
  } catch (e) { gateway = null; gatewayError = e && e.code === 'EADDRINUSE' ? `Port ${st.gatewayPort} is already in use. Pick another one.` : String((e && e.message) || e); logger.error('gateway', gatewayError); }
}
const gatewayInfo = () => {
  const st = getSettings();
  const hl = readLock('headless');
  return { enabled: !!st.gatewayEnabled, running: !!gateway, port: gatewayPort(), token: st.gatewayEnabled ? gatewayToken() : '', error: gatewayError, restrict: !!st.gatewayRestrict, model: st.gatewayModel || '', headless: hl ? { pid: hl.pid, since: hl.startedAt } : null };
};
ipcMain.handle('gateway:info', () => gatewayInfo());
// the headless gateway as a background service (launchd / systemd), run with this app's own binary in Node mode
const gatewayService = () => require('./core/service').createService();
const serviceOpts = () => ({ runtime: process.execPath, electronNode: true, entry: path.join(__dirname, 'core', 'cli-entry.js'), dataDir: app.getPath('userData'), args: [], logFile: path.join(app.getPath('home'), '.artemis', 'logs', 'gateway.log') });
ipcMain.handle('gateway:service', async (_e, action) => {
  try {
    const svc = gatewayService();
    if (action === 'install') { const st = svc.install(serviceOpts()); logger.info('gateway', 'Background service installed: ' + st.file); setTimeout(roleTick, 4000); return { ok: true, ...st }; }
    if (action === 'uninstall') { const st = svc.uninstall(); logger.info('gateway', 'Background service removed'); setTimeout(roleTick, 1500); return { ok: true, ...st }; }
    return { ok: true, ...svc.status() };
  } catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
});
ipcMain.handle('gateway:set', async (_e, o = {}) => {
  const patch = {};
  if (typeof o.enabled === 'boolean') patch.gatewayEnabled = o.enabled;
  if (typeof o.restrict === 'boolean') patch.gatewayRestrict = o.restrict;
  if (typeof o.model === 'string') patch.gatewayModel = o.model;
  if (o.port !== undefined) patch.gatewayPort = Math.min(65535, Math.max(1024, parseInt(o.port, 10) || 8789));
  saveSettings(patch);
  if (o.resetToken) { setSecret('gatewayToken', gatewayLib.newToken()); if (gateway) { await gateway.stop(); gateway = null; } }
  await syncGateway();
  return gatewayInfo();
});
ipcMain.handle('workspace:info', () => {
  const c = initCore();
  let stats = null; try { stats = c.index ? c.index.stats() : null; } catch {}
  return { enabled: !!c.ws, dir: c.ws ? c.ws.dir : workspaceDir(), sqlite: !!c.sessions, dbFile: c.db ? c.db.file : '', stats, embeddingModel: getSettings().embeddingModel || '' };
});
ipcMain.handle('workspace:open', async (_e, rel) => {
  const c = initCore(); if (!c.ws) return { ok: false, error: 'The memory workspace is off.' };
  const target = rel && /^[\w./-]+\.md$/.test(String(rel)) && !String(rel).includes('..') ? c.ws.abs(String(rel)) : c.ws.dir;
  const err = await shell.openPath(target);
  return err ? { ok: false, error: err } : { ok: true };
});
// SOUL.md / USER.md / MEMORY.md edited inside the app (Settings → Long-term memory)
const WS_EDITABLE = ['SOUL.md', 'USER.md', 'MEMORY.md', 'HEARTBEAT.md'];
function writeWorkspaceFile(rel, text) { const c = initCore(); const file = c.ws.abs(rel); const tmp = file + '.tmp'; fs.writeFileSync(tmp, text.endsWith('\n') ? text : text + '\n'); fs.renameSync(tmp, file); }
ipcMain.handle('workspace:read', (_e, rel) => {
  const c = initCore(); if (!c.ws) return { ok: false, error: 'The memory workspace is off.' };
  if (!WS_EDITABLE.includes(rel)) return { ok: false, error: 'Only SOUL.md, USER.md, MEMORY.md and HEARTBEAT.md can be edited here.' };
  return { ok: true, text: c.ws.readText(rel) || '' };
});
ipcMain.handle('workspace:write', (_e, rel, text) => {
  const c = initCore(); if (!c.ws) return { ok: false, error: 'The memory workspace is off.' };
  if (!WS_EDITABLE.includes(rel)) return { ok: false, error: 'Only SOUL.md, USER.md, MEMORY.md and HEARTBEAT.md can be edited here.' };
  if (typeof text !== 'string' || text.length > 200000) return { ok: false, error: 'The text is too long.' };
  try {
    const file = c.ws.abs(rel); const tmp = file + '.tmp';
    fs.writeFileSync(tmp, text.endsWith('\n') ? text : text + '\n'); fs.renameSync(tmp, file);
    if (rel === 'MEMORY.md') toWinSafe('chat:event', { type: 'memory:changed' });
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('workspace:reindex', async () => {
  const c = initCore(); if (!c.index) return { ok: false, error: 'The memory index needs SQLite.' };
  try { c.index.reindex({ force: true }); const n = await c.index.embedPending({ max: 2000 }); return { ok: true, embedded: n, stats: c.index.stats() }; }
  catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
});

// ---------- lock file: tells the headless gateway that the app is running ----------
function claimInstance() {
  try { fs.writeFileSync(lockFile('desktop'), JSON.stringify({ pid: process.pid, startedAt: Date.now() })); } catch {}
  return true;
}
const releaseInstance = () => { try { const cur = JSON.parse(fs.readFileSync(lockFile('desktop'), 'utf8')); if (cur.pid === process.pid) fs.unlinkSync(lockFile('desktop')); } catch {} };

// ---------- app ----------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
app.on('second-instance', () => showMain('Artemis was launched again'));
// Let the window save its pending chats first (ack 'app:flushed', or give up after 1.5 s), then quit for real.
let flushAsked = false; let quitWatchdog = null;
app.on('before-quit', (e) => {
  quitting = true;
  if (!flushAsked && win && !win.isDestroyed()) {
    flushAsked = true;
    e.preventDefault();
    let done = false;
    const go = () => { if (done) return; done = true; ipcMain.removeListener('app:flushed', go); app.quit(); };
    ipcMain.once('app:flushed', go);
    setTimeout(go, 1500);
    try { win.webContents.send('app:flush'); } catch { go(); }
    return;
  }
  flushUsage();
  try { updater.installOnQuit(); } catch (e) { logger.warn('update', 'Install on quit failed: ' + e.message); }
  try { mcpServer.stop(); } catch {} try { sentinelWidget && sentinelWidget.destroy(); } catch {}
  // Every other window goes now: a hidden or always-on-top one must not keep the app alive.
  for (const w of BrowserWindow.getAllWindows()) { try { if (!w.isDestroyed()) w.destroy(); } catch {} }
  // Last resort: if something in the shutdown hangs (a child process, a native module), the app still ends after 4 s instead of needing Force Quit.
  if (!quitWatchdog) { quitWatchdog = setTimeout(() => { try { app.exit(0); } catch { process.exit(0); } }, 4000); }
});

app.whenReady().then(() => {
  if (!gotLock) return;
  if (!claimInstance()) return;
  try {
    const st = getSettings(); const provs = readProviders();
    logger.info('app', 'Saved keys check', { userData: app.getPath('userData'), encryption: safeStorage.isEncryptionAvailable(), providers: provs.map((p) => ({ name: p.name, needsKey: p.needsKey, key: !!getProviderKey(p.id), models: (p.models || []).length })) });
  } catch (e) { logger.error('app', 'Key check failed: ' + e.message); }
  try { nativeThemeFor(); } catch {}
  // the app page's CSP is a meta tag in index.html; the integrated browser has its own session (electron/browser.js)
  buildAppMenu();
  try { updater.start(); } catch (e) { logger.warn('update', 'Could not start the update checks: ' + e.message); }
  try {
    protocol.handle('artifact', (req) => {
      const html = staged.get(new URL(req.url).pathname.slice(1));
      if (!html) return new Response('Not found', { status: 404 });
      return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': ARTIFACT_CSP } });
    });
  } catch {}
  if (process.platform === 'darwin' && app.dock) {
    try {
      const ico = nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png'));
      if (ico.isEmpty()) logger.warn('app', 'Dock icon file could not be read: build/icon.png');
      else { app.dock.setIcon(ico); logger.info('app', 'Dock icon set from build/icon.png'); }
      app.dock.show();
    } catch (e) { logger.warn('app', 'Dock icon failed: ' + ((e && e.message) || e)); }
  }
  floater = createFloat({ BrowserWindow, screen });
  remote = createRemote({
    transcribe: transcribeAudio,
    models: () => providersLib.modelEntries(readProviders()), readStore: (n) => readJson(n, []), mcpStatus: () => mcp.status(readMcpList()),
    memory: memoryApi(() => { try { win?.webContents.send('chat:event', { type: 'memory:changed' }); } catch {} }),
    skillsList: () => skills.list(null).map((x) => ({ name: x.name, description: x.description, enabled: x.enabled })),
    chatsApi: {
      recent: (n) => { const c = initCore(); if (c.sessions) { try { return c.sessions.recent(n, readJson('projects', [])); } catch {} } return chatSearch.recentChats(readChats(), n, readJson('projects', [])); },
      search: (q, n) => searchSaved(q, n),
      get: (id) => { const c = getSaved(id); return c && !c.incognito ? c : null; },
      turns: (c, n) => chatSearch.chatTurns(c, n)
    },
    appendToChat: (chatId, user, assistant) => {
      // with a window open the turn was already streamed live into that chat (phone:start carries the chat id)
      if (win && !win.isDestroyed()) return;
      { const cs = initCore(); if (cs.sessions) { try { if (cs.sessions.get(chatId)) { cs.sessions.appendTurn(chatId, { user, assistant, via: 'telegram', writer: 'desktop' }); mirrorChats(); } return; } catch (e) { logger.warn('db', 'Could not add the phone turn to artemis.db: ' + e.message); } } }
      const list = readJson('chats', []); // no window: write straight into the saved chats
      const c = list.find((x) => x.id === chatId);
      if (c) { const id = () => Math.random().toString(36).slice(2, 10); c.messages.push({ id: id(), role: 'user', content: user, via: 'telegram' }, { id: id(), role: 'assistant', via: 'telegram', steps: [{ text: assistant, toolCalls: [] }] }); c.updatedAt = Date.now(); writeJson('chats', list); }
    },
    notes: notesAi,
    providersApi: {
      list: () => [...readProviders().map((p) => ({ key: p.id, name: p.name, on: p.enabled !== false }))],
      set: (key, on) => {
        { const l = readProviders(); const p = l.find((x) => x.id === key); if (p) { p.enabled = !!on; writeJson('providers', l); } }
        toWinSafe('app:changed', {});
      }
    },
    liveModel,
    summarize: (messages) => compactSummary({ model: getSettings().remoteModel || getSettings().model, messages }),
    desktopCompact: (chatId) => toWinSafe('remote:compact', { chatId }),
    // while the headless gateway runs, it owns the Telegram bot (two bots on one token would fight)
    getSettings: () => (headlessActive() ? { ...getSettings(), telegramEnabled: false } : getSettings()),
    getSecret: (n) => (n === 'telegramToken' && headlessActive() ? '' : getSecret(n)), setSecret,
    saveSettings: (patch) => { saveSettings(patch); if (patch && Object.keys(patch).some((k) => ['toolsEnabled', 'notesAi', 'webEnabled', 'shellEnabled', 'computerEnabled', 'memoryEnabled', 'connectorsEnabled', 'autoApproveEdits'].includes(k))) toWinSafe('app:changed', {}); },
    decide: decideTool, abort: (rid) => runs.get(rid)?.abort(),
    screenshot: async () => { if (!computer) throw new Error('Computer control is only available on macOS.'); const r = await computer.screenshot(); return r.image; },
    parseFile: files.parseAttachment,
    runChat: ({ requestId, messages, send: toPhone, session }) => {
      if (lock.isLocked() && lock.getConfig().pausePhone) throw new Error('Artemis is locked on the computer, so it cannot work from the phone right now.');
      const st = getSettings();
      const toWin = (ch, p) => { try { if (win && !win.isDestroyed()) win.webContents.send(ch, p); } catch {} };
      const last = messages[messages.length - 1];
      const c = last && last.content;
      const text = typeof c === 'string' ? c : (c || []).filter((p) => p.type === 'text').map((p) => p.text).join(' ');
      const images = Array.isArray(c) ? c.filter((p) => p.type === 'image_url').map((p) => p.image_url.url) : [];
      const model = liveModel(remote.control.currentModel());
      const linkedChat = remote.linked && remote.linked();
      toWin('phone:start', { requestId, session, text, images, model, projectId: st.remoteProjectId || null, chatId: linkedChat ? linkedChat.id : null });
      const send = (ev) => { toPhone(ev); toWin('chat:event', { ...ev, requestId }); };
      return executeRun({
        requestId, messages, send, restrict: !st.remoteAllowDangerous, source: 'phone',
        model, system: st.systemPrompt, maxTokens: st.maxTokens,
        project: (() => { const p = remote.control.resolveProject(); return p && p.folder && fs.existsSync(p.folder) ? { name: p.name, instructions: p.instructions, folder: p.folder } : p && !p.folder ? { name: p.name, instructions: p.instructions } : null; })()
      });
    }
  });
  remote.reconfigure().catch(() => {});
  syncMcpServer().catch(() => {});
  syncGateway().catch(() => {});
  // one-time: file edits are auto-approved by default now (deleting still asks)
  if (!getSettings().migAutoApprove2) saveSettings({ migAutoApprove2: true });
  if (!getSettings().migAskDefault) saveSettings({ autoApproveEdits: false, migAskDefault: true }); // everything asks by default
  roleTick(); setInterval(roleTick, 3000); // starts scheduled tasks here unless the headless gateway runs them
  setInterval(pushExternal, 1500); // chats changed by the headless gateway show up in the window
  try { // encrypt secrets left in plain text by older versions (already encrypted values are kept as they are)
    const raw = readJson('mcp', []);
    if (Array.isArray(raw) && safeStorage.isEncryptionAvailable() && JSON.stringify(raw) !== JSON.stringify(raw.map((c) => mapMcpSecrets(c, mcpEnc)))) writeMcpList(raw);
  } catch (e) { logger.warn('mcp', 'Could not encrypt connector secrets: ' + e.message); }
  mcp.configure(readMcpList()).catch(() => {});
  computer = createComputer({ screenSize: () => screen.getPrimaryDisplay().size, avoid: () => floater.rect() });
  quick = quickViaWidget();
  lock.init(); // before the window: its first question is whether it is locked
  createWindow();
  try { createTray(); } catch (e) { tray = null; }
  try {
    const { powerMonitor } = require('electron');
    powerMonitor.on('suspend', () => lock.onSleep());
    powerMonitor.on('lock-screen', () => lock.onSleep());
    const idleTimer = setInterval(() => { try { lock.tick(powerMonitor.getSystemIdleTime()); } catch {} }, 5000); if (idleTimer.unref) idleTimer.unref();
  } catch (e) { logger.warn('lock', 'Idle and sleep locking are not available: ' + ((e && e.message) || e)); }
  applyShortcut();
  applyLoginItem();
  app.on('activate', () => showMain('Dock icon clicked (activate)'));
});
app.on('will-quit', () => {
  // each step on its own: one that throws must not skip the rest
  for (const f of [() => terminals.closeAll(), () => scheduler.stop(), () => heartbeat.stop(), () => { hookService.stop().catch(() => {}); }, () => unregisterShortcuts(), () => globalShortcut.unregisterAll(), () => remote?.stop(), () => wakeword.stop(), () => updater.stop(), () => { const r = mcp.close(); if (r && r.catch) r.catch(() => {}); }, () => { if (gateway) gateway.stop(); gatewayLib.removeDiscovery(gatewayFile()); }, () => releaseInstance(), () => { if (mirrorTimer) { clearTimeout(mirrorTimer); mirrorTimer = null; } }, () => { if (coreState.db) coreState.db.close(); }]) { try { f(); } catch {} }
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ---------- IPC handlers that touch main's mutable state (kept here) ----------
ipcMain.handle('browser:bounds', (_e, r) => {
  if (!r || ![r.x, r.y, r.width, r.height].every(Number.isFinite)) return false;
  // The renderer measures in CSS pixels; the native view is placed in window units. They differ whenever the page is zoomed (⌘+ / ⌘-).
  let z = 1; try { z = _e.sender.getZoomFactor() || 1; } catch {}
  return browser.setRect({ x: Math.max(0, Math.round(r.x * z)), y: Math.max(0, Math.round(r.y * z)), width: Math.max(50, Math.round(r.width * z)), height: Math.max(50, Math.round(r.height * z)) });
});
ipcMain.handle('browser:visible', (_e, v) => browser.setCovered(!!v));
ipcMain.handle('browser:nav', (_e, a) => browser.nav(String(a || '')));
ipcMain.handle('browser:external', (_e, u) => { if (/^https?:\/\//i.test(String(u || ''))) { shell.openExternal(String(u)); return true; } return false; });
ipcMain.handle('browser:open', (_e, url) => { try { return browser.open(url ? String(url) : ''); } catch (e) { logger.warn('browser', e.message); return false; } });
ipcMain.handle('browser:close', () => browser.hide());
ipcMain.handle('browser:navigate', (_e, url) => { try { browser.navigate(String(url || '')); return true; } catch { return false; } });
ipcMain.handle('browser:tabs', () => browser.state());
ipcMain.handle('browser:tab-new', (_e, url) => { try { browser.newTab(url ? String(url) : ''); return browser.state(); } catch (e) { logger.warn('browser', e.message); return browser.state(); } });
ipcMain.handle('browser:tab-select', (_e, id) => { try { browser.select(id); } catch {} return browser.state(); });
ipcMain.handle('browser:tab-close', (_e, id) => { try { browser.close(id); } catch {} return browser.state(); });
ipcMain.handle('sentinel:current', () => widgetInfo());
ipcMain.handle('sentinel:action', (_e, a) => {
  if (lock.isLocked() && !['stop', 'skip', 'mute', 'unmute', 'toggle', 'ptt'].includes(a)) return false; // locked: the widget can only stop, skip or mute
  // Sentinel works with the main window in the background; only these bring it up (the user asked for the app).
  if (a === 'logs' || a === 'settings' || a === 'show' || a === 'raise') showMain(`Sentinel asked for the app (${a})`);
  win?.webContents.send('sentinel:action', a);
  return true;
});
ipcMain.handle('sentinel:status', () => {
  let size = 0; try { size = fs.statSync(sentinelFile()).size; } catch {}
  return { ready: sentinelReady(), size, path: sentinelFile() };
});
ipcMain.handle('sentinel:model', () => { try { return new Uint8Array(fs.readFileSync(sentinelFile())); } catch { return null; } });
ipcMain.handle('sentinel:delete', () => { try { fs.unlinkSync(sentinelFile()); } catch {} return { ok: true }; });
ipcMain.handle('sentinel:download', async (e) => {
  if (sentinelReady()) return { ok: true };
  if (sentinelBusy) return { ok: false, error: 'The voice model is already downloading.' };
  sentinelBusy = true;
  logger.info('sentinel', 'Downloading the voice model');
  logger.progress('sentinel-download', 'Download voice model', { pct: 0, detail: 'Connecting…' });
  const file = sentinelFile(); const tmp = file + '.part';
  let lastErr = '';
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    for (const url of SENTINEL_MODEL_URLS) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(10 * 60 * 1000) });
        logger.info('sentinel', `Model server answered HTTP ${res.status}`, { url });
        if (!res.ok || !res.body) { lastErr = `HTTP ${res.status}`; logger.error('sentinel', 'Model download failed: ' + lastErr, { url }); continue; }
        const total = Number(res.headers.get('content-length')) || 0;
        const out = fs.createWriteStream(tmp);
        let got = 0; let last = 0;
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          got += value.length;
          if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r));
          const pct = total ? Math.round((got / total) * 100) : 0;
          if (pct !== last) { last = pct; try { e.sender.send('sentinel:progress', pct); } catch {} logger.progress('sentinel-download', 'Download voice model', { pct, detail: `${(got / 1048576).toFixed(1)} of ${total ? (total / 1048576).toFixed(1) : '?'} MB` }); }
        }
        await new Promise((r, j) => out.end((err) => (err ? j(err) : r())));
        if (got < 5 * 1024 * 1024) { lastErr = 'The download was incomplete.'; continue; }
        fs.renameSync(tmp, file);
        logger.progress('sentinel-download', 'Download voice model', { pct: 100, state: 'done', detail: `${(got / 1048576).toFixed(1)} MB saved` });
        logger.info('sentinel', `Voice model downloaded (${(got / 1048576).toFixed(1)} MB)`);
        return { ok: true };
      } catch (err) { lastErr = (err && err.message) || String(err); logger.error('sentinel', 'Model download error: ' + lastErr); }
    }
    logger.progress('sentinel-download', 'Download voice model', { state: 'error', detail: lastErr });
    try { fs.unlinkSync(tmp); } catch {}
    return { ok: false, error: 'Could not download the voice model (' + lastErr + '). Check your internet connection and try again.' };
  } finally { sentinelBusy = false; }
});
ipcMain.handle('quick:resize', (_e, mode) => quick?.resize(mode === 'chips' ? 'chips' : !!mode));
ipcMain.handle('quick:hide', () => quick?.hide());
ipcMain.handle('quick:mode', (_e, mode) => quick?.setMode(mode));
// While a shortcut box in Settings is recording, the global shortcuts are let go, so pressing them reaches the box
ipcMain.handle('shortcuts:pause', (_e, on) => { if (on) unregisterShortcuts(); else applyShortcut(); return true; });
ipcMain.handle('quick:keep-open', (_e, on) => quick?.keepOpen(!!on));
ipcMain.handle('quick:handoff', (_e, chat) => {
  showMain('quick chat handed off to the main window');
  const send = () => win?.webContents.send('quick:import', chat);
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send); else send();
});
ipcMain.handle('palette:sync', (_e, snap) => { paletteSnap = { chats: Array.isArray(snap?.chats) ? snap.chats : [], actions: Array.isArray(snap?.actions) ? snap.actions : [] }; });
ipcMain.handle('palette:get', () => paletteSnap);
ipcMain.handle('palette:hide', () => void 0);
ipcMain.handle('palette:run', (_e, item) => {
  quick?.hide();
  const fresh = !win || win.isDestroyed();
  showMain('command palette item run');
  const send = () => { try { win.webContents.send('palette:run', item); } catch {} };
  if (fresh || win.webContents.isLoading()) win.webContents.once('did-finish-load', () => setTimeout(send, 400)); else send();
});
ipcMain.handle('remote:status', () => remote.status());
ipcMain.handle('remote:connect-telegram', (_e, token) => remote.connectTelegram(token));
ipcMain.handle('remote:unpair', () => { remote.unpair(); return remote.status(); });

// ---------- IPC handlers (one module per area, see electron/ipc/) ----------
// Registered last so every helper they use is initialised; handlers only run later, when the renderer calls them.
require('./ipc/skills')({ ipcMain, app, dialog, shell, fs, path, skills, skillRoot, getWin: () => win });
require('./ipc/themes')({ ipcMain, dialog, shell, fs, path, themes, themeDirs, listThemes, nativeThemeFor, broadcastTheme, getSettings, saveSettings, getWin: () => win });
require('./ipc/brains')({ ipcMain, brains });
require('./ipc/agents')({ ipcMain, agents, fs, shell, skillRoot });
require('./ipc/logs')({ ipcMain, shell, fs, logger });
// Memory diagnostics (Logs → Memory, Settings → General → Memory, command palette "Show memory use", and every 5 minutes from the window)
{
  const memory = require('./memory').createMemory({
    app, webContents: require('electron').webContents, logger, getWin: () => win,
    getWidgetWin: () => (sentinelWidget ? sentinelWidget.window : null),
    browserSession: () => { try { return session.fromPartition('persist:artemis-browser'); } catch { return null; } }
  });
  ipcMain.handle('memory:get', (_e, o = {}) => {
    const extra = { heap: o.heap || null, proc: o.proc || null };
    return o.log ? memory.logSnapshot(o.reason || 'check', extra) : memory.snapshot(extra);
  });
  ipcMain.handle('memory:free', async () => { const done = await memory.free(); logger.info('memory', 'Free memory: ' + (done.join(', ') || 'nothing to clear')); return done; });
}
require('./ipc/make')({ ipcMain, MAKE_ZONES, cleanMakeZone, createMake, getSecret, getSettings, logger, make, makeReady, saveSettings, setSecret, validMakeZone });
require('./ipc/mcp')({ ipcMain, mcp, oauthCallbackServer, oauthPending, parseImport, readMcpList, writeMcpList, shell });
require('./ipc/schedule')({ ipcMain, scheduler });
require('./ipc/automation')({ ipcMain, heartbeat, heartbeatTools, hooks, hooksInfo, hookUrls, hookService, getSettings, saveSettings, setSecret, getSecret, headlessActive });
require('./ipc/notes')({ ipcMain, dialog, shell, notesStore, library, files, readJson, writeJson, getWin: () => win });
require('./ipc/term')({ ipcMain, BrowserWindow, openTermWindow, termWindows, terminals, getWin: () => win });
require('./ipc/mcpserver')({ ipcMain, mcpServerInfo, saveSettings, setSecret, syncMcpServer });
require('./ipc/project')({ ipcMain, dialog, fs, logoDir, nativeImage, path, getWin: () => win });
require('./ipc/profile')({ ipcMain, avatarData, avatarFile, dialog, fs, nativeImage, path, profileDir, shell, getWin: () => win });
require('./ipc/sheet')({ ipcMain, BrowserWindow, dialog, files });
require('./ipc/voice')({ ipcMain, getSettings, logger, providersLib, systemPreferences, transcribeAudio, fs, path, crypto: require('crypto'), cacheDir: () => path.join(app.getPath('home'), '.artemis', 'tts-cache') });
require('./ipc/files')({ ipcMain, BrowserWindow, app, defaultFilesDir, dialog, files, tools, library, getWin: () => win });
require('./ipc/library')({ ipcMain, BrowserWindow, dialog, shell, files, library, getWin: () => win });
require('./ipc/perm')({ ipcMain, permissions });
require('./ipc/lock')({ ipcMain, lock, speaker, voiceGate, lockAuthWaiting, snapWaiting, logger, testAlert: testLockAlert });
require('./ipc/wakeword')({ ipcMain, wakeword, dialog, getWin: () => win });
require('./ipc/update')({ ipcMain, updater, shell, app, getWin: () => win });
require('./ipc/media')({ ipcMain, mediaDir, mediaGen, shell });
require('./ipc/usage')({ ipcMain, getUsage: allUsage, setUsage: (l) => { setUsage(l); if (Array.isArray(l) && !l.length) { try { writeJson('usage-headless', []); } catch {} } } });
require('./ipc/providers')({ ipcMain, encStr, getProviderKey, providersLib, publicProviders, readProviderKeys, readProviders, writeJson });
require('./ipc/shell')({ ipcMain, fs, shell });
