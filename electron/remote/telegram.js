// Telegram bot (long polling). Only the paired private chat can talk to it.

const { stripThink } = require('./think');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_MSG = 4000;
const COMMANDS = [
  ['model', 'Show or change the model'], ['project', 'Choose the project / folder'], ['tools', 'Turn tools on or off'], ['settings', 'Switches and model providers'], ['providers', 'Turn model providers on or off'], ['compact', 'Summarise the chat to save tokens'], ['notes', 'Search or list your notes'], ['note', 'Add to a note'],
  ['status', 'Current model, project and switches'], ['screen', 'See your computer screen'], ['new', 'Start a new chat'],
  ['stop', 'Cancel the running task'], ['chats', 'Open a chat from the desktop app'], ['search', 'Search your saved chats'], ['last', 'Last messages of the open chat'], ['skills', 'List skills'], ['memory', 'Show memory'], ['connectors', 'Show connectors'], ['help', 'All commands']
];
const HELP = `Just write to me. Photos and files (xlsx, csv, pdf, docx, txt) are read too.

/model – show models, or "/model gpt-6" to switch
/project – choose a project (and its folder)
/tools – turn web, terminal, computer, memory, connectors, notes on or off
/settings (or /providers) – switches and model providers (Groq, Cloudflare, …) on or off
/compact – summarise the earlier part of this chat to save tokens
/notes – recent notes; "/notes words" searches. Tap one to read it
/note Title: text – add text to a note (created if new; "Folder/Title: text" works)
/status – what is currently set
/screen – see your computer screen now
/chats – your desktop chats; tap one to continue it here (new messages also appear in the app)
/search words – find an earlier chat   /last – recent messages of the open chat
/skills – list skills
/new – start a new chat   /stop – cancel the task
/memory – list memory; /remember text; /forget id
/connectors – list MCP connectors
/unpair – disconnect this phone`;
const { mdToTelegramHtml, splitMarkdown } = require('./tghtml');
const chunks = (s) => { const out = []; for (let i = 0; i < s.length; i += MAX_MSG) out.push(s.slice(i, i + MAX_MSG)); return out.length ? out : ['(empty)']; };
/**
 * Limits /pair guesses: after `max` wrong codes the code is rotated and pairing pauses for `cooldownMs`.
 * The counter starts over whenever the code changes (new code from Settings, unpair, successful pair).
 */
function createPairGuard({ max = 5, cooldownMs = 10 * 60 * 1000, now = Date.now } = {}) {
  let bad = 0, code = '', lockUntil = 0;
  return {
    /** -> 'ok' | 'wrong' | 'locked' (with waitMs) */
    check(given, current, rotate) {
      if (current !== code) { code = current; bad = 0; }
      const t = now();
      if (lockUntil > t) return { result: 'locked', waitMs: lockUntil - t };
      if (given === current) { bad = 0; return { result: 'ok' }; }
      if (++bad >= max) { lockUntil = t + cooldownMs; bad = 0; rotate?.(); return { result: 'locked', waitMs: cooldownMs }; }
      return { result: 'wrong' };
    }
  };
}
const sleep = (ms, signal) => new Promise((r) => { const t = setTimeout(r, ms); signal?.addEventListener('abort', () => { clearTimeout(t); r(); }, { once: true }); });

/**
 * deps: { token, apiBase, getChatId(), setChatId(id), getPairCode(), newPairCode(), channel (see remote.js),
 *         decide(id, ok), abort(), describe(name,args), parseFile(path) }
 */
function createTelegram(deps) {
  const base = `${(deps.apiBase || 'https://api.telegram.org').replace(/\/+$/, '')}/bot${deps.token}`;
  const fileBase = `${(deps.apiBase || 'https://api.telegram.org').replace(/\/+$/, '')}/file/bot${deps.token}`;
  let loopPromise = Promise.resolve();
  let ctrl = null, running = false, botName = '', lastError = '', offset = 0;
  const pairGuard = createPairGuard();
  const buttons = new Map(); // short key -> tool id
  let btnSeq = 0;

  async function api(method, body, signal) {
    let res;
    try {
      res = await fetch(`${base}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}), signal });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      throw Object.assign(new Error('Cannot reach Telegram. Check your internet connection; Artemis will keep trying.'), { network: true });
    }
    const j = await res.json().catch(() => ({}));
    if (!j.ok) {
      if (res.status === 401 || res.status === 404) throw Object.assign(new Error('Telegram rejected the token. Copy it again from @BotFather (Revoke/Show token).'), { fatal: true });
      throw new Error(j.description || `Telegram HTTP ${res.status}`);
    }
    return j.result;
  }
  const chatId = () => deps.getChatId();
  const say = async (text, extra) => { for (const part of chunks(String(text))) await api('sendMessage', { chat_id: chatId(), text: part, ...(extra || {}) }); };

  /** Sends Markdown as formatted Telegram text (bold, code blocks, lists, links). Falls back to plain text if Telegram rejects the markup. */
  const sayMd = async (md, extra) => {
    for (const part of splitMarkdown(String(md))) {
      try { await api('sendMessage', { chat_id: chatId(), text: mdToTelegramHtml(part), parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...(extra || {}) }); }
      catch (e) { if (e && e.network) throw e; await api('sendMessage', { chat_id: chatId(), text: part.slice(0, MAX_MSG), ...(extra || {}) }); }
    }
  };

  async function sendFile(filePath, caption) {
    const buf = fs.readFileSync(filePath);
    if (buf.length > 45 * 1024 * 1024) throw new Error('File is larger than the 50 MB Telegram limit.');
    const fd = new FormData();
    fd.set('chat_id', String(chatId()));
    if (caption) fd.set('caption', String(caption).slice(0, 1000));
    fd.set('document', new Blob([buf]), path.basename(filePath));
    const res = await fetch(`${base}/sendDocument`, { method: 'POST', body: fd });
    const j = await res.json().catch(() => ({}));
    if (!j.ok) throw new Error(j.description || `Telegram HTTP ${res.status}`);
  }
  async function sendPhoto(dataUrl, caption) {
    const m = String(dataUrl).match(/^data:(image\/[a-z+]+);base64,(.+)$/);
    if (!m) throw new Error('Not an image data URL.');
    const fd = new FormData();
    fd.set('chat_id', String(chatId()));
    if (caption) fd.set('caption', String(caption).slice(0, 1000));
    fd.set('photo', new Blob([Buffer.from(m[2], 'base64')], { type: m[1] }), 'screen.jpg');
    const res = await fetch(`${base}/sendPhoto`, { method: 'POST', body: fd });
    const j = await res.json().catch(() => ({}));
    if (!j.ok) throw new Error(j.description || `Telegram HTTP ${res.status}`);
  }

  async function download(fileId, nameHint) {
    const f = await api('getFile', { file_id: fileId });
    const res = await fetch(`${fileBase}/${f.file_path}`);
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    return { buf, name: nameHint || path.basename(f.file_path) };
  }

  async function buildContent(m, text) {
    // photo -> image part; document -> parsed text attachment
    if (m.photo?.length) {
      const best = m.photo[m.photo.length - 1];
      const { buf } = await download(best.file_id);
      return [{ type: 'text', text: text || '(photo)' }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${buf.toString('base64')}` } }];
    }
    if (m.document) {
      if ((m.document.file_size || 0) > 20 * 1024 * 1024) throw new Error('Files over 20 MB cannot be downloaded from Telegram.');
      const { buf, name } = await download(m.document.file_id, m.document.file_name);
      const tmp = path.join(os.tmpdir(), `aid-tg-${Date.now()}-${name.replace(/[^\w.\-]/g, '_')}`);
      fs.writeFileSync(tmp, buf);
      try {
        const att = await deps.parseFile(tmp);
        const body = att.text != null ? `<attachment name="${name}">\n${att.text.length > 30000 ? att.text.slice(0, 30000) : att.text}${att.truncated || att.text.length > 30000 ? '\n…[truncated]' : ''}\n</attachment>\n\n` : `[Attached file ${name} could not be read: ${att.error || 'unsupported'}]\n\n`;
        if (att.kind === 'image' && att.dataUrl) {
          return [{ type: 'text', text: text || '(image)' }, { type: 'image_url', image_url: { url: att.dataUrl } }];
        }
        return body + (text || '');
      } finally { try { fs.unlinkSync(tmp); } catch {} }
    }
    return text;
  }

  async function runPrompt(m, text) {
    const ch = deps.channel;
    if (ch.busy()) return say('Still working on the previous request. Send /stop to cancel it.');
    let content;
    try { content = await buildContent(m, text); } catch (e) { return say(`Could not read the attachment: ${e.message}`); }
    if (!content || (typeof content === 'string' && !content.trim())) return;
    const calls = {};
    let shotTimer = null, latestShot = null, lastShotAt = 0;
    const flushShot = () => { shotTimer = null; if (latestShot) { const img = latestShot; latestShot = null; lastShotAt = Date.now(); sendPhoto(img).catch(() => {}); } };
    const queueShot = (img) => { latestShot = img; if (!shotTimer) shotTimer = setTimeout(flushShot, Math.max(300, 2500 - (Date.now() - lastShotAt))); };
    const typing = setInterval(() => api('sendChatAction', { chat_id: chatId(), action: 'typing' }).catch(() => {}), 4000);
    api('sendChatAction', { chat_id: chatId(), action: 'typing' }).catch(() => {});
    let error = '';
    try {
      let final;
      try { final = await ch.ask(content, async (ev) => {
        if (ev.type === 'tool:call') calls[ev.id] = ev;
        else if (ev.type === 'tool:result' && ev.image) queueShot(ev.image);
        else if (ev.type === 'media') {
          try {
            if (ev.kind === 'image') await sendPhoto(`data:image/${/\.png$/i.test(ev.path) ? 'png' : 'jpeg'};base64,` + fs.readFileSync(ev.path).toString('base64'), String(ev.prompt || '').slice(0, 200));
            else await sendFile(ev.path, String(ev.prompt || '').slice(0, 200));
          } catch (e) { await say(`Could not send the ${ev.kind}: ${e.message}`); }
        }
        else if (ev.type === 'tool:approval') {
          const c = calls[ev.id] || {};
          const key = String(++btnSeq);
          buttons.set(key, ev.id);
          const what = (c.agent && c.agent.name ? `${c.agent.name} agent wants to: ` : '') + deps.describe(c.name || 'action', c.args);
          await say(`${ev.session ? 'Allow for this whole task?\n' : 'Allow?\n'}${what}`, {
            reply_markup: { inline_keyboard: [[{ text: 'Allow', callback_data: `a:${key}` }, { text: 'Deny', callback_data: `d:${key}` }]] }
          }).catch(() => {});
        } else if (ev.type === 'error') error = ev.message;
      }); } catch (e) { if (e.message === 'busy') return say('Still working on the previous request. Send /stop to cancel it.'); throw e; }
      if (error) await say(`Error: ${error}`);
      const shown = stripThink(final);
      if (shown) await sayMd(shown);
      else if (!error) await say('(no reply)');
    } finally { clearInterval(typing); if (shotTimer) { clearTimeout(shotTimer); flushShot(); } }
  }

  // ----- control panels (inline keyboards) -----
  const ctl = () => deps.control;
  function modelPanel() {
    const cur = ctl().currentModel();
    const list = ctl().models();
    return {
      text: `Current model: ${ctl().info().modelName}\nTap a model, or send /model <name>.`,
      reply_markup: { inline_keyboard: list.map((m, i) => [{ text: `${m.id === cur ? '✓ ' : ''}${m.name}`.slice(0, 60), callback_data: `m:${i}` }]) }
    };
  }
  function projectPanel() {
    const cur = ctl().resolveProject();
    const list = ctl().projects();
    const rows = [[{ text: `${!cur || !cur.id ? '✓ ' : ''}No project`, callback_data: 'p:-' }]];
    list.forEach((p, i) => rows.push([{ text: `${cur && cur.id === p.id ? '✓ ' : ''}${p.name}`.slice(0, 60), callback_data: `p:${i}` }]));
    return { text: list.length ? 'Choose the project for phone chats (its folder and instructions are used):' : 'No projects yet. Create one in the app first.', reply_markup: { inline_keyboard: rows } };
  }
  function toolsPanel() {
    const rows = ctl().tools().map((t) => [{ text: `${t.on ? 'ON  ' : 'OFF '}${t.label}`, callback_data: `t:${t.key}` }]);
    ctl().providers().forEach((p, i) => rows.push([{ text: `${p.on ? 'ON  ' : 'OFF '}Provider: ${p.name}`.slice(0, 60), callback_data: `v:${i}` }]));
    return { text: 'Tap to switch on/off (applies to the whole app):', reply_markup: { inline_keyboard: rows } };
  }

  // ----- desktop chats -----
  const chatMap = new Map(); // short key -> chat id
  let chatSeq = 0;
  const chatsApi = () => deps.chats;
  const noteMap = new Map(); let noteSeq = 0;
  const noteKey = (p) => { const k = String(++noteSeq); noteMap.set(k, p); if (noteMap.size > 200) noteMap.delete(noteMap.keys().next().value); return k; };
  const chatKey = (id) => { const k = String(++chatSeq); chatMap.set(k, id); if (chatMap.size > 200) chatMap.delete(chatMap.keys().next().value); return k; };
  const chatPanel = (list, title) => ({
    text: list.length ? title : 'No chats found.',
    reply_markup: { inline_keyboard: list.map((c) => [{ text: `${c.title}${c.project ? ' · ' + c.project : ''} (${c.date})`.slice(0, 60), callback_data: `c:${chatKey(c.id)}` }]) }
  });
  async function openChat(id) {
    const r = chatsApi().open(id);
    if (!r.ok) return say(r.error);
    const tail = r.turns.slice(-2).map((t) => `${t.role === 'user' ? 'You' : 'Assistant'}: ${t.content.slice(0, 600)}`).join('\n\n');
    return say(`Opened "${r.title}". Your next messages continue this chat and also appear in the desktop app. Send /new to leave it.` + (tail ? `\n\n${tail}` : ''));
  }

  async function handleControl(text) {
    const [cmd, ...restArr] = text.split(/\s+/);
    const arg = restArr.join(' ').trim();
    switch (cmd.toLowerCase().replace(/@\w+$/, '')) {
      case '/model': {
        if (!arg) { const p = modelPanel(); return say(p.text, { reply_markup: p.reply_markup }); }
        const r = ctl().setModel(arg);
        return say(r.ok ? `Model set to ${r.name}${r.custom ? ' (not in the list, using it as given)' : ''}.` : r.error);
      }
      case '/project': {
        if (!arg) { const p = projectPanel(); return say(p.text, { reply_markup: p.reply_markup }); }
        const r = ctl().setProject(/^(none|off|-)$/i.test(arg) ? '' : arg);
        return say(r.ok ? (r.project ? `Project set to ${r.project.name}.` : 'No project.') : r.error);
      }
      case '/settings':
      case '/providers': {
        if (arg) { const [k, v] = [arg.split(/\s+/)[0], arg.split(/\s+/)[1]]; const r = ctl().toggleProvider(arg.replace(/\s+(on|off)$/i, ''), v && /^(on|off)$/i.test(v) ? /^on$/i.test(v) : undefined); return say(r.ok ? `${r.name}: ${r.on ? 'ON' : 'OFF'}` : r.error); }
        const p = toolsPanel(); return say(p.text, { reply_markup: p.reply_markup });
      }
      case '/compact': {
        if (!deps.compact) return say('Compact is not available.');
        await say('Summarising…');
        const r = await deps.compact().catch((e) => ({ ok: false, error: e.message }));
        return say(r.ok ? `Done. ${r.count} earlier messages were summarised${r.desktop ? ' (the open desktop chat too)' : ''}.` : r.error);
      }
      case '/notes': {
        if (!deps.notes) return say('Notes are not available.');
        const list = arg ? deps.notes.search(arg, { limit: 10 }).map((n) => ({ path: n.path, name: n.name })) : deps.notes.list().filter((e) => !e.dir).sort((a, b) => (b.mtime || 0) - (a.mtime || 0)).slice(0, 10);
        if (!list.length) return say(arg ? 'No notes matched.' : 'No notes yet. Add one with /note Title: text');
        return say(arg ? `Notes matching "${arg}". Tap to read:` : 'Recent notes. Tap to read:', { reply_markup: { inline_keyboard: list.map((n) => [{ text: n.path.replace(/\.md$/i, '').slice(0, 60), callback_data: `n:${noteKey(n.path)}` }]) } });
      }
      case '/note': {
        if (!deps.notes) return say('Notes are not available.');
        const m = arg.match(/^([^:|\n]{1,100})\s*[:|]\s*([\s\S]+)$/);
        if (!m) return say('Usage: /note Title: text to add\n(The note is created if it does not exist. "Folder/Title: text" puts it in a folder.)');
        try { const r = deps.notes.write(m[1].trim(), m[2].trim(), { append: true }); return say(`Saved to ${r.path}.`); } catch (e) { return say('Could not save the note: ' + e.message); }
      }
      case '/tools': {
        if (arg) {
          const [k, v] = arg.split(/\s+/);
          const r = ctl().toggle(k.toLowerCase(), v ? /^(on|1|true|yes)$/i.test(v) : undefined);
          return say(r.ok ? `${r.label}: ${r.on ? 'ON' : 'OFF'}` : r.error);
        }
        const p = toolsPanel(); return say(p.text, { reply_markup: p.reply_markup });
      }
      case '/status': { const l = chatsApi() && chatsApi().linked(); return say(ctl().statusText() + (l ? `\nOpen chat: ${l.title}` : '')); }
      case '/chats': { if (!chatsApi()) return say('Chat access is not available.'); const p = chatPanel(chatsApi().recent(10), 'Recent chats. Tap one to continue it here:'); return say(p.text, { reply_markup: p.reply_markup }); }
      case '/search': {
        if (!chatsApi()) return say('Chat access is not available.');
        if (!arg) return say('Usage: /search words to look for');
        const hits = chatsApi().search(arg, 8);
        if (!hits.length) return say('No saved chat matches.');
        const p = chatPanel(hits, `Chats matching "${arg}". Tap one to open it:`);
        return say(p.text + '\n\n' + hits.slice(0, 5).map((h, i) => `${i + 1}. ${h.snippet}`).join('\n'), { reply_markup: p.reply_markup });
      }
      case '/open': {
        if (!chatsApi()) return say('Chat access is not available.');
        if (!arg) return say('Use /chats and tap a chat, or /open <words from its title>.');
        const hits = chatsApi().search(arg, 1);
        return hits[0] ? openChat(hits[0].id) : say('No saved chat matches.');
      }
      case '/last': {
        const l = chatsApi() && chatsApi().linked();
        if (!l) return say('No chat is open. Use /chats first.');
        const t = chatsApi().turns(l.id, 4);
        return say(t.length ? `"${l.title}":\n\n` + t.map((x) => `${x.role === 'user' ? 'You' : 'Assistant'}: ${x.content.slice(0, 1200)}`).join('\n\n') : 'This chat is empty.');
      }
      case '/skills': {
        const list = deps.skills ? deps.skills() : [];
        return say(list.length ? list.map((x) => `${x.enabled ? '•' : '○'} ${x.name}: ${x.description}`).join('\n') : 'No skills yet. They are created in the app (Skills) or by the assistant when you teach it a routine.');
      }
      case '/memory': {
        const list = ctl().memoryList();
        return say(list.length ? list.map((m) => `[${m.id}] ${m.text}`).join('\n') : 'Memory is empty.');
      }
      case '/remember': { if (!arg) return say('Usage: /remember something to remember'); const it = ctl().memoryAdd(arg); return say(`Saved (id ${it.id}).`); }
      case '/forget': { if (!arg) return say('Usage: /forget <id> (see /memory)'); return say(ctl().memoryRemove(arg) ? 'Removed.' : 'No memory with that id.'); }
      case '/connectors': {
        const c = ctl().info().connectors;
        return say(c.length ? c.map((x) => `${x.name}: ${x.state}, ${x.tools} tools`).join('\n') : 'No connectors. Add them in the app (Connectors).');
      }
      default: return false;
    }
  }

  async function onMessage(m) {
    if (!m?.chat || m.chat.type !== 'private') return;
    let text = String(m.text || m.caption || '').trim();
    const cid = String(m.chat.id);
    const paired = chatId();

    if (!paired) {
      const pm = text.match(/^\/pair\s+(\d{6})\s*$/);
      const g = pm ? pairGuard.check(pm[1], deps.getPairCode(), () => deps.newPairCode()) : null;
      if (g && g.result === 'ok') {
        deps.setChatId(cid);
        deps.newPairCode();
        await say('Paired. You can now chat with the assistant here. Send /help for commands.');
      } else if (g && g.result === 'locked') {
        await api('sendMessage', { chat_id: cid, text: `Too many wrong codes. Try again in ${Math.ceil(g.waitMs / 60000)} min with the new code shown in Artemis.` }).catch(() => {});
      } else if (g) {
        await api('sendMessage', { chat_id: cid, text: 'Wrong code.' }).catch(() => {});
      } else if (/^\/start/.test(text)) {
        await api('sendMessage', { chat_id: cid, text: 'Send /pair followed by the 6-digit code shown in Artemis → Settings → Phone.' }).catch(() => {});
      }
      return; // everyone else is ignored
    }
    if (cid !== String(paired)) return;

    // A voice message (or audio file, or round video note): turn it into text and handle it like a typed message.
    const vm = m.voice || m.audio || m.video_note;
    if (vm) {
      if (!deps.transcribe) return say('Voice messages are not available here.');
      if ((vm.file_size || 0) > 20 * 1024 * 1024) return say('That recording is too large (limit 20 MB).');
      await api('sendChatAction', { chat_id: cid, action: 'typing' }).catch(() => {});
      let heard;
      try {
        const { buf, name } = await download(vm.file_id, vm.file_name);
        heard = await deps.transcribe({ audio: buf, mime: vm.mime_type || (m.video_note ? 'audio/mp4' : 'audio/ogg'), name });
      } catch (e) { return say(`Could not read the voice message: ${e.message}`); }
      if (!heard || !heard.ok) return say(`Could not understand the voice message: ${(heard && heard.error) || 'unknown error'}`);
      text = (text ? text + '\n' : '') + heard.text;
      await say(`🎤 ${heard.text}`); // show what was understood, so a mishearing is obvious
    }

    if (/^\/(start|help)\b/.test(text)) {
      return say(HELP);
    }
    if (/^\/(screen|screenshot)\b/.test(text)) {
      try { await sendPhoto(await deps.screen(), 'Screen now'); } catch (e) { await say(`Could not capture the screen: ${e.message}`); }
      return;
    }
    if (/^\/new\b/.test(text)) { deps.channel.reset(); return say('New chat started.'); }
    if (/^\/stop\b/.test(text)) { deps.abort(); return say('Stopping…'); }
    if (/^\/unpair\b/.test(text)) { await say('Disconnected.'); deps.setChatId(''); return; }
    if (text.startsWith('/')) { const handled = await handleControl(text); if (handled === false) return say('Unknown command. Send /help.'); return; }
    await runPrompt(m, text);
  }

  async function onCallback(q) {
    const paired = chatId();
    if (!paired || String(q.message?.chat?.id) !== String(paired)) return;
    const [kind, key] = String(q.data || '').split(':');
    if (kind === 'c') {
      const id = chatMap.get(key);
      await api('answerCallbackQuery', { callback_query_id: q.id, text: id ? 'Opening…' : 'Expired' }).catch(() => {});
      if (id) await openChat(id);
      return;
    }
    if (kind === 'n') {
      const p = noteMap.get(key);
      await api('answerCallbackQuery', { callback_query_id: q.id, text: p ? 'Opening…' : 'Expired' }).catch(() => {});
      if (p && deps.notes) { try { const r = deps.notes.read(p, { max: 3500 }); await say(`${p}\n\n${r.text}${r.truncated ? '\n…(cut)' : ''}`); } catch (e) { await say(e.message); } }
      return;
    }
    if (kind === 'm' || kind === 'p' || kind === 't' || kind === 'v') return onControlCallback(q, kind, key);
    const id = buttons.get(key);
    if (!id) { await api('answerCallbackQuery', { callback_query_id: q.id, text: 'Expired' }).catch(() => {}); return; }
    buttons.delete(key);
    deps.decide(id, kind === 'a');
    await api('answerCallbackQuery', { callback_query_id: q.id, text: kind === 'a' ? 'Allowed' : 'Denied' }).catch(() => {});
    await api('editMessageReplyMarkup', { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
  }

  async function onControlCallback(q, kind, key) {
    let note = 'Done', panel;
    if (kind === 'm') { const m = ctl().models()[Number(key)]; const r = m ? ctl().setModel(m.id) : { ok: false, error: 'Expired' }; note = r.ok ? `Model: ${r.name}` : r.error; panel = modelPanel(); }
    else if (kind === 'p') { const list = ctl().projects(); const r = key === '-' ? ctl().setProject('') : ctl().setProject((list[Number(key)] || {}).id); note = r.ok ? (r.project ? `Project: ${r.project.name}` : 'No project') : r.error; panel = projectPanel(); }
    else if (kind === 'v') { const r = ctl().toggleProvider(key); note = r.ok ? `${r.name}: ${r.on ? 'ON' : 'OFF'}` : r.error; panel = toolsPanel(); }
    else { const r = ctl().toggle(key); note = r.ok ? `${r.label}: ${r.on ? 'ON' : 'OFF'}` : r.error; panel = toolsPanel(); }
    await api('answerCallbackQuery', { callback_query_id: q.id, text: note }).catch(() => {});
    await api('editMessageReplyMarkup', { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: panel.reply_markup }).catch(() => {});
  }

  async function loop() {
    while (running) {
      try {
        const updates = await api('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'callback_query'] }, ctrl.signal);
        lastError = '';
        for (const u of updates) {
          offset = u.update_id + 1;
          // do not await: a long task must not block /stop or button presses
          (u.callback_query ? onCallback(u.callback_query) : onMessage(u.message)).catch((e) => { lastError = e.message; });
        }
      } catch (e) {
        if (!running) break;
        if (e.fatal) { lastError = e.message; running = false; break; }
        const conflict = /conflict|409|terminated by other/i.test(e.message);
        lastError = conflict ? 'Another program is polling this bot (409). Close other copies of Artemis or scripts using the same token.' : e.message;
        await sleep(conflict ? 1500 : 3000, ctrl.signal);
      }
    }
  }

  async function start() {
    if (running) return;
    ctrl = new AbortController();
    try {
      const me = await api('getMe', {}, ctrl.signal);
      botName = me.username || '';
      lastError = '';
    } catch (e) { lastError = e.message; throw e; }
    // a leftover webhook would block getUpdates
    await api('deleteWebhook', { drop_pending_updates: false }, ctrl.signal).catch(() => {});
    await api('setMyCommands', { commands: COMMANDS.map(([command, description]) => ({ command, description })) }, ctrl.signal).catch(() => {});
    running = true;
    loopPromise = loop();
  }
  /** Resolves once the polling loop has really ended, so a restart never overlaps with the old one. */
  function stop() { running = false; ctrl?.abort(); return loopPromise; }

  /** Asks on the phone for an approval that something else is waiting for (a team member, a background run): Allow / Deny buttons decide it. */
  async function askApproval(approvalId, text) {
    const key = String(++btnSeq);
    buttons.set(key, approvalId);
    await say(String(text).slice(0, 3500), { reply_markup: { inline_keyboard: [[{ text: 'Allow', callback_data: `a:${key}` }, { text: 'Deny', callback_data: `d:${key}` }]] } });
  }

  return {
    start, stop, say, sayMd, sendFile, sendPhoto, askApproval,
    status: () => ({ running, botName, error: lastError })
  };
}

module.exports = { createTelegram, createPairGuard };
