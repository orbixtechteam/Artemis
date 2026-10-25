import React, { useEffect, useState } from 'react';
import ModelPicker from '../ModelPicker.jsx';
import Select from '../Select.jsx';
import { Icon } from '../Icons.jsx';
import { Switch, Segmented } from '../settings/ui.jsx';
import { askConfirm } from '../../lib/dialog.js';
import { Avatar, MODES, CLI_CLAUDE, CLI_CODEX, isCli } from './parts.jsx';

const BUDGETS = [['0', 'No cap'], ['0.5', '$0.50'], ['1', '$1'], ['3', '$3'], ['5', '$5'], ['10', '$10'], ['25', '$25']];
const MINUTES = [['0', 'No limit'], ['10', '10 min'], ['30', '30 min'], ['60', '1 hour'], ['120', '2 hours']];
const TOKENS = [['0', 'No token cap'], ['200000', '200k tokens'], ['500000', '500k tokens'], ['1000000', '1M tokens'], ['3000000', '3M tokens'], ['10000000', '10M tokens']];
const REPEATS = [['', 'Only when I start it'], ['daily', 'Every day'], ['weekdays', 'Weekdays'], ['interval', 'Every few hours']];
const EVERY = [['60', '1 hour'], ['120', '2 hours'], ['180', '3 hours'], ['360', '6 hours'], ['720', '12 hours']];

/** Create or edit a team. onDone(team | null, { start }) closes it; a deleted team comes back as onDone(null, { deleted }). */
export default function DeploySheet({ team, roster: userRoster, chatGroups, projects = [], onDone, onNewAgent }) {
  const fresh = !team || !team.id;
  const [d, setD] = useState(() => (fresh
    ? { name: '', goal: '', members: userRoster.filter((a) => a.builtin).map((a) => ({ name: a.name, model: '' })), mode: 'lead', leadModel: '', budgetUsd: 3, budgetTokens: 0, minutes: 30, askWrites: true, canHire: false, rules: '', repeat: null, ...(team || {}) }
    : { ...team, members: team.members.map((m) => ({ ...m })) }));
  const [err, setErr] = useState('');
  const project = d.projectId ? projects.find((p) => p.id === d.projectId) : null;
  // a team that works for a project can also use that project's own agents
  const [projRoster, setProjRoster] = useState(null);
  useEffect(() => {
    if (!project || !project.folder) { setProjRoster(null); return; }
    let on = true;
    window.api.agentsList(project.folder).then((l) => { if (on && Array.isArray(l)) setProjRoster(l); }).catch(() => {});
    return () => { on = false; };
  }, [project && project.folder]);
  const roster = projRoster || userRoster;
  const [busy, setBusy] = useState(false);
  const [clis, setClis] = useState({ claude: false, codex: false });
  useEffect(() => { window.api.teamsClis?.().then((c) => c && setClis(c)).catch(() => {}); }, []);
  // Claude Code and Codex run on this computer with their own login (a subscription or their own key)
  const cliGroup = [clis.claude && [CLI_CLAUDE, 'Claude Code · your login'], clis.codex && [CLI_CODEX, 'Codex · your login']].filter(Boolean);
  const memberGroups = cliGroup.length ? [{ label: 'On this computer', items: cliGroup }, ...chatGroups] : chatGroups;
  const usesCodex = d.members.some((m) => m.model === CLI_CODEX);
  const usesCli = d.members.some((m) => isCli(m.model));
  const pickFolder = async () => { const f = await window.api.pickFolder(); if (f) set('folder')(f); };
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
      const r = await window.api.teamsSave({ ...d, budgetUsd: Number(d.budgetUsd) || 0, budgetTokens: Number(d.budgetTokens) || 0, minutes: Number(d.minutes) || 0 });
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
                {m && <ModelPicker value={m.model} groups={memberGroups} onChange={(v) => setModel(a.name, v)} emptyLabel="Agent's model" up={false} align="right" />}
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
          <div className="tm-r"><div className="tm-r-t"><b>Project</b><small>{project ? `Works in its folder, follows its instructions and can use its agents` : 'Not part of a project'}</small></div>
            <Select value={d.projectId || ''} aria-label="Project" onChange={(e) => set('projectId')(e.target.value)}>
              <option value="">No project</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              {d.projectId && !project && <option value={d.projectId}>(deleted project)</option>}
            </Select>
          </div>
          <div className="tm-r"><div className="tm-r-t"><b>Folder</b><small title={d.folder || (project && project.folder) || ''}>{d.folder ? d.folder : project && project.folder ? `${project.folder} (the project's)` : 'Your Files folder'}{usesCli ? ' · Claude Code and Codex work here' : ''}</small></div>
            {d.folder && <button type="button" className="tm-link" onClick={() => set('folder')('')}>{project && project.folder ? "Use the project's" : 'Use Files'}</button>}
            <button type="button" onClick={pickFolder}>Choose…</button>
          </div>
                    <div className="tm-r"><div className="tm-r-t"><b>Token budget</b><small>Counts every model, also ones without a price</small></div>
            <Select value={String(d.budgetTokens || 0)} onChange={(e) => set('budgetTokens')(e.target.value)} aria-label="Token budget">{opt(TOKENS, d.budgetTokens || 0).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
          </div>
          <div className="tm-r"><div className="tm-r-t"><b>Ask me before acting</b><small>{usesCodex && d.askWrites !== false ? 'Codex cannot ask in the middle of a run, so it works read-only while this is on.' : 'Writing files, commands, Make, posting, sending' + (usesCli ? ' (Claude Code asks before edits and commands too)' : '') + '. In the room, and on Telegram when it is paired. Off: the team acts on its own.'}</small></div><Switch checked={d.askWrites !== false} onChange={set('askWrites')} label="Ask me before acting" /></div>
          <div className="tm-r"><div className="tm-r-t"><b>Let Artemis add agents</b><small>When no member fits a task, the lead creates a new agent (up to 3 per team)</small></div><Switch checked={!!d.canHire} onChange={set('canHire')} label="Let Artemis add agents" /></div>
        </div>

        <div className="tm-lbl">Runs by itself</div>
        <div className="tm-grp">
          <div className="tm-r"><div className="tm-r-t"><b>Start a new run</b><small>Each run reads the team notebook: what earlier runs did and learned</small></div>
            <Select value={(d.repeat && d.repeat.type) || ''} aria-label="Start a new run" onChange={(e) => { const v = e.target.value; set('repeat')(!v ? null : v === 'interval' ? { type: 'interval', every: 360 } : { type: v, at: (d.repeat && d.repeat.at) || '09:00' }); }}>
              {REPEATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
            {d.repeat && d.repeat.type !== 'interval' && <input type="time" className="tm-in tm-time" aria-label="At" value={d.repeat.at || '09:00'} onChange={(e) => set('repeat')({ ...d.repeat, at: e.target.value })} />}
            {d.repeat && d.repeat.type === 'interval' && <Select value={String(d.repeat.every || 360)} aria-label="Every" onChange={(e) => set('repeat')({ ...d.repeat, every: Number(e.target.value) })}>{opt(EVERY, d.repeat.every || 360).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>}
          </div>
        </div>
        <label className="tm-lbl" htmlFor="tm-rules">Team rules <small>(optional)</small></label>
        <textarea id="tm-rules" className="tm-in" rows={2} value={d.rules || ''} placeholder="Anything every member should follow: tone, platforms, what not to do, where results go." onChange={(e) => set('rules')(e.target.value)} />

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
