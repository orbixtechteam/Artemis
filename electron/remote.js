// Phone access: the Telegram bot. It talks to the agent through one conversation "channel".
const { stripThink } = require('./remote/think');
const path = require('path');
const crypto = require('crypto');
const { createTelegram } = require('./remote/telegram');
const { createControl } = require('./remote/control');

function describeCall(name, a) {
  a = a || {};
  if (name === 'computer') return 'Computer: ' + [String(a.action || '').replace(/_/g, ' '), a.text ? `"${String(a.text).slice(0, 60)}"` : a.keys || (a.x != null ? `${a.x},${a.y}` : '')].filter(Boolean).join(' ');
  if (name === 'run_command') return 'Terminal: ' + String(a.command || '').slice(0, 300);
  if (name === 'web_search') return 'Web search: ' + (a.query || '');
  if (name === 'web_fetch') return 'Open page: ' + (a.url || '');
  if (name === 'send_to_phone') return 'Send to your phone' + (a.file_path ? `: ${a.file_path}` : a.screenshot ? ': screenshot' : '');
  if (name === 'write_file' || name === 'edit_file' || name === 'delete_file' || name === 'write_spreadsheet' || name === 'update_cells') return `${name.replace(/_/g, ' ')}: ${a.path || ''}`;
  if (name === 'move_file') return `move file: ${a.from} → ${a.to}`;
  return name + (a.path ? ' ' + a.path : '');
}

/** One conversation shared by the phone clients. */
function createChannel(runChat, abortFn, onTurn, autoLink, onLink) {
  let history = [], running = null, session = Date.now().toString(36), linked = null;
  const note = () => { try { onLink && onLink(linked); } catch {} };
  const textOf = (c) => (typeof c === 'string' ? c : c.filter((p) => p.type === 'text').map((p) => p.text).join(' ') + (c.some((p) => p.type === 'image_url') ? ' [image]' : ''));
  return {
    busy: () => !!running,
    reset: () => { history = []; linked = null; session = Date.now().toString(36); note(); },
    /** Continue a saved desktop chat: its text turns become the history, new turns are written back to it. */
    link: (chat, turns) => { if (running) throw new Error('busy'); linked = { id: chat.id, title: chat.title || 'Untitled' }; history = (turns || []).slice(-30); session = Date.now().toString(36); note(); },
    linked: () => linked,
    getHistory: () => history.slice(),
    setHistory: (h) => { history = h; },
    /** A turn that happened in the desktop app: keep the phone's history in step. */
    addTurn: (user, assistant) => { history = [...history, { role: 'user', content: user }, { role: 'assistant', content: assistant || '(no reply)' }].slice(-30); },
    abort: () => { if (running) abortFn(running); },
    async ask(content, onEvent) {
      if (running) throw new Error('busy');
      // not linked to a chat yet: carry on in the desktop chat used most recently instead of starting a stray new one
      if (!linked && !history.length && autoLink) {
        const found = (() => { try { return autoLink(); } catch { return null; } })();
        if (found) { linked = { id: found.chat.id, title: found.chat.title || 'Untitled' }; history = (found.turns || []).slice(-30); note(); }
      }
      const requestId = `phone-${Date.now().toString(36)}`;
      running = requestId;
      const steps = [''];
      const send = (ev) => {
        if (ev.type === 'chunk') steps[steps.length - 1] += ev.text;
        else if (ev.type === 'step:new') steps.push('');
        try { const r = onEvent(ev); if (r && r.catch) r.catch(() => {}); } catch {}
      };
      try { await runChat({ requestId, messages: [...history, { role: 'user', content }], send, session }); }
      finally { running = null; }
      const final = stripThink(steps.filter(Boolean).join('\n\n'));
      history = [...history, { role: 'user', content: textOf(content) }, { role: 'assistant', content: final || '(no reply)' }].slice(-30);
      if (linked && final && onTurn) { try { onTurn(linked, textOf(content), final); } catch {} }
      return final;
    }
  };
}

/**
 * deps: { getSettings(), getSecret(name), setSecret(name, value), saveSettings(patch), runChat({requestId,messages,send}),
 *         decide(id, ok), abort(requestId), parseFile(path), telegramApi? }
 */
function createRemote(deps) {
  const autoLink = () => {
    if (!deps.chatsApi || deps.getSettings().remoteContinueLast === false) return null;
    const r = deps.chatsApi.recent(1)[0]; if (!r) return null;
    const c = deps.chatsApi.get(r.id);
    if (!c || Date.now() - (c.updatedAt || 0) > 12 * 3600e3) return null;
    return { chat: c, turns: deps.chatsApi.turns(c, 30) };
  };
  const channel = createChannel(deps.runChat, deps.abort, (l, userText, answer) => deps.appendToChat && deps.appendToChat(l.id, userText, answer), autoLink,
    (l) => { try { deps.saveSettings({ remoteLinkedChatId: l ? l.id : '' }); } catch {} });
  // remember which chat the phone was continuing across restarts
  { const sid = deps.getSettings().remoteLinkedChatId; const c = sid && deps.chatsApi ? deps.chatsApi.get(sid) : null; if (c) channel.link(c, deps.chatsApi.turns(c, 30)); }
  const control = createControl({
    getSettings: deps.getSettings, saveSettings: deps.saveSettings, models: deps.models || [], readStore: deps.readStore || (() => []),
    providers: deps.providersApi || null, liveModel: deps.liveModel,
    mcpStatus: deps.mcpStatus || (() => []), memory: deps.memory || { list: () => [], add: () => ({}), remove: () => false }, isBusy: () => channel.busy()
  });
  let tg = null, pairCode = '', tgError = '', tgRetry = null, tgRetrying = false;
  const newCode = () => { pairCode = String(crypto.randomInt(100000, 1000000)); return pairCode; };
  newCode();

  // Summarise the older part of the phone conversation (and of the linked desktop chat) to save tokens.
  const compactPhone = async () => {
    if (!deps.summarize) return { ok: false, error: 'Compact is not available.' };
    if (channel.busy()) return { ok: false, error: 'Still working on a request. Send /stop first.' };
    const h = channel.getHistory();
    let at = Math.max(0, h.length - 4);
    while (at > 0 && h[at].role !== 'user') at--;
    if (at < 2) return { ok: false, error: 'The chat is still short, nothing to compact yet.' };
    const r = await deps.summarize(h.slice(0, at));
    if (!r.ok) return { ok: false, error: r.error };
    channel.setHistory([{ role: 'user', content: `[Summary of the earlier conversation — compacted to save tokens]\n${r.summary}` }, ...h.slice(at)]);
    const l = channel.linked();
    if (l && deps.desktopCompact) { try { deps.desktopCompact(l.id); } catch {} }
    return { ok: true, count: at, desktop: !!l };
  };

  const chatsForPhone = deps.chatsApi ? {
    recent: (n) => deps.chatsApi.recent(n),
    search: (q, n) => deps.chatsApi.search(q, n),
    turns: (id, n) => { const c = deps.chatsApi.get(id); return c ? deps.chatsApi.turns(c, n) : []; },
    linked: () => channel.linked(),
    open: (id) => {
      const c = deps.chatsApi.get(id);
      if (!c) return { ok: false, error: 'That chat no longer exists.' };
      if (channel.busy()) return { ok: false, error: 'Still working on a request. Send /stop first.' };
      const turns = deps.chatsApi.turns(c, 30);
      channel.link(c, turns);
      return { ok: true, title: c.title || 'Untitled', turns };
    }
  } : null;

  async function reconfigure() {
    if (tgRetry) { clearTimeout(tgRetry); tgRetry = null; }
    tgRetrying = false;
    const s = deps.getSettings();
    // Telegram
    if (tg) { const old = tg; tg = null; await old.stop(); }
    tgError = '';
    const token = deps.getSecret('telegramToken');
    if ((s.telegramEnabled || process.env.TELEGRAM_BOT_TOKEN) && token) {
      const t = createTelegram({
        token, apiBase: deps.telegramApi, channel, control,
        getChatId: () => deps.getSettings().telegramChatId || '',
        setChatId: (id) => deps.saveSettings({ telegramChatId: id }),
        getPairCode: () => pairCode, newPairCode: newCode,
        decide: deps.decide, abort: () => channel.abort(), describe: describeCall, parseFile: deps.parseFile,
        screen: () => (deps.getSettings().remoteAllowDangerous ? deps.screenshot() : Promise.reject(new Error('Computer control from the phone is turned off in Settings → Phone.'))),
        chats: chatsForPhone, skills: deps.skillsList, transcribe: deps.transcribe,
        notes: deps.notes || null, compact: compactPhone
      });
      try { await t.start(); tg = t; } catch (e) {
        tgError = e.message;
        // no internet at launch, Telegram hiccup: keep trying instead of staying dead. A rejected token will not fix itself.
        if (!e.fatal) { tgRetrying = true; tgRetry = setTimeout(() => { tgRetry = null; reconfigure().catch(() => {}); }, deps.retryMs || 15000); }
      }
    }
  }

  const paired = () => !!(tg && deps.getSettings().telegramChatId);
  return {
    reconfigure, control, linked: () => channel.linked(),
    status: () => ({
      telegram: { hasToken: !!deps.getSecret('telegramToken'), retrying: tgRetrying, running: !!tg, openChat: channel.linked() ? channel.linked().title : '', botName: tg?.status().botName || '', paired: !!deps.getSettings().telegramChatId, pairCode: deps.getSettings().telegramChatId ? '' : pairCode, error: tgError || tg?.status().error || '' }
    }),
    /** Save the token, switch the bot on, connect right now and report what happened. */
    async connectTelegram(rawToken) {
      const token = String(rawToken || '').trim().replace(/^bot(?=\d)/i, '').replace(/\s+/g, '');
      if (token) {
        if (!/^\d{5,}:[\w-]{20,}$/.test(token)) return { ok: false, error: 'That does not look like a bot token. It looks like 123456789:AAH… (copy it from @BotFather).' };
        deps.setSecret('telegramToken', token);
      } else if (!deps.getSecret('telegramToken')) return { ok: false, error: 'Paste the bot token first.' };
      deps.saveSettings({ telegramEnabled: true });
      await reconfigure();
      const st = this.status().telegram;
      if (!tg) return { ok: false, error: tgError || 'Could not connect.', status: st };
      let sent = false;
      if (deps.getSettings().telegramChatId) { try { await tg.say('Artemis is connected. Send /help to see what I can do.'); sent = true; } catch (e) { return { ok: false, error: 'Connected, but sending a test message failed: ' + e.message, status: st }; } }
      return { ok: true, botName: st.botName, paired: !!deps.getSettings().telegramChatId, testMessageSent: sent, pairCode: st.pairCode, status: st };
    },
    unpair: () => { deps.saveSettings({ telegramChatId: '' }); newCode(); },
    /** Used by the send_to_phone tool; null when no phone is paired. */
    phone: () => (paired() ? {
      send: (text) => tg.say(text),
      sendMd: (md) => tg.sayMd(md),
      sendFile: (p, caption) => tg.sendFile(p, caption),
      sendPhoto: (dataUrl, caption) => tg.sendPhoto(dataUrl, caption),
      askApproval: (id, text) => tg.askApproval(id, text)
    } : null),
    /** Typed in the desktop app, in the chat that Telegram is continuing: show it on the phone too. Returns the phone helper or null. */
    mirrorTarget: (chatId) => { const l = channel.linked(); return chatId && l && l.id === chatId && paired() ? { send: (md) => tg.sayMd(md), addTurn: (u, a) => channel.addTurn(u, a) } : null; },
    stop: () => { if (tgRetry) clearTimeout(tgRetry); tg?.stop(); }
  };
}

module.exports = { createRemote, createChannel, describeCall };
