// Heartbeats: each one is a short checklist that Artemis checks every few minutes (within its active hours).
// If nothing needs attention the model answers HEARTBEAT_OK and nothing is sent. Otherwise its answer goes to the
// user (Telegram, a notification, a saved chat). An empty checklist costs nothing: no model call is made.
// The same alert or topic is not sent twice within a day, and alerts are at least two hours apart. Only the process that owns the background jobs runs them.
// There can be several, each with its own checklist, interval, hours and model. The first one ("main") keeps its
// checklist in HEARTBEAT.md, the others in heartbeats/<id>.md in the memory workspace; the list is <data>/heartbeats.json.
//
// deps: {
//   list(): heartbeat[]  { id, name, every (minutes), from 'HH:MM', to 'HH:MM', model, phone, enabled }
//   saveList(list)
//   checklist(hb): string | null      text of its file (null when there is no workspace)
//   writeChecklist(hb, text)
//   removeChecklist?(hb)
//   run({ prompt, model, hb }): Promise<{ text, error }>
//   deliver({ text, model, hb }): Promise  sends an alert to the user
//   readState(), writeState(state)   state by heartbeat id
//   now?(), log?(level, message)
// }
const crypto = require('crypto');
const prompts = require('../prompts');
const { meaningful, TEMPLATES } = require('./workspace');

const MIN = 60000;
const TOKEN = 'HEARTBEAT_OK';
const ACK_MAX = 300;                // an "OK" with a few extra words is still an OK
const DEDUPE_MS = 24 * 60 * MIN;
const ALERT_GAP_MS = 2 * 60 * MIN;  // a hand-run check ignores this

const TEMPLATE = TEMPLATES['HEARTBEAT.md'];

const minutesOf = (hhmm) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '')); return m ? Math.min(23, +m[1]) * 60 + Math.min(59, +m[2]) : null; };
/** Inside the active hours? from == to (or either missing) means always; from > to wraps past midnight (22:00–06:00). */
function inActiveHours(t, from, to) {
  const a = minutesOf(from), b = minutesOf(to);
  if (a === null || b === null || a === b) return true;
  const d = new Date(t); const m = d.getHours() * 60 + d.getMinutes();
  return a < b ? m >= a && m < b : m >= a || m < b;
}

/** The checklist without comments and the "# Heartbeat" title; '' when there is nothing to check. */
function checklistText(text) {
  return meaningful(String(text || '')).replace(/^\s*#\s+.*$/m, '').trim(); // the first title line is only a name
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
/** Splits "TOPIC: some-key" off the first line of an alert; a model rewords a problem, the key stays the same. */
function splitTopic(alert) {
  const m = /^\s*[*_`]*TOPIC:[*_`]*\s*([^\n]+)\n+([\s\S]+)$/i.exec(String(alert || ''));
  if (!m) return { topic: '', body: String(alert || '') };
  return { topic: m[1].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60), body: m[2].trim() };
}
const hashOf = (t) => crypto.createHash('sha256').update(String(t).toLowerCase().replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 16);

const RULES = [
  'Go through the checklist from HEARTBEAT.md below. Use tools only when an item needs them, and keep it short. Do not repeat old tasks from earlier chats and do not invent new items.',
  "If nothing needs the user's attention right now, reply with exactly {token} and nothing else.",
  'If something does, reply instead (without {token}) with a first line "TOPIC: short-stable-key" naming the problem, for example "TOPIC: blog-waiting-for-email-code", then a short message to the user: what happened and what they may want to do. Everything after the first line is sent to them as it is.',
  'A problem the user already knows about is not news: if it has not changed, reply with exactly {token}, even when it is still unsolved.'
].join('\n\n');
prompts.register('heartbeat.rules', { title: 'Heartbeat checks', description: 'How a heartbeat check works. {token} is the word that means "nothing to report"; without it every check is sent to you.', text: RULES });

function buildPrompt({ checklist, every, now, lastAlert, name, topics = [] }) {
  const when = new Date(now).toLocaleString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return [
    `This is a heartbeat check${name && name !== 'Heartbeat' ? ` ("${name}")` : ''}. It runs by itself every ${every} minutes and nobody is waiting for an answer. Current local time: ${when}.`,
    prompts.text('heartbeat.rules', RULES, { token: TOKEN }),
    lastAlert ? `Your last alert (${new Date(lastAlert.at).toLocaleString()}) was:\n"""${String(lastAlert.text).slice(0, 600)}"""\nDo not send it again unless something new happened.` : '',
    topics.length ? `Topics already sent in the last day, not sent again: ${topics.join(', ')}. Use the same key if one of them is still the problem.` : '',
    `<HEARTBEAT.md>\n${checklist}\n</HEARTBEAT.md>`
  ].filter(Boolean).join('\n\n');
}

const RESTART_GAP_MS = 2 * 60 * MIN;
/** What a heartbeat with a teamId may do: see that one team and start it, at most once in two hours. */
function scopedTeams(tools, teamId, now = Date.now) {
  const own = async () => (await tools.list()).find((t) => t.id === teamId) || null;
  return {
    agents: () => [], projects: () => (tools.projects ? tools.projects() : []),
    list: async () => { const t = await own(); return t ? [t] : []; },
    get: async (id) => { const t = await own(); return t && (t.id === id || String(t.name).toLowerCase() === String(id).toLowerCase()) ? t : null; },
    start: async (id) => {
      const t = await own();
      if (!t || t.id !== id) throw new Error('This heartbeat can only start its own team.');
      if (t.run && t.run.status === 'working') throw new Error('The team is already working.');
      if (t.run && t.run.startedAt && now() - t.run.startedAt < RESTART_GAP_MS) throw new Error('The team was started less than 2 hours ago.');
      return tools.start(id);
    }
  };
}

const MIN_EVERY = 2;
const everyOf = (hb) => Math.min(24 * 60, Math.max(MIN_EVERY, Number(hb.every) || 30));
const fileOf = (hb) => (hb.id === 'main' ? 'HEARTBEAT.md' : `heartbeats/${hb.id}.md`);

/** The old single heartbeat (settings heartbeat*) as the first entry of the list. */
function fromSettings(st = {}) {
  return [{ id: 'main', name: 'Heartbeat', every: Number(st.heartbeatEvery) || 30, from: st.heartbeatFrom || '', to: st.heartbeatTo || '', model: st.heartbeatModel || '', phone: st.heartbeatPhone !== false, enabled: !!st.heartbeatEnabled }];
}

function createHeartbeats(deps) {
  const now = deps.now || (() => Date.now());
  const log = deps.log || (() => {});
  const running = new Set();
  let timer = null;
  const list = () => { try { const l = deps.list(); return Array.isArray(l) ? l : []; } catch { return []; } };
  const states = () => { try { return deps.readState() || {}; } catch { return {}; } };
  const stateOf = (id) => states()[id] || {};
  const save = (id, patch) => {
    const all = states();
    all[id] = { ...(all[id] || {}), ...patch };
    try { deps.writeState(all); } catch (e) { log('warn', 'Could not save the heartbeat state: ' + e.message); }
    return all[id];
  };
  const find = (id) => list().find((h) => h.id === id) || null;

  async function beat(hb, { manual = false } = {}) {
    if (running.has(hb.id)) return { status: 'busy' };
    const t = now();
    const raw = deps.checklist(hb);
    if (raw === null || raw === undefined) { save(hb.id, { lastRun: t, lastStatus: 'error', lastError: 'Heartbeats need the memory workspace (Settings → Tools → Memory).' }); return { status: 'error', error: 'no workspace' }; }
    const checklist = checklistText(raw);
    if (!checklist) { save(hb.id, { lastRun: t, lastStatus: 'empty', lastError: '' }); return { status: 'empty' }; }
    running.add(hb.id);
    const prev = stateOf(hb.id);
    save(hb.id, { lastRun: t, lastStatus: 'running', lastError: '' });
    const lastAlert = prev.lastAlertAt && t - prev.lastAlertAt < DEDUPE_MS ? { at: prev.lastAlertAt, text: prev.lastAlert || '' } : null;
    const sentTopics = Object.fromEntries(Object.entries(prev.alertTopics || {}).filter(([, at]) => t - at < DEDUPE_MS));
    const model = hb.model || '';
    let res;
    try { res = await deps.run({ prompt: buildPrompt({ checklist, every: everyOf(hb), now: t, lastAlert, name: hb.name, topics: Object.keys(sentTopics) }), model, hb, projectId: hb.projectId, teamId: hb.teamId }); }
    catch (e) { res = { text: '', error: (e && e.message) || String(e) }; }
    running.delete(hb.id);
    const runs = (prev.runs || 0) + 1;
    const who = `heartbeat "${hb.name}"`;
    if (res.error) {
      log('warn', `${who} failed: ${res.error}`);
      save(hb.id, { lastStatus: 'error', lastError: String(res.error).slice(0, 300), runs });
      return { status: 'error', error: res.error };
    }
    const r = parseReply(res.text);
    if (r.ok) { save(hb.id, { lastStatus: 'ok', runs, oks: (prev.oks || 0) + 1 }); log('info', `${who}: nothing to report${manual ? ' (run by hand)' : ''}`); return { status: 'ok' }; }
    const { topic, body } = splitTopic(r.alert);
    const h = hashOf(body);
    const sameAlert = h === prev.lastAlertHash && prev.lastAlertAt && t - prev.lastAlertAt < DEDUPE_MS;
    const tooSoon = !manual && prev.lastAlertAt && t - prev.lastAlertAt < ALERT_GAP_MS;
    if (sameAlert || (topic && sentTopics[topic]) || tooSoon) {
      save(hb.id, { lastStatus: 'duplicate', runs });
      log('info', `${who}: same alert as before, not sent again`);
      return { status: 'duplicate', text: r.alert };
    }
    try { await deps.deliver({ text: body, model, hb }); }
    catch (e) { log('warn', `${who}: the alert could not be delivered: ${e.message}`); save(hb.id, { lastStatus: 'error', lastError: 'Could not deliver the alert: ' + e.message, runs }); return { status: 'error', error: e.message, text: r.alert }; }
    save(hb.id, { lastStatus: 'alert', runs, alerts: (prev.alerts || 0) + 1, lastAlert: body.slice(0, 2000), lastAlertAt: t, lastAlertHash: h, alertTopics: topic ? { ...sentTopics, [topic]: t } : sentTopics });
    log('info', `${who}: alert sent`);
    return { status: 'alert', text: body };
  }

  const isDue = (hb, t) => {
    if (!hb.enabled || running.has(hb.id)) return false;
    const last = stateOf(hb.id).lastRun || 0;
    if (last && last <= t && t - last < everyOf(hb) * MIN - 15000) return false; // 15 s early is fine: the tick runs every 15 s
    return inActiveHours(t, hb.from, hb.to);
  };
  /** Runs every heartbeat that is due. Returns the promises (for tests). */
  function tick() {
    const t = now();
    return list().filter((hb) => isDue(hb, t)).map((hb) => beat(hb));
  }

  function nextAt(hb, s) {
    if (!hb.enabled) return null;
    const t = now();
    let n = Math.max(t, (s.lastRun || 0) + everyOf(hb) * MIN);
    for (let i = 0; i < 24 * 60 && !inActiveHours(n, hb.from, hb.to); i++) n += MIN; // first minute inside the hours
    return n;
  }
  function status() {
    const all = states();
    return list().map((hb) => {
      const s = all[hb.id] || {};
      const raw = deps.checklist(hb);
      return { ...hb, every: everyOf(hb), file: fileOf(hb), checklist: raw || '', items: checklistText(raw || '').split('\n').filter((l) => /^\s*[-*]\s+\S/.test(l)).length,
        running: running.has(hb.id), nextAt: nextAt(hb, s), ...s, lastStatus: running.has(hb.id) ? 'running' : s.lastStatus === 'running' ? '' : s.lastStatus };
    });
  }

  function upsert(input) {
    const l = list();
    const old = input.id ? l.find((h) => h.id === input.id) : null;
    if (input.id && !old) throw new Error('No heartbeat with that id.');
    const name = String(input.name !== undefined ? input.name : old ? old.name : '').trim().slice(0, 60);
    if (!name) throw new Error('Give the heartbeat a name.');
    const every = input.every !== undefined ? Number(input.every) : old ? old.every : 30;
    if (!(every >= MIN_EVERY && every <= 1440)) throw new Error(`Pick an interval between ${MIN_EVERY} minutes and 24 hours.`);
    const from = input.from !== undefined ? String(input.from || '') : old ? old.from : '';
    const to = input.to !== undefined ? String(input.to || '') : old ? old.to : '';
    if ((from || to) && (!/^\d{1,2}:\d{2}$/.test(from) || !/^\d{1,2}:\d{2}$/.test(to))) throw new Error('Pick both a start and an end time, or neither.');
    let id = old ? old.id : l.length ? 'hb' + crypto.randomBytes(4).toString('hex') : 'main';
    const hb = { ...(old || {}), id, name, every, from, to, model: input.model !== undefined ? String(input.model || '') : old ? old.model || '' : '',
      phone: input.phone !== undefined ? !!input.phone : old ? old.phone !== false : true, enabled: input.enabled !== undefined ? !!input.enabled : old ? !!old.enabled : false };
    deps.saveList(old ? l.map((h) => (h.id === id ? hb : h)) : [...l, hb]);
    if (typeof input.checklist === 'string') deps.writeChecklist(hb, input.checklist);
    else if (!old) deps.writeChecklist(hb, `# ${name}\n\n`);
    return hb;
  }

  return {
    tick, status, save: upsert,
    remove(id) {
      const hb = find(id);
      if (!hb) throw new Error('No heartbeat with that id.');
      deps.saveList(list().filter((h) => h.id !== id));
      const all = states(); delete all[id]; try { deps.writeState(all); } catch {}
      if (hb.id !== 'main' && deps.removeChecklist) { try { deps.removeChecklist(hb); } catch {} }
    },
    beat(id) { const hb = find(id); if (!hb) return Promise.resolve({ status: 'error', error: 'No heartbeat with that id.' }); return beat(hb, { manual: true }); },
    start() { if (timer) return; timer = setInterval(() => { for (const p of tick()) p.catch(() => {}); }, 15000); if (timer.unref) timer.unref(); },
    stop() { if (timer) clearInterval(timer); timer = null; },
    isRunning: (id) => (id ? running.has(id) : running.size > 0)
  };
}

module.exports = { splitTopic, scopedTeams, createHeartbeats, fromSettings, fileOf, parseReply, inActiveHours, checklistText, buildPrompt, TEMPLATE, TOKEN, MIN_EVERY };
