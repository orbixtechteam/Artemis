import React, { useEffect, useMemo, useState } from 'react';
import { Icon } from './Icons.jsx';
import { ContextMenu } from './TabBar.jsx';

const parentOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const baseOf = (p) => p.split('/').pop().replace(/\.md$/i, '');
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const DRAG = 'text/artemis-note';

/**
 * The "Notes" block at the top of the sidebar: a collapsible tree of folders and notes that looks like the chat list.
 * onOpen(path, how) with how = 'here' | 'tab' | 'split'.
 */
export default function NotesSection({ items, root, active, onOpen, onNew, onNewFolder, onRename, onDelete, onMove, onPickRoot, onReveal, onGraph, graphActive }) {
  const [open, setOpen] = useState(() => lsGet('artemis-notes-open', false)); // folded by default; chats come first
  const [closed, setClosed] = useState(() => new Set(lsGet('artemis-notes-closed', [])));
  const [folder, setFolder] = useState('');      // where "new note" goes
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState(null);
  const [menu, setMenu] = useState(null);
  const [moveFor, setMoveFor] = useState(null);
  const [dropOn, setDropOn] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [renaming, setRenaming] = useState(null); // { path, value } while a name is being edited in place

  useEffect(() => lsSet('artemis-notes-open', open), [open]);
  useEffect(() => lsSet('artemis-notes-closed', [...closed]), [closed]);
  useEffect(() => {
    if (!q.trim()) { setHits(null); return undefined; }
    const t = setTimeout(async () => { const r = await window.api.notesSearch(q); setHits(r && r.ok ? r.results : []); }, 200);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => { if (folder && !items.some((i) => i.dir && i.path === folder)) setFolder(''); }, [items, folder]);

  const visible = useMemo(() => items.filter((it) => {
    let p = parentOf(it.path);
    while (p) { if (closed.has(p)) return false; p = parentOf(p); }
    return true;
  }), [items, closed]);
  const toggleDir = (p) => setClosed((c) => { const n = new Set(c); if (n.has(p)) n.delete(p); else n.add(p); return n; });

  const commitRename = () => {
    const r = renaming; setRenaming(null);
    if (!r) return;
    const base = it_base(r.path);
    const name = r.value.trim();
    if (name && name !== base) onRename(r.path, name);
  };
  const it_base = (p) => p.split('/').pop().replace(/\.md$/i, '');
  const click = (e, it) => {
    if (renaming) return;
    if (it.dir) { setFolder(it.path); toggleDir(it.path); return; }
    setFolder(parentOf(it.path));
    onOpen(it.path, e.metaKey || e.ctrlKey ? 'tab' : 'here');
  };
  const rowMenu = (e, it) => {
    e.preventDefault();
    const common = [
      { label: 'Rename', hint: 'Double-click', onClick: () => setRenaming({ path: it.path, value: it_base(it.path) }) },
      { label: 'Move to…', onClick: () => setMoveFor(it.path) },
      { label: 'Delete', danger: true, onClick: () => onDelete(it.path) }
    ];
    const items2 = it.dir
      ? [{ label: 'New note here', onClick: () => onNew(it.path) }, { label: 'New folder here', onClick: () => onNewFolder(it.path) }, { sep: true }, ...common]
      : [{ label: 'Open', onClick: () => onOpen(it.path, 'here') }, { label: 'Open in new tab', hint: '⌘-click', onClick: () => onOpen(it.path, 'tab') }, { label: 'Open in split view', onClick: () => onOpen(it.path, 'split') }, { sep: true }, ...common];
    setMenu({ x: e.clientX, y: e.clientY, items: items2 });
  };

  const dragProps = (path) => ({
    draggable: true,
    onDragStart: (e) => { e.dataTransfer.setData(DRAG, path); e.dataTransfer.setData('text/plain', path); e.dataTransfer.effectAllowed = 'move'; setTimeout(() => setDragging(true), 0); }, // changing the DOM inside dragstart makes Chromium cancel the drag
    onDragEnd: () => { setDragging(false); setDropOn(null); }
  });
  const dropProps = (folderPath) => ({
    onDragOver: (e) => { if (e.dataTransfer.types.includes(DRAG)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDropOn(folderPath); } },
    onDragLeave: () => setDropOn((d) => (d === folderPath ? null : d)),
    onDrop: (e) => { e.preventDefault(); const src = e.dataTransfer.getData(DRAG); setDropOn(null); setDragging(false); if (src) onMove(src, folderPath); }
  });

  return (
    <div className="notes-sec">
      <div className="side-head notes-head" onClick={() => setOpen((o) => !o)}>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} />
        <span className="notes-head-t">Notes</span>
        <span style={{ flex: 1 }} />
        <button title="New note" aria-label="New note" onClick={(e) => { e.stopPropagation(); setOpen(true); onNew(folder); }}><Icon name="plus" size={14} /></button>
        <button title="New folder" aria-label="New folder" onClick={(e) => { e.stopPropagation(); setOpen(true); onNewFolder(folder); }}><Icon name="folder" size={14} /></button>
        {onGraph && <button title="Graph view" aria-label="Graph view" className={graphActive ? 'on' : ''} onClick={(e) => { e.stopPropagation(); onGraph(); }}><Icon name="graph" size={14} /></button>}
        <button title="Search notes" aria-label="Search notes" className={searching ? 'on' : ''} onClick={(e) => { e.stopPropagation(); setOpen(true); setSearching((s) => { if (s) setQ(''); return !s; }); }}><Icon name="search" size={14} /></button>
      </div>
      {open && (
        <>
          {searching && <input className="notes-search" autoFocus placeholder="Search notes…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { setQ(''); setSearching(false); } }} />}
          <div className="notes-tree">
            {hits ? (
              hits.length ? hits.map((h) => (
                <div key={h.path} className={'chat-item note-hit' + (active === h.path ? ' active' : '')} onClick={(e) => onOpen(h.path, e.metaKey || e.ctrlKey ? 'tab' : 'here')} onContextMenu={(e) => rowMenu(e, { path: h.path, dir: false })}>
                  <Icon name="file" size={15} className="row-icon" />
                  <span className="t"><b>{h.name}</b>{h.snippet ? <small>{h.snippet}</small> : null}</span>
                </div>
              )) : <div className="muted small note-empty">No matches.</div>
            ) : (
              <>
                {visible.map((it) => (
                  <div key={it.path} className={'chat-item note-row' + (it.dir ? ' dir' : '') + (it.dir && dropOn === it.path ? ' drop' : '') + (!it.dir && active === it.path ? ' active' : '')}
                    style={{ paddingLeft: 10 + it.depth * 14 }} {...(renaming && renaming.path === it.path ? {} : dragProps(it.path))} {...dropProps(it.dir ? it.path : parentOf(it.path))}
                    onClick={(e) => click(e, it)} onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); setRenaming({ path: it.path, value: it_base(it.path) }); }} onContextMenu={(e) => rowMenu(e, it)}>
                    {it.dir && <Icon name={closed.has(it.path) ? 'chevronRight' : 'chevronDown'} size={12} className="note-chev" />}
                    <Icon name={it.dir ? 'folder' : 'file'} size={15} className="row-icon" />
                    {renaming && renaming.path === it.path
                      ? <input className="note-rename" autoFocus value={renaming.value} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} onFocus={(e) => e.target.select()}
                          onChange={(e) => setRenaming({ ...renaming, value: e.target.value })} onBlur={commitRename}
                          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') { setRenaming({ ...renaming, value: it_base(renaming.path) }); e.currentTarget.blur(); } }} />
                      : <span className="t" title="Double-click to rename">{it.name}</span>}
                  </div>
                ))}
                {dragging && <div className={'notes-root' + (dropOn === '' ? ' drop' : '')} {...dropProps('')}>Drop here to move to the top level</div>}
                {!items.length && <div className="muted small note-empty">No notes yet. Click + to write the first one.</div>}
              </>
            )}
          </div>
        </>
      )}
      <ContextMenu menu={menu} onClose={() => setMenu(null)} />
      {moveFor !== null && (
        <div className="notes-menu-back center" onMouseDown={() => setMoveFor(null)}>
          <div className="notes-move" onMouseDown={(e) => e.stopPropagation()}>
            <div className="notes-move-title">Move “{baseOf(moveFor)}” to</div>
            <div className="notes-move-list">
              <button disabled={parentOf(moveFor) === ''} onClick={() => { const p = moveFor; setMoveFor(null); onMove(p, ''); }}><Icon name="folder" size={14} /> Top level</button>
              {items.filter((i) => i.dir && i.path !== moveFor && !i.path.startsWith(moveFor + '/')).map((f) => (
                <button key={f.path} style={{ paddingLeft: 10 + f.depth * 14 }} disabled={parentOf(moveFor) === f.path} onClick={() => { const p = moveFor; setMoveFor(null); onMove(p, f.path); }}><Icon name="folder" size={14} /> {f.name}</button>
              ))}
              {!items.some((i) => i.dir) && <div className="muted small" style={{ padding: 10 }}>No folders yet. Create one with the folder button.</div>}
            </div>
            <div className="row"><button onClick={() => setMoveFor(null)}>Cancel</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
