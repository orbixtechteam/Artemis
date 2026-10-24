// Heartbeat: every few minutes (within active hours) Artemis reads the checklist in HEARTBEAT.md and checks it.
// If nothing needs attention the model answers HEARTBEAT_OK and nothing is sent. Otherwise its answer goes to the
// user (Telegram, a notification, a saved chat). An empty checklist costs nothing: no model call is made.
// The same alert is not sent twice within a day. Only the process that owns the background jobs runs it.
//
// deps: {
//   settings(): { heartbeatEnabled, heartbeatEvery (minutes), heartbeatFrom 'HH:MM', heartbeatTo 'HH:MM', heartbeatModel },
//   checklist(): string | null      text of HEARTBEAT.md (null when there is no workspace)
//   run({ prompt, model }): Promise<{ text, error }>
//   deliver({ text, model }): Promise  sends an alert to the user
//   readState(), writeState(state), now?(), log?(level, message)
// }
const crypto = require('crypto');
const { meaningful, TEMPLATES } = require('./workspace');

const MIN = 60000;
const TOKEN = 'HEARTBEAT_OK';
const ACK_MAX = 300;                // an "OK" with a few extra words is still an OK
const DEDUPE_MS = 24 * 60 * MIN;

const TEMPLATE = TEMPLATES['HEARTBEAT.md'];

const minutesOf = (hhmm) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '')); return m ? Math.min(23, +m[1]) * 60 + Math.min(59, +m[2]) : null; };
/** Inside the active hours? from == to (or either missing) means always; from > to wraps past midnight (22:00–06:00). */
function inActiveHours(t, from, to) {
  const a = minutesOf(from), b = minutesOf(to);
  if (a === null || b === null || a === b) return true;
  const d = new Date(t); const m = d.getHours() * 60 + d.getMinutes();
  return a < b ? m >= a && m < b : m >= a || m < b;
}
const everyOf = (st) => Math.min(24 * 60, Math.max(5, Number(st.heartbeatEvery) || 30));

/** The checklist without comments and the "# Heartbeat" title; '' when there is nothing to check. */
function checklistText(text) {
  return meaningful(String(text || '')).replace(/^\s*#\s+Heartbeat\s*$/im, '').trim();
}

/** { ok: true } for a silent answer (the token, maybe with a few words), otherwise { ok: false, alert }. */
function parseReply(text, TOKEN = 'HEARTBEAT_OK') {
  const t = String(text || '').trim();
  if (!t) return { ok: true };
  const bare = t.replace(/\*\*|__|[*`~]/g, '').trim();
  if (bare.startsWith(TOKEN) || bare.endsWith(TOKEN) || bare.replace(/[.!\s]+$/, '').endsWith(TOKEN)) {
    const rest = bare.split(TOKEN).join('').trim();
    if (rest.length <= ACK_MAX) return { ok: true };
    return { ok: false, alert: rest };
  }
  return { ok: false, alert: t };
}
const hashOf = (t) => crypto.createHash('sha1').update(String(t).toLowerCase().replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 16);

function buildPrompt({ checklist, every, now, lastAlert }) {
  const when = new Date(now).toLocaleString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return [
    `This is a heartbeat check. It runs by itself every ${every} minutes and nobody is waiting for an answer. Current local time: ${when}.`,
    'Go through the checklist from HEARTBEAT.md below. Use tools only when an item needs them, and keep it short. Do not repeat old tasks from earlier chats and do not invent new items.',
    `If nothing needs the user's attention right now, reply with exactly ${TOKEN} and nothing else.`,
    `If something does, reply with a short message to the user instead (without ${TOKEN}): what happened and what they may want to do. It is sent to them as it is.`,
    lastAlert ? `Your last alert (${new Date(lastAlert.at).toLocaleString()}) was:\n"""${String(lastAlert.text).slice(0, 600)}"""\nDo not send it again unless something new happened.` : '',
    `<HEARTBEAT.md>\n${checklist}\n</HEARTBEAT.md>`
  ].filter(Boolean).join('\n\n');
}

function createHeartbeat(deps) {
  const now = deps.now || (() => Date.now());
  const log = deps.log || (() => {});
  let timer = null, running = false;
  const state = () => { try { return deps.readState() || {}; } catch { return {}; } };
  const save = (patch) => { const s = { ...state(), ...patch }; try { deps.writeState(s); } catch (e) { log('warn', 'Could not save the heartbeat state: ' + e.message); } return s; };

  async function beat({ manual = false } = {}) {
    if (running) return { status: 'busy' };
    const st = deps.settings() || {};
    const t = now();
    const raw = deps.checklist();
    if (raw === null || raw === undefined) { save({ lastRun: t, lastStatus: 'error', lastError: 'The heartbeat needs the memory workspace (Settings → Tools → Memory).' }); return { status: 'error', error: 'no workspace' }; }
    const checklist = checklistText(raw);
    if (!checklist) { save({ lastRun: t, lastStatus: 'empty', lastError: '' }); return { status: 'empty' }; }
    running = true;
    const prev = state();
    save({ lastRun: t, lastStatus: 'running', lastError: '' });
    const lastAlert = prev.lastAlertAt && t - prev.lastAlertAt < DEDUPE_MS ? { at: prev.lastAlertAt, text: prev.lastAlert || '' } : null;
    const model = st.heartbeatModel || '';
    let res;
    try { res = await deps.run({ prompt: buildPrompt({ checklist, every: everyOf(st), now: t, lastAlert }), model }); }
    catch (e) { res = { text: '', error: (e && e.message) || String(e) }; }
    running = false;
    const runs = (prev.runs || 0) + 1;
    if (res.error) {
      log('warn', 'heartbeat failed: ' + res.error);
      save({ lastStatus: 'error', lastError: String(res.error).slice(0, 300), runs });
      return { status: 'error', error: res.error };
    }
    const r = parseReply(res.text);
    if (r.ok) { save({ lastStatus: 'ok', runs, oks: (prev.oks || 0) + 1 }); log('info', `heartbeat: nothing to report${manual ? ' (run by hand)' : ''}`); return { status: 'ok' }; }
    const h = hashOf(r.alert);
    if (h === prev.lastAlertHash && prev.lastAlertAt && t - prev.lastAlertAt < DEDUPE_MS) {
      save({ lastStatus: 'duplicate', runs });
      log('info', 'heartbeat: same alert as before, not sent again');
      return { status: 'duplicate', text: r.alert };
    }
    try { await deps.deliver({ text: r.alert, model }); }
    catch (e) { log('warn', 'heartbeat alert could not be delivered: ' + e.message); save({ lastStatus: 'error', lastError: 'Could not deliver the alert: ' + e.message, runs }); return { status: 'error', error: e.message, text: r.alert }; }
    save({ lastStatus: 'alert', runs, alerts: (prev.alerts || 0) + 1, lastAlert: r.alert.slice(0, 2000), lastAlertAt: t, lastAlertHash: h });
    log('info', 'heartbeat: alert sent');
    return { status: 'alert', text: r.alert };
  }

  /** Runs a check when one is due. */
  function tick() {
    const st = deps.settings() || {};
    if (!st.heartbeatEnabled || running) return null;
    const t = now();
    const last = state().lastRun || 0;
    if (last && last <= t && t - last < everyOf(st) * MIN - 15000) return null; // 15 s early is fine: the tick runs every 30 s
    if (!inActiveHours(t, st.heartbeatFrom, st.heartbeatTo)) return null;
    return beat();
  }

  function status() {
    const st = deps.settings() || {};
    const s = state();
    const t = now();
    let nextAt = null;
    if (st.heartbeatEnabled) {
      nextAt = Math.max(t, (s.lastRun || 0) + everyOf(st) * MIN);
      for (let i = 0; i < 24 * 60 && !inActiveHours(nextAt, st.heartbeatFrom, st.heartbeatTo); i++) nextAt += MIN; // first minute inside the hours
    }
    return { enabled: !!st.heartbeatEnabled, every: everyOf(st), from: st.heartbeatFrom || '', to: st.heartbeatTo || '', model: st.heartbeatModel || '', running, nextAt, ...s, lastStatus: running ? 'running' : s.lastStatus === 'running' ? '' : s.lastStatus };
  }

  return {
    tick, beat: (o) => beat({ manual: true, ...o }), status,
    start() { if (timer) return; timer = setInterval(() => { const p = tick(); if (p && p.catch) p.catch(() => {}); }, 30000); if (timer.unref) timer.unref(); },
    stop() { if (timer) clearInterval(timer); timer = null; },
    isRunning: () => running
  };
}

module.exports = { createHeartbeat, parseReply, inActiveHours, checklistText, buildPrompt, TEMPLATE, TOKEN };
