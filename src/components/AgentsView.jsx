import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AgentEditor, AGENT_BLANK } from './settings/AgentsTab.jsx';
import { Icon } from './Icons.jsx';
import { liveAgents } from '../lib/agents.js';
import { teamsListChanged } from '../lib/teamsNeed.js';
import { labelFor, target } from './ToolCard.jsx';
import TeamRoom from './teams/TeamRoom.jsx';
import DeploySheet from './teams/DeploySheet.jsx';
import { Avatar, Stack, LEAD, teamState, pendingAsks, splitFiles, plain, usd, elapsed, plural, taskTitle } from './teams/parts.jsx';

const GENERAL = 'General';
// The room with every agent is an ordinary team, told apart by this goal. Nothing runs until you write in it.
const GENERAL_GOAL = 'The shared chat with all agents. Do what the user asks in each message; there is no other goal.';
const isGeneral = (t) => t.goal === GENERAL_GOAL;
const SEEN_KEY = 'artemis.teamSeen';
const readSeen = () => { try { return JSON.parse(localStorage.getItem(SEEN_KEY)) || {}; } catch { return {}; } };
const chatMsgs = (t) => ((t.run && t.run.messages) || []).filter((m) => m.kind !== 'status');
const preview = (m) => { const { text, files } = splitFiles(m.text); return plain(text || (files.length ? `${files.length} file${files.length === 1 ? '' : 's'}` : '')).slice(0, 160); };
const needsYou = (t) => pendingAsks(t).length > 0 || !!(t.run && (t.run.status === 'paused' || t.run.status === 'failed'));
const stamp = (t) => { const d = new Date(t), n = new Date(); return d.toDateString() === n.toDateString() ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' }); };

// The conversation you had open: the page unmounts when you switch tabs or pages, and comes back to the same one.
let lastOpen = null;
let pendingSheet = null;
const homeListeners = new Set();
/** Other pages open a team's room or a new-team sheet here before switching to the Agents page; the sidebar goes back to the overview. */
export const agentsIntent = {
  room: (id) => { lastOpen = id; pendingSheet = null; },
  newTeam: (projectId) => { lastOpen = null; pendingSheet = { projectId }; },
  home: () => { lastOpen = null; for (const f of homeListeners) f(); }
};

/** A card that opens something and may hold its own buttons (a <button> cannot hold buttons). */
function Card({ className = '', onOpen, label, children }) {
  return (
    <div role="button" tabIndex={0} aria-label={label} className={className} onClick={onOpen}
      onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); onOpen(); } }}>
      {children}
    </div>
  );
}
const stop = (fn) => (e) => { e.stopPropagation(); fn(); };

/** The room header's title: the open conversation's name, and a menu to jump to any other one. */
function Switcher({ title, items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (e.type === 'keydown' ? e.key === 'Escape' : !(ref.current && ref.current.contains(e.target))) setOpen(false); };
    window.addEventListener('mousedown', close); window.addEventListener('keydown', close);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', close); };
  }, [open]);
  return (
    <div className="tm-switch" ref={ref}>
      <button type="button" className="tm-switch-btn" aria-haspopup="menu" aria-expanded={open} title="Switch conversation" onClick={() => setOpen(!open)}>
        <h1>{title}</h1><Icon name="chevronUpDown" size={13} />
      </button>
      {open && (
        <div className="ctx-menu tm-switch-menu" role="menu">
          {items.map((it, i) => (it.head
            ? <div key={'h' + i} className="tm-switch-head">{it.head}</div>
            : <button type="button" role="menuitem" key={it.key} className={`ctx-item ${it.on ? 'on' : ''}`} onClick={() => { setOpen(false); it.onClick(); }}>
              {it.avatar}<span className="tm-switch-t"><b>{it.label}</b>{it.sub ? <small>{it.sub}</small> : null}</span>
              {it.unread ? <span className="tm-unread">{it.unread}</span> : it.dot ? <i className={`tm-dot ${it.dot}`} /> : null}
            </button>))}
        </div>
      )}
    </div>
  );
}

/** Agents: an overview of what needs you, the teams and the agents; a team, General or one agent opens full width. */
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
  const [err, setErr] = useState('');
  const [, tick] = useState(0);

  const loadRoster = useCallback(async () => { try { setRoster(await api.agentsList()); } catch {} }, []);
  useEffect(() => {
    api.teamsList().then((l) => setTeams(Array.isArray(l) ? l : [])).catch(() => {});
    loadRoster();
    const offT = api.onTeamsChanged((t) => setTeams((l) => (l.some((x) => x.id === t.id) ? l.map((x) => (x.id === t.id ? t : x)) : [t, ...l])));
    const offA = api.onAgentsChanged && api.onAgentsChanged(loadRoster);
    const timer = setInterval(() => tick((n) => n + 1), 30000); // elapsed times
    const home = () => { setOpenRaw(null); setEditing(null); };
    homeListeners.add(home);
    return () => { offT && offT(); offA && offA(); clearInterval(timer); homeListeners.delete(home); };
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
  const openTeam = (t) => { setEditing(null); if (isGeneral(t)) openGeneral(); else setOpen(t.id); };

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
    if (how && how.deleted) { setTeams((l) => l.filter((x) => x.id !== (sheet && sheet.id))); setOpen(null); teamsListChanged(); return; }
    // a team you just made or started opens; saving changes to another team keeps the room you were in
    if (team) { const made = !(sheet && sheet.id); setTeams((l) => (l.some((x) => x.id === team.id) ? l.map((x) => (x.id === team.id ? team : x)) : [team, ...l])); if ((how && how.start) || made) { setEditing(null); setOpen(team.id); } }
  };
  const sheetEl = sheet && <DeploySheet team={sheet} roster={roster} chatGroups={chatGroups} projects={projects} onDone={closeSheet} onNewAgent={() => { setSheet(null); setEditing({ ...AGENT_BLANK }); }} />;

  const unreadOf = (t) => chatMsgs(t).filter((m) => m.from !== 'you' && m.t > (seen[t.id] || 0)).length;
  const busyIn = (name) => { for (const t of teams) { const l = Object.values((t.run && t.run.live) || {}).find((x) => x.name === name); if (l) return { team: t, what: l.what }; } return null; };
  const projectName = (t) => (t.projectId ? (projects.find((p) => p.id === t.projectId) || {}).name || '' : '');
  const real = teams.filter((t) => !isGeneral(t));
  const asking = real.filter(needsYou).concat(general && needsYou(general) ? [general] : []);
  const others = real.filter((t) => !needsYou(t)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  // ---------- an agent in the editor ----------
  if (editing) {
    return (
      <div className="page agents-page">
        <button type="button" className="tm-crumb" onClick={() => setEditing(null)}><Icon name="chevronLeft" size={14} />{dm ? dm : 'Agents'}</button>
        <div className="page-head"><h1>{editing.isNew ? 'New agent' : editing.name}</h1></div>
        <AgentEditor agent={editing} chatGroups={chatGroups} onDone={() => { setEditing(null); loadRoster(); }} />
        {sheetEl}
      </div>
    );
  }

  // ---------- a room, full width ----------
  if (room) {
    const items = [];
    if (asking.length) items.push({ head: 'Needs you' }, ...asking.map((t) => ({ key: t.id, label: t.name, sub: teamState(t).label, dot: 'wait', avatar: <Stack names={[LEAD, ...t.members.map((m) => m.name)].slice(0, 2)} size="xs" />, on: !dm && t.id === room.id, onClick: () => openTeam(t) })));
    items.push({ head: 'Rooms' }, { key: 'general', label: GENERAL, sub: 'Everyone, in one chat', unread: general && general.id !== room.id ? unreadOf(general) : 0, avatar: <span className="tm-av tm-group xs"><Icon name="users" size={10} /></span>, on: !dm && general && general.id === room.id, onClick: () => openGeneral() });
    for (const t of others) items.push({ key: t.id, label: t.name, sub: teamState(t).label, unread: t.id === room.id ? 0 : unreadOf(t), dot: teamState(t).dot, avatar: <Stack names={[LEAD, ...t.members.map((m) => m.name)].slice(0, 2)} size="xs" />, on: !dm && t.id === room.id, onClick: () => openTeam(t) });
    if (roster.length) items.push({ head: 'Agents' }, ...roster.map((a) => ({ key: 'dm:' + a.name, label: a.name, sub: a.role || '', dot: busyIn(a.name) ? 'work' : '', avatar: <Avatar name={a.name} size="xs" />, on: dm === a.name, onClick: () => openGeneral(a.name) })));
    return (
      <div className="tm-full">
        <TeamRoom key={open} team={room} roster={roster} you={settings.profileName || 'You'} youAvatar={avatar} dm={dm} general={isGeneral(room)}
          onBack={() => setOpen(null)} title={<Switcher title={dm || room.name} items={items} />}
          onEdit={() => { if (dm) setEditing({ ...roster.find((a) => a.name === dm) }); else setSheet(room); }} />
        {sheetEl}
      </div>
    );
  }

  // ---------- the overview ----------
  const live = liveAgents(chats, runningIds);
  const working = real.filter((t) => t.run && t.run.status === 'working').length;

  const teamCard = (t) => {
    const st = teamState(t);
    const r = t.run || { tasks: [], messages: [], spent: { usd: 0 } };
    const total = r.tasks.length, done = r.tasks.filter((k) => k.status === 'done').length;
    const ask = pendingAsks(t)[0];
    const paused = r.status === 'paused' || r.status === 'failed';
    const last = [...r.messages].reverse().find((m) => m.kind !== 'status' && m.kind !== 'approval');
    const unread = unreadOf(t);
    const proj = projectName(t);
    const doing = r.tasks.find((k) => k.status === 'doing');
    return (
      <Card key={t.id} className={`tm-team ${ask || paused ? 'need' : ''}`} label={`Open ${t.name}`} onOpen={() => openTeam(t)}>
        <div className="tm-team-top">
          <Stack names={[LEAD, ...t.members.map((m) => m.name)]} />
          <b>{t.name}</b>
          {unread > 0 && <span className="tm-unread" aria-label={`${unread} unread`}>{unread > 99 ? '99+' : unread}</span>}
          <span className="tm-state"><i className={`tm-dot ${st.dot}`} />{st.label}</span>
        </div>
        <div className="tm-goal2">{proj ? <span className="tm-proj">{proj} · </span> : null}{t.goal}</div>
        {total > 0 && (
          <div className="tm-prog">
            <span className="tm-tr" role="progressbar" aria-label={`${t.name}: tasks done`} aria-valuenow={done} aria-valuemin={0} aria-valuemax={total}>
              {r.tasks.map((k) => <i key={k.id} className={k.status} />)}
            </span>
            <span>{done} of {total} done</span>
          </div>
        )}
        {ask ? (
          <div className="tm-last need">
            <Avatar name={ask.from} size="sm" />
            <span><b>{ask.from}</b> wants to: <code>{ask.text}</code></span>
            <span className="tm-acts"><button type="button" onClick={stop(() => api.decide(ask.approvalId, false))}>Deny</button><button type="button" className="primary" onClick={stop(() => api.decide(ask.approvalId, true))}>Allow</button></span>
          </div>
        ) : paused ? (
          <div className="tm-last need">
            <Icon name={r.status === 'failed' ? 'warning' : 'pause'} size={14} />
            <span>{r.status === 'failed' ? 'Stopped on an error. Open the room to see what happened.' : r.reason === 'budget' ? `Spent its ${usd((t.budgetUsd || 0) + (r.extraUsd || 0))} budget.` : r.reason === 'time' ? 'Reached its time limit.' : r.reason === 'tokens' ? 'Used its token budget.' : r.reason === 'restart' ? 'Artemis closed while it was working.' : 'Paused by you.'}</span>
            <span className="tm-acts"><button type="button" className="primary" onClick={stop(() => api.teamsResume(t.id))}>{r.status === 'failed' ? 'Try again' : 'Resume'}</button></span>
          </div>
        ) : r.status === 'working' && doing ? (
          <div className="tm-last"><Avatar name={doing.assignee} size="sm" /><span><b>{doing.assignee}</b> {taskTitle(doing)}</span></div>
        ) : last ? (
          <div className="tm-last">{last.from === 'you' ? <Avatar you name={settings.profileName || 'You'} src={avatar} size="sm" /> : <Avatar name={last.from} size="sm" />}<span><b>{last.from === 'you' ? 'You' : last.from}</b> {preview(last)}</span></div>
        ) : null}
        <div className="tm-meta">
          <span>{last ? stamp(last.t) : 'Not started'}</span>
          {r.spent && (r.spent.usd || r.spent.tokens) ? <span>{usd(r.spent.usd)}{t.budgetUsd ? ` of ${usd(t.budgetUsd + (r.extraUsd || 0))}` : ''}</span> : null}
          {r.status === 'working' ? <span>{elapsed(t)}</span> : null}
          {t.repeat ? <span><Icon name="clock" size={11} />{t.repeat.type === 'interval' ? `Every ${Math.round((t.repeat.every || 60) / 60)} h` : t.repeat.type === 'weekdays' ? 'Weekdays' : 'Daily'}</span> : null}
        </div>
      </Card>
    );
  };

  const genLast = general ? chatMsgs(general).slice(-1)[0] : null;
  const genUnread = general ? unreadOf(general) : 0;

  return (
    <div className="page agents-page tm-home">
      <div className="page-head">
        <h1>Agents</h1>
        <button type="button" className="tm-ib" aria-label="Notifications" title="Notifications" onClick={onOpenNotifications}><Icon name="bell" size={15} /></button>
        <button type="button" className="tm-btn" onClick={() => setEditing({ ...AGENT_BLANK })}><Icon name="plus" size={14} />New agent</button>
        <button type="button" className="primary-btn" onClick={() => setSheet({})}><Icon name="users" size={14} />New team</button>
      </div>
      {err && <div className="tm-err" role="alert">{err}</div>}

      {asking.length > 0 && <>
        <div className="tm-gh"><span>Needs you</span><small>{plural(asking.length, 'team')}</small></div>
        <div className="tm-teams">{asking.map(teamCard)}</div>
      </>}

      <div className="tm-gh"><span>Teams</span><small>{working ? `${working} working` : real.length ? '' : 'Give a few agents one goal'}</small></div>
      <div className="tm-teams">
        {others.map(teamCard)}
        <button type="button" className="tm-team new" onClick={() => setSheet({})}>
          <Icon name="plus" size={18} /><b>New team</b><small>Pick agents and give them one goal. Artemis plans the work, hands it out and keeps you posted.</small>
        </button>
      </div>

      <div className="tm-gh"><span>Talk to agents</span><small>Ask one directly, or everyone at once</small></div>
      <div className="tm-roster">
        <Card className="tm-ag general" label="Open General" onOpen={() => openGeneral()}>
          <span className="tm-ag-top"><span className="tm-av tm-group lg"><Icon name="users" size={17} /></span>{genUnread > 0 && <span className="tm-unread">{genUnread}</span>}</span>
          <b>{GENERAL}</b>
          <span className="tm-role">{genLast ? `${genLast.from === 'you' ? 'You' : genLast.from}: ${preview(genLast)}` : 'Everyone, in one chat'}</span>
        </Card>
        {roster.map((a) => {
          const b = busyIn(a.name);
          return (
            <Card key={a.slug + a.source} className="tm-ag" label={`Message ${a.name}`} onOpen={() => openGeneral(a.name)}>
              <span className="tm-ag-top"><Avatar name={a.name} size="lg" /><button type="button" className="tm-ib tm-ag-edit" aria-label={`Edit ${a.name}`} title={`Edit ${a.name}`} onClick={stop(() => setEditing({ ...a }))}><Icon name="sliders" size={13} /></button></span>
              <b>{a.name}</b>
              <span className="tm-role">{a.role || (a.builtin ? 'Built-in' : a.source)}</span>
              <span className="tm-now"><i className={`tm-dot ${b ? 'work' : ''}`} /><span>{b ? `${b.team.name} · ${b.what}` : 'Free'}</span></span>
            </Card>
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
