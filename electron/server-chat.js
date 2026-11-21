// Chats that live on the paired server, run from the desktop in one of two places:
//   'server' : the server's agent runs the turn (POST /v1/chat, detached; the stream is resumed if it drops)
//   'local'  : this computer's agent runs it (executeRun: computer control, local files and terminal), with the server
//              chat as history, and the finished turn is saved to the server chat marked env 'local'
// A turn never falls back to the other place: if the chosen one is not reachable, the user is told.
// Events go to the window that asked (send(requestId, ev)), in the same shapes as the desktop's own chat events.
const crypto = require('crypto');
const { createTurnBuilder } = require('./core/turn-builder');
const { toApiMessages } = require('./core/history');

const MEDIA = /^artemis-media:\/\//;

/** The server chat's messages as model input on this computer: its pictures stay on the server. */
function localHistory(messages) {
  const clean = (messages || []).map((m) => (m && m.role === 'user' && Array.isArray(m.attachments)
    ? { ...m, attachments: m.attachments.map((a) => (a.kind === 'image' && MEDIA.test(a.url || '') ? { kind: 'file', name: a.name || 'image', text: '[a picture stored on the server]' } : a)) }
    : m));
  return toApiMessages(clean);
}

/**
 * deps: { link (server-link), executeRun(opts) -> Promise, abortLocal(requestId), send(requestId, ev), log?,
 *         settings() , fetch? }
 */
function createServerChat({ link, executeRun, abortLocal, send, log = () => {}, settings = () => ({}) }) {
  const active = new Map(); // requestId -> { env, runId, seq, sessionId, ctl, done }
  const serverApprovals = new Set(); // tool ids a server run is waiting on (answered through the API)

  async function streamServer(r, path, opts) {
    const cfg = link.config();
    const res = await fetch(cfg.url + path, { ...opts, headers: { ...(opts.headers || {}), authorization: `Bearer ${link.token()}`, accept: 'text/event-stream' }, signal: r.ctl.signal });
    if (!res.ok) { const j = await res.json().catch(() => ({})); throw Object.assign(new Error(j.error || `HTTP ${res.status}`), { status: res.status }); }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        let type = '', data = '', id = 0;
        for (const l of block.split('\n')) { if (l.startsWith('event: ')) type = l.slice(7); else if (l.startsWith('data: ')) data += l.slice(6); else if (l.startsWith('id: ')) id = Number(l.slice(4)) || 0; }
        if (!data) continue;
        let ev; try { ev = JSON.parse(data); } catch { continue; }
        if (id) r.seq = Math.max(r.seq, id);
        if (type === 'run') { r.runId = ev.run_id; send(r.requestId, { type: 'server:run', runId: ev.run_id, sessionId: ev.session_id }); continue; }
        if (type === 'done') { r.done = true; send(r.requestId, { type: 'done', text: ev.text, sessionId: ev.session_id }); continue; }
        if (type === 'error') { r.done = true; send(r.requestId, { type: 'error', message: ev.message }); send(r.requestId, { type: 'done' }); continue; }
        if (type === 'snapshot') { send(r.requestId, { type: 'snapshot', message: ev.message }); continue; }
        if ((ev.type || type) === 'tool:approval' && ev.id) serverApprovals.add(ev.id);
        send(r.requestId, { ...ev, type: ev.type || type });
      }
    }
  }

  async function runOnServer(r, { message, model, projectId, attachments, options }) {
    const body = JSON.stringify({ message, session_id: r.sessionId, detach: true, ...(options && typeof options === 'object' ? { options } : {}), ...(model ? { model } : {}), ...(projectId ? { project_id: projectId } : {}), ...(attachments && attachments.length ? { attachments } : {}) });
    let tries = 0;
    let first = true;
    while (!r.done && !r.ctl.signal.aborted) {
      try {
        if (first) { first = false; await streamServer(r, '/v1/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body }); }
        else await streamServer(r, `/v1/runs/${encodeURIComponent(r.runId)}/events?after=${r.seq}`, { method: 'GET' });
        tries = 0;
      } catch (e) {
        if (r.ctl.signal.aborted) break;
        if (!r.runId || (e.status && e.status !== 502 && e.status !== 503 && e.status !== 504)) { // never started, or the server said no
          send(r.requestId, { type: 'error', message: e.status === 404 ? 'The run is over; reload the chat.' : (e.message || 'The server is not reachable.') });
          break;
        }
        if (++tries > 8) { send(r.requestId, { type: 'error', message: 'Lost the connection to the server. The answer goes on there; reload the chat to see it.' }); break; }
        send(r.requestId, { type: 'notice:reconnecting', tries });
        await new Promise((res) => setTimeout(res, Math.min(15000, 1000 * 2 ** tries)));
      }
    }
    if (!r.done) send(r.requestId, { type: 'done' });
  }

  async function runOnComputer(r, { message, model, projectId, attachments, options = {} }) {
    let chat = null;
    try { chat = (await link.request(`/v1/sessions/${encodeURIComponent(r.sessionId)}?full=1`)).chat; }
    catch (e) { if (e.status !== 404) throw e; }
    const user = { id: crypto.randomBytes(6).toString('hex'), role: 'user', content: message, createdAt: Date.now(), via: 'desktop', ...(attachments && attachments.length ? { attachments } : {}) };
    const modelId = model || (chat && chat.model) || settings().model || '';
    const tb = createTurnBuilder({ via: 'desktop', model: modelId, env: 'local' });
    const out = (ev) => { if (!ev || !ev.type) return; if (ev.type !== 'done') tb.apply(ev); send(r.requestId, ev.type === 'done' ? { type: 'local:end' } : ev); };
    let error = '';
    try {
      await executeRun({ requestId: r.requestId, model: modelId, messages: localHistory([...((chat && chat.messages) || []), user]), send: out, source: 'server-chat', chatId: r.sessionId, project: null, system: settings().systemPrompt, maxTokens: settings().maxTokens,
        brain: options.brain, brainPick: (chat && chat.councilPick) || '', agentsMode: options.agents || '', toolsMode: options.tools || '', effort: options.effort || '', permMode: options.perm === 'auto' ? 'auto' : options.perm ? 'ask' : undefined, mentions: options.mentions || [] });
    } catch (e) { error = e.message || String(e); tb.apply({ type: 'error', message: error }); send(r.requestId, { type: 'error', message: error }); }
    // screenshots stay on this computer (they are large and only the run needed them)
    const done = tb.finish();
    const assistant = { ...done, steps: done.steps.map((s) => ({ ...s, toolCalls: (s.toolCalls || []).map(({ image, ...t }) => t) })) };
    try {
      await link.request(`/v1/x/sessions/${encodeURIComponent(r.sessionId)}/turn`, { method: 'POST', body: { user, assistant, title: message, model: modelId, projectId: projectId || (chat && chat.projectId) || null } });
    } catch (e) { send(r.requestId, { type: 'error', message: 'The answer was made on this computer but could not be saved to the server: ' + e.message }); }
    r.done = true;
    send(r.requestId, { type: 'done', text: tb.text(), sessionId: r.sessionId });
  }

  /** o: { sessionId?, message, model?, projectId?, attachments?, env: 'server'|'local' } -> { requestId, sessionId } */
  async function start(o = {}) {
    const st = await link.status();
    const env = o.env === 'local' ? 'local' : 'server';
    if (!st.configured) throw new Error('No server is connected.');
    if (!st.online) throw new Error(env === 'server' ? `The server is not reachable (${st.error || 'offline'}). Try again, or run this turn on this computer.` : `This chat lives on the server, which is not reachable now (${st.error || 'offline'}).`);
    const message = String(o.message || '').trim();
    if (!message && !(o.attachments || []).length) throw new Error('Write a message first.');
    const requestId = o.requestId && /^[\w-]{4,64}$/.test(String(o.requestId)) ? String(o.requestId) : 'srv-' + crypto.randomBytes(6).toString('hex');
    const sessionId = o.sessionId && /^[\w.:-]{1,80}$/.test(o.sessionId) ? o.sessionId : 'd-' + Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex');
    const r = { requestId, env, sessionId, runId: '', seq: 0, done: false, ctl: new AbortController() };
    active.set(requestId, r);
    const job = env === 'server' ? runOnServer(r, { ...o, message }) : runOnComputer(r, { ...o, message });
    job.catch((e) => { send(requestId, { type: 'error', message: e.message || String(e) }); send(requestId, { type: 'done' }); log('warn', 'server chat: ' + e.message); })
      .finally(() => active.delete(requestId));
    return { requestId, sessionId, env };
  }

  function abort(requestId) {
    const r = active.get(requestId);
    if (!r) return false;
    if (r.env === 'local') { abortLocal(requestId); return true; }
    if (r.runId) link.request(`/v1/runs/${encodeURIComponent(r.runId)}/abort`, { method: 'POST', body: {} }).catch(() => {});
    return true;
  }
  /** A tool waiting for approval: on the server through the API; a local turn's go through the app's own approvals. */
  async function decideOnServer(toolId, ok) { serverApprovals.delete(toolId); return link.request(`/v1/approvals/${encodeURIComponent(toolId)}`, { method: 'POST', body: { approve: !!ok } }); }
  const envOf = (requestId) => (active.get(requestId) || {}).env || '';

  return { start, abort, decideOnServer, envOf, localHistory, ownsApproval: (id) => serverApprovals.has(id), has: (rid) => active.has(rid) };
}

module.exports = { createServerChat, localHistory };
