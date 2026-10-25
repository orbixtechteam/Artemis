import React, { useCallback, useEffect, useState } from 'react';
import { AgentEditor, AGENT_BLANK } from './settings/AgentsTab.jsx';
import { Icon } from './Icons.jsx';
import { liveAgents } from '../lib/agents.js';
import { labelFor, target } from './ToolCard.jsx';
import TeamRoom from './teams/TeamRoom.jsx';
import DeploySheet from './teams/DeploySheet.jsx';
import { Avatar, Stack, LEAD, teamState, pendingAsks, usd, elapsed } from './teams/parts.jsx';

/** Agents: teams you deploy on a goal, the roster of agents, and helpers working inside chats right now. */
export default function AgentsView({ settings, chats, runningIds, groups, onOpenChat }) {
  const api = window.api;
  const chatGroups = groups.filter((g) => !/^(Image|Video)/.test(g.label));
  const [teams, setTeams] = useState([]);
  const [roster, setRoster] = useState([]);
  const [open, setOpen] = useState(null);       // id of the team whose room is shown
  const [sheet, setSheet] = useState(null);     // team being created ({}) or edited
  const [editing, setEditing] = useState(null); // agent in the editor
  const [, tick] = useState(0);

  const loadRoster = useCallback(async () => { try { setRoster(await api.agentsList()); } catch {} }, []);
  useEffect(() => {
    api.teamsList().then((l) => setTeams(Array.isArray(l) ? l : [])).catch(() => {});
    loadRoster();
    const offT = api.onTeamsChanged((t) => setTeams((l) => (l.some((x) => x.id === t.id) ? l.map((x) => (x.id === t.id ? t : x)) : [t, ...l])));
    const offA = api.onAgentsChanged && api.onAgentsChanged(loadRoster);
    const timer = setInterval(() => tick((n) => n + 1), 30000); // elapsed times
    return () => { offT && offT(); offA && offA(); clearInterval(timer); };
  }, []);

  const closeSheet = (team, how) => {
    setSheet(null);
    if (how && how.deleted) { setTeams((l) => l.filter((x) => x.id !== (sheet && sheet.id))); setOpen(null); return; }
    if (team) { setTeams((l) => (l.some((x) => x.id === team.id) ? l.map((x) => (x.id === team.id ? team : x)) : [team, ...l])); if (how && how.start) setOpen(team.id); }
  };

  if (editing) {
    return (
      <div className="page agents-page">
        <button type="button" className="link-btn" onClick={() => setEditing(null)}><Icon name="chevronLeft" size={14} /> Agents</button>
        <div className="page-head"><h1>{editing.isNew ? 'New agent' : editing.name}</h1></div>
        <AgentEditor agent={editing} chatGroups={chatGroups} onDone={() => { setEditing(null); loadRoster(); }} />
      </div>
    );
  }

  const room = open && teams.find((t) => t.id === open);
  const sheetEl = sheet && <DeploySheet team={sheet} roster={roster} chatGroups={chatGroups} onDone={closeSheet} onNewAgent={() => { setSheet(null); setEditing({ ...AGENT_BLANK }); }} />;
  if (room) return <>{<TeamRoom team={room} roster={roster} you={settings.profileName || 'You'} onBack={() => setOpen(null)} onEdit={() => setSheet(room)} />}{sheetEl}</>;

  const live = liveAgents(chats, runningIds);
  const busyIn = (name) => { for (const t of teams) { const l = Object.values((t.run && t.run.live) || {}).find((x) => x.name === name); if (l) return { team: t, what: l.what }; } return null; };
  const working = teams.filter((t) => t.run && t.run.status === 'working').length;
  const needYou = teams.filter((t) => pendingAsks(t).length || (t.run && t.run.status === 'paused')).length;

  return (
    <div className="page agents-page">
      <div className="page-head">
        <h1>Agents</h1>
        <button type="button" onClick={() => setEditing({ ...AGENT_BLANK })}><Icon name="plus" size={14} />New agent</button>
        <button type="button" className="primary" onClick={() => setSheet({})}><Icon name="users" size={14} />Deploy a team</button>
      </div>
      <p className="page-sub">Give a team one goal. Artemis splits it into tasks, the agents work in parallel, talk to each other in the team room and check each other's work. You can step in at any point.</p>

      <div className="tm-gh"><span>Teams</span><small>{teams.length ? [working ? `${working} working` : '', needYou ? `${needYou} need${needYou === 1 ? 's' : ''} you` : ''].filter(Boolean).join(' · ') : ''}</small></div>
      <div className="tm-teams">
        {teams.map((t) => {
          const st = teamState(t);
          const r = t.run || { tasks: [], messages: [], spent: { usd: 0 } };
          const total = r.tasks.length;
          const ask = pendingAsks(t)[0];
          const last = ask || [...r.messages].reverse().find((m) => m.kind !== 'status' && m.from !== 'you');
          return (
            <button type="button" key={t.id} className="tm-team" onClick={() => setOpen(t.id)}>
              <div className="tm-team-top"><b>{t.name}</b><Stack names={[LEAD, ...t.members.map((m) => m.name)]} /><span className="tm-state"><i className={`tm-dot ${st.dot}`} />{st.label}</span></div>
              <div className="tm-goal2">{t.goal}</div>
              {total > 0 && (
                <div className="tm-prog">
                  <span className="tm-tr" role="progressbar" aria-label={`${t.name}: tasks done`} aria-valuenow={r.tasks.filter((k) => k.status === 'done').length} aria-valuemin={0} aria-valuemax={total}>
                    {r.tasks.map((k) => <i key={k.id} className={k.status} />)}
                  </span>
                  <span>{r.tasks.filter((k) => k.status === 'done').length} of {total} done</span>
                  <span>{usd(r.spent.usd)}{r.startedAt ? ` · ${elapsed(t)}` : ''}</span>
                </div>
              )}
              {last && <div className={`tm-last ${ask ? 'ask' : ''}`}><Avatar name={last.from} size="sm" /><span><b>{last.from}</b> {ask ? `wants to: ${ask.text}` : String(last.text || '').replace(/\s+/g, ' ').slice(0, 160)}</span></div>}
            </button>
          );
        })}
        <button type="button" className="tm-team new" onClick={() => setSheet({})}>
          <Icon name="users" size={20} /><b>Deploy a team</b><small>Pick agents, give them one goal. They plan, split the work and check each other.</small>
        </button>
      </div>

      <div className="tm-gh"><span>Roster</span><small>Each agent has its own model, tools and instructions</small></div>
      <div className="tm-roster">
        {roster.map((a) => {
          const b = busyIn(a.name);
          return (
            <button type="button" key={a.slug + a.source} className="tm-ag" onClick={() => setEditing({ ...a })} aria-label={`Edit ${a.name}`}>
              <Avatar name={a.name} size="lg" />
              <b>{a.name}</b><span className="tm-role">{a.role || (a.builtin ? 'Built-in' : a.source)}</span>
              <span className="tm-chips"><span>{modelName(a.model, chatGroups)}</span>{a.tools.map((x) => <span key={x}>{x}</span>)}</span>
              <span className="tm-now"><i className={`tm-dot ${b ? 'work' : ''}`} />{b ? `${b.team.name} · ${b.what}` : 'Idle'}</span>
            </button>
          );
        })}
      </div>

      {live.length > 0 && <>
        <div className="tm-gh"><span>Helping in chats</span><small>Agents Artemis called inside a chat</small></div>
        <div className="proc-grid">
          {live.map((a, i) => {
            const tools = a.tools || [];
            const waiting = tools.find((x) => x.status === 'awaiting');
            const running = [...tools].reverse().find((x) => x.status === 'running');
            const now = waiting ? `Waiting for your approval: ${labelFor(waiting.name)[1]} ${target(waiting)}` : running ? `${labelFor(running.name)[1]} ${target(running)}` : (a.text ? 'Thinking and writing…' : 'Starting…');
            return (
              <button key={i} className={`proc-card ${waiting ? 'waiting' : ''}`} onClick={() => onOpenChat(a.chatId)} title="Open the chat">
                <div className="proc-top"><span className="proc-dot" /><b>{a.name}</b>{a.role ? <span className="muted">{a.role}</span> : null}<span className={`badge ${waiting ? 'awaiting' : 'running'}`}>{waiting ? 'waiting for you' : 'working…'}</span></div>
                <div className="proc-task">{a.task}</div>
                <div className="proc-now"><span className="proc-label">Now</span>{now}</div>
                <div className="agent-chips"><span>{a.chatTitle}</span></div>
              </button>
            );
          })}
        </div>
      </>}
      {sheetEl}
    </div>
  );
}

function modelName(id, groups) {
  if (!id) return 'Chat model';
  for (const g of groups) for (const [mid, n] of g.items) if (mid === id) return n;
  return String(id).replace(/^prov:[^:]+:/, '');
}
