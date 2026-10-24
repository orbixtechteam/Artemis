import React, { useEffect, useRef, useState } from 'react';
import Select from '../Select.jsx';
import { Icon } from '../Icons.jsx';

const api = window.api;
const STATUS = { ok: 'Nothing to report', alert: 'Alert sent', duplicate: 'Same alert as before, not sent again', empty: 'Checklist is empty, nothing was checked', error: 'Failed', running: 'Checking…' };
const when = (ts) => {
  if (!ts) return '—';
  const d = new Date(ts); const same = d.toDateString() === new Date().toDateString();
  const t = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return same ? `Today ${t}` : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${t}`;
};
const EXAMPLE = '# Heartbeat\n\n- If an email from a client or my bank arrived since the last check, tell me who and what in one line.\n- If a meeting in my calendar starts within the next 30 minutes, remind me.\n';

/** The heartbeat: a short checklist (HEARTBEAT.md) that Artemis checks every few minutes, silent unless something needs you. */
export default function HeartbeatPanel({ models }) {
  const [s, setS] = useState(null);
  const [headless, setHeadless] = useState(false);
  const [text, setText] = useState('');
  const [dirty, setDirty] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const dirtyRef = useRef(false);
  const load = () => api.heartbeatStatus().then((r) => {
    if (!r.ok) return setErr(r.error);
    setS(r.status); setHeadless(!!r.headless);
    if (!dirtyRef.current) setText(r.status.checklist || '');
  }).catch(() => {});
  useEffect(() => { load(); const off = api.onAutomationChanged && api.onAutomationChanged(load); const t = setInterval(load, 15000); return () => { off && off(); clearInterval(t); }; }, []);
  const set = async (o) => { setErr(''); const r = await api.heartbeatSet(o); if (!r.ok) return setErr(r.error); setS(r.status); };
  const saveText = async () => { await set({ checklist: text }); dirtyRef.current = false; setDirty(false); setSaved(true); setTimeout(() => setSaved(false), 1500); };
  const runNow = async () => { setBusy(true); setErr(''); if (dirty) await saveText(); const r = await api.heartbeatRun(); setBusy(false); if (!r.ok) setErr(r.error); load(); };
  if (!s) return <div className="hb-panel">{err && <div className="error">{err}</div>}</div>;
  const allDay = !s.from || !s.to || s.from === s.to;
  const items = text.split('\n').filter((l) => /^\s*-\s+\S/.test(l)).length;
  return (
    <div className="hb-panel">
      <div className="sched-row hb-head">
        <div className="sched-main">
          <div className="sched-name">Heartbeat{s.running && <span className="sched-badge run">Checking…</span>}{s.lastStatus === 'error' && <span className="sched-badge bad" title={s.lastError}>Failed</span>}</div>
          <div className="sched-sub">{s.enabled ? `Every ${s.every} min${allDay ? ', day and night' : `, ${s.from}–${s.to}`} · Next: ${when(s.nextAt)}` : 'Off'}{headless ? ' · runs in the background gateway' : ''}</div>
          <div className="sched-sub">Last: {when(s.lastRun)}{s.lastStatus ? ` · ${STATUS[s.lastStatus] || s.lastStatus}` : ''}{s.runs ? ` · ${s.runs} check${s.runs === 1 ? '' : 's'}, ${s.alerts || 0} alert${s.alerts === 1 ? '' : 's'}` : ''}</div>
          {s.lastStatus === 'error' && s.lastError && <div className="sched-sub bad-text">{s.lastError}</div>}
        </div>
        <button className="icon-btn" title="Check now" aria-label="Check now" onClick={runNow} disabled={busy || s.running || headless}><Icon name="play" size={15} /></button>
        <label className="switch" title={s.enabled ? 'Switch off' : 'Switch on'}><input type="checkbox" checked={s.enabled} onChange={(e) => set({ enabled: e.target.checked })} /><i /></label>
      </div>

      <div className="sched-grid">
        <label className="field"><span>Every (minutes)</span>
          <Select value={String(s.every)} onChange={(e) => set({ every: Number(e.target.value) })}>
            {[...new Set([10, 15, 30, 60, 120, 240, s.every])].sort((a, b) => a - b).map((m) => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} h`}</option>)}
          </Select>
        </label>
        <label className="field"><span>When</span>
          <Select value={allDay ? 'all' : 'hours'} onChange={(e) => set(e.target.value === 'all' ? { from: '', to: '' } : { from: '08:00', to: '23:00' })}>
            <option value="all">Day and night</option><option value="hours">Only between…</option>
          </Select>
        </label>
        {!allDay && <label className="field"><span>From</span><input type="time" value={s.from || ''} onChange={(e) => set({ from: e.target.value })} /></label>}
        {!allDay && <label className="field"><span>Until</span><input type="time" value={s.to || ''} onChange={(e) => set({ to: e.target.value })} /></label>}
        <label className="field"><span>Model</span>
          <Select value={s.model || ''} onChange={(e) => set({ model: e.target.value })}>
            <option value="">Same as scheduled tasks</option>
            {models.map((g) => <optgroup key={g.label} label={g.label}>{g.items.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</optgroup>)}
          </Select>
        </label>
      </div>
      <label className="field"><span>Checklist (HEARTBEAT.md){items ? ` · ${items} item${items === 1 ? '' : 's'}` : ''}</span>
        <textarea className="mono" rows={9} value={text} spellCheck={false} placeholder={EXAMPLE}
          onChange={(e) => { setText(e.target.value); dirtyRef.current = true; setDirty(true); }} />
      </label>
      <div className="actions-row">
        {!items && <button type="button" onClick={() => { setText(EXAMPLE); dirtyRef.current = true; setDirty(true); }}>Use an example</button>}
        <span style={{ flex: 1 }} />
        <button className="primary" disabled={!dirty} onClick={saveText}>{saved ? 'Saved' : 'Save checklist'}</button>
      </div>
      {err && <div className="error">{err}</div>}
      <small className="hint">
        Each check is one model call with the checklist (a few thousand tokens, more when an item needs a tool such as your mail). When nothing needs you, the model answers HEARTBEAT_OK and you hear nothing. Otherwise you get the message as a chat, a notification and on Telegram. With an empty checklist no check runs and it costs nothing. A cheap model is enough for most checklists.
      </small>
      <label className="check"><input type="checkbox" checked={s.phone !== false} onChange={(e) => set({ phone: e.target.checked })} /> Send alerts to my phone (Telegram)</label>
    </div>
  );
}
