import React, { useEffect, useState } from 'react';
import { Group, Row, Buttons, SwitchRow } from './ui.jsx';

const when = (t) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Phone notifications through ntfy (free, iPhone and Android). While this Mac is linked to a server, the server sends them
 *  (it runs when the Mac sleeps) and this Mac keeps the same topic for its own scheduled tasks. */
function PhonePush() {
  const api = window.api;
  const [cfg, setCfg] = useState(null);
  const [linked, setLinked] = useState(false);
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState(false);
  const mirror = (c) => (c && c.topic ? api.ntfySet({ on: c.on, topic: c.topic, server: c.server, preview: c.preview, schedules: c.schedules, chats: c.chats, approvals: c.approvals }) : null);
  const load = async () => {
    const st = api.serverLinkStatus ? await api.serverLinkStatus().catch(() => null) : null;
    const on = !!(st && st.configured && st.online);
    setLinked(on);
    if (on) {
      const r = await api.serverApi('GET', '/v1/x/notify');
      if (r && r.notify) {
        const local = await api.ntfyGet();
        if (!r.notify.topic && local.topic) { const p = await api.serverApi('POST', '/v1/x/notify', { on: local.on, topic: local.topic, server: local.server, preview: local.preview, schedules: local.schedules, chats: local.chats, approvals: local.approvals }); if (p && p.notify) { setCfg(p.notify); return; } }
        setCfg(r.notify); mirror(r.notify); return;
      }
    }
    setCfg(await api.ntfyGet());
  };
  useEffect(() => { load().catch(() => {}); }, []);
  const change = async (patch) => {
    setNote(null);
    if (linked) {
      const r = await api.serverApi('POST', '/v1/x/notify', patch);
      if (!r || !r.notify) return setNote({ bad: true, text: (r && r.error) || 'The server did not answer.' });
      setCfg(r.notify); await mirror(r.notify);
    } else setCfg(await api.ntfySet(patch));
  };
  const test = async () => {
    setBusy(true); setNote(null);
    try {
      const r = linked ? await api.serverApi('POST', '/v1/x/notify/test', {}) : await api.ntfyTest();
      setNote(r && r.ok ? { text: 'Sent. It should be on your phone in a few seconds.' } : { bad: true, text: (r && r.error) || 'Sending failed.' });
    } finally { setBusy(false); }
  };
  if (!cfg) return null;
  const copy = () => { navigator.clipboard.writeText(cfg.topic).then(() => setNote({ text: 'Topic copied.' })).catch(() => {}); };
  return (
    <Group title="On your phone" footer={linked ? 'Sent by your server, so they come even when this Mac sleeps.' : 'Sent by this Mac (scheduled tasks). Link a server to get them when the Mac sleeps too.'}>
      <SwitchRow label="Push notifications (ntfy)" description="Free, for iPhone and Android: install the ntfy app and subscribe to your topic. A tap opens the chat in the Artemis app."
        checked={cfg.on} onChange={(v) => change({ on: v })} />
      {cfg.on && (
        <>
          <Row stacked label="Your topic" description={<>In the ntfy app: + → paste the topic (server {cfg.server.replace(/^https?:\/\//, '')}). Or in the Artemis app: Settings → Notifications → Subscribe in ntfy. Anyone who knows the topic can read the notifications: keep it private.</>}>
            <div className="pref-inline grow">
              <input readOnly value={cfg.topic} onFocus={(e) => e.target.select()} aria-label="ntfy topic" />
              <button type="button" className="pref-btn" onClick={copy}>Copy</button>
              <button type="button" className="pref-btn" onClick={() => change({ newTopic: true })} title="Make a new topic (subscribe again on the phone)">New</button>
            </div>
          </Row>
          <SwitchRow label="Scheduled tasks" description="When a task finishes." checked={cfg.schedules} onChange={(v) => change({ schedules: v })} />
          <SwitchRow label="Answers" description="When an answer you asked for on the phone is ready and the app is closed." checked={cfg.chats} onChange={(v) => change({ chats: v })} />
          <SwitchRow label="Waiting for your OK" description="When a task from the phone needs an approval." checked={cfg.approvals} onChange={(v) => change({ approvals: v })} />
          <SwitchRow label="Show the text" description="Off: only the title is sent through ntfy, the text stays on your server." checked={cfg.preview} onChange={(v) => change({ preview: v })} />
          <Row stacked label="ntfy server" description="ntfy.sh is free. Your own ntfy server works too (on iPhone, it needs upstream-base-url set to https://ntfy.sh for instant delivery).">
            <input defaultValue={cfg.server} placeholder="https://ntfy.sh" onBlur={(e) => { if (e.target.value.trim() !== cfg.server) change({ server: e.target.value.trim() }); }} aria-label="ntfy server" />
          </Row>
          <Row label="Test"><Buttons><button type="button" onClick={test} disabled={busy}>{busy ? 'Sending…' : 'Send a test'}</button></Buttons></Row>
        </>
      )}
      {note && <Row description={<span className={note.bad ? 'pref-err-text' : 'pref-ok-text'}>{note.text}</span>} />}
    </Group>
  );
}

/** Settings → Notifications: everything Artemis told you, a test, and the way to the macOS switch. Opening it marks the list read. */
export function NotificationsTab() {
  const [st, setSt] = useState({ items: [] });
  const [sent, setSent] = useState(false);
  useEffect(() => {
    window.api.notificationsReadAll().then(setSt).catch(() => {});
    return window.api.onNotificationsChanged(setSt);
  }, []);
  const test = async () => { await window.api.notificationsTest(); setSent(true); };
  return (
    <>
      <Group>
        <Row label="Test a notification" description={sent ? 'Sent. Nothing on the screen? macOS is hiding it: check Focus and the Artemis entry in System Settings.' : 'Banners appear only while Artemis is not the front window.'}>
          <Buttons><button type="button" onClick={test}>Send test</button><button type="button" onClick={() => window.api.notificationsSettings()}>Open macOS settings</button></Buttons>
        </Row>
      </Group>
      <PhonePush />
      <Group title="Recent" footer="The Dock number counts the ones you have not read here.">
        {st.items.length === 0 ? <Row label="Nothing yet" description="Finished chats, scheduled tasks, heartbeats and updates show up here." /> : st.items.map((n) => <Row key={n.id} label={n.title} description={n.body}><small className="muted">{when(n.t)}</small></Row>)}
        {st.items.length > 0 && <Row label="Clear the list"><Buttons><button type="button" onClick={() => window.api.notificationsClear().then(setSt)}>Clear</button></Buttons></Row>}
      </Group>
    </>
  );
}
