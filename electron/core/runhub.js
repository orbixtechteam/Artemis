// Runs that outlive the HTTP request that started them. Every event of a run is numbered (seq) and kept for a while, so a
// client that lost its connection (a phone going to the background, a tunnel hiccup) asks for "everything after N" and
// carries on where it stopped. When too many events were dropped for that, it gets one "snapshot" event first: the
// assistant message as built so far (core/turn-builder.js), then the live events.
// Pure Node, no I/O.
const crypto = require('crypto');

/**
 * opts: { now?(), keepMs? (finished runs are kept this long), maxEvents? (per run), log? }
 */
function createRunHub({ now = () => Date.now(), keepMs = 15 * 60 * 1000, maxEvents = 5000, log = () => {} } = {}) {
  const runs = new Map(); // runId -> run
  const pending = new Map(); // approval id -> { id, runId, sessionId, summary, category, session, agent, at }

  function gc() {
    const t = now();
    for (const [id, r] of runs) if (r.endedAt && t - r.endedAt > keepMs) runs.delete(id);
  }
  const pub = (r) => ({ run_id: r.id, session_id: r.sessionId || null, started: r.started, ended: r.endedAt || 0, status: r.status, client: r.client || null, last_seq: r.seq, env: r.env || 'server' });

  function push(r, type, data) {
    r.seq++;
    const ev = { seq: r.seq, type, data };
    r.events.push(ev);
    if (r.events.length > maxEvents) { // drop the oldest; resumers from before this get a snapshot
      const cut = r.events.length - maxEvents;
      r.events.splice(0, cut);
    }
    if (type === 'tool:approval' && data && data.id) pending.set(data.id, { id: data.id, run_id: r.id, session_id: r.sessionId || null, summary: data.summary, category: data.category, session: !!data.session, agent: data.agent || null, at: now() });
    if ((type === 'tool:result' || type === 'tool:answered') && data && data.id) pending.delete(data.id);
    for (const fn of [...r.subs]) { try { fn(ev); } catch (e) { log('warn', 'run subscriber failed: ' + e.message); } }
  }

  /**
   * Starts a run. exec(emit, ctx) does the work and resolves { sessionId, text }; ctx.setSnapshot(fn) registers a function
   * that returns the message built so far. abort() stops it. Returns the run's public info.
   */
  function start({ runId = 'run_' + crypto.randomBytes(6).toString('hex'), sessionId = '', client = null, env = 'server', exec, abort }) {
    gc();
    if (sessionId && busy(sessionId)) throw Object.assign(new Error('That chat is already running a task. Wait for it or stop it.'), { status: 409 });
    const r = { id: runId, sessionId, client, env, started: now(), endedAt: 0, status: 'running', seq: 0, events: [], subs: new Set(), snapshot: null, abort, result: null, done: null };
    runs.set(runId, r);
    push(r, 'run', { run_id: runId, session_id: sessionId || null });
    const emit = (ev) => { if (!ev || !ev.type || ev.type === 'done' || r.endedAt) return; push(r, String(ev.type), ev); };
    r.done = Promise.resolve()
      .then(() => exec(emit, { setSnapshot: (fn) => { r.snapshot = fn; } }))
      .then((out) => {
        r.result = { session_id: (out && out.sessionId) || sessionId || null, run_id: runId, text: (out && out.text) || '' };
        if (out && out.sessionId) r.sessionId = out.sessionId;
        r.status = 'done';
        push(r, 'done', r.result);
        return r.result;
      }, (e) => {
        const msg = e instanceof Error && e.message ? e.message.split('\n')[0].slice(0, 500) : 'The run failed';
        log('warn', 'run failed: ' + ((e && e.stack) || e));
        r.status = 'error';
        r.error = msg;
        push(r, 'error', { message: msg, status: (e && e.status) || 500 });
        throw Object.assign(new Error(msg), { status: (e && e.status) || 500 });
      })
      .finally(() => {
        r.endedAt = now();
        for (const [id, a] of pending) if (a.run_id === runId) pending.delete(id);
        r.subs.clear();
      });
    r.done.catch(() => {});
    return pub(r);
  }

  /** Replays events after `after`, then follows the run live. fn(ev) gets { seq, type, data }. Returns unsubscribe. */
  function subscribe(runId, after, fn) {
    const r = runs.get(runId);
    if (!r) return null;
    const a = Math.max(0, Number(after) || 0);
    const first = r.events.length ? r.events[0].seq : r.seq + 1;
    if (a > 0 && a < first - 1 && r.snapshot) { // the client missed events we no longer have
      try { fn({ seq: first - 1, type: 'snapshot', data: { message: r.snapshot(), run_id: r.id, session_id: r.sessionId || null } }); } catch {}
    }
    for (const ev of r.events) if (ev.seq > a) fn(ev);
    if (r.endedAt) return () => {};
    r.subs.add(fn);
    return () => r.subs.delete(fn);
  }

  function busy(sessionId) { for (const r of runs.values()) if (!r.endedAt && r.sessionId === sessionId) return r; return null; }
  function abortRun(runId) { const r = runs.get(runId); if (!r || r.endedAt) return false; try { return r.abort ? r.abort() !== false : false; } catch { return false; } }
  const get = (runId) => { const r = runs.get(runId); return r ? { ...pub(r), result: r.result, error: r.error || '' } : null; };
  const list = ({ sessionId = '', active = false } = {}) => { gc(); return [...runs.values()].filter((r) => (!sessionId || r.sessionId === sessionId) && (!active || !r.endedAt)).map(pub); };
  const wait = (runId) => { const r = runs.get(runId); return r ? r.done : Promise.reject(new Error('No such run')); };
  const snapshot = (runId) => { const r = runs.get(runId); return r && r.snapshot ? r.snapshot() : null; };
  const approvals = () => [...pending.values()];
  const settled = (id) => pending.delete(id);
  const abortAll = () => { for (const r of runs.values()) if (!r.endedAt) { try { r.abort && r.abort(); } catch {} } };

  return { start, subscribe, abort: abortRun, get, list, wait, busy, snapshot, approvals, settled, abortAll, ids: () => [...runs.values()].filter((r) => !r.endedAt).map((r) => r.id) };
}

module.exports = { createRunHub };
