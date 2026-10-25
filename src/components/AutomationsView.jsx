import React, { useEffect, useMemo, useState } from 'react';
import Select from './Select.jsx';
import { Icon } from './Icons.jsx';
import { askConfirm } from '../lib/dialog.js';

const ago = (t) => {
  const ms = Date.now() - new Date(t).getTime();
  if (!Number.isFinite(ms)) return '';
  const m = Math.round(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
};
/** Make's schedule object in words. */
export function scheduleText(s) {
  if (!s || typeof s !== 'object') return 'No schedule';
  if (s.type === 'immediately') return 'Instantly (webhook or trigger)';
  if (s.type === 'on-demand') return 'On demand';
  if (s.type === 'indefinitely' && s.interval) { const min = Math.round(s.interval / 60); return min >= 60 && min % 60 === 0 ? `Every ${min / 60} h` : `Every ${min} min`; }
  if (s.type === 'daily') return 'Daily';
  if (s.type === 'weekly') return 'Weekly';
  if (s.type === 'monthly') return 'Monthly';
  return String(s.type || 'Scheduled');
}
const STATUS = { 1: ['Success', 'ok'], 2: ['Warning', 'warn'], 3: ['Error', 'bad'] };

/** Your Make scenarios in one place: see which are on, switch them, run them once, open them in Make, read the latest runs. */
export default function AutomationsView({ onOpenSettings }) {
  const api = window.api;
  const [data, setData] = useState(null);       // { scenarios, teams, zone }
  const [err, setErr] = useState('');
  const [notConnected, setNotConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [team, setTeam] = useState('all');
  const [open, setOpen] = useState({});         // id -> { loading, logs, error }
  const [busy, setBusy] = useState({});         // id -> 'toggle' | 'run'
  const [note, setNote] = useState('');

  const load = async () => {
    setLoading(true); setErr(''); setNotConnected(false);
    try {
      const r = await api.makeScenarios();
      if (!r.ok) { setNotConnected(!!r.notConnected); setErr(r.notConnected ? '' : r.error); setData(null); }
      else setData(r);
    } catch (e) { setErr((e && e.message) || String(e)); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  const flash = (t) => { setNote(t); setTimeout(() => setNote((n) => (n === t ? '' : n)), 4000); };

  const list = useMemo(() => {
    if (!data) return [];
    const t = q.trim().toLowerCase();
    return data.scenarios
      .filter((s) => (filter === 'all' || (filter === 'on' ? s.isActive : !s.isActive)) && (team === 'all' || String(s.teamId) === team) && (!t || `${s.name} ${s.teamName}`.toLowerCase().includes(t)))
      .sort((a, b) => Number(b.isActive) - Number(a.isActive) || String(a.name).localeCompare(String(b.name)));
  }, [data, q, filter, team]);

  const patch = (id, p) => setData((d) => d && ({ ...d, scenarios: d.scenarios.map((s) => (s.id === id ? { ...s, ...p } : s)) }));
  const toggle = async (s) => {
    setBusy((b) => ({ ...b, [s.id]: 'toggle' }));
    patch(s.id, { isActive: !s.isActive });
    const r = await api.makeToggle({ id: s.id, active: !s.isActive });
    setBusy((b) => { const n = { ...b }; delete n[s.id]; return n; });
    if (!r.ok) { patch(s.id, { isActive: s.isActive }); flash(r.error || 'Could not change the scenario.'); } else flash(`${s.name} is now ${!s.isActive ? 'on' : 'off'}.`);
  };
  const run = async (s) => {
    if (!(await askConfirm({ title: 'Run scenario', message: `Run "${s.name}" once now?`, confirmLabel: 'Run' }))) return;
    setBusy((b) => ({ ...b, [s.id]: 'run' }));
    const r = await api.makeRunNow({ id: s.id });
    setBusy((b) => { const n = { ...b }; delete n[s.id]; return n; });
    flash(r.ok ? `${s.name} started.` : (r.error || 'Could not run the scenario.'));
  };
  const expand = async (s) => {
    if (open[s.id]) { setOpen((o) => { const n = { ...o }; delete n[s.id]; return n; }); return; }
    setOpen((o) => ({ ...o, [s.id]: { loading: true } }));
    const r = await api.makeLogs({ id: s.id });
    setOpen((o) => (o[s.id] ? { ...o, [s.id]: r.ok ? { logs: r.logs } : { error: r.error } } : o));
  };

  const teams = data ? data.teams : [];
  const total = data ? data.scenarios.length : 0;
  const onCount = data ? data.scenarios.filter((s) => s.isActive).length : 0;

  return (
    <div className="page auto">
      <div className="page-head">
        <h1>Automations</h1>
        <div className="head-actions">
          <button onClick={load} disabled={loading}><Icon name={loading ? 'spinner' : 'refresh'} size={14} /> Refresh</button>
          {data && <button onClick={() => window.open(`https://${data.zone}/`, '_blank')}>Open Make</button>}
        </div>
      </div>

      {notConnected && (
        <div className="empty-card">
          <b>Make is not connected</b>
          <span>Add your Make API token to see your scenarios here.</span>
          <button className="primary-btn" onClick={() => onOpenSettings && onOpenSettings('make')}>Connect Make</button>
        </div>
      )}
      {err && <div className="auto-err">{err}</div>}
      {note && <div className="auto-note">{note}</div>}

      {data && (
        <>
          <div className="auto-bar">
            <input className="auto-search" placeholder="Search scenarios…" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="seg">{[['all', `All ${total}`], ['on', `On ${onCount}`], ['off', `Off ${total - onCount}`]].map(([id, n]) => <button key={id} className={filter === id ? 'on' : ''} onClick={() => setFilter(id)}>{n}</button>)}</div>
            {teams.length > 1 && (
              <Select value={team} onChange={(e) => setTeam(e.target.value)} title="Team">
                <option value="all">All teams</option>
                {teams.map((t) => <option key={t.id} value={String(t.id)}>{t.name}</option>)}
              </Select>
            )}
          </div>
          {teams.filter((t) => t.error).map((t) => <div key={t.id} className="auto-err">Could not read team "{t.name}": {t.error}</div>)}
          {list.length === 0 && <div className="empty-card">{total === 0 ? 'No scenarios found in your Make account.' : 'No scenario matches.'}</div>}
          <div className="auto-list">
            {list.map((s) => {
              const o = open[s.id];
              return (
                <div key={s.id} className={`auto-row ${s.isActive ? 'on' : 'off'}`}>
                  <div className="auto-main">
                    <button className="auto-exp" onClick={() => expand(s)} title="Show the latest runs" aria-label="Show the latest runs"><Icon name="chevronRight" size={15} /></button>
                    <span className={`auto-dot ${s.isActive ? 'on' : ''}`} title={s.isActive ? 'On' : 'Off'} />
                    <div className="auto-info">
                      <div className="auto-name">{s.name}</div>
                      <div className="auto-meta">
                        <span>{scheduleText(s.scheduling)}</span>
                        {teams.length > 1 && <span>{s.teamName}</span>}
                        {s.lastEdit && <span>Edited {ago(s.lastEdit)}</span>}
                      </div>
                    </div>
                    <button className="auto-btn" disabled={!!busy[s.id]} onClick={() => run(s)} title="Run once now">{busy[s.id] === 'run' ? <Icon name="spinner" size={13} /> : <Icon name="play" size={13} />} Run</button>
                    <button className="auto-btn icon" onClick={() => window.open(s.url, '_blank')} title="Open in Make" aria-label="Open in Make"><Icon name="globe" size={14} /></button>
                    <label className="switch" title={s.isActive ? 'Turn off' : 'Turn on'}>
                      <input type="checkbox" checked={!!s.isActive} disabled={busy[s.id] === 'toggle'} onChange={() => toggle(s)} /><i />
                    </label>
                  </div>
                  {o && (
                    <div className="auto-logs">
                      {o.loading && <span className="muted small">Loading the latest runs…</span>}
                      {o.error && <span className="auto-err inline">{o.error}</span>}
                      {o.logs && o.logs.length === 0 && <span className="muted small">No runs yet.</span>}
                      {o.logs && o.logs.map((l, i) => {
                        const [label, cls] = STATUS[l.status] || ['Run', ''];
                        return (
                          <div key={l.id || i} className="auto-log">
                            <span className={`auto-badge ${cls}`}>{label}</span>
                            <span>{l.at ? new Date(l.at).toLocaleString() : ''}</span>
                            <span className="muted">{l.operations != null ? `${l.operations} op` : ''}{l.duration != null ? ` · ${Math.max(0.1, l.duration / 1000).toFixed(1)}s` : ''}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
      {loading && !data && !err && !notConnected && <div className="muted">Loading your scenarios…</div>}
    </div>
  );
}
