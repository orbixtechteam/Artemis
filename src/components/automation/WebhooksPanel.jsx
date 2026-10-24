import React, { useEffect, useState } from 'react';
import Select from '../Select.jsx';
import { Icon } from '../Icons.jsx';
import { askConfirm } from '../../lib/dialog.js';

const api = window.api;
const VERIFY = { token: 'Secret token (any service)', github: 'GitHub signature', stripe: 'Stripe signature' };
const STATUS = { ok: 'Told you', quiet: 'Handled, nothing to tell', error: 'Failed', running: 'Running…' };
const blank = () => ({ name: '', instructions: '', verify: 'token', secret: '', events: '', perHour: 20, notifyPhone: true, model: '', projectId: '', allowEdits: false, enabled: true });
const ago = (ts) => { if (!ts) return 'never'; const m = Math.round((Date.now() - ts) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };

function useCopy() {
  const [copied, setCopied] = useState('');
  return [copied, async (key, text) => { try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(''), 1500); } catch {} }];
}

function howTo(h, url) {
  if (h.verify === 'github') return `GitHub → the repository → Settings → Webhooks → Add webhook. Payload URL: ${url} · Content type: application/json · Secret: the secret below.`;
  if (h.verify === 'stripe') return `Stripe → Developers → Webhooks → Add endpoint: ${url}. Paste its signing secret (whsec_…) here.`;
  return `POST JSON to ${url} with the header "Authorization: Bearer <secret>" (or add ?token=<secret> to the URL when the service cannot set headers).`;
}

function Editor({ hook, models, projects, info, onSave, onClose }) {
  const [h, setH] = useState({ ...hook, events: Array.isArray(hook.events) ? hook.events.join(', ') : hook.events || '' });
  const [err, setErr] = useState('');
  const [show, setShow] = useState(false);
  const [copied, copy] = useCopy();
  const set = (p) => setH({ ...h, ...p });
  const save = async () => {
    const r = await api.hooksSave({ ...h, secret: h.verify === 'stripe' ? h.secret : (hook.id && hook.verify === h.verify ? hook.secret : ''), perHour: Number(h.perHour) || 20 });
    if (!r.ok) return setErr(r.error);
    onSave(r.hook);
  };
  const url = h.name ? (info.publicUrl ? `${info.publicUrl}/hooks/${h.name}` : `http://127.0.0.1:${info.port}/hooks/${h.name}`) : '';
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal wide">
        <h2>{hook.id ? `Edit webhook "${hook.name}"` : 'New webhook'}</h2>
        <div className="sched-grid">
          <label className="field"><span>Name (part of the address)</span><input value={h.name} placeholder="github-issues" autoFocus onChange={(e) => set({ name: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40) })} /></label>
          <label className="field"><span>Who can call it</span>
            <Select value={h.verify} onChange={(e) => set({ verify: e.target.value })}>{Object.entries(VERIFY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          </label>
        </div>
        <label className="field"><span>What should Artemis do with each event?</span>
          <textarea rows={4} value={h.instructions} placeholder={h.verify === 'github' ? 'Summarise the new issue in two lines: title, who opened it, what is wrong.' : h.verify === 'stripe' ? 'When a payment succeeds, tell me the customer, the amount and the product in one line.' : 'Tell me who signed up and what they wrote, in one line.'} onChange={(e) => set({ instructions: e.target.value })} />
        </label>
        {h.verify === 'stripe' && <label className="field"><span>Stripe signing secret</span><input type="password" value={h.secret} placeholder="whsec_…" onChange={(e) => set({ secret: e.target.value.trim() })} /></label>}
        <div className="sched-grid">
          <label className="field"><span>Only these events (comma separated, empty = all)</span><input value={h.events} placeholder={h.verify === 'github' ? 'issues.opened, pull_request' : h.verify === 'stripe' ? 'invoice.paid, charge.refunded' : ''} onChange={(e) => set({ events: e.target.value })} /></label>
          <label className="field"><span>At most per hour</span><input type="number" min={1} max={1000} value={h.perHour} onChange={(e) => set({ perHour: e.target.value })} /></label>
        </div>
        <div className="sched-grid">
          <label className="field"><span>Model</span>
            <Select value={h.model || ''} onChange={(e) => set({ model: e.target.value })}>
              <option value="">Same as scheduled tasks</option>
              {models.map((g) => <optgroup key={g.label} label={g.label}>{g.items.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</optgroup>)}
            </Select>
          </label>
          <label className="field"><span>Project</span>
            <Select value={h.projectId || ''} onChange={(e) => set({ projectId: e.target.value })}>
              <option value="">No project</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </label>
        </div>
        <label className="check"><input type="checkbox" checked={h.notifyPhone !== false} onChange={(e) => set({ notifyPhone: e.target.checked })} /> Send the result to my phone (Telegram)</label>
        <label className="check"><input type="checkbox" checked={!!h.allowEdits} onChange={(e) => set({ allowEdits: e.target.checked })} /> Allow file changes in the project folder (otherwise it can only read)</label>
        {hook.id && hook.verify === h.verify && h.verify !== 'stripe' && (
          <div className="field"><span>Secret</span>
            <div className="pref-inline">
              <input className="mono" readOnly type={show ? 'text' : 'password'} value={hook.secret} onFocus={(e) => e.target.select()} aria-label="Webhook secret" />
              <button type="button" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button>
              <button type="button" onClick={() => copy('secret', hook.secret)}>{copied === 'secret' ? 'Copied' : 'Copy'}</button>
            </div>
          </div>
        )}
        {url && <small className="hint">{howTo(h, url)}{!info.publicUrl ? ' This address works on this computer only; switch on the tunnel below for services on the internet.' : ''}</small>}
        <small className="hint">The event's data goes to the model as data, never as instructions. When the event needs no message the run stays quiet. Each event is one model run, so filter the events you need.</small>
        {err && <div className="error">{err}</div>}
        <div className="actions-row"><span style={{ flex: 1 }} /><button onClick={onClose}>Cancel</button><button className="primary" onClick={save}>Save</button></div>
      </div>
    </div>
  );
}

/** Webhooks: outside services start runs by calling an address; with an optional Cloudflare tunnel for the internet. */
export default function WebhooksPanel({ models, projects }) {
  const [d, setD] = useState(null);
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState('');
  const [port, setPort] = useState('');
  const [token, setToken] = useState('');
  const [pub, setPub] = useState('');
  const [fresh, setFresh] = useState(null); // the hook just created: show its secret once
  const [copied, copy] = useCopy();
  const load = () => api.hooksList().then((r) => { if (r.ok) { setD(r); setPort((p) => p || String(r.info.port)); setPub((p) => p || r.info.publicUrlSetting || ''); } else setErr(r.error); }).catch(() => {});
  useEffect(() => { load(); const off = api.onAutomationChanged && api.onAutomationChanged(load); const t = setInterval(load, 5000); return () => { off && off(); clearInterval(t); }; }, []);
  const apply = async (o) => { setErr(''); const r = await api.hooksSet(o); if (!r.ok) setErr(r.error); else setD(r); };
  if (!d) return <div>{err && <div className="error">{err}</div>}</div>;
  const i = d.info;
  const tunnelText = i.tunnelMode === 'off' ? '' : i.tunnel.state === 'running' ? `Online: ${i.publicUrl}` : i.tunnel.state === 'starting' ? `Connecting…${i.tunnel.error ? ` (${i.tunnel.error})` : ''}` : i.tunnel.error || '';
  return (
    <div className="hooks-panel">
      <div className="sched-row hb-head">
        <div className="sched-main">
          <div className="sched-name">Webhook server{i.running && <span className="sched-badge run">On</span>}</div>
          <div className="sched-sub">{i.enabled ? (i.running ? `Listening on ${i.localUrl}/hooks/<name>${i.owner === 'headless' ? ' (in the background gateway)' : ''}` : i.error || 'Starting…') : 'Off. Outside services can call Artemis on its own port, which answers only the webhook addresses below.'}</div>
          {i.enabled && i.error && <div className="sched-sub bad-text">{i.error}</div>}
        </div>
        <label className="switch" title={i.enabled ? 'Switch off' : 'Switch on'}><input type="checkbox" checked={i.enabled} onChange={(e) => apply({ enabled: e.target.checked })} /><i /></label>
      </div>
      {i.enabled && (
        <div className="sched-grid">
          <label className="field"><span>Port</span><input inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))} onBlur={() => port && String(i.port) !== port && apply({ port: Number(port) })} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} /></label>
          <label className="field"><span>On the internet</span>
            <Select value={i.tunnelMode} onChange={(e) => apply({ tunnel: e.target.value })}>
              <option value="off">No (this computer only)</option>
              <option value="quick">Cloudflare quick tunnel (free, address changes on restart)</option>
              <option value="named">Cloudflare tunnel with your own domain</option>
            </Select>
          </label>
        </div>
      )}
      {i.enabled && i.tunnelMode === 'named' && (
        <div className="sched-grid">
          <label className="field"><span>Tunnel token {i.hasTunnelToken ? '(saved)' : ''}</span><input type="password" value={token} placeholder={i.hasTunnelToken ? '••••••••  (paste to replace)' : 'eyJh… from Cloudflare → Zero Trust → Tunnels'} onChange={(e) => setToken(e.target.value)} onBlur={() => token && apply({ tunnelToken: token }).then(() => setToken(''))} /></label>
          <label className="field"><span>Public address</span><input value={pub} placeholder="https://hooks.example.com" onChange={(e) => setPub(e.target.value)} onBlur={() => pub !== (i.publicUrlSetting || '') && apply({ publicUrl: pub })} /></label>
        </div>
      )}
      {i.enabled && i.tunnelMode !== 'off' && (
        <small className={`hint ${i.tunnel.state === 'error' ? 'bad-text' : ''}`}>
          {!i.cloudflared ? 'cloudflared is not installed. On a Mac: brew install cloudflared, then switch the tunnel off and on. ' : ''}{tunnelText}
          {i.tunnelMode === 'named' ? ' In the Cloudflare dashboard, point the tunnel\'s public hostname at http://127.0.0.1:' + i.port + '.' : ''} The tunnel reaches only this webhook port, never your chats or the gateway.
        </small>
      )}
      {err && <div className="error">{err}</div>}

      <div className="page-head sub"><h2>Webhooks</h2><button className="primary-btn" onClick={() => setEdit(blank())}><Icon name="plus" size={15} /> New webhook</button></div>
      {fresh && (
        <div className="empty-card left">
          <p><b>"{fresh.name}" is ready.</b> {howTo(fresh, fresh.urls.public || fresh.urls.local)}</p>
          <div className="pref-inline">
            <input className="mono" readOnly value={fresh.urls.public || fresh.urls.local} onFocus={(e) => e.target.select()} aria-label="Webhook address" />
            <button onClick={() => copy('furl', fresh.urls.public || fresh.urls.local)}>{copied === 'furl' ? 'Copied' : 'Copy address'}</button>
            {fresh.verify !== 'stripe' && <button onClick={() => copy('fsec', fresh.secret)}>{copied === 'fsec' ? 'Copied' : 'Copy secret'}</button>}
            <button onClick={() => setFresh(null)}>Done</button>
          </div>
        </div>
      )}
      {d.hooks.length === 0 ? (
        <div className="empty-card">
          <Icon name="link" size={28} />
          <p>Let GitHub, Stripe, a form or n8n tell Artemis when something happens — a new issue, a payment, a sign-up — and it acts on it with your instructions. You can also ask in chat: "make me a webhook for new GitHub issues".</p>
          <button className="primary-btn" onClick={() => setEdit(blank())}>Create a webhook</button>
        </div>
      ) : (
        <div className="sched-list">
          {d.hooks.map((h) => (
            <div key={h.id} className={`sched-row ${h.enabled !== false ? '' : 'off'}`}>
              <div className="sched-main">
                <div className="sched-name">{h.name}{h.lastStatus === 'running' && <span className="sched-badge run">Running…</span>}{h.lastStatus === 'error' && <span className="sched-badge bad" title={h.lastError}>Failed</span>}</div>
                <div className="sched-sub mono">{h.urls.public || h.urls.local}</div>
                <div className="sched-sub">{VERIFY[h.verify] || h.verify} · {(h.events || []).length ? h.events.join(', ') : 'all events'} · last: {ago(h.lastAt)}{h.lastEvent ? ` (${h.lastEvent})` : ''}{h.lastStatus && h.lastStatus !== 'running' ? ` · ${STATUS[h.lastStatus] || h.lastStatus}` : ''}{h.runs ? ` · ${h.runs} run${h.runs === 1 ? '' : 's'}` : ''}</div>
              </div>
              <button className="icon-btn" title="Copy address" aria-label="Copy address" onClick={() => copy(h.id, h.urls.public || h.urls.local)}><Icon name={copied === h.id ? 'check' : 'copy'} size={15} /></button>
              <button className="icon-btn" title="Edit" aria-label="Edit" onClick={() => setEdit({ ...blank(), ...h })}><Icon name="pencil" size={15} /></button>
              <button className="icon-btn" title="Delete" aria-label="Delete" onClick={() => askConfirm({ title: 'Delete webhook', message: `Delete "${h.name}"? Its address stops working.`, confirmLabel: 'Delete', danger: true }).then((ok) => ok && api.hooksDelete(h.id).then((r) => r.ok && setD(r)))}><Icon name="trash" size={15} /></button>
              <label className="switch" title={h.enabled !== false ? 'Switch off' : 'Switch on'}><input type="checkbox" checked={h.enabled !== false} onChange={(e) => api.hooksSave({ ...h, enabled: e.target.checked }).then(load)} /><i /></label>
            </div>
          ))}
        </div>
      )}
      {edit && <Editor hook={edit} models={models} projects={projects} info={i} onClose={() => setEdit(null)} onSave={(hk) => { const isNew = !edit.id; setEdit(null); api.hooksList().then((r) => { if (r.ok) { setD(r); if (isNew) setFresh(r.hooks.find((x) => x.id === hk.id) || null); } }); }} />}
    </div>
  );
}
