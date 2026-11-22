import React, { useEffect, useState } from 'react';
import { askConfirm } from '../../lib/dialog.js';
import { Group, Row, Note, Buttons } from './ui.jsx';
import { MoveDataGroup } from './MoveDataGroup.jsx';
import QRCode from 'qrcode';

/** The pairing code as a QR code for the phone app: artemis://connect?url=<server>&code=<code>. */
function PairQr({ url, code }) {
  const [src, setSrc] = useState('');
  useEffect(() => { QRCode.toDataURL(`artemis://connect?url=${encodeURIComponent(url)}&code=${code}`, { margin: 1, width: 180 }).then(setSrc).catch(() => setSrc('')); }, [url, code]);
  return src ? <img src={src} width={180} height={180} alt="Pairing QR code" style={{ borderRadius: 8, background: '#fff' }} /> : null;
}

const ago = (t) => {
  if (!t) return 'never';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
};
const KIND = { desktop: 'Desktop', mobile: 'Phone', web: 'Web app', cli: 'Command line', other: 'Other' };

/** This computer as a client of an Artemis server (a home server behind an https tunnel or reverse proxy, or another machine). */
function LinkGroup() {
  const [st, setSt] = useState(null);
  const [url, setUrl] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = () => window.api.serverLinkStatus().then(setSt).catch((e) => setError(String(e.message || e)));
  useEffect(() => { load(); }, []);

  const connect = async () => {
    setBusy(true); setError('');
    const r = await window.api.serverLinkConnect({ url, code, name: name.trim() || undefined });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setCode(''); setSt(r);
  };
  const disconnect = async () => {
    const ok = await askConfirm({ title: 'Disconnect from the server?', message: 'This computer forgets the server and the server stops accepting it. Chats on the server stay there; you can pair again any time.', confirmLabel: 'Disconnect' });
    if (!ok) return;
    setBusy(true); await window.api.serverLinkDisconnect({ revoke: true }); setBusy(false); load();
  };

  if (!st) return <Group title="Connect to a server"><Row label="Loading…" /></Group>;
  if (!st.configured) {
    return (
      <Group title="Connect to a server" footer={<>On the server, <code>artemis gateway</code> shows a pairing code when it starts; <code>artemis pair</code> makes a new one. Codes work once, for 10 minutes.</>}>
        <Row stacked label="Server address" description="The server's https address (your tunnel or reverse proxy), e.g. https://artemis.example.com. http:// works only on this computer and your local network.">
          <input className="pref-input wide" value={url} placeholder="https://artemis.example.com" spellCheck={false} autoCapitalize="off" onChange={(e) => setUrl(e.target.value)} />
        </Row>
        <Row label="Pairing code">
          <input className="pref-input mono" value={code} placeholder="XXXX-XXXX" spellCheck={false} autoCapitalize="characters" maxLength={12} onChange={(e) => setCode(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === 'Enter' && url && code) connect(); }} />
        </Row>
        <Row label="This computer's name" description="How it shows in the server's list of devices.">
          <input className="pref-input" value={name} placeholder="My Mac" onChange={(e) => setName(e.target.value)} />
        </Row>
        <Row error={error}>
          <Buttons end><button type="button" className="pref-btn primary" disabled={busy || !url.trim() || !code.trim()} onClick={connect}>{busy ? 'Connecting…' : 'Connect'}</button></Buttons>
        </Row>
      </Group>
    );
  }
  const state = st.online ? <span className="pref-ok-text">Connected</span> : st.revoked ? <span className="pref-err-text">Not accepted any more</span> : <span className="pref-err-text">Offline</span>;
  return (
    <>
    <Group title="Connected server">
      <Row label={st.serverName || st.url} description={<>{st.url}{st.version ? ` · Artemis ${st.version}` : ''}{st.model ? ` · ${st.model}` : ''}</>}>{state}</Row>
      <Row label="This computer" description={`Paired as "${st.name || 'Desktop'}" ${st.pairedAt ? ago(st.pairedAt) : ''}`} />
      {st.error && <Row error={st.error} />}
      <Row>
        <Buttons end>
          <button type="button" className="pref-btn" disabled={busy} onClick={load}>Check again</button>
          {st.revoked && <button type="button" className="pref-btn" disabled={busy} onClick={async () => { await window.api.serverLinkDisconnect({ revoke: false }); setUrl(st.url); load(); }}>Pair again</button>}
          <button type="button" className="pref-btn danger" disabled={busy} onClick={disconnect}>Disconnect</button>
        </Buttons>
      </Row>
    </Group>
    {st.online && <MoveDataGroup />}
    {st.online && <DownloadGroup />}
    </>
  );
}

/** This computer as a server: other devices (phone, web app, another computer) pair with it. */
/** Settings → Server & devices → Copy from the server to this Mac: everything the server has comes here too. */
function DownloadGroup() {
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState(null);
  const [res, setRes] = useState(null);
  useEffect(() => (window.api.onServerDownloadProgress ? window.api.onServerDownloadProgress((p) => setProg({ phase: 'files', ...p })) : undefined), []);
  const start = async () => {
    setBusy(true); setRes(null); setProg(null);
    try { setRes(await new Promise((resolve) => window.dispatchEvent(new CustomEvent('aid-server-download', { detail: { resolve, onProgress: setProg } })))); }
    finally { setBusy(false); setProg(null); }
  };
  const progText = prog ? (prog.phase === 'chats' ? `Chats ${prog.done} / ${prog.total}…` : `Files ${prog.done} / ${prog.total}…`) : 'Starting…';
  return (
    <Group title="Copy from the server to this Mac" footer="Chats, memory, skills, agents, brains, the server's files and pictures, connectors with their sign-ins, and provider keys. Nothing here is overwritten: a file that differs is kept next to yours as “name (server)”. The server keeps everything.">
      <Row label="Download everything" description={busy ? progText : res ? (res.ok === false && res.error ? res.error : `${res.chats ? res.chats.copied : 0} chats copied · ${res.files ? res.files.added + res.files.kept : 0} files (${res.files ? res.files.kept : 0} kept next to yours) · ${res.connectors ? res.connectors.added + res.connectors.updated : 0} connectors · ${res.providers ? res.providers.keys : 0} keys${res.failures && res.failures.length ? ` · ${res.failures.length} failed` : ''}${res.filesFolder ? `. The server's files are in ${res.filesFolder}.` : ''}`) : 'A copy of everything on the server, on this Mac.'}>
        <button type="button" className="pref-btn primary" disabled={busy} onClick={start}>{busy ? 'Copying…' : res ? 'Copy again' : 'Copy to this Mac'}</button>
      </Row>
    </Group>
  );
}

function HostGroup({ goTo }) {
  const [i, setI] = useState(null);
  const [hosts, setHosts] = useState('');
  const [origins, setOrigins] = useState('');
  const [code, setCode] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const take = (x) => { if (!x || x.ok === false) { setError((x && x.error) || 'Failed'); return; } setError(''); setI(x); setHosts((x.publicHosts || []).join(', ')); setOrigins((x.allowedOrigins || []).join(', ')); };
  const load = () => window.api.serverHostInfo().then(take);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, []);
  useEffect(() => { if (!code) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [code]);

  const save = async (patch) => { const r = await window.api.serverHostSet(patch); take(r); if (r && r.restartHeadless) setNote('The background gateway uses the new addresses after it restarts.'); };
  const pair = async () => { const r = await window.api.serverPairCode('from the desktop app'); if (!r.ok) return setError(r.error); setError(''); setCode(r); setNow(Date.now()); };
  const act = async (c, action) => {
    if (action === 'revoke' && !(await askConfirm({ title: `Revoke "${c.name}"?`, message: 'It stops working at once and has to be paired again.', confirmLabel: 'Revoke' }))) return;
    take(await window.api.serverClient(c.id, action));
  };
  if (!i) return <Group title="Use this Mac as a server"><Row label="Loading…" error={error} /></Group>;
  const left = code ? Math.max(0, Math.round((code.expiresAt - now) / 1000)) : 0;
  const devices = (i.clients || []).slice().sort((a, b) => (a.revoked - b.revoked) || (b.lastSeenAt - a.lastSeenAt));
  return (
    <>
      <Group title="Use this Mac as a server" footer={<>Point your tunnel or reverse proxy (Cloudflare Tunnel, ngrok, Tailscale, Caddy…) at <code>http://localhost:{i.port}</code>. Every request still needs a paired device's token; the address alone gives no access.</>}>
        <Row label="Gateway" description={i.headless ? 'The background gateway is serving on this Mac.' : i.inApp ? `Running in the app on port ${i.port}.` : 'Off: devices cannot reach this Mac.'}>
          {i.gatewayOn ? <span className="pref-ok-text">On</span> : <button type="button" className="pref-btn" onClick={() => goTo && goTo('access')}>Turn on…</button>}
        </Row>
        <Row stacked label="Public address" description="The hostname of your tunnel, e.g. artemis.example.com. Requests for other hostnames are refused.">
          <input className="pref-input wide" value={hosts} placeholder="artemis.example.com" spellCheck={false} autoCapitalize="off" onChange={(e) => setHosts(e.target.value)} onBlur={() => save({ publicHosts: hosts })} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
        </Row>
        <Row stacked label="Web app addresses" description="Only if you deploy the Artemis web app on another domain (e.g. https://app.example.com). Leave empty otherwise.">
          <input className="pref-input wide" value={origins} placeholder="https://app.example.com" spellCheck={false} autoCapitalize="off" onChange={(e) => setOrigins(e.target.value)} onBlur={() => save({ allowedOrigins: origins })} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
        </Row>
        {note && <Row description={note} />}
        {error && <Row error={error} />}
      </Group>
      <Group title="Devices" footer="A device pairs once with a code; after that it has its own access, which you can take away here at any time.">
        <Row label="Pair a device" description={code && left ? <>Enter this code in the Artemis app on the phone, the web app or another computer. Valid for {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}, once.</> : 'Makes a one-time code for the phone, the web app or another computer.'}>
          {code && left ? <span className="server-code">{code.code}</span> : <button type="button" className="pref-btn primary" disabled={!i.gatewayOn} onClick={pair}>New code</button>}
        </Row>
        {code && left > 0 && (i.publicHosts || [])[0] && <Row stacked label="Or scan with the phone" description={`Opens the Artemis app connected to https://${i.publicHosts[0]}.`}><PairQr url={`https://${i.publicHosts[0]}`} code={code.code} /></Row>}
        {devices.length === 0 && <Row description="No device is paired yet." />}
        {devices.map((c) => (
          <Row key={c.id} label={<>{c.name}{c.revoked ? <span className="pref-tag">revoked</span> : null}</>} description={`${KIND[c.kind] || c.kind} · paired ${ago(c.createdAt)}${c.revoked ? '' : ` · last seen ${ago(c.lastSeenAt)}`}`}>
            {c.revoked
              ? <button type="button" className="pref-btn" onClick={() => act(c, 'remove')}>Remove</button>
              : <button type="button" className="pref-btn danger" onClick={() => act(c, 'revoke')}>Revoke</button>}
          </Row>
        ))}
      </Group>
    </>
  );
}

/** Where a new turn of a server chat runs unless the composer says otherwise. */
function RunWhereGroup({ s, setS }) {
  if (!s || !setS) return null;
  return (
    <Group title="Where chats run" footer="Each chat's composer has the same switch (Server / This Mac), so you can change it for a single message.">
      <Row label="New chats run on" description="Server: keeps going when this computer sleeps, and your phone sees it live. This Mac: computer control, local files and the terminal; the chat is still saved on the server.">
        <select className="pref-input" value={s.defaultRunEnv === 'local' ? 'local' : 'server'} onChange={(e) => setS((x) => ({ ...x, defaultRunEnv: e.target.value }))}>
          <option value="server">Server</option>
          <option value="local">This Mac</option>
        </select>
      </Row>
    </Group>
  );
}

export function ServerTab({ goTo, s, setS }) {
  return (
    <>
      <Note>Run Artemis on a home server so chats, memory and scheduled tasks keep going when this computer is off, and use it from your phone or the web. Or let this Mac be the server.</Note>
      <LinkGroup />
      <RunWhereGroup s={s} setS={setS} />
      <HostGroup goTo={goTo} />
    </>
  );
}
