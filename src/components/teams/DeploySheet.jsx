import React, { useEffect, useState } from 'react';
import ModelPicker from '../ModelPicker.jsx';
import Select from '../Select.jsx';
import { Icon } from '../Icons.jsx';
import { Switch, Segmented } from '../settings/ui.jsx';
import { askConfirm } from '../../lib/dialog.js';
import { Avatar, MODES } from './parts.jsx';

const BUDGETS = [['0', 'No cap'], ['0.5', '$0.50'], ['1', '$1'], ['3', '$3'], ['5', '$5'], ['10', '$10'], ['25', '$25']];
const MINUTES = [['0', 'No limit'], ['10', '10 min'], ['30', '30 min'], ['60', '1 hour'], ['120', '2 hours']];

/** Create or edit a team. onDone(team | null, { start }) closes it; a deleted team comes back as onDone(null, { deleted }). */
export default function DeploySheet({ team, roster, chatGroups, onDone, onNewAgent }) {
  const fresh = !team || !team.id;
  const [d, setD] = useState(() => (fresh
    ? { name: '', goal: '', members: roster.filter((a) => a.builtin).map((a) => ({ name: a.name, model: '' })), mode: 'lead', leadModel: '', budgetUsd: 3, minutes: 30, askWrites: true, ...(team || {}) }
    : { ...team, members: team.members.map((m) => ({ ...m })) }));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setD((x) => ({ ...x, [k]: v }));
  const member = (name) => d.members.find((m) => m.name === name);
  const toggle = (name) => setD((x) => ({ ...x, members: member(name) ? x.members.filter((m) => m.name !== name) : [...x.members, { name, model: '' }] }));
  const setModel = (name, model) => setD((x) => ({ ...x, members: x.members.map((m) => (m.name === name ? { ...m, model } : m)) }));

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape' && !busy) onDone(null, {}); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [busy, onDone]);

  const submit = async (start) => {
    setErr(''); setBusy(true);
    try {
      const r = await window.api.teamsSave({ ...d, budgetUsd: Number(d.budgetUsd) || 0, minutes: Number(d.minutes) || 0 });
      if (!r.ok) { setErr(r.error); return; }
      if (start) { const s = await window.api.teamsStart(r.team.id); if (!s.ok) { setErr(s.error); return; } onDone(s.team, { start: true }); }
      else onDone(r.team, {});
    } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!(await askConfirm({ title: 'Delete team', message: `Delete "${team.name}" and its room? This cannot be undone.`, confirmLabel: 'Delete', danger: true }))) return;
    await window.api.teamsDelete(team.id);
    onDone(null, { deleted: true });
  };
  const mode = MODES.find((m) => m[0] === d.mode) || MODES[0];
  const opt = (list, v) => (list.some((o) => o[0] === String(v)) ? list : [...list, [String(v), String(v)]]);

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onDone(null, {}); }}>
      <div className="modal tm-sheet" role="dialog" aria-label={fresh ? 'Deploy a team' : 'Edit team'}>
        <h2>{fresh ? 'Deploy a team' : 'Edit team'}</h2>
        <p className="tm-sheet-sub">One goal, a few agents. Artemis leads: it plans, hands out the work and keeps the team talking.</p>
        <label className="tm-lbl" htmlFor="tm-name">Name</label>
        <input id="tm-name" className="tm-in" value={d.name} autoFocus={fresh} placeholder="Launch week" onChange={(e) => set('name')(e.target.value)} />
        <label className="tm-lbl" htmlFor="tm-goal">Goal</label>
        <textarea id="tm-goal" className="tm-in" rows={3} value={d.goal} placeholder="What should the team deliver? Be specific about the result and where it should go." onChange={(e) => set('goal')(e.target.value)} />

        <div className="tm-lbl">Members</div>
        <div className="tm-grp">
          {roster.map((a) => {
            const m = member(a.name);
            return (
              <div key={a.name} className={`tm-r ${m ? '' : 'off'}`}>
                <Avatar name={a.name} />
                <div className="tm-r-t"><b>{a.name}{a.role ? <span> · {a.role}</span> : null}</b><small>{a.description}</small></div>
                {m && <ModelPicker value={m.model} groups={chatGroups} onChange={(v) => setModel(a.name, v)} emptyLabel="Agent's model" up={false} align="right" />}
                <Switch checked={!!m} onChange={() => toggle(a.name)} label={`${a.name} on the team`} />
              </div>
            );
          })}
          <button type="button" className="tm-r tm-add" onClick={onNewAgent}><Icon name="plus" size={14} /> New agent…</button>
        </div>

        <div className="tm-lbl">How they work</div>
        <div className="tm-grp">
          <div className="tm-r"><div className="tm-r-t"><b>Teamwork</b></div><Segmented label="Teamwork" value={d.mode} onChange={set('mode')} options={MODES.map(([v, l]) => [v, l])} /></div>
          <div className="tm-r"><div className="tm-r-t"><b>Lead model</b><small>Artemis plans and writes the final answer</small></div><ModelPicker value={d.leadModel} groups={chatGroups} onChange={set('leadModel')} emptyLabel="Chat model" up={false} align="right" /></div>
        </div>
        <p className="tm-how">{mode[2]}</p>

        <div className="tm-grp">
          <div className="tm-r"><div className="tm-r-t"><b>Budget</b><small>The team pauses and asks when it is reached</small></div>
            <Select value={String(d.budgetUsd)} onChange={(e) => set('budgetUsd')(e.target.value)} aria-label="Budget">{opt(BUDGETS, d.budgetUsd).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
            <Select value={String(d.minutes)} onChange={(e) => set('minutes')(e.target.value)} aria-label="Time limit">{opt(MINUTES, d.minutes).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
          </div>
          <div className="tm-r"><div className="tm-r-t"><b>Ask me before writing files</b><small>Agents write into your Files folder. Deleting is never allowed.</small></div><Switch checked={d.askWrites !== false} onChange={set('askWrites')} label="Ask me before writing files" /></div>
        </div>

        {err && <div className="tm-err" role="alert">{err}</div>}
        <div className="tm-foot">
          {!fresh && <button type="button" className="tm-del" onClick={remove} disabled={busy}>Delete team</button>}
          <small>Each agent uses its own model, so cheap work stays cheap.</small>
          <button type="button" onClick={() => onDone(null, {})} disabled={busy}>Cancel</button>
          {!fresh && <button type="button" onClick={() => submit(false)} disabled={busy}>Save</button>}
          {(fresh || team.run?.status !== 'working') && <button type="button" className="primary" onClick={() => submit(true)} disabled={busy}>{busy ? 'Starting…' : fresh ? 'Deploy team' : 'Save and run'}</button>}
        </div>
      </div>
    </div>
  );
}
