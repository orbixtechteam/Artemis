import React, { useEffect, useState } from 'react';
import { askConfirm } from '../../lib/dialog.js';
import { Group, Row, SwitchRow } from './ui.jsx';

/** The gateway: a local HTTP API so the `artemis` command line and other programs can use the same agent, chats and memory. */
export function GatewayCard() {
  const [i, setI] = useState(null);
  const [port, setPort] = useState('');
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState('');
  useEffect(() => { window.api.gatewayInfo().then((x) => { setI(x); setPort(String(x.port)); }).catch(() => {}); }, []);
  const apply = async (o) => { const x = await window.api.gatewaySet(o); setI(x); setPort(String(x.port)); };
  const url = i ? `http://127.0.0.1:${i.port}` : '';
  const curl = i ? `curl -N ${url}/v1/chat -H "Authorization: Bearer ${i.token || '<token>'}" -H "content-type: application/json" -d '{"message":"What is on my plate today?"}'` : '';
  const copy = async (what, text) => { try { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(''), 1500); } catch {} };
  return (
    <Group title="Gateway (command line and other apps)" footer={i && i.enabled ? <>From a terminal: <code>artemis chat "…"</code>, <code>artemis search …</code>, <code>artemis memory search …</code> (the command is <code>bin/artemis.js</code> in the source folder). The API is described at the top of <code>electron/core/gateway.js</code>.</> : null}>
      <SwitchRow label="Gateway" checked={!!(i && i.enabled)} onChange={(v) => i && apply({ enabled: v })} disabled={!i}
        description={<>{i && i.headless ? `The headless gateway (process ${i.headless.pid}) is running on this data folder: it serves the API, scheduled tasks and Telegram until it stops. ` : i && i.running ? `Running on ${url}. ` : 'Off. '}Other programs on this Mac can send messages to Artemis and read your saved chats and memory through a small local API. It listens on this Mac only and needs the token below. Actions still ask for approval: in the app window, or in the terminal that sent the message.</>}
        error={i && i.error ? i.error : ''} />
      {i && i.enabled && (
        <>
          <Row label="Port" description="Saved when you leave the field.">
            <input className="pref-input narrow" inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))} onBlur={() => port && String(i.port) !== port && apply({ port })} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
          </Row>
          <Row label="Token" description="Programs send it as a bearer token. The command line finds it by itself.">
            <div className="pref-inline">
              <input className="pref-input" readOnly type={show ? 'text' : 'password'} value={i.token} onFocus={(e) => e.target.select()} aria-label="Gateway token" />
              <button type="button" className="pref-btn" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button>
              <button type="button" className="pref-btn" onClick={() => askConfirm({ title: 'Make a new token?', message: 'Programs that use the old token stop working until you give them the new one.', confirmLabel: 'New token' }).then((ok) => ok && apply({ resetToken: true }))}>New token</button>
            </div>
          </Row>
          <SwitchRow label="No terminal or computer control from outside" description="On: messages that come through the gateway cannot run commands or control the screen, even if you approve."
            checked={!!i.restrict} onChange={(v) => apply({ restrict: v })} />
          <Row stacked label="Try it" description="Paste in a terminal. The answer streams back as server-sent events.">
            <textarea readOnly rows={3} className="mono" value={curl} onFocus={(e) => e.target.select()} />
          </Row>
          <Row>
            <div className="pref-inline">
              <button type="button" className="pref-btn" onClick={() => copy('curl', curl)}>{copied === 'curl' ? 'Copied' : 'Copy command'}</button>
              <button type="button" className="pref-btn" onClick={() => copy('url', url)}>{copied === 'url' ? 'Copied' : 'Copy address'}</button>
            </div>
          </Row>
        </>
      )}
    </Group>
  );
}
