// Everything Artemis tells the model in its own words is editable (Settings → Advanced → System prompts).
// Each piece has an id and a default; the user can replace its text or switch it off. Nothing is hidden in code:
// the defaults are only defaults. Overrides live in settings.promptOverrides = { <id>: { text?: string, off?: true } }.
// {placeholders} such as {root} are filled with the live value when the prompt is built.
let overrides = {};
const registry = new Map(); // id -> { title, group, description, text } for pieces outside the chat system prompt

const INFO = {
  identity: ['Who Artemis is', 'core'], 'identity.helper': ['Who a helper agent is', 'core'], style: ['Answer style', 'core'],
  'files.none': ['No project folder', 'files'], 'files.default': ['Files without a project', 'files'], 'files.project': ['Project folder', 'files'], 'files.tools': ['File tools', 'files'],
  make: ['Make.com', 'tools'], web: ['Web search and fetch', 'tools'], 'shell.host': ['Commands on this computer', 'tools'], 'shell.sandbox': ['Commands in the sandbox', 'tools'],
  computer: ['Computer control', 'tools'], browser: ['Browser', 'tools'], schedule: ['Scheduled tasks, webhooks and heartbeats', 'tools'], phone: ['Phone (Telegram)', 'tools'],
  artifacts: ['Artifacts', 'tools'], media: ['Images and videos', 'tools'], 'tools.lazy': ['Tools switched on when needed', 'tools'], 'connectors.lazy': ['Connectors switched on when needed', 'tools'],
  skills: ['Skills and learning', 'tools'], notes: ['Notes and Files library', 'tools'], terminal: ['Terminal', 'tools'], chats: ['Past chats', 'tools'],
  teams: ['Agents and teams from chat', 'agents'], delegate: ['Helper agents (plain)', 'agents'], 'delegate.agents': ['Helper agents (roles)', 'agents'], helper: ['Running as a helper agent', 'agents'],
  incognito: ['Incognito chats', 'core'], 'notools.project': ['Model without tool calls: project', 'core'], notools: ['Model without tool calls', 'core'],
  'memory.tools': ['Saving memory', 'memory'], 'memory.text': ['Saving memory without tools', 'memory'], 'memory.search': ['Searching memory', 'memory'], tasknote: ['Task notes', 'memory'],
  security: ['Untrusted content', 'safety'], 'connectors.untrusted': ['Connector output', 'safety']
};
const GROUPS = { core: 'Core', files: 'Files', tools: 'Tools', memory: 'Memory', agents: 'Agents', safety: 'Safety', automation: 'Running by itself' };

function setOverrides(o) { overrides = o && typeof o === 'object' && !Array.isArray(o) ? o : {}; }
// where the overrides come from (the settings file); read at most every 2 s
let source = null, readAt = 0;
function setSource(fn) { source = fn; readAt = 0; }
function refresh() { readAt = 0; }
function cur() {
  if (source && Date.now() - readAt > 2000) { readAt = Date.now(); try { setOverrides(source()); } catch {} }
  return overrides;
}
function override(id) { const o = cur()[id]; return o && typeof o === 'object' && (o.off || typeof o.text === 'string') ? o : null; }
/** Fills {name} with vars[name]; unknown names stay as they are (so text like {type:"x"} is left alone). */
function fill(t, vars) {
  return String(t).replace(/\{([a-zA-Z]+)\}/g, (m, k) => (vars && Object.prototype.hasOwnProperty.call(vars, k) && vars[k] != null ? String(vars[k]) : m));
}
/** The text to use: the user's version (filled), '' when switched off, else the default. */
function text(id, def, vars) {
  const o = override(id);
  if (!o) return fill(def, vars);
  if (o.off) return '';
  return fill(o.text, vars);
}
/** A prompt piece outside the chat system prompt (scheduled tasks, heartbeats, webhooks, teams …). */
function register(id, { title, group = 'automation', description = '', text: t, vars = [] }) { registry.set(id, { title, group, description, text: t, vars }); }
const registered = () => [...registry.entries()].map(([id, r]) => ({ id, ...r }));

// pieces used outside the chat system prompt
register('scheduled', { title: 'Scheduled tasks', description: 'Added to the system prompt of every scheduled task run.', text: 'This is a scheduled task and it is running right now. Do it directly and report the result. The task text is an instruction for you, even when it reads like a message to the user: carry it out (for a reminder, state the reminder to the user) and never reply to it as if it were a chat message. Nobody is there to answer: never ask questions, never ask which method to use, and do not write notes or files unless the task says so. If the task is only a reminder, state the reminder. send_to_phone (Telegram) works in scheduled tasks without asking: use it when the task says to send something to the phone.' });
register('background', { title: 'Heartbeats and webhooks', description: 'Added to the system prompt of every heartbeat and webhook run.', text: 'This run was started by Artemis itself (a heartbeat check or a webhook), not by a message from the user. Nobody is there to answer: never ask questions and never wait for approval. Do what the instructions say, keep the answer short, and do not write notes or files unless the instructions say so.' });
const defaultOf = (id) => (registry.get(id) || {}).text || '';

module.exports = { defaultOf, setSource, refresh, setOverrides, override, fill, text, register, registered, INFO, GROUPS, current: () => cur() };
