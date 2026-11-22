// Phone notifications through ntfy (https://ntfy.sh, or an ntfy server of your own). Free, no Apple developer account,
// works on iPhone and Android: install the ntfy app, subscribe to the topic, and Artemis pushes there. A tap on a
// notification opens the chat in the Artemis app (artemis://chat/<id>).
// The topic is the only key: whoever knows it can read the notifications, so it is long and random.
const crypto = require('crypto');

const DEFAULT_SERVER = 'https://ntfy.sh';
const newTopic = () => 'artemis-' + crypto.randomBytes(12).toString('hex');
const cleanServer = (s) => { const v = String(s || '').trim().replace(/\/+$/, ''); return /^https?:\/\/[^\s/]+(\/[^\s]*)?$/i.test(v) ? v : DEFAULT_SERVER; };
const cleanTopic = (t) => String(t || '').trim().replace(/[^\w-]/g, '').slice(0, 64);
const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const plain = (md) => String(md || '').replace(/```[\s\S]*?```/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`#>]+/g, '').replace(/\s+/g, ' ').trim();

/** The settings as the apps see them (and what send() needs). */
function config(st = {}) {
  const topic = cleanTopic(st.ntfyTopic);
  const server = cleanServer(st.ntfyServer);
  return {
    on: !!st.ntfyOn && !!topic, server, topic, preview: st.ntfyPreview !== false,
    schedules: st.ntfySchedules !== false, chats: st.ntfyChats !== false, approvals: st.ntfyApprovals !== false,
    links: topic ? { app: `ntfy://${server.replace(/^https?:\/\//i, '')}/${topic}`, web: `${server}/${topic}`, store: { ios: 'https://apps.apple.com/app/ntfy/id1625396347', android: 'https://play.google.com/store/apps/details?id=io.heckel.ntfy' } } : null
  };
}

/** A change from the apps -> the settings patch to save. Switching on without a topic makes one. */
function patchFrom(body = {}, st = {}) {
  const p = {};
  if (body.on !== undefined) p.ntfyOn = !!body.on;
  if (body.server !== undefined) p.ntfyServer = body.server ? cleanServer(body.server) : '';
  if (body.topic !== undefined && cleanTopic(body.topic).length >= 8) p.ntfyTopic = cleanTopic(body.topic);
  if (body.newTopic || ((p.ntfyOn || (body.on === undefined && st.ntfyOn)) && !cleanTopic(p.ntfyTopic || st.ntfyTopic))) p.ntfyTopic = newTopic();
  for (const [k, s] of [['preview', 'ntfyPreview'], ['schedules', 'ntfySchedules'], ['chats', 'ntfyChats'], ['approvals', 'ntfyApprovals']]) if (body[k] !== undefined) p[s] = !!body[k];
  return p;
}

/** Sends one notification. kind: 'schedule' | 'chat' | 'approval' | 'test' (each can be switched off). Never throws. */
async function send(st, { kind = 'test', title, message, chatId = '', tags = [], priority } = {}, { fetchImpl = fetch, timeout = 10000 } = {}) {
  const c = config(st);
  if (!c.topic || (kind !== 'test' && !c.on)) return { ok: false, skipped: true, error: 'Phone notifications are off.' };
  if ((kind === 'schedule' && !c.schedules) || (kind === 'chat' && !c.chats) || (kind === 'approval' && !c.approvals)) return { ok: false, skipped: true };
  const body = {
    topic: c.topic, title: clip(title || 'Artemis', 120),
    message: (c.preview ? clip(plain(message), 900) : '') || (kind === 'approval' ? 'Artemis is waiting for your OK.' : 'Open Artemis to see it.'),
    ...(tags.length ? { tags } : {}), ...(priority ? { priority } : {}),
    ...(chatId ? { click: 'artemis://chat/' + encodeURIComponent(chatId) } : {})
  };
  try {
    const r = await fetchImpl(c.server, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
    if (!r.ok) return { ok: false, error: `ntfy answered ${r.status}${r.status === 429 ? ' (too many messages, try later)' : ''}` };
    return { ok: true };
  } catch (e) { return { ok: false, error: 'Cannot reach ' + c.server + ': ' + ((e && e.message) || e) }; }
}

module.exports = { config, patchFrom, send, newTopic, cleanServer, DEFAULT_SERVER };
