// Turns chat messages (app format) into the OpenAI message format.
import { stripThink } from './think.mjs';
import { stripTags } from './tts-emotion.mjs';
import { mentionHint } from './mentions.mjs';
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/** The answer's text (no thinking). Emotion tags ("[warm]") are removed unless keepTags (reading it aloud). */
export function assistantText(m, keepTags = false) {
  const t = (m.steps || []).map((s) => stripThink(s.text)).filter(Boolean).join('\n\n');
  return keepTags ? t : stripTags(t);
}

export function toApiMessages(messages) {
  const out = [];
  for (const m of messages) {
    if (m.role === 'user') {
      let text = '';
      const images = [];
      for (const a of m.attachments || []) {
        if (a.kind === 'image' && (a.dataUrl || a.url)) images.push(a); // url: an artemis-media:// link, made into base64 by the main process
        else if (a.text != null) {
          const MAX_INLINE = 3000; // a big file is shown only in part (the start, so the model sees the format); it searches the rest with tools
          const big = a.text.length > MAX_INLINE;
          const shown = big ? a.text.slice(0, MAX_INLINE) : a.text;
          const note = big ? `\n…[only the first ${MAX_INLINE} of ${a.text.length}${a.truncated ? '+' : ''} characters are shown. ${a.lib ? `The whole file is in the Files library as "${a.lib}": read parts with library_read (query for matching lines, from_line / to_line for a slice) or use run_command (head, grep, sed, python) on it. Do not ask for the whole file.` : 'Use run_command (head, grep, sed, python) on the file.'}]` : (a.truncated ? '\n…[truncated]' : '');
          text += `<attachment name="${a.name}"${a.lib ? ` library="${a.lib}"` : ''}>\n${shown}${note}\n</attachment>\n\n`;
        }
      }
      text += m.content || '';
      // items picked in the "@" menu: a hint for the model only, the chat shows the text as typed
      const hint = mentionHint(m.mentions);
      if (hint) text += (text ? '\n\n' : '') + hint;
      if (images.length) {
        out.push({
          role: 'user',
          content: [{ type: 'text', text: text || '(image)' }, ...images.map((i) => ({ type: 'image_url', image_url: { url: i.dataUrl || i.url } }))]
        });
      } else out.push({ role: 'user', content: text });
    } else {
      for (const step of m.steps || []) {
        const calls = (step.toolCalls || []);
        if (calls.length) {
          out.push({
            role: 'assistant', content: stripThink(step.text) || null,
            tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args || {}) } }))
          });
          for (const c of calls) out.push({ role: 'tool', tool_call_id: c.id, content: c.result ?? '(cancelled)' });
        } else if (stripThink(step.text)) {
          out.push({ role: 'assistant', content: stripThink(step.text) });
        }
      }
    }
  }
  return out;
}

export function dayGroup(ts) {
  const d = new Date(ts), now = new Date();
  const days = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'Last 7 days';
  if (days < 30) return 'Last 30 days';
  return 'Older';
}

export function greeting() {
  const h = new Date().getHours();
  return h < 6 ? 'Hello' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}
