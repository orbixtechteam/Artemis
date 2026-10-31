import React, { useCallback, useEffect, useState } from 'react';
import { AgentEditor, AGENT_BLANK } from './settings/AgentsTab.jsx';
import { Icon } from './Icons.jsx';
import { liveAgents } from '../lib/agents.js';
import TeamRoom from './teams/TeamRoom.jsx';
import DeploySheet from './teams/DeploySheet.jsx';
import { Avatar, Stack, LEAD, teamState, pendingAsks, splitFiles } from './teams/parts.jsx';

const GENERAL = 'General';
// The room with every agent is an ordinary team, told apart by this goal. Nothing runs until you write in it.
const GENERAL_GOAL = 'The shared chat with all agents. Do what the user asks in each message; there is no other goal.';
const isGeneral = (t) => t.goal === GENERAL_GOAL;
const SEEN_KEY = 'artemis.teamSeen';
const readSeen = () => { try { return JSON.parse(localStorage.getItem(SEEN_KEY)) || {}; } catch { return {}; } };
const chatMsgs = (t) => ((t.run && t.run.messages) || []).filter((m) => m.kind !== 'status');
const preview = (m) => { const { text, files } = splitFiles(m.text); return String(text || (files.length ? `${files.length} file${files.length === 1 ? '' : 's'}` : '')).replace(/\s+/g, ' ').slice(0, 90); };

// The conversation you had open: the page unmounts when you switch tabs or pages, and comes back to the same one.
let lastOpen = null;
let pendingSheet = null;
/** Other pages (a project) open a team's room or a new-team sheet here before switching to the Agents page. */
export const agentsIntent = { room: (id) => { lastOpen = id; pendingSheet = null; }, newTeam: (projectId) => { lastOpen = null; pendingSheet = { projectId }; } };

function Row({ on, unread, avatar, name, time, sub, dot, onClick, ask }) {
  return (
    <button type="button" className={`tm-row ${on ? 'on' : ''}`} aria-current={on || undefined} onClick={onClick}>
      {avatar}
      <span className="tm-row-b">
        <span className="tm-row-t"><b>{name}</b>{time ? <small>{time}</small> : null}</span>
        <span className={`tm-row-s ${ask ? 'ask' : ''}`}>{dot !== undefined && <i className={`tm-dot ${dot}`} />}<span>{sub}</span></span>
      </span>
      {unread > 0 && <span className="tm-unread" aria-label={`${unread} unread`}>{unread > 99 ? '99+' : unread}</span>}
    </button>
  );
}

const stamp = (t) => { const d = new Date(t), n = new Date(); return d.toDateString() === n.toDateString() ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' }); };

/** Agents, as a messenger: conversations on the left (what needs you, General, teams, each agent), the open one on the right. */
export default function AgentsView({ settings, chats, runningIds, groups, onOpenChat, projects = [], avatar = null, onOpenNotifications }) {
  const api = window.api;
  const chatGroups = groups.filter((g) => !/^(Image|Video)/.test(g.label));
  const [teams, setTeams] = useState([]);
  const [roster, setRoster] = useState([]);
  const [open, setOpenRaw] = useState(() => lastOpen); // a team id, or 'dm:Name'
  const setOpen = (id) => { lastOpen = id; setOpenRaw(id); };
  const [sheet, setSheet] = useState(() => { const s0 = pendingSheet; pendingSheet = null; return s0; }); // team being created ({}) or edited
  const [editing, setEditing] = useState(null); // agent in the editor
  const [seen, setSeen] = useState(readSeen);
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const [, tick] = useState(0);

  const loadRoster = useCallback(async () => { try { setRoster(await api.agentsList()); } catch {} }, []);
  useEffect(() => {
    api.teamsList().then((l) => setTeams(Array.isArray(l) ? l : [])).catch(() => {});
    loadRoster();
    const offT = api.onTeamsChanged((t) => setTeams((l) => (l.some((x) => x.id === t.id) ? l.map((x) => (x.id === t.id ? t : x)) : [t, ...l])));
    const offA = api.onAgentsChanged && api.onAgentsChanged(loadRoster);
    const timer = setInterval(() => tick((n) => n + 1), 30000);
    return () => { offT && offT(); offA && offA(); clearInterval(timer); };
  }, []);

  const general = teams.find(isGeneral);
  /** The General room exists once you open it, and always holds the whole roster. */
  const ensureGeneral = async () => {
    const members = roster.map((a) => ({ name: a.name, model: a.model || '' }));
    const same = general && general.members.length === members.length && members.every((m) => general.members.some((x) => x.name === m.name));
    if (same) return general;
    const res = await api.teamsSave({ ...(general ? { id: general.id } : {}), name: GENERAL, goal: GENERAL_GOAL, members, mode: 'lead', reviewer: '' });
    if (!res || res.ok === false) { setErr((res && res.error) || 'Could not open General.'); return null; }
    setErr('');
    setTeams((l) => (l.some((x) => x.id === res.team.id) ? l.map((x) => (x.id === res.team.id ? res.team : x)) : [res.team, ...l]));
    return res.team;
  };
  const openGeneral = async (dm) => { const t = await ensureGeneral(); if (t) { setEditing(null); setOpen(dm ? 'dm:' + dm : t.id); } };

  const dm = open && open.startsWith('dm:') ? open.slice(3) : '';
  const room = dm ? general : open && teams.find((t) => t.id === open);
  const lastT = room ? (chatMsgs(room).slice(-1)[0] || {}).t || 0 : 0;
  useEffect(() => {
    if (!room || !lastT || seen[room.id] >= lastT) return;
    const next = { ...seen, [room.id]: lastT };
    setSeen(next);
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(next)); } catch {}
  }, [room && room.id, lastT]);

  const closeSheet = (team, how) => {
    setSheet(null);
    if (how && how.deleted) { setTeams((l) => l.filter((x) => x.id !== (sheet && sheet.id))); setOpen(null); return; }
    if (team) { setTeams((l) => (l.some((x) => x.id === team.id) ? l.map((x) => (x.id === team.id ? team : x)) : [team, ...l])); if (how && how.start) setOpen(team.id); }
  };
  const sheetEl = sheet && <DeploySheet team={sheet} roster={roster} chatGroups={chatGroups} projects={projects} onDone={closeSheet} onNewAgent={() => { setSheet(null); setEditing({ ...AGENT_BLANK }); }} />;

  const hit = (s) => !q.trim() || String(s).toLowerCase().includes(q.trim().toLowerCase());
  const unreadOf = (t) => chatMsgs(t).filter((m) => m.from !== 'you' && m.t > (seen[t.id] || 0)).length;
  const busyIn = (name) => { for (const t of teams) { const l = Object.values((t.run && t.run.live) || {}).find((x) => x.name === name); if (l) return { team: t, what: l.what }; } return null; };
  const needsYou = (t) => pendingAsks(t).length > 0 || (t.run && t.run.status === 'paused');
  const teamRow = (t) => {
    const st = teamState(t);
    const ask = pendingAsks(t)[0];
    const last = chatMsgs(t).slice(-1)[0];
    const sub = ask ? `${ask.from} wants to: ${ask.text}` : last ? `${last.from === 'you' ? 'You' : last.from}: ${preview(last)}` : st.label;
    const gen = isGeneral(t);
    return <Row key={t.id} on={!dm && open === t.id} unread={open === t.id ? 0 : unreadOf(t)} ask={!!ask} avatar={gen ? <span className="tm-av tm-group"><Icon name="users" size={15} /></span> : <Stack names={[LEAD, ...t.members.map((m) => m.name)].slice(0, 2)} />} name={t.name} time={last ? stamp(last.t) : ''} sub={sub} dot={gen && !(t.run && t.run.status) ? undefined : st.dot} onClick={() => { setEditing(null); if (gen) openGeneral(); else setOpen(t.id); }} />;
  };

  const visible = teams.filter((t) => hit(t.name));
  const asking = visible.filter((t) => needsYou(t));
  const others = visible.filter((t) => !needsYou(t) && !isGeneral(t));
  const agents = roster.filter((a) => hit(a.name) || hit(a.role || ''));
  const live = liveAgents(chats, runningIds);

  return (
    <div className="tm-msgr">
      <aside className="tm-list" aria-label="Conversations">
        <div className="tm-list-h">
          <h1>Agents</h1>
          <button type="button" className="tm-ib" aria-label="Notifications" title="Notifications" onClick={onOpenNotifications}><Icon name="bell" size={15} /></button>
          <button type="button" className="tm-ib" aria-label="New agent" title="New agent" onClick={() => setEditing({ ...AGENT_BLANK })}><Icon name="plus" size={15} /></button>
          <button type="button" className="tm-ib" aria-label="Deploy a team" title="Deploy a team" onClick={() => setSheet({})}><Icon name="users" size={15} /></button>
        </div>
        <input className="tm-find" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search conversations" />
        {err && <div className="tm-err" role="alert">{err}</div>}
        <div className="tm-rows">
          {asking.length > 0 && <><div className="tm-sec">Needs you</div>{asking.map(teamRow)}</>}
          {hit(GENERAL) && !(general && needsYou(general)) && (general ? teamRow(general) : <Row avatar={<span className="tm-av tm-group"><Icon name="users" size={15} /></span>} name={GENERAL} sub="Everyone, in one chat" onClick={() => openGeneral()} />)}
          {others.length > 0 && <><div className="tm-sec">Teams</div>{others.map(teamRow)}</>}
          {agents.length > 0 && <><div className="tm-sec">Agents</div>{agents.map((a) => {
            const b = busyIn(a.name);
            return <Row key={a.slug + a.source} on={dm === a.name && !editing} avatar={<Avatar name={a.name} />} name={a.name} sub={b ? `${b.team.name} · ${b.what}` : a.role || 'Idle'} dot={b ? 'work' : ''} onClick={() => openGeneral(a.name)} />;
          })}</>}
          {live.length > 0 && <><div className="tm-sec">Helping in chats</div>{live.map((a, i) => <Row key={i} avatar={<Avatar name={a.name} />} name={a.name} sub={a.chatTitle} dot="work" onClick={() => onOpenChat(a.chatId)} />)}</>}
        </div>
      </aside>
      <div className="tm-pane">
        {editing ? (
          <div className="page agents-page">
            <div className="page-head"><h1>{editing.isNew ? 'New agent' : editing.name}</h1></div>
            <AgentEditor agent={editing} chatGroups={chatGroups} onDone={() => { setEditing(null); loadRoster(); }} />
          </div>
        ) : room ? (
          <TeamRoom key={open} team={room} roster={roster} you={settings.profileName || 'You'} youAvatar={avatar} dm={dm} general={isGeneral(room)} onEdit={() => { if (dm) setEditing({ ...roster.find((a) => a.name === dm) }); else setSheet(room); }} />
        ) : (
          <div className="tm-empty tm-pick"><b>Pick a conversation</b><span>Open General to talk to every agent, a team, or one agent directly.</span></div>
        )}
      </div>
      {sheetEl}
    </div>
  );
}
