import React, { useEffect, useMemo, useRef, useState } from 'react';

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
      <Icon name={icon} size={15} className="row-icon" title={status === 'running' ? 'Running' : status === 'awaiting' ? 'Needs your approval' : undefined} />
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
  const navRef = useRef(null);
  const [navH, setNavH] = useState(() => { try { const v = parseInt(localStorage.getItem('artemis-nav-h') || localStorage.getItem('ares-nav-h'), 10); return v > 60 ? v : null; } catch { return null; } });
  const moreRef = useRef(null);
  // the menu can never be dragged shorter than the row that holds "More"
  const minNav = () => { const b = moreRef.current, n = navRef.current; if (!b || !n) return 60; return Math.ceil(b.getBoundingClientRect().bottom - n.getBoundingClientRect().top + n.scrollTop + 4); };
  useEffect(() => { if (navH != null) { const m = minNav(); if (navH < m) setNavH(m); } }, []); // (a saved menu height only applies while More is open: closed, the menu fits its rows, so no empty gap is left under "More")
  const openMore = () => setMore((m) => (m ? m : true));
  const closeMore = () => setMore((m) => (m ? false : m));
  const startSplit = (e) => {
    e.preventDefault();
    const y0 = e.clientY, h0 = navRef.current ? navRef.current.offsetHeight : 200;
    const max = () => Math.max(100, (navRef.current?.closest('.sidebar')?.clientHeight || 700) - 230);
    let cur = h0;
    const mv = (ev) => { cur = Math.round(Math.max(minNav(), Math.min(Math.max(max(), minNav()), h0 + ev.clientY - y0))); setNavH(cur); if (ev.clientY - y0 > 24) openMore(); else if (ev.clientY - y0 < -24) closeMore(); };
    const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); document.body.style.cursor = ''; try { localStorage.setItem('artemis-nav-h', String(cur)); } catch {} };
    document.body.style.cursor = 'row-resize';
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
  };
  const resetSplit = () => { setNavH(null); try { { localStorage.removeItem('artemis-nav-h'); localStorage.removeItem('ares-nav-h'); }; } catch {} };
  const [more, setMore] = useState(false); // More is closed every time the app starts (the open state is no longer remembered)
  const toggleMore = () => setMore((m) => !m);
  // opening or closing More moves the divider down or up to fit it (only when the menu height was set by hand)
  const firstMore = useRef(true);
  useEffect(() => {
    if (firstMore.current) { firstMore.current = false; return; }
    if (navH == null) return;
    requestAnimationFrame(() => {
      const n = navRef.current; if (!n) return;
      const cap = Math.max(100, (n.closest('.sidebar')?.clientHeight || 700) - 230);
      if (more) setNavH((h) => Math.max(h || 0, Math.min(cap, n.scrollHeight)));
      else setNavH(minNav());
    });
  }, [more]);
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
      <div className="drag" style={{ height: mac ? 34 : 6 }} />
      <div className="side-search"><Icon name="search" size={16} /><input type="search" placeholder="Search" aria-label="Search chats, notes and files" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <nav className="side-nav" ref={navRef} style={navH && more ? { height: navH, maxHeight: 'none', flex: 'none' } : undefined}>
        <button className="nav-item" data-nav="home" onClick={onHome}><Icon name="home" size={18} /> Home</button>
        <div className="nav-row">
          <button className="nav-item" onClick={onNewChat}><span className="nav-ico new"><Icon name="plus" size={15} /></span> New</button>
          <button className="nav-mini" onClick={onNewIncognito} title="New incognito chat: not saved, no memory" aria-label="New incognito chat: not saved, no memory"><Icon name="ghost" size={16} /></button>
        </div>
        <button className={`nav-item ${view === 'other' ? '' : ''}`} data-nav="projects" onClick={onProjects}><Icon name="folders" size={18} /> Projects</button>
        {onFiles && <button className="nav-item" data-nav="files" onClick={onFiles}><Icon name="folder" size={18} /> Files</button>}
        <button className="nav-item" data-nav="schedule" onClick={onSchedule}><Icon name="clock" size={18} /> Scheduled</button>
        <button ref={moreRef} className="nav-item muted-item" onClick={toggleMore} title={more ? 'Hide' : 'Skills, Agents, Automations, Sentinel, Connectors, Memory…'}>
          <Icon name={more ? 'chevronDown' : 'chevronRight'} size={18} /> More
          {!more && <span className="more-peek"><Icon name="sparkle" size={13} /><Icon name="user" size={13} /><Icon name="bolt" size={13} /><Icon name="terminal" size={13} />{agentCount ? <i className="dot" title={agentCount + ' agents running'} /> : null}</span>}
        </button>
        {more && (
          
          <div className="nav-more">
               <button className="nav-item" data-nav="skills" onClick={onSkills}><Icon name="sparkle" size={18} /> Skills</button>
        <button className="nav-item" data-nav="agents" onClick={onAgents}><Icon name="user" size={18} /> Agents{agentCount ? <span className="count" title={agentCount + " running"}>{agentCount}</span> : null}</button>
     
              {onAutomations && <button className="nav-item" data-nav="automations" onClick={onAutomations}><Icon name="bolt" size={18} /> Automations</button>}
        {onLogs && <button className="nav-item" data-nav="logs" onClick={onLogs}><Icon name="terminal" size={18} /> Logs</button>}
        {onSentinel && <button className={`nav-item ${sentinel !== 'off' ? 'on' : ''}`} onClick={onSentinel} title={`Talk to Artemis hands-free${sKey}`}><Icon name="mic" size={18} /> Sentinel<span className="count">{sentinel === 'off' ? 'Off' : 'On'}</span></button>}
        <button className="nav-item" data-nav="connectors" onClick={onConnectors}><Icon name="plug" size={18} /> Connectors{connectorCount ? <span className="count">{connectorCount}</span> : null}</button>
        <button className="nav-item" data-nav="memory" onClick={onMemory}><Icon name="bulb" size={18} /> Memory{memoryCount ? <span className="count">{memoryCount}</span> : null}</button>
        <button className="nav-item" onClick={onPermissions}><Icon name="shield" size={18} /> Permissions</button>

          </div>
        )}
      </nav>
      <div className="nav-split" onMouseDown={startSplit} onDoubleClick={resetSplit} title="Drag to resize the menu and the chat list. Double-click to reset."><span /></div>
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
        <button className="profile-btn" title="Profile and settings" aria-label="Profile and settings" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setGear({ x: r.left, y: r.top - 76, items: [{ label: 'Profile', onClick: onProfile }, { label: 'Settings', hint: '⌘,', onClick: onSettings }] }); }}>
          {profile.avatar ? <img className="avatar" src={profile.avatar} alt="" /> : <span className="avatar">{(profile.name || '').trim().slice(0, 1).toUpperCase() || <Icon name="user" size={15} />}</span>}
          <span className="side-user">{profile.name || 'Set up profile'}</span>
        </button>
        <span style={{ flex: 1 }} />
    <div className="foot-icons">
      <button title="Usage" aria-label="Usage" data-nav="usage" onClick={onUsage}><Icon name="chart" size={17} /></button>
      {onTerminal && <button title="Terminal (Ctrl/Cmd + `)" aria-label="Terminal (Ctrl/Cmd + `)" data-nav="terminal" onClick={onTerminal}><Icon name="terminal" size={17} /></button>}
    </div>
        <ContextMenu menu={gear} onClose={() => setGear(null)} />
      </div>
    </aside>
  );
}
