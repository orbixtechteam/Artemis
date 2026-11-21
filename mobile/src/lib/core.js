// Pure helpers shared by the app screens (no React Native imports, so `node scripts/test-lib.mjs` tests them):
// server addresses, the SSE parser, UTF-8 decoding of streamed bytes, and the turn builder that turns agent events
// into the same assistant message the desktop and the server store.

const PRIVATE = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[\w-]+\.local|[\w-]+\.lan|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+)$/i;

/** "artemis.example.com" -> "https://artemis.example.com"; http only for the local network. Throws a readable Error. */
export function normalizeUrl(input) {
  let s = String(input || '').trim();
  if (!s) throw new Error('Enter the server address.');
  if (!/^[a-z]+:\/\//i.test(s)) s = (PRIVATE.test(s.split(/[/:]/)[0]) ? 'http://' : 'https://') + s;
  let u;
  try { u = new URL(s); } catch { throw new Error('That is not a valid address.'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('The address must start with https://');
  if (u.protocol === 'http:' && !PRIVATE.test(u.hostname)) throw new Error('Use https:// for a server on the internet. http:// works only on your local network.');
  const p = u.pathname.replace(/\/+$/, '').replace(/\/v1$/, '');
  return `${u.protocol}//${u.host}${p}`;
}

/** A scanned QR code or an opened link: artemis://pair?url=…&code=…, or https://server/?code=… */
export function parsePairLink(text) {
  try {
    const u = new URL(String(text || '').trim());
    const code = u.searchParams.get('code') || '';
    if (u.protocol === 'artemis:') return { url: u.searchParams.get('url') || '', code };
    if (u.protocol === 'https:' || u.protocol === 'http:') return { url: `${u.protocol}//${u.host}`, code };
  } catch {}
  return null;
}

/** Streaming UTF-8 decoder (TextDecoder where there is one; a small fallback where there is not). */
export function utf8Decoder() {
  if (typeof TextDecoder !== 'undefined') { const d = new TextDecoder('utf-8'); return (bytes, end) => d.decode(bytes, { stream: !end }); }
  let rest = [];
  return (bytes, end) => {
    const b = rest.length ? [...rest, ...(bytes || [])] : Array.from(bytes || []);
    let out = '', i = 0;
    while (i < b.length) {
      const c = b[i];
      const n = c < 0x80 ? 1 : c >= 0xf0 ? 4 : c >= 0xe0 ? 3 : c >= 0xc0 ? 2 : 1;
      if (i + n > b.length) break;
      let cp = n === 1 ? c : n === 2 ? c & 0x1f : n === 3 ? c & 0x0f : c & 0x07;
      for (let k = 1; k < n; k++) cp = (cp << 6) | (b[i + k] & 0x3f);
      out += String.fromCodePoint(cp);
      i += n;
    }
    rest = end ? [] : b.slice(i);
    return out;
  };
}

/** Feeds text, calls onEvent({ type, seq, data }) for every complete server-sent event. */
export function sseParser(onEvent) {
  let buf = '';
  return (text) => {
    buf += text.replace(/\r\n/g, '\n');
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      let type = 'message', data = '', id = '';
      for (const line of block.split('\n')) {
        if (line.startsWith(':')) continue;
        if (line.startsWith('event:')) type = line.slice(6).trim();
        else if (line.startsWith('data:')) data += (data ? '\n' : '') + line.slice(5).replace(/^ /, '');
        else if (line.startsWith('id:')) id = line.slice(3).trim();
      }
      if (!data) continue;
      let parsed; try { parsed = JSON.parse(data); } catch { parsed = data; }
      onEvent({ type, seq: Number(id) || (parsed && parsed.seq) || 0, data: parsed });
    }
  };
}

// ---- turn builder: the same rules as electron/core/turn-builder.js and the desktop window ----
const uid = () => Math.random().toString(36).slice(2, 10);
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

export function newAssistant(id = uid()) { return { id, role: 'assistant', steps: [{ text: '', toolCalls: [] }], createdAt: Date.now(), env: 'server' }; }

/** One event applied to an assistant message; returns the new message (never changes the old one). */
export function applyEvent(m, ev) {
  if (!ev || !ev.type) return m;
  const t = Date.now();
  switch (ev.type) {
    case 'chunk': return ev.agent ? m : lastStep(m, (s) => ({ ...s, text: s.text + String(ev.text || '') }));
    case 'thinking': return lastStep(m, (s) => ({ ...s, thinking: { text: ((s.thinking && s.thinking.text) || '') + String(ev.text || ''), start: (s.thinking && s.thinking.start) || t } }));
    case 'thinking:end': return lastStep(m, (s) => (s.thinking ? { ...s, thinking: { ...s.thinking, ms: ev.ms } } : s));
    case 'step:new': return { ...m, steps: [...m.steps, { text: '', toolCalls: [] }] };
    case 'tool:call':
      if (ev.agent) return patchAgent(m, ev.agent.parent, ev.agent.idx, (a) => ({ ...a, tools: [...(a.tools || []), { id: ev.id, name: ev.name, args: ev.args, status: 'running', startedAt: t }] }));
      return lastStep(m, (s) => ({ ...s, toolCalls: [...s.toolCalls, { id: ev.id, name: ev.name, args: ev.args, status: 'running', startedAt: t }] }));
    case 'agent:start': return patchAgent(m, ev.parent, ev.idx, (a) => ({ ...a, name: ev.agent, role: ev.role, task: ev.task, model: ev.model, status: 'running' }));
    case 'agent:chunk': return patchAgent(m, ev.parent, ev.idx, (a) => ({ ...a, text: ((a.text || '') + ev.text).slice(-600) }));
    case 'agent:done': return patchAgent(m, ev.parent, ev.idx, (a) => ({ ...a, status: ev.ok ? 'done' : 'error', error: ev.error, tools: (a.tools || []).map((x) => (x.status === 'running' ? { ...x, status: ev.ok ? 'done' : 'cancelled' } : x)) }));
    case 'tool:question': {
      const set = (x) => ({ ...x, status: 'question', questions: ev.questions });
      if (m.steps.some((s) => s.toolCalls.some((x) => x.id === ev.id))) return patchTool(m, ev.id, set);
      return lastStep(m, (s) => ({ ...s, toolCalls: [...s.toolCalls, set({ id: ev.id, name: 'ask_user', args: {}, startedAt: t })] }));
    }
    case 'tool:answered': return patchTool(m, ev.id, (x) => (x.status !== 'question' ? x : { ...x, status: ev.answers ? 'done' : 'cancelled', answers: ev.answers || null }));
    case 'tool:approval': return patchTool(m, ev.id, (x) => ({ ...x, status: 'awaiting', session: ev.session, category: ev.category, summary: ev.summary }));
    case 'tool:result': return patchTool(m, ev.id, (x) => ({ ...x, status: ev.denied ? 'denied' : ev.ok ? 'done' : 'error', result: ev.text, endedAt: t }));
    case 'media': return lastStep(m, (s) => ({ ...s, media: [...(s.media || []), { kind: ev.kind, path: ev.path, prompt: ev.prompt }] }));
    case 'files': return lastStep(m, (s) => {
      const byPath = new Map((s.files || []).map((f) => [f.path, f]));
      for (const it of ev.items || []) if (it && it.path) byPath.set(it.path, { path: it.path, name: it.name, size: it.size, ext: it.ext, env: 'server' });
      return { ...s, files: [...byPath.values()] };
    });
    case 'artifact': return lastStep(m, (s) => ({ ...s, artifactRefs: [...(s.artifactRefs || []), ev.id] }));
    case 'brain': return { ...m, brain: { name: ev.name, role: ev.role, model: ev.model } };
    case 'council:start': return { ...m, council: { pending: true } };
    case 'council': return { ...m, council: { votes: ev.votes, verdict: ev.verdict } };
    case 'notice': return { ...m, notices: [...(m.notices || []), ev.text] };
    case 'error': return { ...m, error: ev.message };
    default: return m;
  }
}

/** Open cards closed and empty trailing steps removed, like the desktop when a run ends. */
export function finishAssistant(m) {
  const cancel = (x) => (x.status === 'running' || x.status === 'awaiting' || x.status === 'question' ? { ...x, status: 'cancelled' } : x);
  let steps = m.steps.map((s) => ({ ...s, toolCalls: s.toolCalls.map(cancel) }));
  while (steps.length > 1 && !steps[steps.length - 1].text && !steps[steps.length - 1].toolCalls.length && !steps[steps.length - 1].thinking) steps = steps.slice(0, -1);
  return { ...m, steps };
}

/** The visible text of a message (no <think> blocks). */
export function messageText(m) {
  if (!m) return '';
  if (m.role === 'user') return String(m.content || '');
  return (m.steps || []).map((s) => String(s.text || '').replace(/<think(ing)?>[\s\S]*?(<\/think(ing)?>|$)/gi, '').trim()).filter(Boolean).join('\n\n');
}

/** "3 min ago", "Yesterday", or a date. */
export function when(t, now = Date.now()) {
  if (!t) return '';
  const s = Math.round((now - t) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  if (s < 172800) return 'Yesterday';
  return new Date(t).toLocaleDateString();
}

/** A chat id made on the phone (the server accepts [\w.:-]{1,80}). */
export const newChatId = () => 'm-' + Date.now().toString(36) + '-' + uid();
export const newMessageId = () => uid() + uid();
