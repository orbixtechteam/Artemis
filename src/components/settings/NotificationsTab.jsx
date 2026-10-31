import React, { useEffect, useState } from 'react';
import { Group, Row, Buttons } from './ui.jsx';

const when = (t) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

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
      <Group title="Recent" footer="The Dock number counts the ones you have not read here.">
        {st.items.length === 0 ? <Row label="Nothing yet" description="Finished chats, scheduled tasks, heartbeats and updates show up here." /> : st.items.map((n) => <Row key={n.id} label={n.title} description={n.body}><small className="muted">{when(n.t)}</small></Row>)}
        {st.items.length > 0 && <Row label="Clear the list"><Buttons><button type="button" onClick={() => window.api.notificationsClear().then(setSt)}>Clear</button></Buttons></Row>}
      </Group>
    </>
  );
}
