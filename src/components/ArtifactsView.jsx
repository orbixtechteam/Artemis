import React, { useEffect, useMemo, useRef, useState } from 'react';
import PluginsView from './PluginsView.jsx';
import { Icon } from './Icons.jsx';
import { ArtifactPanel } from './SidePanel.jsx';
import { askConfirm } from '../lib/dialog.js';
import { ContextMenu } from './TabBar.jsx';

const api = window.api;
const KIND = { html: 'Web page', svg: 'SVG', markdown: 'Document', spreadsheet: 'Spreadsheet', code: 'Code' };
const ICON = { html: 'globe', svg: 'image', markdown: 'doc', spreadsheet: 'sheet', code: 'code' };
const fmtDate = (t) => { const d = new Date(t), now = new Date(); return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' }); };
const latest = (a) => String((a.versions && a.versions.length ? a.versions[a.versions.length - 1] : a.content) || '');

/** A small, non-interactive picture of the artifact: web pages and SVGs render scaled down (staged only once the card scrolls into view), the rest show their first lines. */
function Thumb({ a }) {
  const ref = useRef(null);
  const [src, setSrc] = useState('');
  const live = a.type === 'html' || a.type === 'svg';
  useEffect(() => {
    if (!live || !ref.current) return;
    let off = false;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      api.stageArtifact(latest(a), a.type).then((u) => { if (!off) setSrc(u); });
    }, { rootMargin: '200px' });
    io.observe(ref.current);
    return () => { off = true; io.disconnect(); };
  }, [live, a.id, a.versions && a.versions.length]);
  const text = live ? '' : latest(a).split('\n').slice(0, 14).join('\n');
  return (
    <span className="art-thumb" ref={ref}>
      <span className="art-win">
        {live ? (src ? <iframe title={a.title} src={src} sandbox="allow-scripts" tabIndex={-1} scrolling="no" /> : null) : <pre className={a.type === 'code' || a.type === 'spreadsheet' ? 'mono' : ''}>{text}</pre>}
      </span>
    </span>
  );
}

/** Every artifact from every chat in one place, newest chat first. Opening one shows it full page; its Chat button jumps to the chat with the artifact panel open. */
export default function ArtifactsView({ chats, onOpen, onDelete, initialSection = 'artifacts' }) {
  const [q, setQ] = useState('');
  const [hasPlugins, setHasPlugins] = useState(false);
  useEffect(() => { const load = () => api.pluginsList().then((l) => setHasPlugins(!!(l && l.length))).catch(() => {}); load(); const off = api.onPluginsChanged && api.onPluginsChanged(load); return () => off && off(); }, []);
  const [kind, setKind] = useState(initialSection === 'plugins' ? 'plugins' : 'all');
  useEffect(() => { if (initialSection === 'plugins') setKind('plugins'); }, [initialSection]);
  const [menu, setMenu] = useState(null); // right-click menu on a card
  const [open, setOpen] = useState(null); // { chatId, id }: the artifact shown full page, like Claude
  const items = useMemo(() => {
    const out = [];
    for (const c of chats || []) {
      if (c.incognito) continue;
      for (const a of Object.values(c.artifacts || {})) out.push({ a, chatId: c.id, chat: c.title, at: c.updatedAt || 0 });
    }
    return out.sort((x, y) => y.at - x.at);
  }, [chats]);
  const needle = q.trim().toLowerCase();
  const shown = items.filter((i) => (kind === 'all' || i.a.type === kind) && (!needle || (i.a.title + ' ' + i.chat).toLowerCase().includes(needle)));
  const remove = async (chatId, a) => {
    if (!(await askConfirm({ title: 'Delete artifact?', message: `"${a.title}" will be removed from its chat. This cannot be undone.`, confirmLabel: 'Delete', danger: true }))) return;
    if (open && open.id === a.id && open.chatId === chatId) setOpen(null);
    onDelete(chatId, a.id);
  };
  const kinds = ['all', ...Object.keys(KIND).filter((k) => items.some((i) => i.a.type === k))];

  if (open) {
    const c = (chats || []).find((x) => x.id === open.chatId);
    const a = c && c.artifacts && c.artifacts[open.id];
    return (
      <div className="art-full">
        <ArtifactPanel artifact={a} onClose={() => setOpen(null)} onChat={c ? () => onOpen(open.chatId, open.id) : undefined} />
      </div>
    );
  }
  return (
    <div className="art-page">
      <h1>Artifacts</h1>
      <div className="art-bar">
        <div className="art-tabs">
          {kinds.map((k) => <button key={k} className={`art-tab ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>{k === 'all' ? 'All' : KIND[k]}</button>)}
          <button className={`art-tab ${kind === 'plugins' ? 'on' : ''}`} onClick={() => setKind('plugins')}>Plugins</button>
        </div>
        <label className="art-search"><Icon name="search" size={15} /><input type="search" placeholder="Search" aria-label={kind === 'plugins' ? 'Search plugins' : 'Search artifacts'} value={q} onChange={(e) => setQ(e.target.value)} /></label>
      </div>
      {kind === 'plugins' ? <PluginsView q={q} /> : shown.length === 0 && !(kind === 'all' && hasPlugins) ? (
        <div className="muted art-empty">{items.length ? 'No match.' : 'No artifacts yet. Ask Artemis to build a page, a document or a table and it will show up here.'}</div>
      ) : (
        <div className="art-grid">
          {shown.map(({ a, chatId, chat, at }) => (
            <button key={chatId + a.id} className="art-card" onClick={() => setOpen({ chatId, id: a.id })}
              onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, items: [
                { label: 'Open', onClick: () => setOpen({ chatId, id: a.id }) },
                { label: 'Open chat', onClick: () => onOpen(chatId, a.id) },
                ...(onDelete ? [{ sep: true }, { label: 'Delete', danger: true, onClick: () => remove(chatId, a) }] : [])
              ] }); }} title={`${a.title} · ${chat}`}>
              <Thumb a={a} />
              {onDelete && <span role="button" className="art-del" title="Delete" aria-label={`Delete ${a.title}`} onClick={(e) => { e.stopPropagation(); remove(chatId, a); }}><Icon name="trash" size={14} /></span>}
              <span className="art-meta">
                <span className="art-ic"><Icon name={ICON[a.type] || 'artifact'} size={16} /></span>
                <span className="art-tx">
                  <span className="ti">{a.title}</span>
                  <span className="su">{KIND[a.type] || 'Artifact'}{at ? ` · ${fmtDate(at)}` : ''}{a.versions && a.versions.length > 1 ? ` · v${a.versions.length}` : ''}</span>
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
      {kind === 'all' && hasPlugins && <><h2 className="art-sub">Plugins</h2><PluginsView q={q} compact /></>}
      <ContextMenu menu={menu} onClose={() => setMenu(null)} />
    </div>
  );
}
