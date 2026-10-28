import React, { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import SentinelPill from './SentinelPill.jsx';
import QuickChat from '../QuickChat.jsx';
import CommandPalette from './CommandPalette.jsx';
import { Icon } from './Icons.jsx';
import Markdown from './Markdown.jsx';
import { CodeView } from './SidePanel.jsx';
import { applyTextSize, applySettingsTheme, loadThemes } from '../lib/themes.js';
import { languageOf, viewKind } from '../lib/langs.js';
import { parseCsv, detectDelimiter, splitSheets } from '../lib/preview.js';

const IDLE_MS = 8000; // after the answer has been read: back to the pill after this long (unless pinned, hovered, typing, viewing or waiting for you)
const SIZES = ['S', 'M', 'L'];
const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch {} return null; };
const SUB = { html: 'Web page', svg: 'SVG', markdown: 'Document', spreadsheet: 'Spreadsheet', code: 'Code' };
const extOf = (n) => (String(n || '').split('.').pop() || '').toLowerCase();

/** A generated file (a path, loaded through the main process) or a screenshot / web image (a data: or https: URL). */
function useImageUrl(img) {
  const [url, setUrl] = useState(img.type === 'src' ? img.src : '');
  useEffect(() => {
    if (img.type === 'src') { setUrl(img.src); return undefined; }
    let off = false, made = '';
    window.api.loadMedia(img.path).then((r) => {
      if (off || !r) return;
      const bin = atob(r.base64); const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      made = URL.createObjectURL(new Blob([bytes], { type: r.mime })); setUrl(made);
    }).catch(() => {});
    return () => { off = true; if (made) URL.revokeObjectURL(made); };
  }, [img.type, img.src, img.path]);
  return url;
}
function Thumb({ img, onOpen }) {
  const url = useImageUrl(img);
  return (
    <button className="swc-thumb" title={img.label || 'Click to view'} onClick={() => onOpen({ type: 'image', img })}>
      {!url ? <span className="swc-load" /> : img.kind === 'video' ? <video src={url} muted playsInline /> : <img src={url} alt={img.label || 'image'} />}
    </button>
  );
}

/** Small table for CSV / spreadsheet previews (first 200 rows). */
function MiniTable({ rows }) {
  const shown = rows.slice(0, 200);
  return (
    <div className="swv-table">
      <table><tbody>{shown.map((r, i) => <tr key={i}>{r.map((c, j) => (i === 0 ? <th key={j}>{c}</th> : <td key={j}>{c}</td>))}</tr>)}</tbody></table>
      {rows.length > shown.length && <small className="dim">Showing 200 of {rows.length} rows.</small>}
    </div>
  );
}

/** Links in the widget open in the default browser (the main window never comes forward). */
const linkClick = (e) => {
  const a = e.target.closest && e.target.closest('a[href]');
  if (!a) return;
  e.preventDefault(); e.stopPropagation();
  const href = a.getAttribute('href') || '';
  if (/^https?:\/\//i.test(href) && window.api.openExternalUrl) window.api.openExternalUrl(href);
};

function ArtifactCard({ a, onOpen }) {
  return (
    <button className="swc-card" onClick={() => onOpen({ type: 'artifact', id: a.id })} title="Show it here">
      <span className="ic"><Icon name="artifact" size={15} /></span>
      <span className="tx"><b>{a.title}</b><small>Artifact · {SUB[a.type] || a.type || 'Artifact'}{a.versions > 1 ? ` · v${a.versions}` : ''}</small></span>
      <Icon name="eye" size={13} />
    </button>
  );
}
function FileCard({ f, onOpen }) {
  const ext = extOf(f.name);
  const icon = /^(xlsx|xls|csv|tsv|ods)$/.test(ext) ? 'sheet' : ext === 'pdf' ? 'pdf' : /^(docx?|rtf)$/.test(ext) ? 'doc' : /^(png|jpe?g|gif|webp|heic|svg)$/.test(ext) ? 'image' : 'file';
  return (
    <button className="swc-card" onClick={() => onOpen({ type: 'file', file: f })} title={f.path}>
      <span className="ic"><Icon name={icon} size={15} /></span>
      <span className="tx"><b>{f.name}</b><small>{f.kind === 'library' ? 'Files library' : f.kind === 'project' ? 'Project file' : 'File'}{ext ? ` · ${ext.toUpperCase()}` : ''}</small></span>
      <Icon name="eye" size={13} />
    </button>
  );
}

/** One message of the mini chat. */
function Bubble({ m, onOpen, last }) {
  if (m.role === 'user') {
    return (
      <div className="swm-user">
        {m.text && <p>{m.text}</p>}
        {(m.files || []).length > 0 && <div className="swc-cards">{m.files.map((f) => <FileCard key={f.kind + f.path} f={f} onOpen={onOpen} />)}</div>}
      </div>
    );
  }
  const tools = m.tools || [];
  return (
    <div className="swm-asst">
      {tools.length > 0 && (
        <details className="swm-tools">
          <summary>{m.running ? <span className="swc-spin" /> : <Icon name="check" size={11} />} {tools.length === 1 ? tools[0].label : `${tools.length} steps`}{m.running && tools.length > 1 ? ` · ${tools[tools.length - 1].label}` : ''}</summary>
          <ul>{tools.map((t) => <li key={t.id} className={t.status}>{t.label}</li>)}</ul>
        </details>
      )}
      {m.text ? <div className="swm-md"><Markdown text={m.text} caret={last && m.running} /></div> : (last && m.running && !tools.length ? <p className="dim">…</p> : null)}
      {(m.images || []).length > 0 && <div className="swc-imgs">{m.images.map((im, i) => <Thumb key={(im.path || '') + i + (im.src ? im.src.length : 0)} img={im} onOpen={onOpen} />)}</div>}
      {((m.artifacts || []).length > 0 || (m.files || []).length > 0) && (
        <div className="swc-cards">
          {(m.artifacts || []).map((a) => <ArtifactCard key={a.id} a={a} onOpen={onOpen} />)}
          {(m.files || []).map((f) => <FileCard key={f.kind + f.path} f={f} onOpen={onOpen} />)}
        </div>
      )}
      {m.error && <p className="swm-err">{m.error}</p>}
    </div>
  );
}

const SizeButton = createContext(null); // the S / M / L button, shown in every viewer's top bar

// The chat is re-sent ~10 times a second while an answer streams: only re-render (and re-parse the markdown of) messages that changed.
const bubbleKey = (m) => [m.role, m.text, m.error, m.running, (m.tools || []).map((t) => t.status).join(), (m.images || []).map((i) => i.path || (i.src || '').length).join(),
  (m.artifacts || []).map((a) => a.id + a.rev).join(), (m.files || []).map((f) => f.path).join()].join('\u0001');
const MemoBubble = React.memo(Bubble, (a, b) => a.last === b.last && a.onOpen === b.onOpen && bubbleKey(a.m) === bubbleKey(b.m));

/** Top bar of the viewer: back to the chat, the title, and actions. */
function ViewerHead({ title, sub, onBack, children }) {
  const sizeBtn = useContext(SizeButton);
  return (
    <div className="swv-head">
      <button className="sn-btn" title="Back to the chat" aria-label="Back to the chat" onClick={onBack}><Icon name="chevronLeft" size={13} /></button>
      <span className="swv-title" title={title}><b>{title}</b>{sub && <small>{sub}</small>}</span>
      {children}
      {sizeBtn}
    </div>
  );
}
function CopyButton({ text }) {
  const [done, setDone] = useState(false);
  if (text == null) return null;
  return <button className="swv-btn" title="Copy" onClick={() => { window.api.sentinelCopy(String(text)); setDone(true); setTimeout(() => setDone(false), 1200); }}><Icon name={done ? 'check' : 'copy'} size={12} /> {done ? 'Copied' : 'Copy'}</button>;
}

/** An artifact, rendered the way the app's side panel does it (staged artifact: URL in a sandboxed iframe for HTML / SVG). */
function ArtifactViewer({ id, rev, onBack }) {
  const api = window.api;
  const [a, setA] = useState(null);
  const [src, setSrc] = useState('');
  const [code, setCode] = useState(false);
  const [note, setNote] = useState('');
  useEffect(() => { let off = false; api.sentinelAsk('artifact', id).then((r) => { if (!off) setA(r || { missing: true }); }).catch(() => { if (!off) setA({ missing: true }); }); return () => { off = true; }; }, [id, rev]);
  const live = !!a && (a.type === 'html' || a.type === 'svg');
  useEffect(() => { let off = false; if (live && a.content) api.stageArtifact(a.content, a.type).then((u) => { if (!off) setSrc(u); }); return () => { off = true; }; }, [a, live]);
  const isSheet = !!a && a.type === 'spreadsheet';
  const isTable = isSheet || (!!a && a.type === 'code' && /^(csv|tsv)$/i.test(a.language || ''));
  const rows = useMemo(() => (!a || !isTable ? null : isSheet ? splitSheets(a.content)[0].rows : parseCsv(a.content, /^tsv$/i.test(a.language) ? '\t' : detectDelimiter(a.content, 'x.csv'))), [a, isTable, isSheet]);
  if (!a) return <><ViewerHead title="Loading…" onBack={onBack} /><div className="swv-body pad"><span className="swc-load" /></div></>;
  if (a.missing) return <><ViewerHead title="Artifact" onBack={onBack} /><div className="swv-body pad dim">This artifact is no longer available.</div></>;
  const save = async () => { const r = await api.saveArtifact({ title: a.title, kind: a.type, language: a.language, content: a.content }); if (r && r.ok) { setNote('Saved.'); setTimeout(() => setNote(''), 2000); } };
  const showCode = code || (a.type === 'code' && !isTable);
  return (
    <>
      <ViewerHead title={a.title} sub={`${SUB[a.type] || 'Artifact'}${a.versions > 1 ? ` · v${a.versions}` : ''}`} onBack={onBack}>
        {(a.type !== 'code' || isTable) && <button className={`swv-btn${code ? ' on' : ''}`} title={code ? 'Preview' : 'Code'} onClick={() => setCode(!code)}><Icon name={code ? 'eye' : 'code'} size={12} /></button>}
        <CopyButton text={a.content} />
        <button className="swv-btn" title="Download" onClick={save}><Icon name="download" size={12} /></button>
        <button className="swv-btn" title="Open in the app" onClick={() => api.sentinelAsk('openArtifact', a.id)}><Icon name="external" size={12} /></button>
      </ViewerHead>
      <div className={`swv-body${live && !showCode ? ' flush' : ''}`}>
        {showCode ? <CodeView text={a.content} language={a.language || (a.type === 'html' ? 'html' : a.type === 'svg' ? 'xml' : a.type === 'markdown' ? 'markdown' : 'code')} />
          : live ? (src ? <iframe className="swv-frame" title={a.title} sandbox="allow-scripts" src={src} /> : <div className="pad"><span className="swc-load" /></div>)
          : a.type === 'markdown' ? <div className="swm-md pad"><Markdown text={a.content} /></div>
          : rows ? <MiniTable rows={rows} /> : <CodeView text={a.content} language={a.language || 'code'} />}
      </div>
      {note && <div className="swv-note">{note}</div>}
    </>
  );
}

/** A quick look at a file: text, markdown, code, tables, images, HTML. Anything else gets "Open" / "Show in Finder". */
function FileViewer({ file, onBack }) {
  const api = window.api;
  const [a, setA] = useState(null);
  const [src, setSrc] = useState('');
  useEffect(() => {
    let off = false; setA(null); setSrc('');
    if (file.kind === 'path') { setA({ name: file.name, path: file.path, kind: 'binary', noPreview: true }); return undefined; }
    api.sentinelAsk('file', file).then((r) => { if (!off) setA(r || { name: file.name, kind: 'error', error: 'Could not read the file.' }); }).catch(() => { if (!off) setA({ name: file.name, kind: 'error', error: 'Could not read the file.' }); });
    return () => { off = true; };
  }, [file.kind, file.path]);
  const vk = a ? viewKind({ ...a, name: a.name || file.name }) : '';
  useEffect(() => { let off = false; if ((vk === 'html' || vk === 'svg') && a && a.text) api.stageArtifact(a.text, vk).then((u) => { if (!off) setSrc(u); }); return () => { off = true; }; }, [a, vk]);
  const rows = useMemo(() => (!a || a.text == null ? null : vk === 'table' ? parseCsv(a.text, detectDelimiter(a.text, a.name)) : vk === 'sheet' ? splitSheets(a.text)[0].rows : null), [a, vk]);
  const abs = a && a.path;
  const binary = a && (a.noPreview || a.kind === 'binary' || a.kind === 'archive');
  return (
    <>
      <ViewerHead title={file.name} sub={extOf(file.name).toUpperCase()} onBack={onBack}>
        {a && a.text != null && !binary && <CopyButton text={a.text} />}
        {abs && <button className="swv-btn" title="Open with the default app" onClick={() => api.openPath(abs)}><Icon name="external" size={12} /></button>}
        {abs && <button className="swv-btn" title="Show in Finder" onClick={() => api.revealPath(abs)}><Icon name="folderOpen" size={12} /></button>}
      </ViewerHead>
      <div className={`swv-body${src ? ' flush' : ''}`}>
        {!a ? <div className="pad"><span className="swc-load" /></div>
          : a.kind === 'error' ? <div className="pad swm-err">{a.error || 'Could not read the file.'}</div>
          : vk === 'image' && (a.dataUrl || a.url) ? <div className="swv-media"><img src={a.dataUrl || a.url} alt={a.name} /></div>
          : binary ? <div className="pad swv-none"><Icon name="file" size={28} /><p>No preview for this kind of file.</p><div className="swc-row"><button onClick={() => abs && api.openPath(abs)}>Open with default app</button><button onClick={() => abs && api.revealPath(abs)}>Show in Finder</button></div></div>
          : (vk === 'html' || vk === 'svg') ? (src ? <iframe className="swv-frame" title={a.name} sandbox="allow-scripts" src={src} /> : <div className="pad"><span className="swc-load" /></div>)
          : vk === 'markdown' ? <div className="swm-md pad"><Markdown text={a.text || ''} /></div>
          : rows ? <MiniTable rows={rows} />
          : <CodeView text={a.text || ''} language={languageOf(a.name) || (vk === 'text' ? 'text' : 'code')} />}
        {a && a.truncated && <small className="dim pad">Only the first part of this file is shown.</small>}
      </div>
    </>
  );
}

/** An image or video from the chat, full size. */
function ImageViewer({ img, onBack }) {
  const url = useImageUrl(img);
  return (
    <>
      <ViewerHead title={img.label || (img.kind === 'video' ? 'Video' : 'Image')} onBack={onBack}>
        {img.path && <button className="swv-btn" title="Open with the default app" onClick={() => window.api.openPath(img.path)}><Icon name="external" size={12} /></button>}
        {img.path && <button className="swv-btn" title="Show in Finder" onClick={() => window.api.revealMedia(img.path)}><Icon name="folderOpen" size={12} /></button>}
      </ViewerHead>
      <div className="swv-body swv-media" onClick={onBack} title="Click to go back">
        {!url ? <span className="swc-load" /> : img.kind === 'video' ? <video src={url} controls autoPlay loop playsInline onClick={(e) => e.stopPropagation()} /> : <img src={url} alt={img.label || 'image'} />}
      </div>
    </>
  );
}

/** Contents of the floating Sentinel window (see electron/sentinel-widget.js): a pill, and a mini chat client that opens when there is something to show. */
export default function SentinelWidget() {
  const api = window.api;
  const [info, setInfo] = useState({ state: 'off' });
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(() => store('sn-pin') === '1');
  const [viewer, setViewer] = useState(null); // { type: 'artifact', id } | { type: 'file', file } | { type: 'image', img }
  const [hover, setHover] = useState(false);
  // Quick chat / Quick search live here too: the widget has two tabs, Chat (Cmd+1) and Search (Cmd+2); the shortcut, tray and menu open it (electron/main.js openWidgetTab)
  const [tab, setTab] = useState('chat');
  const [quickOpen, setQuickOpen] = useState(false); // opened by the shortcut / tray: it stays until you close it
  const [snap, setSnap] = useState({ chats: [], actions: [] });
  const [nonce, setNonce] = useState(0);
  const [focusNonce, setFocusNonce] = useState(0);
  const keepRef = useRef(false); const openedAt = useRef(0);
  const live = useRef({}); // the latest values for handlers that were set up once
  const [front, setFront] = useState(false); // the main window is up front: no automatic opening or closing, the widget stays as it is
  const frontRef = useRef(false); frontRef.current = front;
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState(false);
  const [sending, setSending] = useState(false);
  const [sizes, setSizes] = useState(() => ({ expanded: store('sn-size-expanded') || 'M', viewer: store('sn-size-viewer') || 'M' }));
  const box = useRef(null); const scroller = useRef(null); const stuck = useRef(true); const input = useRef(null);
  const pin = (v) => { setPinned(v); store('sn-pin', v ? '1' : '0'); if (v) setOpen(true); };
  useEffect(() => {
    document.documentElement.classList.add('sw-root');
    const theme = () => api.getSettings().then((s) => { applyTextSize(s.textSize); return loadThemes(api).then((t) => applySettingsTheme(s, t)); }).catch(() => {});
    theme();
    const offTheme = api.onThemeChanged ? api.onThemeChanged(theme) : null; // a new theme in Settings repaints the widget too
    api.sentinelCurrent().then((i) => i && setInfo(i)).catch(() => {});
    const o1 = api.onSentinelState((i) => setInfo(i || { state: 'off' }));
    const o2 = api.onSentinelLevel((v) => window.dispatchEvent(new CustomEvent('sentinel-level', { detail: v })));
    const o4 = api.onSentinelFront && api.onSentinelFront((f) => setFront(!!f));
    const o3 = api.onSentinelCmd && api.onSentinelCmd((c) => {
      if (c && typeof c === 'object') {
        if (c.quick === 'close') { setQuickOpen(false); setOpen(false); setViewer(null); }
        else if (c.tab) live.current.openTab(c.tab, !!c.toggle);
        return;
      }
      if (c === 'expand') setOpen(true);
      else if (c === 'collapse') { setOpen(false); setViewer(null); setPinned(false); store('sn-pin', '0'); }
      else if (c === 'pin') pin(true);
      else if (c === 'unpin') pin(false);
    });
    return () => { o1 && o1(); o2 && o2(); o3 && o3(); o4 && o4(); offTheme && offTheme(); };
  }, []);
  const v = info.view || {};
  const msgs = v.messages || [];
  const closeQuick = () => { setQuickOpen(false); setOpen(false); setViewer(null); api.sentinelWidget && api.sentinelWidget('hide-quick'); };
  const switchTab = (t) => {
    setTab(t); setViewer(null);
    if (t === 'search') { setNonce((n) => n + 1); api.paletteGet && api.paletteGet().then((x) => setSnap(x || { chats: [], actions: [] })).catch(() => {}); }
    else { setFocusNonce((n) => n + 1); setTimeout(() => input.current && input.current.focus(), 60); }
  };
  const openTab = (t, toggle) => {
    const L = live.current;
    if (toggle && L.open && L.tab === t && L.quickOpen) { closeQuick(); return; }
    openedAt.current = Date.now(); setQuickOpen(true); setOpen(true); switchTab(t);
  };
  live.current = { ...live.current, openTab, open, tab, quickOpen, on: info.state !== 'off' && info.state !== 'loading', closeQuick };
  useEffect(() => { if (!open) setTab('chat'); }, [open]); // the next automatic opening shows the conversation, not a leftover Search
  useEffect(() => { // Cmd+1 / Cmd+2 switch the tab; leaving the window closes a Quick chat / Search that was opened by the shortcut (not while a task runs or a file dialog is open)
    const key = (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || !live.current.open) return;
      if (e.key === '1') { e.preventDefault(); switchTab('chat'); } else if (e.key === '2') { e.preventDefault(); switchTab('search'); }
    };
    const blur = () => { const L = live.current; if (L.quickOpen && !L.on && !keepRef.current && Date.now() - openedAt.current > 500) L.closeQuick(); };
    window.addEventListener('keydown', key); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('blur', blur); };
  }, []);
  const answer = v.answer || info.said || '';
  const err = v.error || info.err || '';
  const on = info.state !== 'off' && info.state !== 'loading';
  const has = on && !!(info.heard || answer || v.approval || (v.images || []).length || err || v.activity || (v.artifacts || []).length || msgs.length);
  // Opens by itself when something new arrives: a question, an approval, an image, an error, an artifact.
  const sig = `${info.heard}|${v.approval ? v.approval.id : ''}|${(v.images || []).length}|${err}|${(v.artifacts || []).length}`;
  const lastSig = useRef('');
  useEffect(() => { if (sig !== lastSig.current) { const was = lastSig.current; lastSig.current = sig; if (has && was !== '' && sig.replace(/\|/g, '') && !frontRef.current) { setOpen(true); stuck.current = true; } } }, [sig, has]);
  useEffect(() => { if (info.state === 'off' && !live.current.quickOpen) { setOpen(false); setViewer(null); } }, [info.state]);
  // A new artifact made while the widget is open is shown right away; an update to the one on screen refreshes it (rev).
  const arts = useMemo(() => { const m = new Map(); for (const x of msgs) for (const a of x.artifacts || []) m.set(a.id, a); return m; }, [msgs]);
  const known = useRef(null);
  useEffect(() => {
    if (!on) return;
    if (known.current === null) { known.current = new Set(arts.keys()); return; }
    const fresh = [...arts.keys()].filter((id) => !known.current.has(id));
    for (const id of fresh) known.current.add(id);
    if (fresh.length && open && !(viewer && viewer.type === 'file')) { setViewer({ type: 'artifact', id: fresh[fresh.length - 1] }); setOpen(true); }
  }, [arts, on]);
  // Closes by itself once Artemis is done talking and nothing needs you (not while you type or look at something).
  const busy = !!draft.trim() || typing || !!viewer || sending || quickOpen || tab === 'search';
  const quiet = (info.state === 'idle' || info.state === 'listening') && !v.approval && !v.running && !pinned && !hover && !busy;
  useEffect(() => { if (!open || !quiet || front) return undefined; const t = setTimeout(() => setOpen(false), IDLE_MS); return () => clearTimeout(t); }, [open, quiet, front, answer, msgs.length]);
  const big = open && (on || quickOpen);
  const mode = big ? (viewer ? 'viewer' : 'expanded') : 'compact';
  const size = mode === 'compact' ? 'M' : sizes[mode];
  const gripDown = (e) => {
    e.preventDefault(); e.stopPropagation();
    const sx = e.screenX, sy = e.screenY; const t = e.currentTarget;
    try { t.setPointerCapture(e.pointerId); } catch {}
    api.sentinelGrip('start');
    const mv = (ev) => api.sentinelGrip('move', ev.screenX - sx, ev.screenY - sy);
    const up = () => { t.removeEventListener('pointermove', mv); t.removeEventListener('pointerup', up); t.removeEventListener('pointercancel', up); api.sentinelGrip('end'); };
    t.addEventListener('pointermove', mv); t.addEventListener('pointerup', up); t.addEventListener('pointercancel', up);
  };
  const cycleSize = () => { api.sentinelGrip('reset', mode); const next = SIZES[(SIZES.indexOf(size) + 1) % SIZES.length]; store(`sn-size-${mode}`, next); setSizes((s) => ({ ...s, [mode]: next })); };
  // Follow the end of the chat unless the user scrolled up to read.
  useEffect(() => { const el = scroller.current; if (el && stuck.current) el.scrollTop = el.scrollHeight; }, [msgs, answer, open, viewer, v.activity, v.approval]);
  const onScroll = () => { const el = scroller.current; if (el) stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24; };
  // The window follows the content: the pill reports its height; the chat and the viewer have the fixed S / M / L size.
  // Only when something changed: the layout effect runs on every render (many per second while Sentinel talks) and each report moves a native window.
  const lastReport = useRef('');
  const report = () => {
    if (!box.current) return;
    const h = box.current.offsetHeight + 8;
    const key = mode === 'compact' ? `${mode}|${size}|${h}` : `${mode}|${size}`;
    if (key === lastReport.current) return;
    lastReport.current = key;
    api.sentinelResize(h, mode, size);
  };
  useLayoutEffect(report);
  useEffect(() => { if (!box.current || !window.ResizeObserver || mode !== 'compact') return undefined; const ro = new ResizeObserver(() => report()); ro.observe(box.current); return () => ro.disconnect(); }, [mode, size]);
  const act = (a) => () => api.sentinelAction(a);
  const back = () => { stuck.current = true; setViewer(null); };
  const openItem = React.useCallback((it) => { stuck.current = false; setViewer(it); setOpen(true); }, []);
  const send = async () => {
    const text = draft.trim(); if (!text || sending) return;
    setSending(true); stuck.current = true;
    try { const ok = await api.sentinelAsk('send', text); if (ok) setDraft(''); } catch {} finally { setSending(false); }
  };
  // The three bouncing dots, like in the main chat: shown while the answer has not started (the message is the user's, or the reply has no text or tool steps yet).
  const lastMsg = msgs.length ? msgs[msgs.length - 1] : null;
  const waiting = (info.state === 'thinking' || !!v.running || !!v.busy) && !v.approval && !v.activity && (!lastMsg || lastMsg.role === 'user' || (!lastMsg.text && !(lastMsg.tools || []).length));
  const working = info.state === 'thinking' || info.state === 'speaking' || !!v.running || !!v.busy || msgs.some((m) => m.running);
  const viewRev = viewer && viewer.type === 'artifact' && arts.get(viewer.id) ? arts.get(viewer.id).rev : '';
  // Messages from before Sentinel's chat existed would show nothing: fall back to the last exchange.
  const shown = msgs.length ? msgs : (info.heard ? [{ id: 'h', role: 'user', text: info.heard }, ...(answer ? [{ id: 'a', role: 'assistant', text: answer, tools: [], images: v.images || [], artifacts: v.artifacts || [], files: [] }] : [])] : []);
  return (
    <div ref={box} className={`sw-box${big ? ' open' : ''}`} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      {on && <SentinelPill floating noTalk expanded={big} canExpand={on} onToggle={() => { setOpen(!big); if (big) setViewer(null); }} state={info.state} info={info.info} err={big ? '' : info.err} heard={info.heard} said={answer}
        muted={!!info.muted} onMute={act(info.muted ? 'unmute' : 'mute')} onStop={act('stop')} onSkip={act('skip')} onDismiss={act('dismiss')} onSettings={act('settings')} onLogs={act('logs')} />}
      {big && (
        <div className={`swc${viewer ? ' viewing' : ''}`} role="region" aria-label="Sentinel conversation">
          {viewer && tab === 'chat' ? (
            <SizeButton.Provider value={<button className="sn-btn swc-size" title={`Size: ${size} (click to change)`} aria-label="Change the viewer size" onClick={cycleSize}>{size}</button>}>
            {viewer.type === 'artifact' ? <ArtifactViewer id={viewer.id} rev={viewRev} onBack={back} />
              : viewer.type === 'file' ? <FileViewer file={viewer.file} onBack={back} />
              : <ImageViewer img={viewer.img} onBack={back} />}
            </SizeButton.Provider>
          ) : (
            <>
              <div className="swc-head">
                <div className="swc-tabs" role="tablist">
                  <button role="tab" aria-selected={tab === 'chat'} className={tab === 'chat' ? 'on' : ''} title={v.title || ''} onClick={() => switchTab('chat')}>Chat <kbd>⌘1</kbd></button>
                  <button role="tab" aria-selected={tab === 'search'} className={tab === 'search' ? 'on' : ''} onClick={() => switchTab('search')}>Search <kbd>⌘2</kbd></button>
                </div>
                <div className="swc-grip" aria-hidden="true" title="Drag to move" />
                <button className="sn-btn swc-size" title={`Size: ${size} (click to change)`} aria-label="Change the widget size" onClick={cycleSize}>{size}</button>
                <button className={`sn-btn${pinned ? ' on' : ''}`} title={pinned ? 'Unpin: close by itself again' : 'Pin: keep this open'} aria-label={pinned ? 'Unpin' : 'Pin open'} aria-pressed={pinned} onClick={() => pin(!pinned)}><Icon name="pin" size={12} /></button>
                <button className="sn-btn" title="Open this chat in the app" aria-label="Open this chat in the app" onClick={act('show')}><Icon name="external" size={12} /></button>
              </div>
              {tab === 'search' ? (
                <CommandPalette key={nonce} embedded open chats={snap.chats} onClose={() => (quickOpen || !on ? closeQuick() : setOpen(false))}
                  actions={(snap.actions || []).map((a) => ({ ...a, run: () => { api.paletteRun({ kind: 'action', id: a.id }); closeQuick(); } }))}
                  onOpenChat={(id) => { api.paletteRun({ kind: 'chat', id }); closeQuick(); }} onOpenNote={(pth) => { api.paletteRun({ kind: 'note', path: pth }); closeQuick(); }} onOpenFile={(pth) => { api.paletteRun({ kind: 'file', path: pth }); closeQuick(); }} />
              ) : !on ? (
                <QuickChat embedded focusNonce={focusNonce} onClose={closeQuick} onKeepOpen={(k) => { keepRef.current = !!k; }} />
              ) : (<>
              <div className="swm-list" ref={scroller} onScroll={onScroll} onClickCapture={linkClick}>
                {shown.length === 0 && <p className="dim swm-empty">Say your wake phrase or type a message below.</p>}
                {shown.map((m, i) => <MemoBubble key={m.id || i} m={m} onOpen={openItem} last={i === shown.length - 1} />)}
                {waiting && <div className="swm-asst" aria-label="Artemis is answering"><span className="typing"><i /><i /><i /></span></div>}
              </div>
              {v.approval && (
                <div className="swc-ask">
                  <b>{v.approval.title || 'Allow this?'}</b>
                  {v.approval.summary && <span>{v.approval.summary}</span>}
                  <div className="swc-row">
                    <button className="primary" onClick={act('approve')}><Icon name="check" size={12} /> Allow</button>
                    <button onClick={act('deny')}><Icon name="x" size={12} /> Deny</button>
                    <small>or say “yes” / “no”</small>
                  </div>
                </div>
              )}
              {v.activity && !v.approval && <p className="swc-act"><span className="swc-spin" />{v.activity}</p>}
              {err && (
                <div className="swc-err">
                  <span>{err}</span>
                  <div className="swc-row">
                    <button onClick={act('retry')}><Icon name="refresh" size={12} /> Retry</button>
                    {/speech-to-text|Providers|Settings → Voice/i.test(err) && <button onClick={act('settings')}>Voice settings</button>}
                    {info.err && <button onClick={act('dismiss')}>Dismiss</button>}
                  </div>
                </div>
              )}
              <div className="swm-compose">
                <textarea ref={input} rows={1} value={draft} placeholder="Message Sentinel…" aria-label="Message Sentinel"
                  onChange={(e) => setDraft(e.target.value)} onFocus={() => setTyping(true)} onBlur={() => setTyping(false)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } else if (e.key === 'Escape') { e.currentTarget.blur(); } }} />
                {working
                  ? <button className="sn-btn" title="Stop" aria-label="Stop" onClick={() => api.sentinelAsk('stop')}><Icon name="stop" size={12} /></button>
                  : <button className={`sn-btn${info.state === 'listening' ? ' on' : ''}`} title="Talk (tap again to send)" aria-label="Talk" onClick={act('ptt')}><Icon name="mic" size={12} /></button>}
                <button className="sn-btn primary" title="Send" aria-label="Send" disabled={!draft.trim() || sending} onClick={send}><Icon name="send" size={12} /></button>
              </div>
              </>)}
            </>
          )}
        </div>
      )}
      {big && <div className="sw-grip" title="Drag to resize" aria-label="Resize the widget" onPointerDown={gripDown} />}
    </div>
  );
}
