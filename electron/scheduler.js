// Scheduled tasks: recurring or one-off prompts that run in the background.
// job: { id, name, prompt, projectId, model, enabled, allowEdits, notifyPhone,
//        repeat: { type: 'once'|'interval'|'daily'|'weekdays'|'weekly'|'monthly'|'cron', at:'HH:MM', every (minutes), days:[0-6], dayOfMonth, date:'YYYY-MM-DD', cron:'m h dom mon dow' },
//        nextRun, lastRun, lastStatus, lastError, runs }
const { nextCron, describeCron, parseCron, minGapMinutes } = require('./core/cron');
const MIN = 60000;

function atParts(at) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(at || '09:00'));
  return m ? [Math.min(23, +m[1]), Math.min(59, +m[2])] : [9, 0];
}
const daysInMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();

/** Next run time (ms) strictly after `from`, or null when the job will not run again. */
function nextRunAfter(job, from = Date.now()) {
  const r = job.repeat || {};
  const [h, m] = atParts(r.at);
  if (r.type === 'interval') return from + Math.max(1, Number(r.every) || 60) * MIN;
  if (r.type === 'cron') { try { return nextCron(r.cron, from); } catch { return null; } }
  if (r.type === 'once') {
    const t = new Date(`${r.date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`).getTime();
    return Number.isFinite(t) && t > from ? t : null;
  }
  const days = Array.isArray(r.days) && r.days.length ? r.days.map(Number) : [1];
  const base = new Date(from);
  for (let i = 0; i < 400; i++) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i, h, m, 0, 0);
    if (d.getTime() <= from) continue;
    const dow = d.getDay();
    if (r.type === 'daily') return d.getTime();
    if (r.type === 'weekdays' && dow >= 1 && dow <= 5) return d.getTime();
    if (r.type === 'weekly' && days.includes(dow)) return d.getTime();
    if (r.type === 'monthly' && d.getDate() === Math.min(Math.max(1, Number(r.dayOfMonth) || 1), daysInMonth(d))) return d.getTime();
  }
  return null;
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function describe(job) {
  const r = job.repeat || {};
  const at = r.at || '09:00';
  switch (r.type) {
    case 'once': return `Once on ${r.date} at ${at}`;
    case 'interval': { const e = Number(r.every) || 60; return e % 1440 === 0 ? `Every ${e / 1440} day${e === 1440 ? '' : 's'}` : e % 60 === 0 ? `Every ${e / 60} hour${e === 60 ? '' : 's'}` : `Every ${e} min`; }
    case 'daily': return `Daily at ${at}`;
    case 'weekdays': return `Weekdays at ${at}`;
    case 'weekly': return `${(r.days || [1]).map((d) => DOW[d]).join(', ')} at ${at}`;
    case 'monthly': return `Monthly on day ${r.dayOfMonth || 1} at ${at}`;
    case 'cron': return describeCron(r.cron);
    default: return '';
  }
}

function validate(job, now = Date.now()) {
  if (!String(job.name || '').trim()) throw new Error('Give the task a name.');
  if (!String(job.prompt || '').trim()) throw new Error('Write what the task should do.');
  const r = job.repeat || {};
  if (!['once', 'interval', 'daily', 'weekdays', 'weekly', 'monthly', 'cron'].includes(r.type)) throw new Error('Choose how often it runs.');
  if (r.type === 'interval' && !(Number(r.every) >= 5)) throw new Error('The interval must be at least 5 minutes.');
  if (r.type === 'once' && !/^\d{4}-\d{2}-\d{2}$/.test(r.date || '')) throw new Error('Pick a date.');
  if (r.type === 'once' && job.enabled !== false && nextRunAfter(job, now) === null) throw new Error('That date and time have already passed. Pick a time in the future.');
  if (r.type === 'weekly' && !(r.days || []).length) throw new Error('Pick at least one weekday.');
  if (r.type === 'cron') {
    parseCron(r.cron); // throws a readable message
    if (nextCron(r.cron, now) === null) throw new Error('That cron expression never matches a date.');
    if (minGapMinutes(r.cron, now) < 5) throw new Error('That cron expression runs more often than every 5 minutes. Use a step of at least 5 (for example "*/5 * * * *").');
  }
}

/**
 * deps: { read(): job[], write(job[]), run(job, {manual}): Promise<{ok, error?}>, now?(): ms, changed?(): void }
 */
function createScheduler(deps) {
  const now = deps.now || (() => Date.now());
  const running = new Set();
  let timer = null;

  const load = () => { try { const l = deps.read(); return Array.isArray(l) ? l : []; } catch { return []; } };
  const store = (list) => { deps.write(list); try { deps.changed && deps.changed(); } catch {} };

  async function start(job, manual) {
    if (running.has(job.id)) return { ok: false, error: 'Already running.' };
    running.add(job.id);
    const t = now();
    let list = load();
    list = list.map((j) => (j.id === job.id ? { ...j, lastRun: t, runs: (j.runs || 0) + 1, lastStatus: 'running', lastError: '',
      ...(manual ? {} : { nextRun: nextRunAfter(j, t), enabled: j.repeat.type === 'once' ? false : j.enabled }) } : j));
    store(list);
    let res;
    try { res = await deps.run(job, { manual }); } catch (e) { res = { ok: false, error: e.message || String(e) }; }
    running.delete(job.id);
    store(load().map((j) => (j.id === job.id ? { ...j, lastStatus: res.ok ? 'ok' : 'error', lastError: res.ok ? '' : String(res.error || '').slice(0, 300) } : j)));
    return res;
  }

  function tick() {
    const t = now();
    let list = load();
    let dirty = false;
    list = list.map((j) => {
      if (j.enabled && !j.nextRun && j.lastStatus !== 'running') {
        dirty = true;
        const next = nextRunAfter(j, t);
        return next ? { ...j, nextRun: next } : { ...j, nextRun: null, enabled: false }; // a job that will never run again (past one-time) switches off
      }
      return j;
    });
    if (dirty) store(list);
    for (const j of list) if (j.enabled && j.nextRun && j.nextRun <= t && !running.has(j.id)) start(j, false);
  }

  return {
    tick,
    start: () => { tick(); timer = setInterval(tick, 20000); if (timer.unref) timer.unref(); },
    stop: () => { if (timer) clearInterval(timer); timer = null; },
    list: () => load().map((j) => ({ ...j, description: describe(j), running: running.has(j.id) })),
    save(input) {
      validate(input, now());
      const list = load();
      const id = input.id || 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const old = list.find((j) => j.id === id);
      const job = {
        runs: 0, lastRun: null, lastStatus: '', lastError: '', ...(old || {}),
        id, name: String(input.name).trim().slice(0, 80), prompt: String(input.prompt).trim(), projectId: input.projectId || null, model: input.model || '',
        enabled: input.enabled !== false, allowEdits: !!input.allowEdits, notifyPhone: !!input.notifyPhone, reminder: !!input.reminder, repeat: { ...input.repeat }
      };
      job.nextRun = job.enabled ? nextRunAfter(job, now()) : null;
      store(old ? list.map((j) => (j.id === id ? job : j)) : [...list, job]);
      return job;
    },
    toggle(id, enabled) {
      store(load().map((j) => {
        if (j.id !== id) return j;
        const next = enabled ? nextRunAfter(j, now()) : null;
        return { ...j, enabled: !!(enabled && next), nextRun: next };
      }));
    },
    remove: (id) => store(load().filter((j) => j.id !== id)),
    runNow(id) { const j = load().find((x) => x.id === id); return j ? start(j, true) : Promise.resolve({ ok: false, error: 'Task not found.' }); },
    isRunning: (id) => running.has(id)
  };
}

module.exports = { createScheduler, nextRunAfter, describe, validate };
