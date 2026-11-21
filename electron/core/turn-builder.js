// Builds an assistant message from agent events, in the same shape the desktop window stores (src/App.jsx onEvent):
//   { id, role: 'assistant', steps: [{ text, toolCalls: [...], thinking?, files?, media?, artifactRefs? }], error?, notices?, brain?, council? }
// The server uses it so a chat run on the server (from the phone, the web app or the desktop's "Home server" mode) is saved
// with its tool cards, files and thinking, exactly like a chat run on the computer. Pure: no I/O, no Electron.
const THINK_CAP = 50000;
const uid = () => Math.random().toString(36).slice(2, 10);

function addThinking(prev, piece, now) {
  const p = prev || {};
  const old = String(p.text || '');
  const add = String(piece || '');
  const room = Math.max(0, THINK_CAP - old.length);
  const out = { text: old + add.slice(0, room), start: p.start || now };
  if (p.cut || add.length > room) out.cut = true;
  return out;
}
const lastStep = (m, fn) => { const steps = [...m.steps]; steps[steps.length - 1] = fn(steps[steps.length - 1]); return { ...m, steps }; };
const patchTool = (m, id, fn) => ({ ...m, steps: m.steps.map((s) => ({ ...s, toolCalls: s.toolCalls.map((t) => {
  if (t.id === id) return fn(t);
  if (t.agents && t.agents.some((a) => (a.tools || []).some((x) => x.id === id))) return { ...t, agents: t.agents.map((a) => ((a.tools || []).some((x) => x.id === id) ? { ...a, tools: a.tools.map((x) => (x.id === id ? fn(x) : x)) } : a)) };
  return t;
}) })) });
const patchAgent = (m, parent, idx, fn) => ({ ...m, steps: m.steps.map((s) => ({ ...s, toolCalls: s.toolCalls.map((t) => {
  if (t.id !== parent) return t;
  const agents = [...(t.agents || [])];
  agents[idx] = fn(agents[idx] || { tools: [], text: '', status: 'running' });
  return { ...t, agents };
}) })) });
const isShot = (s) => typeof s === 'string' && s.startsWith('data:image/');

/**
 * opts: { id?, via?, model?, env?, now?() }
 * returns { apply(ev), finish(), message(), artifacts() }
 * Screenshots (data: URLs on tool results) are kept only for the last `keepShots` results, like the window does.
 */
function createTurnBuilder({ id = uid(), via = '', model = '', env = 'server', now = () => Date.now(), keepShots = 2 } = {}) {
  let m = { id, role: 'assistant', steps: [{ text: '', toolCalls: [] }], createdAt: now() };
  if (via) m.via = via;
  if (model) m.model = model;
  if (env) m.env = env;
  const artifacts = {}; // chat-level, like chat.artifacts in the window
  const shots = [];

  function apply(ev) {
    if (!ev || !ev.type) return;
    const t = now();
    switch (ev.type) {
      case 'chunk': if (!ev.agent) m = lastStep(m, (s) => ({ ...s, text: s.text + String(ev.text || '') })); break;
      case 'thinking': m = lastStep(m, (s) => ({ ...s, thinking: addThinking(s.thinking, ev.text, t) })); break;
      case 'thinking:end': m = lastStep(m, (s) => (s.thinking ? { ...s, thinking: { ...s.thinking, ms: ev.ms } } : s)); break;
      case 'step:new': m = { ...m, steps: [...m.steps, { text: '', toolCalls: [] }] }; break;
      case 'tool:call':
        if (ev.agent) m = patchAgent(m, ev.agent.parent, ev.agent.idx, (a) => ({ ...a, tools: [...(a.tools || []), { id: ev.id, name: ev.name, args: ev.args, status: 'running', startedAt: t }] }));
        else m = lastStep(m, (s) => ({ ...s, toolCalls: [...s.toolCalls, { id: ev.id, name: ev.name, args: ev.args, status: 'running', startedAt: t }] }));
        break;
      case 'agent:start': m = patchAgent(m, ev.parent, ev.idx, (a) => ({ ...a, name: ev.agent, role: ev.role, task: ev.task, model: ev.model, status: 'running', prompt: 0, completion: 0 })); break;
      case 'agent:chunk': m = patchAgent(m, ev.parent, ev.idx, (a) => ({ ...a, text: ((a.text || '') + ev.text).slice(-600) })); break;
      case 'agent:usage': m = patchAgent(m, ev.parent, ev.idx, (a) => ({ ...a, prompt: ev.prompt, completion: ev.completion })); break;
      case 'agent:done': m = patchAgent(m, ev.parent, ev.idx, (a) => ({ ...a, status: ev.ok ? 'done' : 'error', error: ev.error, prompt: ev.prompt ?? a.prompt, completion: ev.completion ?? a.completion, tools: (a.tools || []).map((x) => (x.status === 'running' ? { ...x, status: ev.ok ? 'done' : 'cancelled' } : x)) })); break;
      case 'tool:question': {
        const set = (x) => ({ ...x, status: 'question', questions: ev.questions });
        if (m.steps.some((s) => s.toolCalls.some((x) => x.id === ev.id))) m = patchTool(m, ev.id, set);
        else m = lastStep(m, (s) => ({ ...s, toolCalls: [...s.toolCalls, set({ id: ev.id, name: 'ask_user', args: {}, startedAt: t })] }));
        break;
      }
      case 'tool:answered': m = patchTool(m, ev.id, (x) => (x.status !== 'question' ? x : { ...x, status: ev.answers ? 'done' : 'cancelled', endedAt: t, answers: ev.answers || null,
        result: ev.answers ? Object.entries(ev.answers).map(([q, a]) => `${q} -> ${a}`).join('\n') : 'Not answered.' })); break;
      case 'tool:approval': m = patchTool(m, ev.id, (x) => ({ ...x, status: 'awaiting', session: ev.session, category: ev.category, agent: ev.agent, summary: ev.summary })); break;
      case 'tool:result':
        if (isShot(ev.image)) { shots.push(ev.id); }
        m = patchTool(m, ev.id, (x) => ({ ...x, status: ev.denied ? 'denied' : ev.ok ? 'done' : 'error', result: ev.text, image: ev.image, endedAt: t }));
        break;
      case 'artifact': {
        const prev = artifacts[ev.id];
        artifacts[ev.id] = { id: ev.id, title: ev.title, type: ev.kind, language: ev.language, versions: [...(prev ? prev.versions : []), ev.content].slice(-12) };
        m = lastStep(m, (s) => ({ ...s, artifactRefs: [...(s.artifactRefs || []), ev.id] }));
        break;
      }
      case 'media': m = lastStep(m, (s) => ({ ...s, media: [...(s.media || []), { kind: ev.kind, path: ev.path, prompt: ev.prompt, model: ev.model, ...(env ? { env } : {}) }] })); break;
      case 'files': m = lastStep(m, (s) => {
        const byPath = new Map((s.files || []).map((f) => [f.path, f]));
        for (const it of ev.items || []) if (it && it.path) byPath.set(it.path, it.kind === 'plugin' ? { kind: 'plugin', path: it.path, name: it.name, slug: it.slug, description: it.description, tools: it.tools, panels: it.panels } : { path: it.path, name: it.name, size: it.size, ext: it.ext, ...(env ? { env } : {}) });
        return { ...s, files: [...byPath.values()] };
      }); break;
      case 'brain': m = { ...m, brain: { name: ev.name, role: ev.role, model: ev.model } }; break;
      case 'council': m = { ...m, council: { votes: ev.votes, verdict: ev.verdict, tokens: ev.tokens } }; break;
      case 'council:start': m = { ...m, council: { pending: true } }; break;
      case 'notice': m = { ...m, notices: [...(m.notices || []), ev.text] }; break;
      case 'error': m = { ...m, error: ev.message }; break;
      default: break;
    }
  }

  /** Same clean-up as the window's "done": open cards become cancelled, empty trailing steps go, a blank answer says so. */
  function finish() {
    const t = now();
    const cancel = (x) => (x.status === 'running' || x.status === 'awaiting' || x.status === 'question' ? { ...x, status: 'cancelled' } : x);
    let steps = m.steps.map((s) => ({ ...s, toolCalls: s.toolCalls.map((x) => { const y = cancel(x); return y.agents ? { ...y, agents: y.agents.map((a) => (a && a.status === 'running' ? { ...a, status: 'cancelled', tools: (a.tools || []).map(cancel) } : a)) } : y; }) }));
    while (steps.length > 1 && !steps[steps.length - 1].text && !steps[steps.length - 1].toolCalls.length && !steps[steps.length - 1].thinking) steps = steps.slice(0, -1);
    steps = steps.map((s) => (s.thinking && typeof s.thinking.ms !== 'number' ? { ...s, thinking: { ...s.thinking, ms: Math.max(0, t - (s.thinking.start || t)) } } : s));
    const blank = steps.every((s) => !s.text && !(s.toolCalls || []).length && !s.thinking && !(s.media || []).length) && !m.error && !(m.notices || []).length;
    // only the newest screenshots stay (they are large); older ones keep their card without the picture
    const drop = new Set(shots.slice(0, Math.max(0, shots.length - keepShots)));
    if (drop.size) steps = steps.map((s) => ({ ...s, toolCalls: s.toolCalls.map((x) => (drop.has(x.id) ? (({ image, ...r }) => r)(x) : x)) }));
    m = { ...m, steps, ...(blank ? { notices: ['No answer was written (the run was stopped or the model returned nothing). Press Regenerate to try again.'] } : {}) };
    return m;
  }

  /** The visible answer: the last step with text (the same as the old text-only gateway result). */
  const text = () => { const parts = m.steps.map((s) => String(s.text || '').trim()).filter(Boolean); return parts.length ? parts[parts.length - 1] : ''; };

  return { apply, finish, message: () => m, artifacts: () => ({ ...artifacts }), text };
}

module.exports = { createTurnBuilder, addThinking };
