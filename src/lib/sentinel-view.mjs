// What the floating Sentinel widget shows: the last question, the answer as it is written, what the tools are doing,
// images, a waiting approval and errors. Pure functions (no DOM), so they can be tested in Node.
import { stripThink } from './think.mjs';
import { stripTags } from './tts-emotion.mjs';

const clip = (s, n) => { const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const base = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || '';
const host = (u) => { try { return new URL(String(u)).hostname.replace(/^www\./, ''); } catch { return clip(u, 40); } };
const args = (t) => { if (t && t.args && typeof t.args === 'object') return t.args; try { return JSON.parse((t && t.args) || '{}') || {}; } catch { return {}; } };

const ACTIVITY = {
  web_search: (a) => `Searching the web${a.query ? ` for “${clip(a.query, 48)}”` : ''}`,
  web_fetch: (a) => `Reading ${a.url ? host(a.url) : 'a web page'}`,
  read_file: (a) => `Reading ${base(a.path) || 'a file'}`,
  list_dir: (a) => `Looking in ${base(a.path) || 'the folder'}`,
  search_files: (a) => `Searching files${a.query ? ` for “${clip(a.query, 40)}”` : ''}`,
  write_file: (a) => `Writing ${base(a.path) || 'a file'}`,
  edit_file: (a) => `Editing ${base(a.path) || 'a file'}`,
  write_spreadsheet: (a) => `Creating ${base(a.path) || 'a spreadsheet'}`,
  update_cells: (a) => `Updating ${base(a.path) || 'cells'}`,
  create_folder: () => 'Creating a folder',
  move_file: () => 'Moving a file',
  delete_file: (a) => `Deleting ${base(a.path) || 'a file'}`,
  run_command: (a) => `Running ${a.command ? `“${clip(a.command, 40)}”` : 'a command'}`,
  terminal_run: (a) => `Running ${a.command ? `“${clip(a.command, 40)}”` : 'a command'} in the terminal`,
  terminal_read: () => 'Reading the terminal',
  computer: (a) => (a.action === 'screenshot' ? 'Looking at your screen' : 'Using your computer'),
  notes_search: () => 'Searching your notes', notes_read: () => 'Reading a note', notes_list: () => 'Browsing your notes',
  notes_write: () => 'Writing a note', notes_append: () => 'Adding to a note', notes_edit: () => 'Editing a note',
  create_artifact: (a) => `Making ${a.title ? `“${clip(a.title, 40)}”` : 'an artifact'}`,
  generate_image: () => 'Generating an image', generate_video: () => 'Generating a video',
  memory_save: () => 'Saving to memory', memory_forget: () => 'Removing from memory',
  use_skill: () => 'Using a skill', search_chats: () => 'Searching your chats', read_chat: () => 'Reading a chat',
  delegate: () => 'Agents are working', send_to_phone: () => 'Sending to your phone', schedule_task: () => 'Scheduling a task',
  browser_navigate: (a) => `Opening ${a.url ? host(a.url) : 'a page'}`, browser_read_page: () => 'Reading the page', browser_get_text: () => 'Reading the page',
  browser_click: () => 'Clicking on the page', browser_type: () => 'Typing on the page', browser_form_input: () => 'Filling in a form',
  browser_screenshot: () => 'Taking a browser screenshot', browser_scroll: () => 'Scrolling the page', browser_find: () => 'Searching the page'
};

/** "Searching the web for “x”…": one line for the tool call that is running (or waiting). */
export function activityOf(tc) {
  if (!tc || !tc.name) return '';
  const f = ACTIVITY[tc.name];
  if (f) return f(args(tc)) + '…';
  const m = /^mcp__([^_]+(?:_[^_]+)*)__(.+)$/.exec(tc.name);
  if (m) return `Using ${m[1]} (${m[2].replace(/_/g, ' ')})…`;
  return `Using ${tc.name.replace(/_/g, ' ')}…`;
}

/** Keeps the end of a long answer (whole paragraphs where possible), so the widget never holds more than it can show. */
export function tailText(text, max = 6000) {
  const t = String(text || '');
  if (t.length <= max) return t;
  const cut = t.slice(t.length - max);
  const p = cut.indexOf('\n\n');
  return '…' + (p >= 0 && p < max / 2 ? cut.slice(p + 2) : cut);
}

/**
 * The widget's view of one chat: its last exchange.
 * Returns { title, heard, answer, activity, images: [{ type: 'media' | 'src', path?, src?, kind }], approval, error, artifacts, running }.
 */
export function widgetView(chat, { maxText = 6000, maxShot = 1500000, maxImages = 4 } = {}) {
  const empty = { title: '', heard: '', answer: '', activity: '', images: [], approval: null, error: '', artifacts: [], files: [], messages: [], running: false };
  if (!chat || !Array.isArray(chat.messages)) return empty;
  const msgs = chat.messages;
  let ui = -1; for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === 'user') { ui = i; break; }
  const user = ui >= 0 ? msgs[ui] : null;
  const asst = msgs.slice(ui + 1).reverse().find((m) => m.role === 'assistant') || null;
  const out = { ...empty, title: chat.title || '', heard: user ? clip(typeof user.content === 'string' ? user.content : '', 600) : '', messages: chatMessages(chat, { maxShot }) };
  if (!asst) return out;
  out.files = filesOf(asst);
  const steps = asst.steps || [];
  out.answer = tailText(stripTags(steps.map((s) => stripThink(s.text || '')).filter(Boolean).join('\n\n'), { partial: true }), maxText); // emotion tags are for the voice only
  const imgs = [];
  for (const s of steps) {
    for (const tc of s.toolCalls || []) {
      if ((tc.status === 'running' || tc.status === 'awaiting')) out.activity = activityOf(tc);
      if (tc.status === 'awaiting' && !out.approval) out.approval = { id: tc.id, title: activityOf(tc).replace(/…$/, ''), summary: clip(tc.summary || tc.category || '', 300) };
      for (const a of tc.agents || []) for (const x of (a && a.tools) || []) if (x.status === 'awaiting' && !out.approval) out.approval = { id: x.id, title: `${a.name || 'Agent'}: ${activityOf(x).replace(/…$/, '')}`, summary: clip(x.summary || x.category || '', 300) };
      if (typeof tc.image === 'string' && /^(data:image\/|artemis-media:\/\/)/.test(tc.image) && tc.image.length <= maxShot) imgs.push({ type: 'src', src: tc.image, kind: 'image', label: tc.name === 'computer' ? 'Screen' : 'Screenshot' });
    }
    for (const md of s.media || []) if (md && md.path) imgs.push({ type: 'media', path: md.path, kind: md.kind === 'video' ? 'video' : 'image', label: clip(md.prompt || '', 80) });
    for (const id of s.artifactRefs || []) { const a = artifactCard(chat, id); if (a && !out.artifacts.some((x) => x.id === id)) out.artifacts.push(a); }
  }
  for (const m of out.answer.matchAll(/!\[([^\]]*)\]\((https:\/\/[^)\s]+|data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+)\)/g)) if (m[2].length <= maxShot) imgs.push({ type: 'src', src: m[2], kind: 'image', label: clip(m[1], 80) });
  out.images = imgs.slice(-maxImages);
  out.error = asst.error ? clip(asst.error, 300) : '';
  out.running = steps.some((s) => (s.toolCalls || []).some((t) => t.status === 'running' || t.status === 'awaiting'));
  return out;
}

/** An artifact as the widget lists it. rev changes whenever the artifact gets a new version (or its latest one grows), so a viewer can refresh. */
export function artifactCard(chat, id) {
  const a = chat && chat.artifacts && chat.artifacts[id];
  if (!a) return null;
  const vs = Array.isArray(a.versions) ? a.versions : [];
  const last = vs.length ? String(vs[vs.length - 1] || '') : String(a.content || '');
  return { id, title: a.title || 'Artifact', type: a.type || '', language: a.language || '', versions: vs.length, rev: `${vs.length}:${last.length}` };
}

const PROJECT_WRITES = new Set(['write_file', 'edit_file', 'write_spreadsheet', 'update_cells']);
const LIBRARY_WRITES = new Set(['library_write', 'library_edit']);

/**
 * Files one message brought in or produced: attachments (kept in the Files library), files the agent wrote in the project folder or in
 * the Files library. Generated images / videos are not files here: they are the message's images.
 * Returns [{ kind: 'library' | 'project' | 'path', path, name }].
 */
export function filesOf(msg) {
  const out = []; const seen = new Set();
  const add = (kind, p, name) => { const path = String(p || ''); if (!path || seen.has(kind + ':' + path)) return; seen.add(kind + ':' + path); out.push({ kind, path, name: name || base(path) || path }); };
  if (!msg) return out;
  if (msg.role === 'user') {
    for (const a of msg.attachments || []) if (a && a.kind !== 'error') { if (a.lib) add('library', a.lib, a.name); else if (a.path) add('path', a.path, a.name); }
    return out;
  }
  for (const s of msg.steps || []) {
    for (const tc of s.toolCalls || []) {
      if (tc.status !== 'done') continue;
      const a = args(tc);
      if (PROJECT_WRITES.has(tc.name) && a.path) add('project', a.path);
      else if (LIBRARY_WRITES.has(tc.name) && a.path) add('library', a.path);
    }
  }
  return out;
}

/**
 * The widget's chat view: the last `max` messages of the chat, as bubbles.
 * user: { id, role, text, files }. assistant: { id, role, text, tools: [{ id, label, status }], images, artifacts, files, error, running }.
 * Screenshots (data URLs) are only kept for the last assistant message, so the list stays small enough to send ~10 times a second.
 */
export function chatMessages(chat, { max = 20, maxText = 4000, maxShot = 1500000, maxImages = 6 } = {}) {
  if (!chat || !Array.isArray(chat.messages)) return [];
  const all = chat.messages.filter((m) => m && (m.role === 'user' || m.role === 'assistant'));
  const msgs = all.slice(-max);
  let lastA = -1; for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === 'assistant') { lastA = i; break; }
  return msgs.map((m, i) => {
    const id = m.id || `m${all.length - msgs.length + i}`;
    if (m.role === 'user') {
      const text = typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? m.content.map((p) => (p && p.type === 'text' ? p.text : '')).join(' ') : '';
      return { id, role: 'user', text: text.length > maxText ? text.slice(0, maxText - 1) + '…' : text, files: filesOf(m) };
    }
    const steps = m.steps || [];
    const text = tailText(stripTags(steps.map((s) => stripThink(s.text || '')).filter(Boolean).join('\n\n'), { partial: true }), maxText);
    const tools = []; const images = []; const artifacts = [];
    for (const s of steps) {
      for (const tc of s.toolCalls || []) {
        if (!tc || !tc.name) continue;
        tools.push({ id: tc.id || String(tools.length), label: activityOf(tc).replace(/…$/, ''), status: tc.status || '' });
        if (i === lastA && typeof tc.image === 'string' && /^(data:image\/|artemis-media:\/\/)/.test(tc.image) && tc.image.length <= maxShot) images.push({ type: 'src', src: tc.image, kind: 'image', label: tc.name === 'computer' ? 'Screen' : 'Screenshot' });
      }
      for (const md of s.media || []) if (md && md.path) images.push({ type: 'media', path: md.path, kind: md.kind === 'video' ? 'video' : 'image', label: clip(md.prompt || '', 80) });
      for (const aid of s.artifactRefs || []) { const a = artifactCard(chat, aid); if (a && !artifacts.some((x) => x.id === aid)) artifacts.push(a); }
    }
    const running = steps.some((s) => (s.toolCalls || []).some((t) => t.status === 'running' || t.status === 'awaiting'));
    return { id, role: 'assistant', text, tools, images: images.slice(-maxImages), artifacts, files: filesOf(m), error: m.error ? clip(m.error, 300) : '', running };
  });
}

/** Markdown-lite for the widget: headings, list items, quotes, code blocks and paragraphs. Code is kept but never read aloud. */
export function mdBlocks(text) {
  const out = []; const lines = String(text || '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').split('\n');
  let para = []; let code = null;
  const flush = () => { if (para.length) { out.push({ type: 'p', text: para.join(' ') }); para = []; } };
  for (const line of lines) {
    if (code) { if (/^\s*```/.test(line)) { out.push({ type: 'code', text: code.join('\n') }); code = null; } else code.push(line); continue; }
    if (/^\s*```/.test(line)) { flush(); code = []; continue; }
    if (!line.trim()) { flush(); continue; }
    let m;
    if ((m = /^\s*#{1,6}\s+(.*)$/.exec(line))) { flush(); out.push({ type: 'h', text: m[1] }); continue; }
    if ((m = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line))) { flush(); out.push({ type: 'li', text: m[1] }); continue; }
    if ((m = /^\s*>\s?(.*)$/.exec(line))) { flush(); out.push({ type: 'q', text: m[1] }); continue; }
    para.push(line.trim());
  }
  if (code) out.push({ type: 'code', text: code.join('\n') });
  flush();
  return out;
}

/** Inline marks: **bold**, *italic*, `code`, [link](url) (shown as its text). */
export function mdInline(text) {
  const out = []; const s = String(text || '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  const re = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*\s][^*]*\*)/g;
  let last = 0; let m;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ t: s.slice(last, m.index) });
    const v = m[0];
    if (v.startsWith('`')) out.push({ t: v.slice(1, -1), code: true });
    else if (v.startsWith('**') || v.startsWith('__')) out.push({ t: v.slice(2, -2), b: true });
    else out.push({ t: v.slice(1, -1), i: true });
    last = m.index + v.length;
  }
  if (last < s.length) out.push({ t: s.slice(last) });
  return out;
}
