import React, { useEffect, useState } from 'react';
import Select from './Select.jsx';
import { askConfirm } from '../lib/dialog.js';
import { Icon } from './Icons.jsx';
import HeartbeatPanel from './automation/HeartbeatPanel.jsx';
import WebhooksPanel from './automation/WebhooksPanel.jsx';

const api = window.api;
const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const blank = () => ({ name: '', prompt: '', projectId: '', model: '', enabled: true, allowEdits: false, notifyPhone: false, reminder: false, repeat: { type: 'daily', at: '09:00', every: 60, days: [1], dayOfMonth: 1, date: today(), window: false, from: '09:00', to: '18:00', idays: [0, 1, 2, 3, 4, 5, 6] } });
const ALL = [0, 1, 2, 3, 4, 5, 6];
const EVERY = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 360, 480, 720];
const everyLabel = (m) => (m < 60 ? `${m} minutes` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} hour${m === 60 ? '' : 's'}`);
/** A saved job in the editor's shape: "custom" is shown as "every few minutes / hours" with its hours and days. */
export function toEditor(job) {
  const b = blank();
  const r = { ...b.repeat, ...job.repeat };
  if (r.type === 'custom') { r.type = 'interval'; r.window = !!(r.from && r.to); r.idays = Array.isArray(job.repeat.days) && job.repeat.days.length ? job.repeat.days : ALL; r.days = b.repeat.days; if (!r.window) { r.from = '09:00'; r.to = '18:00'; } }
  return { ...b, ...job, repeat: r };
}
/** The editor's shape back to what is saved. */
function fromEditor(r) {
  const every = Number(r.every) || 60;
  if (r.type !== 'interval') { const { window, from, to, idays, ...rest } = r; return { ...rest, every, dayOfMonth: Number(r.dayOfMonth) || 1 }; }
  const allDays = !r.idays || r.idays.length === 7;
  if (!r.window && allDays) return { type: 'interval', every };
  return { type: 'custom', every, ...(r.window ? { from: r.from, to: r.to } : {}), days: allDays ? ALL : r.idays };
}

function when(ts) {
  if (!ts) return '—';
  const d = new Date(ts); const now = new Date();
  const same = d.toDateString() === now.toDateString();
  const t = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return same ? `Today ${t}` : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${t}`;
}

function Editor({ job, projects, models, onSave, onClose }) {
  const [j, setJ] = useState(job);
  const [err, setErr] = useState('');
  const r = j.repeat;
  const setR = (patch) => setJ({ ...j, repeat: { ...r, ...patch } });
  const toggleDay = (d) => setR({ days: r.days.includes(d) ? r.days.filter((x) => x !== d) : [...r.days, d].sort() });
  const toggleIDay = (d) => setR({ idays: r.idays.includes(d) ? r.idays.filter((x) => x !== d) : [...r.idays, d].sort() });
  // the next run times, worked out by the app as you change the schedule
  const [preview, setPreview] = useState(null);
  const repeatKey = JSON.stringify(fromEditor(r));
  useEffect(() => {
    if (!api.schedulePreview) return undefined;
    const t = setTimeout(() => api.schedulePreview({ repeat: fromEditor(r) }).then(setPreview).catch(() => setPreview(null)), 150);
    return () => clearTimeout(t);
  }, [repeatKey]);
  const save = async () => {
    const res = await api.scheduleSave({ ...j, repeat: fromEditor(r) });
    if (!res.ok) return setErr(res.error);
    onSave();
  };
  const needsTime = r.type !== 'interval';
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal wide">
        <h2>{job.id ? 'Edit scheduled task' : 'New scheduled task'}</h2>
        <label className="field"><span>Name</span><input value={j.name} placeholder="Morning news summary" onChange={(e) => setJ({ ...j, name: e.target.value })} autoFocus /></label>
        <label className="field"><span>What should Artemis do?</span><textarea rows={4} value={j.prompt} placeholder="Search the web for today's AI news and give me the five most important items." onChange={(e) => setJ({ ...j, prompt: e.target.value })} /></label>
        <div className="sched-grid">
          <label className="field"><span>Repeat</span>
            <Select value={r.type} onChange={(e) => setR({ type: e.target.value })}>
              <option value="daily">Every day</option><option value="weekdays">Weekdays</option><option value="weekly">Certain weekdays</option>
              <option value="monthly">Every month</option><option value="interval">Every few minutes / hours</option><option value="once">Once</option>
            </Select>
          </label>
          {needsTime && <label className="field"><span>Time</span><input type="time" value={r.at} onChange={(e) => setR({ at: e.target.value })} /></label>}
          {r.type === 'interval' && <label className="field"><span>Every</span>
            <Select value={String(r.every)} onChange={(e) => setR({ every: Number(e.target.value) })}>
              {[...new Set([...EVERY, Number(r.every) || 60])].sort((a, b) => a - b).map((m) => <option key={m} value={m}>{everyLabel(m)}</option>)}
            </Select>
          </label>}
          {r.type === 'once' && <label className="field"><span>Date</span><input type="date" min={today()} value={r.date} onChange={(e) => setR({ date: e.target.value })} /></label>}
          {r.type === 'monthly' && <label className="field"><span>Day of month</span><input type="number" min={1} max={31} value={r.dayOfMonth} onChange={(e) => setR({ dayOfMonth: e.target.value })} /></label>}
        </div>
        {r.type === 'interval' && (
          <div className="sched-window">
            <label className="check"><input type="checkbox" checked={!!r.window} onChange={(e) => setR({ window: e.target.checked })} /> Only between</label>
            <input type="time" aria-label="From" value={r.from} disabled={!r.window} onChange={(e) => setR({ from: e.target.value })} />
            <span>and</span>
            <input type="time" aria-label="Until" value={r.to} disabled={!r.window} onChange={(e) => setR({ to: e.target.value })} />
          </div>
        )}
        {r.type === 'interval' && <div className="day-pick" aria-label="On these days">{DAYS.map((d, i) => <button key={i} type="button" title={DAY_NAMES[i]} aria-label={DAY_NAMES[i]} className={r.idays.includes(i) ? 'on' : ''} onClick={() => toggleIDay(i)}>{d}</button>)}</div>}
        {preview && (preview.ok
          ? <small className="hint sched-preview">{preview.description}{preview.next && preview.next.length ? ` · next: ${preview.next.map(when).join(', ')}` : ''}</small>
          : <small className="hint bad-text">{preview.error}</small>)}
        {r.type === 'weekly' && <div className="day-pick">{DAYS.map((d, i) => <button key={i} type="button" title={DAY_NAMES[i]} aria-label={DAY_NAMES[i]} className={r.days.includes(i) ? 'on' : ''} onClick={() => toggleDay(i)}>{d}</button>)}</div>}
        <div className="sched-grid">
          <label className="field"><span>Project</span>
            <Select value={j.projectId || ''} onChange={(e) => setJ({ ...j, projectId: e.target.value })}>
              <option value="">No project</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </label>
          <label className="field"><span>Model</span>
            <Select value={j.model} onChange={(e) => setJ({ ...j, model: e.target.value })}>
              <option value="">Default (Settings → General)</option>
              {models.map((g) => <optgroup key={g.label} label={g.label}>{g.items.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</optgroup>)}
            </Select>
          </label>
        </div>
        <label className="check"><input type="checkbox" checked={!!j.reminder} onChange={(e) => setJ({ ...j, reminder: e.target.checked })} /> Plain reminder: show the text above exactly as written, without running the AI</label>
        <label className="check"><input type="checkbox" checked={j.allowEdits} onChange={(e) => setJ({ ...j, allowEdits: e.target.checked })} /> Allow file changes in the project folder (otherwise the task can only read)</label>
        <label className="check"><input type="checkbox" checked={j.notifyPhone} onChange={(e) => setJ({ ...j, notifyPhone: e.target.checked })} /> Send the result to my phone (Telegram)</label>
        <small className="hint">Scheduled tasks run while Artemis is open (it can stay in the menu bar), or in the background gateway (Settings → Gateway → Keep running in the background). They can't use the shell, the computer tool or ask for approval. If Artemis was closed at the time, the task runs once when you open it again.</small>
        {err && <div className="error">{err}</div>}
        <div className="actions-row"><span style={{ flex: 1 }} /><button onClick={onClose}>Cancel</button><button className="primary" onClick={save}>Save</button></div>
      </div>
    </div>
  );
}

const TABS = [['tasks', 'Tasks'], ['heartbeat', 'Heartbeat'], ['hooks', 'Webhooks']];
let lastTab = 'tasks';

export default function SchedulesView({ projects, models, onOpenChat }) {
  const [tab, setTab0] = useState(lastTab);
  const setTab = (t) => { lastTab = t; setTab0(t); };
  const [jobs, setJobs] = useState([]);
  const [edit, setEdit] = useState(null);
  const load = () => api.scheduleList().then((l) => setJobs(l || [])).catch(() => {});
  useEffect(() => { load(); const off = api.onScheduleChanged(load); const t = setInterval(load, 30000); return () => { off && off(); clearInterval(t); }; }, []);
  const pname = (id) => (projects.find((p) => p.id === id) || {}).name;
  return (
    <div className="page">
      <div className="page-head">
        <h1>Scheduled</h1>
        <div className="seg" role="tablist">{TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
        {tab === 'tasks' && <button className="primary-btn" onClick={() => setEdit(blank())}><Icon name="plus" size={15} /> New task</button>}
      </div>
      {tab === 'heartbeat' ? <HeartbeatPanel models={models} /> : tab === 'hooks' ? <WebhooksPanel models={models} projects={projects} /> : jobs.length === 0 ? (
        <div className="empty-card">
          <Icon name="clock" size={28} />
          <p>Run a prompt automatically — every morning, every few hours, or once at a set time. Each run appears as its own chat.</p>
          <button className="primary-btn" onClick={() => setEdit(blank())}>Create your first task</button>
        </div>
      ) : (
        <div className="sched-list">
          {jobs.map((j) => (
            <div key={j.id} className={`sched-row ${j.enabled ? '' : 'off'}`}>
              <div className="sched-main">
                <div className="sched-name">{j.name}{j.running && <span className="sched-badge run">Running…</span>}{j.lastStatus === 'error' && <span className="sched-badge bad" title={j.lastError}>Failed</span>}</div>
                <div className="sched-sub">{j.description}{pname(j.projectId) ? ` · ${pname(j.projectId)}` : ''}</div>
                <div className="sched-sub">Next: {j.enabled ? when(j.nextRun) : 'paused'} · Last: {when(j.lastRun)}{j.runs ? ` · ${j.runs} run${j.runs === 1 ? '' : 's'}` : ''}</div>
              </div>
              <button className="icon-btn" title="Run now" aria-label="Run now" onClick={() => api.scheduleRun(j.id)} disabled={j.running}><Icon name="play" size={15} /></button>
              <button className="icon-btn" title="Edit" aria-label="Edit" onClick={() => setEdit(toEditor(j))}><Icon name="pencil" size={15} /></button>
              <button className="icon-btn" title="Delete" aria-label="Delete" onClick={() => askConfirm({ title: 'Delete task', message: `Delete "${j.name}"?`, confirmLabel: 'Delete', danger: true }).then((ok) => ok && api.scheduleDelete(j.id).then(load))}><Icon name="trash" size={15} /></button>
              <label className="switch" title={j.enabled ? 'Pause' : 'Resume'}><input type="checkbox" checked={j.enabled} onChange={(e) => api.scheduleToggle(j.id, e.target.checked).then(load)} /><i /></label>
            </div>
          ))}
        </div>
      )}
      {edit && <Editor job={edit} projects={projects} models={models} onClose={() => setEdit(null)} onSave={() => { setEdit(null); load(); }} />}
    </div>
  );
}
