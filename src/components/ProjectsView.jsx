import React from 'react';
import { Icon } from './Icons.jsx';
import ProjectLogo from './ProjectLogo.jsx';
import Composer, { ChatPills } from './Composer.jsx';
import { dayGroup } from '../lib/history.js';
import { teamState } from './teams/parts.jsx';

const base = (p) => (p ? String(p).split(/[\\/]/).filter(Boolean).pop() : '');

export function ProjectsList({ projects, chats, onOpen, onNew, onPin }) {
  return (
    <div className="page">
      <div className="page-head">
        <h1>Projects</h1>
        <button className="primary-btn" onClick={onNew}><Icon name="plus" size={15} /> New project</button>
      </div>
      {projects.length === 0 ? (
        <div className="empty-card">
          <Icon name="folderPlus" size={28} />
          <p>Projects keep chats, instructions and a working folder together.</p>
          <button className="primary-btn" onClick={onNew}>Create your first project</button>
        </div>
      ) : (
        <div className="cards">
          {[...projects].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)).map((p) => {
            const n = chats.filter((c) => c.projectId === p.id).length;
            return (
              <button key={p.id} className="card" onClick={() => onOpen(p.id)}>
                <div className="card-title"><ProjectLogo logo={p.logo} size={16} /> {p.name}<span role="button" className={`card-pin ${p.pinned ? 'on' : ''}`} title={p.pinned ? 'Unpin' : 'Pin'} onClick={(e) => { e.stopPropagation(); onPin(p.id); }}><Icon name="pin" size={14} /></span></div>
                <div className="card-text">{p.instructions ? p.instructions.slice(0, 110) : 'No instructions yet'}</div>
                <div className="card-meta">
                  {p.folder && <span><Icon name="folderOpen" size={13} /> {base(p.folder)}</span>}
                  <span><Icon name="chat" size={13} /> {n} chat{n === 1 ? '' : 's'}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** The agent teams that work for this project: open one's room, or start a new team for it. */
function ProjectTeams({ projectId, onOpenTeam, onNewTeam }) {
  const [teams, setTeams] = React.useState([]);
  React.useEffect(() => {
    const api = window.api;
    if (!api.teamsList) return undefined;
    api.teamsList().then((l) => setTeams(Array.isArray(l) ? l : [])).catch(() => {});
    const off = api.onTeamsChanged && api.onTeamsChanged((t) => setTeams((l) => (l.some((x) => x.id === t.id) ? l.map((x) => (x.id === t.id ? t : x)) : [t, ...l])));
    return () => { off && off(); };
  }, []);
  const mine = teams.filter((t) => t.projectId === projectId);
  if (!onOpenTeam) return null;
  return (
    <>
      <div className="section-title proj-teams-head"><span>Agent teams</span><button type="button" className="link-btn" onClick={onNewTeam}><Icon name="plus" size={13} /> New team</button></div>
      {mine.length === 0 ? <div className="muted small">No team works for this project yet.</div> : (
        <div className="proj-chats">
          {mine.map((t) => {
            const st = teamState(t);
            return (
              <button key={t.id} className="proj-chat" onClick={() => onOpenTeam(t.id)}>
                <Icon name="layers" size={15} />
                <span className="t">{t.name}</span>
                <span className="muted small"><i className={`tm-dot ${st.dot}`} /> {st.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

export function ProjectPage({ project, chats, statusOf, onBack, onEdit, onSelect, onStartChat, groups = [], defaultModel = '', brains = [], settings = {}, onUsageDetails, onOpenSettings, sentinel = 'off', onSentinel, onOpenTeam, onNewTeam }) {
  const list = chats.filter((c) => c.projectId === project.id && c.messages.length).sort((a, b) => b.updatedAt - a.updatedAt);
  const [draft, setDraft] = React.useState({}); // choices for the chat the box below starts
  const up = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const brain = draft.brain !== undefined ? draft.brain : (settings.defaultBrain || '');
  const model = draft.model || defaultModel;
  return (
    <div className="page proj-page">
      <button className="link-btn" onClick={onBack}><Icon name="chevronRight" size={14} className="flip" /> All projects</button>
      <div className="page-head">
        <h1><ProjectLogo logo={project.logo} size={22} /> {project.name}</h1>
        <div className="head-actions">
          {project.folder && <button onClick={() => window.api.openPath(project.folder)}><Icon name="external" size={14} /> Open folder</button>}
          <button onClick={onEdit}><Icon name="sliders" size={14} /> Settings</button>
        </div>
      </div>
      {project.folder && <div className="muted small proj-path"><Icon name="folderOpen" size={14} /> {project.folder}</div>}
      {project.instructions && <div className="instr"><div className="instr-label">Instructions</div>{project.instructions}</div>}
      <div className="home-pills">
          <ChatPills stacked={false} brains={brains} brain={brain}
            onBrain={(v) => { const b = brains.find((x) => x.slug === v); up({ brain: v, ...(b && b.model ? { model: b.model } : {}) }); }}
            tools={draft.tools || 'on'} onTools={(v) => up({ tools: v })}
            agents={draft.agents || 'on'} onAgents={(v) => up({ agents: v })}
            perm={draft.perm || 'ask'} onPerm={(v) => up({ perm: v })}
            model={model} settings={settings} onUsageDetails={onUsageDetails} onOpenSettings={onOpenSettings}
            sentinel={sentinel} onSentinel={onSentinel} />
        </div>
        <Composer key={project.id} chatId={"draft:project:" + project.id} streaming={false} onSend={(t, a, x) => { onStartChat(t, a, { ...draft, brain, model, ...(x || {}) }); setDraft({}); }} onStop={() => {}} placeholder={`Start a chat in ${project.name}…`} sentinel={sentinel} onSentinel={onSentinel}
          model={model} onModel={(m) => up({ model: m })} groups={groups}
          settings={settings} onUsageDetails={onUsageDetails} onOpenSettings={onOpenSettings}
          tools={draft.tools || 'on'} onTools={(v) => up({ tools: v })} agents={draft.agents || 'on'} onAgents={(v) => up({ agents: v })}
          brains={brains} brain={brain} onBrain={(v) => up({ brain: v })} />
      <ProjectTeams projectId={project.id} onOpenTeam={onOpenTeam} onNewTeam={onNewTeam} />
      <div className="section-title">Chats</div>
      {list.length === 0 ? <div className="muted small">No chats in this project yet.</div> : (
        <div className="proj-chats">
          {list.map((c) => {
            const st = statusOf(c);
            return (
              <button key={c.id} className="proj-chat" onClick={() => onSelect(c.id)}>
                <Icon name={st === 'running' ? 'spinner' : st === 'awaiting' ? 'warning' : 'chat'} size={15} />
                <span className="t">{c.title}</span>
                <span className="muted small">{dayGroup(c.updatedAt)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
