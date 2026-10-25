import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icons.jsx';

const api = window.api;
const fmtSize = (n) => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
const fmtDate = (t) => { const d = new Date(t), now = new Date(); return d.toDateString() === now.toDateString() ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' }); };
export const fileIcon = (f) => (f.kind === 'image' ? 'image' : 'file');
const readBytes = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(new Uint8Array(r.result)); r.onerror = rej; r.readAsArrayBuffer(file); });

/** Everything attached to chats lives here: browse, search, update in place, send to your phone, use in a chat. */
export default function FilesView({ onOpen, onUse, rev }) {
  const [items, setItems] = useState([]);
  const [root, setRoot] = useState('');
  const [q, setQ] = useState('');
  const [hits, setHits] = useState(null);
  const [note, setNote] = useState('');
  const [renaming, setRenaming] = useState(null);
  const [drag, setDrag] = useState(false);
  const noteT = useRef(0);

  const flash = (m) => { setNote(m); clearTimeout(noteT.current); noteT.current = setTimeout(() => setNote(''), 3500); };
  const load = useCallback(async () => {
    const r = await api.libList();
    if (r && r.ok) setItems(r.items);
    api.libRoot().then(setRoot).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load, rev]);
  useEffect(() => {
    if (q.trim().length < 2) { setHits(null); return; }
    const t = setTimeout(async () => { const r = await api.libSearch(q); setHits(r && r.ok ? r.results : []); }, 150);
    return () => clearTimeout(t);
  }, [q]);

  const shown = useMemo(() => hits || items, [hits, items]);
  const upload = async () => { const r = await api.libAdd(); if (r && r.ok && r.items.length) { flash(`Added ${r.items.length} file${r.items.length > 1 ? 's' : ''}.`); load(); } else if (r && !r.ok) flash(r.error); };
  const onDrop = async (e) => {
    e.preventDefault(); setDrag(false);
    let n = 0;
    for (const f of [...e.dataTransfer.files]) {
      try { const r = await api.libAddBuffer(f.name, await readBytes(f)); if (r && r.ok) n++; else if (r) flash(r.error); } catch (err) { flash(err.message); }
    }
    if (n) { flash(`Added ${n} file${n > 1 ? 's' : ''}.`); load(); }
  };
  const phone = async (f) => { const a = await api.libAbs(f.path); if (!a.ok) return flash(a.error); const r = await api.sendFileToPhone(a.path); flash(r.ok ? 'Sent to your phone.' : r.error || 'Could not send.'); };
  const replace = async (f) => { const r = await api.libReplace(f.path); if (r && r.ok && r.item) { flash('Updated. Chats that use this file see the new version.'); load(); } else if (r && !r.ok) flash(r.error); };
  const remove = async (f) => { if (!window.confirm(`Delete “${f.name}” from Files? This cannot be undone.`)) return; const r = await api.libDelete(f.path); if (r.ok) load(); else flash(r.error); };
  const commitRename = async () => {
    const r0 = renaming; setRenaming(null);
    if (!r0 || !r0.value.trim() || r0.value === r0.name) return;
    const r = await api.libRename(r0.path, r0.value.trim());
    if (r.ok) load(); else flash(r.error);
  };

  return (
    <div className={'files-page' + (drag ? ' dropping' : '')} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={(e) => { if (e.currentTarget === e.target) setDrag(false); }} onDrop={onDrop}>
      <div className="page-head">
        <h1>Files</h1>
        <button className="files-reveal" title={root} onClick={() => api.libReveal('')}>Show in folder</button>
        <button className="primary" onClick={upload}><Icon name="upload" size={14} /> Upload</button>
      </div>
      <p className="page-sub">Files you attach in chats are kept here. Use them again with <kbd>@</kbd> in any chat, or ask Artemis to read and edit them.</p>
      <div className="files-search"><Icon name="search" size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search names and contents" spellCheck={false} /></div>
      {note && <div className="files-note">{note}</div>}
      <div className="files-list">
        {shown.map((f) => (
          <div key={f.path} className="files-row" onClick={() => onOpen(f.path)}>
            <span className="files-ic"><Icon name={fileIcon(f)} size={16} /></span>
            <div className="files-main">
              {renaming && renaming.path === f.path
                ? <input className="note-rename" autoFocus value={renaming.value} onClick={(e) => e.stopPropagation()} onFocus={(e) => e.target.select()} onChange={(e) => setRenaming({ ...renaming, value: e.target.value })} onBlur={commitRename}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') { setRenaming({ ...renaming, value: renaming.name }); e.currentTarget.blur(); } }} />
                : <div className="files-name">{f.name}</div>}
              {f.snippet ? <div className="files-snip">{f.snippet}</div> : null}
            </div>
            <span className="files-meta">{(f.ext || '').toUpperCase()}</span>
            <span className="files-meta">{fmtSize(f.size)}</span>
            <span className="files-meta">{fmtDate(f.mtime)}</span>
            <div className="files-actions" onClick={(e) => e.stopPropagation()}>
              <button title="Use in a chat" aria-label="Use in a chat" onClick={() => onUse(f.path)}><Icon name="plus" size={14} /></button>
              <button title="Send to phone" aria-label="Send to phone" onClick={() => phone(f)}><Icon name="phone" size={14} /></button>
              <button title="Update with a new version" aria-label="Update with a new version" onClick={() => replace(f)}><Icon name="refresh" size={14} /></button>
              <button title="Rename" aria-label="Rename" onClick={() => setRenaming({ path: f.path, name: f.name, value: f.name })}><Icon name="pencil" size={14} /></button>
              <button title="Open with the default app" aria-label="Open with the default app" onClick={() => api.libOpen(f.path)}><Icon name="external" size={14} /></button>
              <button title="Delete" aria-label="Delete" onClick={() => remove(f)}><Icon name="trash" size={14} /></button>
            </div>
          </div>
        ))}
        {!shown.length && <div className="muted files-empty">{q ? `No files match “${q}”.` : 'No files yet. Upload one, drop it here, or attach it in a chat.'}</div>}
      </div>
    </div>
  );
}
