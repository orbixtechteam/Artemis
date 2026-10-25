import React, { useEffect, useRef, useState } from 'react';
import { Icon } from '../Icons.jsx';

// The "@" menu of the team room, like the chat's: teammates, your other agents, tools, connectors, skills, files and notes.
// Choosing one puts "@Name" in the message; a teammate's name sends the message to that member, the rest tell the team what to use.
const TOOLS = [
  ['Make', 'Make.com scenarios: post, call your apps'], ['Browser', 'The browser, with the sites you signed in to'], ['Web', 'Search and read the web'],
  ['Memory', 'Long-term memory'], ['Phone', 'Send to your phone (Telegram)'], ['Commands', 'Run commands (in the sandbox when one is set)'], ['Scheduled', 'Scheduled tasks, heartbeats, webhooks']
];
const GROUPS = [['team', 'Team', 'user'], ['agent', 'Your agents', 'user'], ['tool', 'Tools', 'wrench'], ['connector', 'Connectors', 'plug'], ['skill', 'Skills', 'sparkle'], ['file', 'Files', 'file'], ['note', 'Notes', 'file']];

export function useMentionMenu({ text, setText, ta, members, lead, roster }) {
  const [items, setItems] = useState({ connectors: [], skills: [], files: [], notes: [] });
  const [sel, setSel] = useState(0);
  const [off, setOff] = useState(false);
  const m = /(?:^|\s)@([^\s@]*)$/.exec(text);
  const open = !!m && !off;
  const q = m ? m[1].toLowerCase() : '';
  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    Promise.all([window.api.mcpStatus().catch(() => []), window.api.skillsList().catch(() => []), window.api.libList().catch(() => null), window.api.notesList().catch(() => null)])
      .then(([cn, sk, fl, nt]) => {
        if (!live) return;
        setItems({
          connectors: (Array.isArray(cn) ? cn : []).filter((x) => x.state === 'connected' || x.status === 'connected' || (x.tools || []).length),
          skills: (sk || []).filter((x) => x.enabled !== false),
          files: fl && fl.ok ? fl.items || [] : [], notes: nt && nt.ok ? (nt.items || []).filter((x) => !x.dir) : []
        });
      });
    return () => { live = false; };
  }, [open]);
  useEffect(() => { setSel(0); }, [q, open]);
  useEffect(() => { if (!m) setOff(false); }, [!!m]);
  const has = (s) => !q || String(s || '').toLowerCase().includes(q);
  const entries = !open ? [] : [
    ...[lead, ...members].filter(has).map((n) => ({ kind: 'team', name: n, desc: n === lead ? 'Leads the team' : (roster.find((a) => a.name === n) || {}).role || 'Member' })),
    ...roster.filter((a) => !members.includes(a.name) && has(a.name)).map((a) => ({ kind: 'agent', name: a.name, desc: a.role || a.description || '' })),
    ...TOOLS.filter(([n]) => has(n)).map(([n, d]) => ({ kind: 'tool', name: n, desc: d })),
    ...items.connectors.filter((x) => has(x.name)).map((x) => ({ kind: 'connector', name: x.name, desc: `${(x.tools || []).length} tools` })),
    ...items.skills.filter((x) => has(x.name)).map((x) => ({ kind: 'skill', name: x.name, desc: x.description || '' })),
    ...items.files.filter((x) => has(x.name)).slice(0, 8).map((x) => ({ kind: 'file', name: x.name, insert: 'Files/' + x.path, desc: x.path })),
    ...items.notes.filter((x) => has(x.name || x.path)).slice(0, 8).map((x) => ({ kind: 'note', name: (x.name || x.path).replace(/\.md$/i, ''), insert: 'Notes/' + x.path, desc: x.path }))
  ];
  const choose = (e) => {
    if (!e) return;
    const base = text.replace(/(^|\s)@[^\s@]*$/, '$1');
    const token = String(e.insert || e.name).replace(/\s+/g, '_');
    const next = base + '@' + token + ' ';
    setText(next);
    setTimeout(() => { const el = ta.current; if (el) { el.focus(); el.setSelectionRange(next.length, next.length); } }, 0);
  };
  /** Keys while the menu is open; returns true when it used the key. */
  const onKey = (e) => {
    if (!open || !entries.length) return false;
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => (s + 1) % entries.length); return true; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => (s - 1 + entries.length) % entries.length); return true; }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); choose(entries[sel]); return true; }
    if (e.key === 'Escape') { e.preventDefault(); setOff(true); return true; }
    return false;
  };
  return { open: open && entries.length > 0, entries, sel, setSel, choose, onKey };
}

export function MentionMenu({ menu }) {
  const pop = useRef(null);
  useEffect(() => { const el = pop.current && pop.current.querySelector('.slash-item.on'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }); }, [menu.sel]);
  if (!menu.open) return null;
  return (
    <div className="slash-pop tm-mention-pop" ref={pop} role="listbox" aria-label="Mention">
      {GROUPS.map(([k, title, icon]) => {
        const rows = menu.entries.filter((e) => e.kind === k);
        if (!rows.length) return null;
        return (
          <div key={k}>
            <div className="slash-title">{title}</div>
            {rows.map((e) => {
              const i = menu.entries.indexOf(e);
              return (
                <button type="button" key={k + e.name + (e.insert || '')} role="option" aria-selected={i === menu.sel} className={`slash-item ${i === menu.sel ? 'on' : ''}`}
                  onMouseEnter={() => menu.setSel(i)} onMouseDown={(ev) => { ev.preventDefault(); menu.choose(e); }}>
                  <Icon name={icon} size={15} />
                  <span className="slash-name">{e.name}</span>
                  {e.desc && <span className="slash-desc">{e.desc}</span>}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
