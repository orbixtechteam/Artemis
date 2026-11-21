// Chat messages (app format) -> OpenAI messages, for runs on the server. A CommonJS copy of src/lib/history.js
// toApiMessages (and the helpers it uses from think.mjs, tts-emotion.mjs and mentions.mjs), so a turn on the server sends
// the model exactly what the desktop window would send: earlier tool calls and results, attachments, the latest compact.
// scripts/test-history-parity.js checks that both give the same output.
function splitThink(text) {
  let s = String(text == null ? '' : text);
  const out = [];
  const close = /<\/think(?:ing)?>/i.exec(s), open = /<think(?:ing)?>/i.exec(s);
  if (close && (!open || close.index < open.index)) {
    const body = s.slice(0, close.index).trim();
    if (body) out.push({ type: 'think', text: body, done: true });
    s = s.slice(close.index + close[0].length);
  }
  const re = /<(think|thinking)>([\s\S]*?)(<\/\1>|$)/gi;
  let last = 0, m;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ type: 'text', text: s.slice(last, m.index) });
    const body = m[2].trim(), done = !!m[3];
    if (body || !done) out.push({ type: 'think', text: body, done });
    last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++;
  }
  if (last < s.length) out.push({ type: 'text', text: s.slice(last) });
  return out;
}
function stripThink(text) {
  const s = String(text == null ? '' : text);
  if (!/<\/?think(ing)?>/i.test(s)) return s;
  return splitThink(s).filter((p) => p.type === 'text').map((p) => p.text).join('').trim();
}
const KINDS = ['connector', 'skill', 'agent', 'make'];
function cleanMentions(list) {
  const out = []; const seen = new Set();
  for (const m of Array.isArray(list) ? list : []) {
    if (!m || typeof m.name !== 'string' || !m.name.trim() || !KINDS.includes(m.kind)) continue;
    const k = m.kind + '\u0000' + m.name;
    if (seen.has(k)) continue;
    seen.add(k); out.push({ kind: m.kind, name: m.name });
  }
  return out;
}
function mentionHint(mentions) {
  const parts = cleanMentions(mentions).map((m) => (
    m.kind === 'make' ? 'Make — use the Make tools'
      : m.kind === 'skill' ? `the "${m.name}" skill — load it with use_skill first`
        : m.kind === 'agent' ? `the "${m.name}" agent — delegate to it`
          : `the "${m.name}" connector — use its tools for this request`
  ));
  return parts.length ? `[The user selected: ${parts.join('; ')}]` : '';
}
function lastCompact(messages) {
  for (let i = (messages || []).length - 1; i >= 0; i--) if (messages[i] && messages[i].role === 'user' && messages[i].compacted) return i;
  return -1;
}

function toApiMessages(messages) {
  const out = [];
  for (const m of (messages || []).slice(Math.max(0, lastCompact(messages)))) {
    if (!m) continue;
    if (m.role === 'user') {
      let text = '';
      const images = [];
      for (const a of m.attachments || []) {
        if (a.kind === 'image' && (a.dataUrl || a.url)) images.push(a);
        else if (a.text != null) {
          const MAX_INLINE = 3000;
          const big = a.text.length > MAX_INLINE;
          const shown = big ? a.text.slice(0, MAX_INLINE) : a.text;
          const note = big ? `\n…[only the first ${MAX_INLINE} of ${a.text.length}${a.truncated ? '+' : ''} characters are shown. ${a.lib ? `The whole file is in the Files library as "${a.lib}": read parts with library_read (query for matching lines, from_line / to_line for a slice) or use run_command (head, grep, sed, python) on it. Do not ask for the whole file.` : 'Use run_command (head, grep, sed, python) on the file.'}]` : (a.truncated ? '\n…[truncated]' : '');
          text += `<attachment name="${a.name}"${a.lib ? ` library="${a.lib}"` : ''}>\n${shown}${note}\n</attachment>\n\n`;
        }
      }
      text += m.content || '';
      const hint = mentionHint(m.mentions);
      if (hint) text += (text ? '\n\n' : '') + hint;
      if (images.length) out.push({ role: 'user', content: [{ type: 'text', text: text || '(image)' }, ...images.map((i) => ({ type: 'image_url', image_url: { url: i.dataUrl || i.url } }))] });
      else out.push({ role: 'user', content: text });
    } else {
      for (const step of m.steps || []) {
        const calls = (step.toolCalls || []);
        if (calls.length) {
          out.push({ role: 'assistant', content: stripThink(step.text) || null, tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args || {}) } })) });
          for (const c of calls) out.push({ role: 'tool', tool_call_id: c.id, content: c.result ?? '(cancelled)' });
        } else if (stripThink(step.text)) {
          out.push({ role: 'assistant', content: stripThink(step.text) });
        }
      }
    }
  }
  return out;
}

module.exports = { toApiMessages, stripThink, splitThink, lastCompact, mentionHint };
