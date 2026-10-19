// App lock: a password (scrypt) and a recovery code, Touch ID, locking at start / after idle / on sleep, failed-attempt counters with an
// escalating lockdown, and a Touch ID check before sensitive actions.
// A factory like the other main-process modules: files, Touch ID and the clock are injected, so scripts/test-lock.js runs it without Electron.
// It does not encrypt anything on disk. It keeps the app (and every IPC call that acts) closed to whoever sits at the computer.
const crypto = require('crypto');

const DEFAULT_CFG = {
  enabled: false,
  lockOnStart: true, // locked every time Artemis starts
  idleMinutes: 0, // 0 = never; otherwise lock after this many minutes without keyboard, mouse or Sentinel activity
  lockOnSleep: true, // also when the Mac sleeps or the screen is locked
  touchIdUnlock: true, // Touch ID can unlock (Mac with Touch ID)
  voiceUnlock: true, // the owner's voice can unlock (needs an enrolled voice)
  voiceOnly: false, // Sentinel answers only the owner's voice, also while unlocked
  strangerChatOnly: false, // another voice may talk to Artemis, but nothing is executed for it (no tools, no memory, no commands) and nothing locks
  lockOnStranger: false, // a voice that is not the owner's locks the app at once (needs an enrolled voice; off: it is only refused and counted)
  voiceThreshold: 0.45, // cosine score from which a voice counts as the owner's (0.25 to 0.7)
  pausePhone: false, // phone (Telegram) control waits while locked; off: the paired phone keeps working
  maxVoiceFails: 3, // unrecognised voices inside the window before a lockdown
  maxPasswordFails: 5, // wrong passwords / recovery codes / Touch ID failures inside the window before a lockdown
  failWindowMin: 5,
  alertTelegram: true,
  photoOnLockdown: false, // a webcam photo goes with the Telegram alert
  sensitiveTouchId: false, // Touch ID (password if there is none) before the actions below
  sensitive: { delete: true, shell: true, computer: true, connectorWrite: false, write: false }
};
const LEVELS_MIN = [5, 15, 60, 240]; // lockdown length: first time, then each repeat (a quiet day starts over)
const KEEP_LEVEL_MS = 24 * 3600 * 1000;
const MIN_PASSWORD = 6;

// IPC channels that do nothing while the app is locked. Reads of the stores stay open, because the window has to start (and keep saving) behind the lock
// screen so Sentinel can hear its owner. Everything that acts, or shows content, is listed here.
const BLOCKED_WHILE_LOCKED = [
  /^chat:/, /^tool:/, /^term:/, /^files:/, /^library:/, /^notes:/, /^mcp:/, /^mcpserver:/, /^make:/, /^schedule:/, /^artifact:/, /^sheet:/,
  /^media:/, /^import:/, /^dialog:/, /^shell:/, /^phone:/, /^float:/, /^project:/, /^profile:(pick|clear)/, /^artemis:/, /^claude:/,
  /^providers:(save|delete|test)$/, /^skills:(save|delete|import|toggle|get)$/, /^agents:(save|delete)$/, /^brains:(save|delete)$/,
  /^settings:set$/, /^browser:(open|navigate|nav|tab-new|external)$/, /^quick:handoff$/, /^palette:run$/, /^sentinel:(ask|copy|download|delete)$/,
  /^voice:transcribe$/, /^wakeword:(download|preset|import|remove)$/, /^update:(download|install)$/, /^perm:request$/, /^memory:free$/, /^usage:clear$/, /^logs:clear$/, /^themes:(delete|import)$/
];
const isBlockedChannel = (ch) => !/^lock:|^speaker:/.test(String(ch)) && BLOCKED_WHILE_LOCKED.some((re) => re.test(String(ch)));

/** scrypt of a secret with a fresh (or given) salt. */
function hashSecret(secret, salt = crypto.randomBytes(16)) {
  const hash = crypto.scryptSync(String(secret), salt, 32, { N: 16384, r: 8, p: 1 });
  return { salt: salt.toString('base64'), hash: hash.toString('base64') };
}
function checkSecret(secret, rec) {
  if (!rec || !rec.salt || !rec.hash) return false;
  try {
    const h = crypto.scryptSync(String(secret), Buffer.from(rec.salt, 'base64'), 32, { N: 16384, r: 8, p: 1 });
    const want = Buffer.from(rec.hash, 'base64');
    return want.length === h.length && crypto.timingSafeEqual(h, want);
  } catch { return false; }
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** 20 characters of a 32-letter alphabet (100 bits), shown as XXXX-XXXX-XXXX-XXXX-XXXX. */
function makeRecoveryCode() {
  let s = '';
  for (let i = 0; i < 20; i++) s += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return s.match(/.{4}/g).join('-');
}
const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Which Touch ID category a tool approval belongs to (null = not sensitive). info: { name, category } as the approval card has it. */
function sensitiveCategory(info) {
  const name = String((info && info.name) || ''); const cat = String((info && info.category) || '');
  if (name === 'delete_file' || name === 'library_delete') return 'delete';
  if (cat === 'shell') return 'shell';
  if (cat === 'computer') return 'computer';
  if (cat.startsWith('mcp:')) return 'connectorWrite';
  if (/^(library_write|library_edit|notes_write|notes_append|notes_edit|write_file|edit_file|write_spreadsheet|update_cells|move_file)$/.test(name)) return 'write';
  return null;
}

const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
function cleanCfg(raw, base = DEFAULT_CFG) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const b = (k) => (r[k] === undefined ? base[k] : !!r[k]);
  const s = r.sensitive && typeof r.sensitive === 'object' ? r.sensitive : {};
  return {
    enabled: b('enabled'), lockOnStranger: b('lockOnStranger'), strangerChatOnly: b('strangerChatOnly'), lockOnStart: b('lockOnStart'), lockOnSleep: b('lockOnSleep'), touchIdUnlock: b('touchIdUnlock'), voiceUnlock: b('voiceUnlock'), voiceOnly: b('voiceOnly'),
    pausePhone: b('pausePhone'), alertTelegram: b('alertTelegram'), photoOnLockdown: b('photoOnLockdown'), sensitiveTouchId: b('sensitiveTouchId'),
    idleMinutes: r.idleMinutes === undefined ? base.idleMinutes : Math.round(num(r.idleMinutes, 0, 1440, 0)),
    voiceThreshold: r.voiceThreshold === undefined ? base.voiceThreshold : Math.round(num(r.voiceThreshold, 0.25, 0.7, 0.45) * 100) / 100,
    maxVoiceFails: r.maxVoiceFails === undefined ? base.maxVoiceFails : Math.round(num(r.maxVoiceFails, 1, 20, 3)),
    maxPasswordFails: r.maxPasswordFails === undefined ? base.maxPasswordFails : Math.round(num(r.maxPasswordFails, 1, 20, 5)),
    failWindowMin: r.failWindowMin === undefined ? base.failWindowMin : Math.round(num(r.failWindowMin, 1, 120, 5)),
    sensitive: Object.fromEntries(Object.keys(DEFAULT_CFG.sensitive).map((k) => [k, s[k] === undefined ? !!(base.sensitive || DEFAULT_CFG.sensitive)[k] : !!s[k]]))
  };
}

function createLock(deps) {
  const now = deps.now || Date.now;
  const log = deps.log || (() => {});
  const touch = deps.touchId || { available: () => false, prompt: async () => { throw new Error('Touch ID is not available.'); } };
  const raw0 = (() => { try { return deps.read() || {}; } catch { return {}; } })();
  let data = {
    cfg: cleanCfg(raw0.cfg),
    pw: raw0.pw && raw0.pw.hash ? raw0.pw : null,
    recovery: raw0.recovery && raw0.recovery.hash ? raw0.recovery : null,
    lockdown: { level: Number(raw0.lockdown && raw0.lockdown.level) || 0, until: Number(raw0.lockdown && raw0.lockdown.until) || 0 }
  };
  let locked = false; let reason = ''; let lastActivity = now();
  const fails = { voice: [], password: [], touchid: [] };
  const save = () => { try { deps.write(data); } catch (e) { log('warn', 'Could not save the lock settings: ' + ((e && e.message) || e)); } };

  const hasPassword = () => !!data.pw;
  const enabled = () => !!data.cfg.enabled && hasPassword();
  const isLocked = () => enabled() && locked;
  const lockdownLeft = () => Math.max(0, data.lockdown.until - now());
  const touchAvailable = () => { try { return !!touch.available(); } catch { return false; } };
  const state = () => ({
    enabled: enabled(), locked: isLocked(), reason: isLocked() ? reason : '', hasPassword: hasPassword(), hasRecovery: !!data.recovery,
    touchId: touchAvailable() && data.cfg.touchIdUnlock, touchIdAvailable: touchAvailable(),
    lockdown: { active: lockdownLeft() > 0, until: data.lockdown.until, level: data.lockdown.level }, now: now()
  });
  const emit = () => { try { deps.onState && deps.onState(state()); } catch (e) { log('warn', 'Lock state listener failed: ' + ((e && e.message) || e)); } };

  function lock(why = 'manual') {
    if (!enabled()) return { ok: false, error: hasPassword() ? 'The app lock is off. Turn it on in Settings → Security.' : 'Set a password in Settings → Security first.' };
    if (!locked) { locked = true; reason = why; log('info', 'App locked (' + why + ')'); emit(); }
    return { ok: true };
  }
  function unlockOk(method) {
    locked = false; reason = ''; for (const k of Object.keys(fails)) fails[k] = []; lastActivity = now();
    log('info', 'App unlocked (' + method + ')'); emit();
    return { ok: true, method };
  }
  function startLockdown(kind, attempts) {
    const t = now(); const ld = data.lockdown;
    const level = ld.until && t - ld.until > KEEP_LEVEL_MS ? 0 : ld.level || 0;
    const minutes = LEVELS_MIN[Math.min(level, LEVELS_MIN.length - 1)];
    data.lockdown = { level: level + 1, until: t + minutes * 60000 };
    for (const k of Object.keys(fails)) fails[k] = [];
    if (enabled()) { locked = true; reason = 'lockdown'; }
    save(); emit();
    const info = { kind, attempts, minutes, at: t, level: level + 1 };
    log('warn', `Lockdown: ${attempts} failed attempts (${kind}), ${minutes} min`);
    try { deps.onAlert && deps.onAlert(info); } catch (e) { log('warn', 'Lock alert failed: ' + ((e && e.message) || e)); }
    return info;
  }
  /** Counts a failed attempt ('voice' | 'password' | 'touchid'); returns the lockdown info when this one started it. */
  function recordFailure(kind) {
    const t = now(); const win = data.cfg.failWindowMin * 60000;
    const list = (fails[kind] = (fails[kind] || []).filter((x) => t - x < win)); list.push(t);
    const max = kind === 'voice' ? data.cfg.maxVoiceFails : data.cfg.maxPasswordFails;
    return list.length >= max ? startLockdown(kind, list.length) : null;
  }
  const lockdownError = () => ({ ok: false, locked: true, error: `Too many attempts. Try again in ${Math.max(1, Math.ceil(lockdownLeft() / 60000))} min (a recovery code still works).`, lockdown: state().lockdown });

  async function unlock(method, value) {
    if (!isLocked()) return { ok: true, already: true };
    if (lockdownLeft() > 0 && method !== 'recovery') return lockdownError();
    if (method === 'password') {
      if (checkSecret(value, data.pw)) return unlockOk('password');
      const ld = recordFailure('password');
      return ld ? { ...lockdownError(), error: `Wrong password. Locked for ${ld.minutes} min.` } : { ok: false, error: 'Wrong password.' };
    }
    if (method === 'recovery') {
      if (data.recovery && checkSecret(normCode(value), data.recovery)) { data.lockdown = { level: 0, until: 0 }; save(); return unlockOk('recovery'); }
      const ld = recordFailure('password');
      return ld ? { ...lockdownError(), error: 'Wrong recovery code.' } : { ok: false, error: 'Wrong recovery code.' };
    }
    if (method === 'touchid') {
      if (!data.cfg.touchIdUnlock || !touchAvailable()) return { ok: false, error: 'Touch ID is not available.' };
      try { await touch.prompt('unlock Artemis'); return unlockOk('touchid'); } catch (e) {
        if (/cancel/i.test(String((e && e.message) || e))) return { ok: false, cancelled: true };
        const ld = recordFailure('touchid');
        return ld ? { ...lockdownError(), error: `Touch ID failed. Locked for ${ld.minutes} min.` } : { ok: false, error: 'Touch ID did not recognise you.' };
      }
    }
    return { ok: false, error: 'Unknown unlock method.' };
  }
  /** The owner's voice was recognised while locked (the voice check ran in the speaker module). */
  function unlockByVoice() {
    if (!isLocked()) return { ok: true, already: true };
    if (!data.cfg.voiceUnlock) return { ok: false, error: 'Voice unlock is off.' };
    if (lockdownLeft() > 0) return lockdownError();
    return unlockOk('voice');
  }
  function voiceSuccess() { fails.voice = []; }

  /** Proof that the user is here: the current password, or Touch ID. */
  async function authOk(auth) {
    if (auth && auth.password !== undefined && auth.password !== null && auth.password !== '') return checkSecret(auth.password, data.pw);
    if (auth && auth.touchid && touchAvailable()) { try { await touch.prompt('change the Artemis security settings'); return true; } catch { return false; } }
    return false;
  }

  /** Sets or changes the password. A first password needs no proof. Returns the recovery code when one was just made. */
  async function setPassword(pw, auth) {
    const p = String(pw || '');
    if (p.length < MIN_PASSWORD) return { ok: false, error: `Use at least ${MIN_PASSWORD} characters.` };
    if (hasPassword() && !(await authOk(auth))) return { ok: false, error: 'Enter the current password first.' };
    data.pw = hashSecret(p);
    let code = '';
    if (!data.recovery) { code = makeRecoveryCode(); data.recovery = hashSecret(normCode(code)); }
    save(); emit();
    return { ok: true, recoveryCode: code };
  }
  async function newRecoveryCode(auth) {
    if (!hasPassword()) return { ok: false, error: 'Set a password first.' };
    if (!(await authOk(auth))) return { ok: false, error: 'Enter the current password first.' };
    const code = makeRecoveryCode(); data.recovery = hashSecret(normCode(code)); save(); emit();
    return { ok: true, recoveryCode: code };
  }
  /** Changes settings. Turning the lock off needs the password (or Touch ID); turning it on needs a password to exist. */
  async function setConfig(patch, auth) {
    const p = patch && typeof patch === 'object' ? patch : {};
    if (p.enabled === true && !hasPassword()) return { ok: false, error: 'Set a password first.' };
    if (p.enabled === false && data.cfg.enabled && !(await authOk(auth))) return { ok: false, error: 'Enter the current password to turn the lock off.' };
    const next = cleanCfg({ ...data.cfg, ...p, sensitive: { ...data.cfg.sensitive, ...(p.sensitive || {}) } }, data.cfg);
    data.cfg = next; if (!enabled()) { locked = false; reason = ''; }
    save(); emit();
    return { ok: true, config: next };
  }

  /** Something happened in the app (a key, the mouse, Sentinel): the idle timer starts over. */
  function activity() { lastActivity = now(); }
  /** Called every few seconds with the system idle time; locks after the configured quiet time. */
  function tick(systemIdleSec = 0) {
    if (!enabled() || locked || !data.cfg.idleMinutes) return false;
    const idleMs = Math.min(Math.max(0, Number(systemIdleSec) || 0) * 1000, now() - lastActivity);
    if (idleMs >= data.cfg.idleMinutes * 60000) { lock('idle'); return true; }
    return false;
  }
  /** Start of the app: locked when it is set to lock on start (or a lockdown is still running). */
  function init() {
    if (enabled() && (data.cfg.lockOnStart || lockdownLeft() > 0)) { locked = true; reason = lockdownLeft() > 0 ? 'lockdown' : 'start'; }
    lastActivity = now(); emit();
  }
  /** Mac asleep / screen locked. */
  function onSleep() { if (enabled() && data.cfg.lockOnSleep) lock('sleep'); }

  /**
   * Touch ID (the password when Touch ID cannot be used) before a sensitive action. info: { name, category } of the approval.
   * Returns { ok } (also ok when nothing is required).
   */
  async function requireSensitive(info) {
    const cat = sensitiveCategory(info);
    if (!enabled() || !data.cfg.sensitiveTouchId || !cat || !data.cfg.sensitive[cat]) return { ok: true, skipped: true };
    const why = ({ delete: 'delete files', shell: 'run a command', computer: 'control the computer', connectorWrite: 'change data in a connected app', write: 'change files' })[cat];
    if (touchAvailable()) {
      try { await touch.prompt('allow Artemis to ' + why); return { ok: true, via: 'touchid' }; } catch (e) { if (/cancel/i.test(String((e && e.message) || e))) return { ok: false, cancelled: true }; }
    }
    if (deps.askPassword) {
      let pw = null; try { pw = await deps.askPassword('Allow Artemis to ' + why); } catch {}
      if (pw === null || pw === undefined) return { ok: false, cancelled: true };
      return checkSecret(pw, data.pw) ? { ok: true, via: 'password' } : { ok: false, error: 'Wrong password.' };
    }
    return { ok: true, skipped: 'no-method' };
  }

  /** Whether Sentinel must check the speaker for this sentence: the owner-only setting, or the lock screen listening for its owner. */
  const wantsVoiceCheck = () => !!data.cfg.voiceOnly || !!data.cfg.strangerChatOnly || (enabled() && !!data.cfg.lockOnStranger) || (isLocked() && !!data.cfg.voiceUnlock);

  init.called = false;
  return {
    state, isLocked, enabled, hasPassword, lockdownLeft, getConfig: () => JSON.parse(JSON.stringify(data.cfg)),
    lock, unlock, unlockByVoice, voiceSuccess, recordFailure, setPassword, newRecoveryCode, setConfig, authOk,
    activity, tick, init, onSleep, requireSensitive, wantsVoiceCheck,
    guard: (channel) => !isLocked() || !isBlockedChannel(channel)
  };
}

module.exports = { createLock, DEFAULT_CFG, LEVELS_MIN, MIN_PASSWORD, isBlockedChannel, hashSecret, checkSecret, makeRecoveryCode, sensitiveCategory, cleanCfg, normCode };
