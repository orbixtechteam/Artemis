import React, { useEffect, useMemo, useState } from 'react';

// rows built from divs act like buttons for the keyboard too
const asButton = (fn) => ({ role: 'button', tabIndex: 0, onKeyDown: (e) => { if (e.target !== e.currentTarget) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(e); } } });
import { dayGroup } from '../lib/history.js';
import { Icon } from './Icons.jsx';
import ProjectLogo from './ProjectLogo.jsx';
import NotesSection from './NotesSection.jsx';
import TitleText from './TitleText.jsx';
import { ContextMenu } from './TabBar.jsx';
import { useSentinelKey } from '../lib/sentinelKey.js';

function ChatRow({ c, active, status, inProject, onSelect, onRename, onPin }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(c.title);
  const finish = (ok) => {
    setEditing(false);
    if (ok && val.trim()) onRename(c.id, val.trim().slice(0, 80));
  };
  const icon = status === 'running' ? 'spinner' : status === 'awaiting' ? 'warning' : c.incognito ? 'ghost' : c.sentinel ? 'mic' : inProject ? 'folder' : c.source === 'phone' ? 'phone' : c.source === 'schedule' ? 'clock' : 'chat';
  return (
    <div className={`chat-item ${active ? 'active' : ''} ${status || ''}`} data-chat={c.id} onClick={() => onSelect(c.id)} {...asButton(() => onSelect(c.id))} aria-current={active ? 'page' : undefined}>
      {icon !== 'chat' && <Icon name={icon} size={14} className="row-icon" title={status === 'running' ? 'Running' : status === 'awaiting' ? 'Needs your approval' : undefined} />}
      {editing ? (
        <input
          className="rename" autoFocus value={val}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setVal(e.target.value)}
          onBlur={() => finish(true)}
          onKeyDown={(e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); }}
        />
      ) : (
        <TitleText className="t" text={c.title} onDoubleClick={(e) => { e.stopPropagation(); setVal(c.title); setEditing(true); }} />
      )}
      <button className={`x pin ${c.pinned ? 'on' : ''}`} title={c.pinned ? 'Unpin' : 'Pin'} aria-label={c.pinned ? `Unpin ${c.title}` : `Pin ${c.title}`} onClick={(e) => { e.stopPropagation(); onPin(c.id); }}><Icon name="pin" size={14} /></button>
    </div>
  );
}

/** Collapsible section header used by Pinned projects, Pinned chats and Projects (Notes has its own, same look). */
function SideHead({ label, open, onToggle }) {
  return (
    <div className="side-head" onClick={onToggle} {...asButton(onToggle)} aria-expanded={open}>
      <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} />
      <span>{label}</span>
    </div>
  );
}

export default function Sidebar({
  chats, projects = [], currentId, view, statusOf, onNewChat, onNewIncognito, onSelect, onRename, onPinChat, onPinProject, onOpenProject,
  onHome, onFiles, onOpenFile, onProjects, onConnectors, onSettings, onMemory, onUsage, onBrowser, onTerminal, notes, onSchedule, onSkills, onAgents, onAutomations, onSentinel, sentinel = 'off', onLogs, agentCount = 0, onPermissions, onProfile, profile = {}, view_, memoryCount, connectorCount, hidden, onResizeStart
}) {
  const sKey = useSentinelKey();
  const [q, setQ] = useState('');
  const [dq, setDq] = useState(''); // the search as used for filtering: follows typing after a short pause
  useEffect(() => { const t = setTimeout(() => setDq(q), 150); return () => clearTimeout(t); }, [q]);
  const [gear, setGear] = useState(null);
  const [found, setFound] = useState({ notes: [], files: [] }); // search also looks inside notes and the Files library
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setFound({ notes: [], files: [] }); return undefined; }
    let live = true;
    const t = setTimeout(async () => {
      const [n, f] = await Promise.all([window.api.notesSearch(term).catch(() => null), window.api.libSearch(term).catch(() => null)]);
      if (live) setFound({ notes: n && n.ok ? n.results.slice(0, 6) : [], files: f && f.ok ? f.results.slice(0, 6) : [] });
    }, 180);
    return () => { live = false; clearTimeout(t); };
  }, [q]);
  // Workspace (agents, skills, automations …) is a section that can be folded away; it starts open
  const [work, setWork] = useState(() => { try { return localStorage.getItem('artemis-side-work') !== '0'; } catch { return true; } });
  const toggleWork = () => setWork((w) => { try { localStorage.setItem('artemis-side-work', w ? '0' : '1'); } catch {} return !w; });
  const [openProjects, setOpenProjects] = useState(() => {
    try { return JSON.parse(localStorage.getItem('zero-open-projects') || '{}'); } catch { return {}; }
  });
  const mac = window.api.platform === 'darwin';
  const toggleProject = (id) => setOpenProjects((old) => {
    const next = { ...old, [id]: old[id] === undefined ? false : !old[id] };
    try { localStorage.setItem('zero-open-projects', JSON.stringify(next)); } catch {}
    return next;
  });
  useEffect(() => {
    // Keep newly created/imported projects visible without forcing old sections open.
    setOpenProjects((old) => {
      const next = { ...old };
      projects.forEach((p) => { if (next[p.id] === undefined) next[p.id] = true; });
      return next;
    });
  }, [projects.length]);
  const [shut, setShut] = useState(() => { try { return JSON.parse(localStorage.getItem('artemis-side-shut') || '{}'); } catch { return {}; } });
  const toggleSec = (k) => setShut((old) => { const next = { ...old, [k]: !old[k] }; try { localStorage.setItem('artemis-side-shut', JSON.stringify(next)); } catch {} return next; });
  const ql = dq.trim().toLowerCase();
  const secOpen = (k) => !!ql || !shut[k]; // searching always shows everything
  const visible = useMemo(() => chats
    .filter((c) => !ql || c.title.toLowerCase().includes(ql) ||
      c.messages.some((m) => (m.content || '').toLowerCase().includes(ql) || (m.steps || []).some((s) => (s.text || '').toLowerCase().includes(ql))))
    .sort((a, b) => b.updatedAt - a.updatedAt), [chats, ql]);

  const rows = [];
  const pinnedChats = visible.filter((c) => c.pinned);
  const pinnedProjects = ql ? [] : projects.filter((p) => p.pinned);
  if (pinnedProjects.length) {
    rows.push(<SideHead key="pinned-projects" label="Pinned projects" open={secOpen('pinnedProjects')} onToggle={() => toggleSec('pinnedProjects')} />);
    for (const p of secOpen('pinnedProjects') ? pinnedProjects : []) {
      rows.push(
        <div key={'p' + p.id} className="chat-item" data-project={p.id} onClick={() => onOpenProject(p.id)} {...asButton(() => onOpenProject(p.id))}>
          <ProjectLogo logo={p.logo} size={15} />
          <span className="t">{p.name}</span>
          <button className="x pin on" title="Unpin" aria-label={`Unpin ${p.name}`} onClick={(e) => { e.stopPropagation(); onPinProject(p.id); }}><Icon name="pin" size={14} /></button>
        </div>
      );
    }
  }
  if (pinnedChats.length) {
    rows.push(<SideHead key="pinned" label="Pinned chats" open={secOpen('pinnedChats')} onToggle={() => toggleSec('pinnedChats')} />);
    for (const c of secOpen('pinnedChats') ? pinnedChats : []) {
      rows.push(
        <ChatRow key={c.id} c={c} active={view === 'chat' && c.id === currentId} status={statusOf(c)} inProject={!!c.projectId}
          onSelect={onSelect} onRename={onRename} onPin={onPinChat} />
      );
    }
  }
  const unassigned = visible.filter((x) => !x.pinned && !x.projectId);
  const projectList = projects.filter((p) => visible.some((c) => !c.pinned && c.projectId === p.id));
  if (projectList.length) {
    rows.push(<SideHead key="projects-head" label="Projects" open={secOpen('projects')} onToggle={() => toggleSec('projects')} />);
  }
  for (const p of secOpen('projects') ? projectList : []) {
    const items = visible.filter((c) => !c.pinned && c.projectId === p.id);
    const isOpen = ql || openProjects[p.id] !== false;

    rows.push(
      <div key={'pg' + p.id} className={`project-group ${isOpen ? 'open' : 'closed'}`}>
        <div className="project-group-head" data-project={p.id} onClick={() => toggleProject(p.id)} {...asButton(() => toggleProject(p.id))} aria-expanded={!!isOpen}>
          <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} size={13} className="project-chevron" />
          <ProjectLogo logo={p.logo} size={15} />
          <span className="t" onDoubleClick={(e) => { e.stopPropagation(); onOpenProject(p.id); }}>{p.name}</span>
          <button className="project-open" title="Open project" aria-label={`Open project ${p.name}`} onClick={(e) => { e.stopPropagation(); onOpenProject(p.id); }}><Icon name="external" size={13} /></button>
        </div>
        {isOpen && <div className="project-submenu">
          {items.map((c) => <ChatRow key={c.id} c={c} active={view === 'chat' && c.id === currentId} status={statusOf(c)} inProject
            onSelect={onSelect} onRename={onRename} onPin={onPinChat} />)}
        </div>}
      </div>
    );
  }
  let last = '';
  for (const c of unassigned) {
    const g = dayGroup(c.updatedAt);
    if (g !== last) { rows.push(<div key={'g' + g} className="group-label">{g}</div>); last = g; }
    rows.push(<ChatRow key={c.id} c={c} active={view === 'chat' && c.id === currentId} status={statusOf(c)} inProject={false}
      onSelect={onSelect} onRename={onRename} onPin={onPinChat} />);
  }

  return (
    <aside className={`sidebar ${hidden ? 'hidden' : ''}`}>
      {!hidden && <div className="resize-grip right" onMouseDown={onResizeStart} title="Drag to resize" />}
      <div className={`side-top drag ${mac ? 'mac' : ''}`}>
        <span className="sp" />
        <button className="side-ib nodrag" onClick={onNewIncognito} title="New incognito chat: not saved, no memory" aria-label="New incognito chat: not saved, no memory"><Icon name="ghost" size={16} /></button>
        <button className="side-ib nodrag" onClick={onNewChat} title="New chat (⌘N)" aria-label="New chat"><Icon name="edit" size={16} /></button>
      </div>
      <div className="side-search"><Icon name="search" size={14} /><input type="search" placeholder="Search" aria-label="Search chats, notes and files" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <nav className="side-nav" aria-label="Main">
        <button className="nav-item" data-nav="home" onClick={onHome}><Icon name="home" size={16} /> Home</button>
        <button className="nav-item" data-nav="projects" onClick={onProjects}><Icon name="folders" size={16} /> Projects</button>
        {onFiles && <button className="nav-item" data-nav="files" onClick={onFiles}><Icon name="folder" size={16} /> Files</button>}
        <button className="nav-item" data-nav="schedule" onClick={onSchedule}><Icon name="clock" size={16} /> Scheduled</button>
        <SideHead label="Workspace" open={work} onToggle={toggleWork} />
        {work && (
          <div className="nav-more">
            <button className="nav-item" data-nav="agents" onClick={onAgents}><Icon name="user" size={16} /> Agents{agentCount ? <span className="count" title={agentCount + ' running'}>{agentCount}</span> : null}</button>
            <button className="nav-item" data-nav="skills" onClick={onSkills}><Icon name="sparkle" size={16} /> Skills</button>
            {onAutomations && <button className="nav-item" data-nav="automations" onClick={onAutomations}><Icon name="bolt" size={16} /> Automations</button>}
            <button className="nav-item" data-nav="connectors" onClick={onConnectors}><Icon name="plug" size={16} /> Connectors{connectorCount ? <span className="count">{connectorCount}</span> : null}</button>
            <button className="nav-item" data-nav="memory" onClick={onMemory}><Icon name="bulb" size={16} /> Memory{memoryCount ? <span className="count">{memoryCount}</span> : null}</button>
            {onSentinel && <button className={`nav-item ${sentinel !== 'off' ? 'on' : ''}`} onClick={onSentinel} title={`Talk to Artemis hands-free${sKey}`}><Icon name="mic" size={16} /> Sentinel<span className={`state ${sentinel !== 'off' ? 'on' : ''}`}>{sentinel === 'off' ? 'Off' : 'On'}</span></button>}
          </div>
        )}
      </nav>
      <div className="chat-list">
        {ql && found.notes.length > 0 && (
          <div className="found-group"><div className="found-title">Notes</div>
            {found.notes.map((h) => <div key={h.path} className="chat-item" title={h.snippet || h.path} onClick={() => notes && notes.onOpen(h.path, 'here')} {...asButton(() => notes && notes.onOpen(h.path, 'here'))}><Icon name="file" size={15} className="row-icon" /><span className="t">{h.name}</span></div>)}
          </div>
        )}
        {ql && found.files.length > 0 && (
          <div className="found-group"><div className="found-title">Files</div>
            {found.files.map((h) => <div key={h.path} className="chat-item" title={h.snippet || h.path} onClick={() => onOpenFile && onOpenFile(h.path)} {...asButton(() => onOpenFile && onOpenFile(h.path))}><Icon name={h.kind === 'image' ? 'image' : 'file'} size={15} className="row-icon" /><span className="t">{h.name}</span></div>)}
          </div>
        )}
        {notes && <NotesSection {...notes} />}
        {rows.length ? rows : <div className="muted pad">No chats</div>}
      </div>
      <div className="side-foot">
        <button className="profile-btn" title="Profile, usage and more" aria-label="Profile, usage and more" aria-haspopup="menu" onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const items = [
            { label: 'Profile', onClick: onProfile },
            { label: 'Settings', hint: '⌘,', onClick: onSettings },
            { sep: true },
            { label: 'Usage', onClick: onUsage },
            onTerminal && { label: 'Terminal', hint: '⌃`', onClick: onTerminal },
            onLogs && { label: 'Logs', onClick: onLogs },
            onPermissions && { label: 'Permissions', onClick: onPermissions },
          ].filter(Boolean);
          setGear({ x: r.left, y: r.top - 8 - items.length * 30, items });
        }}>
          {profile.avatar ? <img className="avatar" src={profile.avatar} alt="" /> : <span className="avatar">{(profile.name || '').trim().slice(0, 1).toUpperCase() || <Icon name="user" size={14} />}</span>}
          <span className="side-user">{profile.name || 'Set up profile'}</span>
        </button>
        <button className="side-ib" title="Settings (⌘,)" aria-label="Settings" data-nav="settings" onClick={onSettings}><Icon name="sliders" size={16} /></button>
        <ContextMenu menu={gear} onClose={() => setGear(null)} />
      </div>
    </aside>
  );
}
