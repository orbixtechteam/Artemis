// Search and read the app's saved chats (used by the search_chats / read_chat tools and the Telegram bot).
const clip = (s, n) => (String(s).length > n ? String(s).slice(0, n) + '…' : String(s));

function messageText(m) {
  if (!m) return '';
  if (m.role === 'user') return String(m.content || '') + ((m.attachments || []).length ? ` [attached: ${(m.attachments || []).map((a) => a.name).join(', ')}]` : '');
  return (m.steps || []).map((s) => s.text).filter(Boolean).join('\n\n');
}
const tokens = (q) => String(q || '').toLowerCase().split(/[\s,;]+/).filter((w) => w.length > 1);
const when = (t) => { if (!t) return ''; const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }; // local date, like the user's calendar

function searchChats(chats, query, { limit = 8, projects = [] } = {}) {
  const words = tokens(query);
  if (!words.length) return [];
  const pname = (id) => (projects.find((p) => p.id === id) || {}).name || '';
  const out = [];
  for (const c of chats || []) {
    if (!c || c.incognito) continue;
    let best = 0, snippet = '';
    const title = String(c.title || '').toLowerCase();
    let score = words.reduce((n, w) => n + (title.includes(w) ? 3 : 0), 0);
    for (const m of c.messages || []) {
      const text = messageText(m);
      const low = text.toLowerCase();
      const hit = words.filter((w) => low.includes(w));
      if (!hit.length) continue;
      const s = hit.length + (hit.length === words.length ? 2 : 0);
      if (s > best) {
        best = s;
        const i = low.indexOf(hit[0]);
        snippet = (m.role === 'user' ? 'You: ' : 'Assistant: ') + clip(text.slice(Math.max(0, i - 80), i + 160).replace(/\s+/g, ' '), 240);
      }
    }
    score += best;
    if (score > 0) out.push({ id: c.id, title: c.title || 'Untitled', project: pname(c.projectId), date: when(c.updatedAt), snippet, score, updatedAt: c.updatedAt || 0 });
  }
  return out.sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt).slice(0, limit);
}

function recentChats(chats, n = 10, projects = []) {
  const pname = (id) => (projects.find((p) => p.id === id) || {}).name || '';
  return (chats || []).filter((c) => c && !c.incognito && (c.messages || []).length).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, n)
    .map((c) => ({ id: c.id, title: c.title || 'Untitled', project: pname(c.projectId), date: when(c.updatedAt), model: c.model || '', count: c.messages.length, source: c.source || '' }));
}

/** Plain text turns [{role, content}] (tool calls dropped), most recent `maxTurns`. */
function chatTurns(chat, maxTurns = 30, maxChars = 4000) {
  return (chat.messages || []).map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: clip(messageText(m), maxChars) })).filter((t) => t.content.trim()).slice(-maxTurns);
}

/** Turns for a model continuing the chat: from the latest compact card on (the messages before it stay for the user and read_chat). */
function modelTurns(chat, maxTurns = 30, maxChars = 4000) {
  const msgs = chat.messages || [];
  let i = msgs.length - 1;
  while (i >= 0 && !(msgs[i] && msgs[i].role === 'user' && msgs[i].compacted)) i--;
  return chatTurns(i > 0 ? { ...chat, messages: msgs.slice(i) } : chat, maxTurns, maxChars);
}

/** The latest `last` turns, `offset` turns back from the end (to read what a compact summarized). */
function transcript(chat, { last = 10, offset = 0, maxChars = 12000 } = {}) {
  const all = chatTurns(chat, Infinity, 3000);
  const off = Math.max(0, Math.min(all.length, Number(offset) || 0));
  const turns = all.slice(Math.max(0, all.length - off - last), all.length - off);
  let text = turns.map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`).join('\n\n');
  if (text.length > maxChars) text = '…' + text.slice(-maxChars);
  return `Chat "${chat.title || 'Untitled'}" (${when(chat.updatedAt)}, ${(chat.messages || []).length} messages${turns.length < all.length ? `, showing ${all.length - off - turns.length + 1}-${all.length - off} of ${all.length} turns` : ''}):\n\n${text}`;
}

module.exports = { searchChats, recentChats, chatTurns, modelTurns, transcript, messageText };
