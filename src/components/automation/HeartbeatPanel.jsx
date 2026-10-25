import React, { useEffect, useState } from 'react';
import Select from '../Select.jsx';
import { Icon } from '../Icons.jsx';
import { askConfirm } from '../../lib/dialog.js';

const api = window.api;
const STATUS = { ok: 'Nothing to report', alert: 'Alert sent', duplicate: 'Same alert as before, not sent again', empty: 'Checklist is empty, nothing was checked', error: 'Failed', running: 'Checking…' };
const EVERY = [2, 5, 10, 15, 30, 60, 120, 240, 360, 720, 1440];
const everyLabel = (m) => (m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`);
const when = (ts) => {
  if (!ts) return '—';
  const d = new Date(ts); const same = d.toDateString() === new Date().toDateString();
  const t = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return same ? `Today ${t}` : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${t}`;
};
const EXAMPLE = '- If an email from a client or my bank arrived since the last check, tell me who and what in one line.\n- If a meeting in my calendar starts within the next 30 minutes, remind me.\n';
/** Text outside <!-- comments --> (no regex: a plain scan). */
function visible(t) {
  let out = '', i = 0; const s = String(t || '');
  for (;;) { const a = s.indexOf('<!--', i); if (a < 0) return out + s.slice(i); out += s.slice(i, a); const b = s.indexOf('-->', a + 4); if (b < 0) return out; i = b + 3; }
}
const countItems = (t) => visible(t).split('\n').filter((l) => /^\s*[-*]\s+\S/.test(l)).length;
const minutesOf = (hhmm) => { const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || ''); return m ? +m[1] * 60 + +m[2] : null; };
function perDay(h) {
  const a = minutesOf(h.from), b = minutesOf(h.to);
  const span = a === null || b === null || a === b ? 1440 : ((b - a + 1440) % 1440);
  return Math.max(1, Math.round(span / (Number(h.every) || 30)));
}

function Card({ hb, models, headless, open, onToggleOpen, onChanged }) {
  const [d, setD] = useState(hb);
  const [dirty, setDirty] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!dirty) setD(hb); }, [hb]);
  const set = (p) => { setD({ ...d, ...p }); setDirty(true); };
  const allDay = !d.from || !d.to || d.from === d.to;
  const save = async (extra = {}) => {
    setErr('');
    const r = await api.heartbeatSave({ id: hb.id, name: d.name, every: Number(d.every), from: allDay ? '' : d.from, to: allDay ? '' : d.to, model: d.model || '', phone: d.phone !== false, checklist: d.checklist, ...extra });
    if (!r.ok) { setErr(r.error); return false; }
    setDirty(false); onChanged(r.heartbeats); return true;
  };
  const toggle = async (on) => { const r = await api.heartbeatSave({ id: hb.id, enabled: on }); if (!r.ok) setErr(r.error); else onChanged(r.heartbeats); };
  const runNow = async () => { setBusy(true); setErr(''); if (dirty && !(await save())) { setBusy(false); return; } const r = await api.heartbeatRun(hb.id); setBusy(false); if (!r.ok) setErr(r.error); onChanged(); };
  const del = () => askConfirm({ title: 'Delete heartbeat', message: `Delete "${hb.name}" and its checklist?`, confirmLabel: 'Delete', danger: true })
    .then((ok) => ok && api.heartbeatDelete(hb.id).then((r) => (r.ok ? onChanged(r.heartbeats) : setErr(r.error))));
  const items = countItems(d.checklist);
  const hbAllDay = !hb.from || !hb.to || hb.from === hb.to;
  return (
    <div className={`hb-card ${hb.enabled ? '' : 'off'}`}>
      <div className="sched-row hb-head">
        <button type="button" className="icon-btn" aria-expanded={open} aria-label={open ? 'Collapse' : 'Edit'} title={open ? 'Collapse' : 'Edit'} onClick={onToggleOpen}><Icon name={open ? 'x' : 'pencil'} size={15} /></button>
        <div className="sched-main" onClick={onToggleOpen} role="button" tabIndex={-1}>
          <div className="sched-name">{hb.name}{hb.running && <span className="sched-badge run">Checking…</span>}{hb.lastStatus === 'error' && <span className="sched-badge bad" title={hb.lastError}>Failed</span>}</div>
          <div className="sched-sub">{hb.enabled ? `Every ${everyLabel(hb.every)}, ${hbAllDay ? 'day and night' : `${hb.from}–${hb.to}`} · Next: ${when(hb.nextAt)}` : 'Off'} · {hb.items ? `${hb.items} item${hb.items === 1 ? '' : 's'}` : 'empty checklist'}</div>
          <div className="sched-sub">Last: {when(hb.lastRun)}{hb.lastStatus ? ` · ${STATUS[hb.lastStatus] || hb.lastStatus}` : ''}{hb.runs ? ` · ${hb.runs} check${hb.runs === 1 ? '' : 's'}, ${hb.alerts || 0} alert${hb.alerts === 1 ? '' : 's'}` : ''}</div>
          {hb.lastStatus === 'error' && hb.lastError && <div className="sched-sub bad-text">{hb.lastError}</div>}
        </div>
        <button className="icon-btn" title={headless ? 'The background gateway runs heartbeats now' : 'Check now'} aria-label="Check now" onClick={runNow} disabled={busy || hb.running || headless}><Icon name="play" size={15} /></button>
        <label className="switch" title={hb.enabled ? 'Switch off' : 'Switch on'}><input type="checkbox" checked={!!hb.enabled} onChange={(e) => toggle(e.target.checked)} /><i /></label>
      </div>
      {open && (
        <div className="hb-body">
          <div className="sched-grid">
            <label className="field"><span>Name</span><input value={d.name} onChange={(e) => set({ name: e.target.value })} /></label>
            <label className="field"><span>Every</span>
              <Select value={String(d.every)} onChange={(e) => set({ every: Number(e.target.value) })}>
                {[...new Set([...EVERY, Number(d.every) || 30])].sort((a, b) => a - b).map((m) => <option key={m} value={m}>{everyLabel(m)}</option>)}
              </Select>
            </label>
            <label className="field"><span>When</span>
              <Select value={allDay ? 'all' : 'hours'} onChange={(e) => set(e.target.value === 'all' ? { from: '', to: '' } : { from: '08:00', to: '23:00' })}>
                <option value="all">Day and night</option><option value="hours">Only between…</option>
              </Select>
            </label>
            {!allDay && <label className="field"><span>From</span><input type="time" value={d.from} onChange={(e) => set({ from: e.target.value })} /></label>}
            {!allDay && <label className="field"><span>Until</span><input type="time" value={d.to} onChange={(e) => set({ to: e.target.value })} /></label>}
            <label className="field"><span>Model</span>
              <Select value={d.model || ''} onChange={(e) => set({ model: e.target.value })}>
                <option value="">Same as scheduled tasks</option>
                {models.map((g) => <optgroup key={g.label} label={g.label}>{g.items.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</optgroup>)}
              </Select>
            </label>
          </div>
          <label className="field"><span>Checklist · {items ? `${items} item${items === 1 ? '' : 's'}` : 'no items yet (start each line with "- ")'}</span>
            <textarea className="mono" rows={7} value={d.checklist} spellCheck={false} placeholder={EXAMPLE} onChange={(e) => set({ checklist: e.target.value })} />
          </label>
          <label className="check"><input type="checkbox" checked={d.phone !== false} onChange={(e) => set({ phone: e.target.checked })} /> Send alerts to my phone (Telegram)</label>
          <small className={`hint ${perDay(d) > 200 ? 'warn-text' : ''}`}>
            About {perDay(d)} check{perDay(d) === 1 ? '' : 's'} a day{items ? '' : ' once it has items'}. Each check is one model call (a few thousand tokens, more when an item uses a tool such as your mail){perDay(d) > 200 ? ': at this rate pick a cheap model' : ''}. Nothing is sent when nothing needs you.
          </small>
          {err && <div className="error">{err}</div>}
          <div className="actions-row">
            <button type="button" className="danger-link" onClick={del}>Delete</button>
            {!items && <button type="button" onClick={() => set({ checklist: (d.checklist.trim() ? d.checklist.trimEnd() + '\n' : '') + EXAMPLE })}>Add an example</button>}
            <span style={{ flex: 1 }} />
            <button className="primary" disabled={!dirty} onClick={() => save()}>Save</button>
          </div>
        </div>
      )}
      {!open && err && <div className="error">{err}</div>}
    </div>
  );
}

/** Heartbeats: short checklists Artemis checks every few minutes, each with its own interval and hours; silent unless something needs you. */
export default function HeartbeatPanel({ models }) {
  const [list, setList] = useState(null);
  const [headless, setHeadless] = useState(false);
  const [open, setOpen] = useState(null);
  const [err, setErr] = useState('');
  const load = (fresh) => {
    if (fresh) { setList(fresh); return; }
    api.heartbeatList().then((r) => { if (!r.ok) return setErr(r.error); setList(r.heartbeats); setHeadless(!!r.headless); }).catch(() => {});
  };
  useEffect(() => { load(); const off = api.onAutomationChanged && api.onAutomationChanged(() => load()); const t = setInterval(() => load(), 15000); return () => { off && off(); clearInterval(t); }; }, []);
  const add = async () => {
    setErr('');
    const r = await api.heartbeatSave({ name: list && list.length ? `Heartbeat ${list.length + 1}` : 'Heartbeat', every: 30, enabled: false });
    if (!r.ok) return setErr(r.error);
    setList(r.heartbeats); setOpen(r.heartbeat.id);
  };
  if (!list) return <div className="hb-panel">{err && <div className="error">{err}</div>}</div>;
  return (
    <div className="hb-panel">
      <div className="page-head sub"><h2>Heartbeats</h2><button className="primary-btn" onClick={add}><Icon name="plus" size={15} /> New heartbeat</button></div>
      <small className="hint">A heartbeat is a short checklist Artemis goes through by itself, for example every 10 minutes for your inbox and every 6 hours for your website. When nothing needs you it stays silent; otherwise you get a chat, a notification and a Telegram message. A heartbeat with an empty checklist never calls the model.{headless ? ' The background gateway runs them now.' : ''}</small>
      {list.length === 0 && <div className="empty-card"><Icon name="clock" size={28} /><p>No heartbeats yet.</p><button className="primary-btn" onClick={add}>Create one</button></div>}
      {list.map((hb) => <Card key={hb.id} hb={hb} models={models} headless={headless} open={open === hb.id} onToggleOpen={() => setOpen(open === hb.id ? null : hb.id)} onChanged={load} />)}
      {err && <div className="error">{err}</div>}
    </div>
  );
}
