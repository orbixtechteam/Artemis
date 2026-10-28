import React, { useEffect, useState } from 'react';
import Select from './Select.jsx';
import { askConfirm } from '../lib/dialog.js';
import Markdown from './Markdown.jsx';
import { Icon, FILE_ICON } from './Icons.jsx';
import { splitSheets, openPreview, parseCsv, detectDelimiter } from '../lib/preview.js';
import { languageOf, viewKind } from '../lib/langs.js';
import { labelFor, target } from './ToolCard.jsx';
import { summarize, progressOf } from '../lib/outputs.js';
import hljs from 'highlight.js/lib/common';
import SheetEditor from './SheetEditor.jsx';
import { ContextMenu } from './TabBar.jsx';
import FindBar from './FindBar.jsx';

const api = window.api;

function Head({ title, sub, onClose, expanded, onExpand, children }) {
  return (
    <div className="sp-head">
      <div className="sp-title"><span className="t">{title}</span>{sub && <span className="sub">{sub}</span>}</div>
      {children}
      <button className="icon-btn" title={expanded ? 'Shrink' : 'Expand'} aria-label={expanded ? 'Shrink' : 'Expand'} onClick={onExpand}><Icon name="expand" size={16} /></button>
      <button className="icon-btn" title="Close" aria-label="Close" onClick={onClose}><Icon name="x" size={17} /></button>
    </div>
  );
}

function CopyBtn({ getText }) {
  const [done, setDone] = useState(false);
  return <button className="sp-btn" onClick={() => { navigator.clipboard.writeText(getText()); setDone(true); setTimeout(() => setDone(false), 1200); }}><Icon name={done ? 'check' : 'copy'} size={14} /> {done ? 'Copied' : 'Copy'}</button>;
}

const MAX_CODE_LINES = 4000;
const esc = (t) => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function CodeView({ text, language = 'code' }) {
  const all = String(text || '').split('\n');
  const cut = all.length > MAX_CODE_LINES;
  const shown = (cut ? all.slice(0, MAX_CODE_LINES) : all).join('\n');
  const grammar = { js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', py: 'python', sh: 'bash', html: 'xml', md: 'markdown', text: 'plaintext', code: '' }[String(language).toLowerCase()] ?? String(language).toLowerCase();
  const htmlLines = React.useMemo(() => {
    let out = '';
    try {
      if (shown.length > 400000) out = esc(shown);
      else if (grammar && hljs.getLanguage(grammar)) out = hljs.highlight(shown, { language: grammar }).value;
      else out = hljs.highlightAuto(shown).value;
    } catch { out = esc(shown); }
    return out.split('\n');
  }, [shown, grammar]);
  const width = String(all.length).length;
  return (
    <div className="editor-wrap">
      <pre className="code-editor"><code>{htmlLines.map((line, i) => <span className="code-line" key={i}><span className="line-no">{String(i + 1).padStart(width, ' ')}</span><span className="line-text" dangerouslySetInnerHTML={{ __html: line || '&nbsp;' }} /></span>)}</code>
        {cut && <div className="editor-more">Showing the first {MAX_CODE_LINES} of {all.length} lines. Use Open to see the whole file.</div>}</pre>
    </div>
  );
}

const PAGE = 500;

/** CSV / spreadsheet table with search, header toggle and paging. */
function DataTable({ rows, clean = false }) {
  const [q, setQ] = useState('');
  const [header, setHeader] = useState(true);
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => { setLimit(PAGE); setQ(''); }, [rows]);
  const cols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const head = header && rows.length ? rows[0] : null;
  const body = head ? rows.slice(1) : rows;
  const needle = q.trim().toLowerCase();
  const filtered = needle ? body.filter((r) => r.some((c) => String(c).toLowerCase().includes(needle))) : body;
  const shown = filtered.slice(0, limit);
  return (
    <div className={`datatable${clean ? ' clean' : ''}`}>
      {!clean && <div className="dt-bar">
        <input type="search" placeholder="Search rows" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="dt-check"><input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} /> First row is header</label>
        <span className="dt-count">{filtered.length.toLocaleString()}{needle ? ` of ${body.length.toLocaleString()}` : ''} rows · {cols} columns</span>
      </div>}
      <div className="dt-wrap">
        <table>
          <thead><tr>{!clean && <th className="rn">#</th>}{Array.from({ length: cols }, (_, j) => <th key={j}>{head ? head[j] : colName(j)}</th>)}</tr></thead>
          <tbody>{shown.map((r, i) => <tr key={i}>{!clean && <td className="rn">{i + 1}</td>}{Array.from({ length: cols }, (_, j) => <td key={j} title={r[j]}>{r[j]}</td>)}</tr>)}</tbody>
        </table>
      </div>
      {filtered.length > limit && <button className="dt-more" onClick={() => setLimit(limit + PAGE)}>Show {Math.min(PAGE, filtered.length - limit)} more rows</button>}
    </div>
  );
}
const colName = (j) => { let n = j, s = ''; do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0); return s; };

const extOf = (n) => { const m = /\.([A-Za-z0-9]+)$/.exec(n || ''); return m ? m[1].toUpperCase() : ''; };
const baseOf = (n) => String(n || '').replace(/\.[A-Za-z0-9]+$/, '');

/** Claude-style file viewer: Preview/Code toggle, "Name · EXT", a Copy split button with the other actions in its menu. */
export function FilePanel({ file: a, onClose, expanded, onExpand }) {
  const [dirty, setDirty] = useState(false);
  const [edPath, setEdPath] = useState(null);
  const [note, setNote] = useState(a._note || '');
  const [tab, setTab] = useState(0);
  const [mode, setMode] = useState('preview');
  const [src, setSrc] = useState('');
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState(null);
  const [over, setOver] = useState(null); // text after an in-place edit
  const [draft, setDraft] = useState(null); // text being edited (text files kept in Files)
  const [copied, setCopied] = useState(false);
  const noteT = React.useRef(0);
  const bodyRef = React.useRef(null);
  const vk = viewKind(a);
  useEffect(() => { setNote(a._note || ''); setTab(0); setMode('preview'); setSrc(''); setDirty(false); setEdPath(null); setEditing(false); setOver(null); setDraft(null); setMenu(null); }, [a]);
  const flash = (m) => { setNote(m); clearTimeout(noteT.current); noteT.current = setTimeout(() => setNote(''), 3000); };
  const editable = !!a.path && (vk === 'sheet' || vk === 'table') && /\.(csv|tsv|tab|xlsx|xlsm|xls|xlsb|ods)$/i.test(a.name);
  const textEditable = !!a.lib && a.text != null && !a.truncated && ['code', 'text', 'markdown', 'html', 'svg'].includes(vk);
  const close = async () => { if ((dirty || (draft !== null && draft !== (over ?? a.text))) && !(await askConfirm({ title: 'Unsaved changes', message: 'This file has unsaved changes. Close anyway?', confirmLabel: 'Close anyway', danger: true }))) return; onClose(); };
  const text = over ?? (a.text || '');
  const sheets = vk === 'sheet' ? splitSheets(text) : null;
  const rows = React.useMemo(() => (vk === 'table' ? parseCsv(text, detectDelimiter(text, a.name)) : sheets ? sheets[Math.min(tab, sheets.length - 1)].rows : null), [vk, text, tab, a.name]);
  const live = (vk === 'html' || vk === 'svg') && mode === 'preview' && draft === null;
  useEffect(() => {
    let off = false;
    if (live && text) api.stageArtifact(text, vk).then((u) => { if (!off) setSrc(u); });
    return () => { off = true; };
  }, [live, text, vk]);
  const phone = async () => { const r = await api.sendFileToPhone(a.path); flash(r.ok ? 'Sent to your phone.' : r.error); };
  const saveToFiles = async () => { const r = await api.libAddPaths([a.path]); flash(r && r.ok ? 'Saved to Files.' : (r && r.error) || 'Could not save.'); };
  const saveEdit = async () => {
    const r = await api.libWrite(a.lib, draft);
    if (r && r.ok) { setOver(draft); setDraft(null); flash('Saved.'); } else flash((r && r.error) || 'Could not save.');
  };
  const toggles = { table: ['Preview', 'Code'], sheet: ['Preview', 'Code'], markdown: ['Preview', 'Raw'], html: ['Preview', 'Code'], svg: ['Preview', 'Code'] }[vk];
  const lang = languageOf(a.name) || (vk === 'text' ? 'text' : 'code');
  const copy = () => { if (a.text == null) return; navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1200); };
  const openMenu = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const items = [];
    if (a.text != null) items.push({ label: 'Copy', onClick: copy });
    if (a.path) items.push({ label: 'Open with default app', onClick: () => api.openPath(a.path) }, { label: 'Show in folder', onClick: () => api.revealPath(a.path) }, { label: 'Send to phone', onClick: phone });
    if (a.path && !a.lib) items.push({ sep: true }, { label: 'Save to Files', onClick: saveToFiles });
    setMenu({ x: Math.max(8, r.right - 210), y: r.bottom + 4, items });
  };
  const ext = extOf(a.name);
  const name = edPath ? edPath.split(/[\\/]/).pop() : a.name;
  return (
    <>
      <div className="sp-head fp-head">
        {toggles && !editing && draft === null && (
          <div className="fp-seg" role="group">
            <button className={mode === 'preview' ? 'on' : ''} title={toggles[0]} aria-label={toggles[0]} onClick={() => setMode('preview')}><Icon name="eye" size={15} /></button>
            <button className={mode === 'raw' ? 'on' : ''} title={toggles[1]} aria-label={toggles[1]} onClick={() => setMode('raw')}><Icon name="code" size={15} /></button>
          </div>
        )}
        <div className="fp-title" title={name}><span className="t">{baseOf(name) || name}</span>{ext && <span className="e"> · {ext}</span>}</div>
        {draft !== null ? (
          <>
            <button className="sp-btn" onClick={() => setDraft(null)}>Cancel</button>
            <button className="sp-btn primary" onClick={saveEdit}>Save</button>
          </>
        ) : (
          <>
            {editable && !editing && <button className="sp-btn" onClick={() => setEditing(true)}><Icon name="edit" size={14} /> Edit</button>}
            {textEditable && <button className="sp-btn" onClick={() => { setDraft(text); setMode('raw'); }}><Icon name="edit" size={14} /> Edit</button>}
            {(a.text != null || a.path) && (
              <div className="fp-split">
                <button className="main" onClick={a.text != null ? copy : openMenu}>{copied ? <><Icon name="check" size={14} /> Copied</> : 'Copy'}</button>
                <button className="caret" title="More" aria-label="More" onClick={openMenu}><Icon name="chevronDown" size={13} /></button>
              </div>
            )}
          </>
        )}
        <button className="icon-btn" title={expanded ? 'Shrink' : 'Expand'} aria-label={expanded ? 'Shrink' : 'Expand'} onClick={onExpand}><Icon name="expand" size={16} /></button>
        <button className="icon-btn" title="Close" aria-label="Close" onClick={close}><Icon name="x" size={17} /></button>
      </div>
      {!editing && sheets && sheets.length > 1 && <div className="tabs sp-sheets">{sheets.map((sh, i) => <button key={i} className={i === tab ? 'active' : ''} onClick={() => setTab(i)}>{sh.name}</button>)}</div>}
      {!live && vk !== 'image' && <FindBar key={a.path || a.name} targetRef={bodyRef} />}
      <div className={`sp-body ${live ? 'flush' : ''}`} ref={bodyRef}>
        {vk === 'image' && (a.dataUrl || a.url) && <img className="preview-img" src={a.dataUrl || a.url} alt={a.name} />}
        {draft !== null && <textarea className="fp-edit" value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} autoFocus />}
        {draft === null && editable && editing && <SheetEditor path={a.path} name={a.name} onDirty={setDirty} onSaved={setEdPath} />}
        {draft === null && !editing && (vk === 'sheet' || vk === 'table') && mode === 'preview' && rows && <DataTable rows={rows} clean />}
        {draft === null && !editing && (vk === 'sheet' || vk === 'table') && mode === 'raw' && <CodeView text={text} language="text" />}
        {draft === null && vk === 'markdown' && mode === 'preview' && <div className="sp-doc"><Markdown text={text} /></div>}
        {draft === null && vk === 'markdown' && mode === 'raw' && <CodeView text={text} language="markdown" />}
        {live && (src ? <iframe className="artifact-frame" title={a.name} sandbox="allow-scripts" src={src} /> : <div className="muted pad">Loading…</div>)}
        {draft === null && (vk === 'html' || vk === 'svg') && mode === 'raw' && <CodeView text={text} language={vk === 'svg' ? 'xml' : 'html'} />}
        {draft === null && (vk === 'code' || vk === 'text') && <CodeView text={text} language={lang} />}
        {vk === 'error' && <div className="error">{a.error}</div>}
        {a.truncated && <small className="hint">Only the first part of this file is shown.</small>}
      </div>
      {note && <div className="fp-note">{note}</div>}
      <ContextMenu menu={menu} onClose={() => setMenu(null)} />
    </>
  );
}

export function ArtifactPanel({ artifact, onClose, expanded, onExpand }) {
  const [ver, setVer] = useState(-1);
  const [tab, setTab] = useState('preview');
  const [src, setSrc] = useState('');
  const [note, setNote] = useState('');
  const bodyRef = React.useRef(null);
  const versions = artifact ? artifact.versions : [];
  const idx = ver < 0 || ver >= versions.length ? versions.length - 1 : ver;
  const content = versions[idx] || '';
  const live = artifact && (artifact.type === 'html' || artifact.type === 'svg');
  const isSheet = !!artifact && artifact.type === 'spreadsheet';
  const isTable = isSheet || (!!artifact && artifact.type === 'code' && /^(csv|tsv)$/i.test(artifact.language || ''));
  const [sheetTab, setSheetTab] = useState(0);
  const sheetList = React.useMemo(() => (isSheet ? splitSheets(content) : null), [isSheet, content]);
  const tableRows = React.useMemo(() => (isSheet ? sheetList[Math.min(sheetTab, sheetList.length - 1)].rows : isTable ? parseCsv(content, /^tsv$/i.test(artifact.language) ? '\t' : detectDelimiter(content, 'x.csv')) : null), [isSheet, isTable, content, sheetList, sheetTab]);
  useEffect(() => { setVer(-1); setSheetTab(0); setTab(artifact && artifact.type === 'code' && !isTable ? 'code' : 'preview'); }, [artifact && artifact.id]);
  useEffect(() => { setVer(-1); }, [versions.length]);
  useEffect(() => {
    let off = false;
    if (live && tab === 'preview' && content) api.stageArtifact(content, artifact.type).then((u) => { if (!off) setSrc(u); });
    return () => { off = true; };
  }, [content, tab, live, artifact && artifact.type]);
  if (!artifact) return <div className="sp-body"><div className="muted pad">This artifact is no longer available.</div></div>;
  const save = async () => { const r = await api.saveArtifact({ title: artifact.title, kind: artifact.type, language: artifact.language, content }); if (r.ok) setNote('Saved.'); };
  const sub = { html: 'Web page', svg: 'SVG', markdown: 'Document', spreadsheet: 'Spreadsheet', code: artifact.language || 'Code' }[artifact.type];
  return (
    <>
      <Head title={artifact.title} sub={sub} onClose={onClose} expanded={expanded} onExpand={onExpand}>
        {versions.length > 1 && (
          <Select className="sp-ver" value={idx} onChange={(e) => setVer(Number(e.target.value))}>
            {versions.map((_, i) => <option key={i} value={i}>v{i + 1}{i === versions.length - 1 ? ' (latest)' : ''}</option>)}
          </Select>
        )}
        <CopyBtn getText={() => content} />
        <button className="sp-btn" onClick={save}><Icon name="download" size={14} /> Download</button>
      </Head>
      {(artifact.type !== 'code' || isTable) && (
        <div className="sp-tabs">
          <button className={tab === 'preview' ? 'active' : ''} onClick={() => setTab('preview')}><Icon name="eye" size={14} /> Preview</button>
          <button className={tab === 'code' ? 'active' : ''} onClick={() => setTab('code')}><Icon name="code" size={14} /> Code</button>
        </div>
      )}
      {!(live && tab === 'preview') && <FindBar key={artifact.id} targetRef={bodyRef} />}
      <div className={`sp-body ${live && tab === 'preview' ? 'flush' : ''}`} ref={bodyRef}>
        {tab === 'preview' && live && (src ? <iframe className="artifact-frame" title={artifact.title} sandbox="allow-scripts" src={src} /> : <div className="muted pad">Loading…</div>)}
        {tab === 'preview' && artifact.type === 'markdown' && <div className="sp-doc"><Markdown text={content} /></div>}
        {tab === 'preview' && sheetList && sheetList.length > 1 && <div className="tabs sp-sheets">{sheetList.map((sh, i) => <button key={i} className={i === sheetTab ? 'active' : ''} onClick={() => setSheetTab(i)}>{sh.name}</button>)}</div>}
        {tab === 'preview' && isTable && tableRows && <DataTable rows={tableRows} clean />}
        {(tab === 'code' || (artifact.type === 'code' && !isTable)) && <CodeView text={content} language={artifact.language || 'code'} />}
      </div>
      {note && <div className="sp-foot"><small className="hint">{note}</small></div>}
    </>
  );
}

const ICON_OF = { file: 'file', media: 'image', artifact: 'artifact' };

export function ProgressPanel({ chat, onClose, expanded, onExpand, onOpenArtifact, controls }) {
  const [showAll, setShowAll] = useState(false);
  const { calls, done, total } = progressOf(chat);
  const { outputs, used } = summarize(chat);
  const shownCalls = showAll ? calls : calls.slice(-8);
  const rows = [];
  if (used.uploads.length) rows.push(['paperclip', 'Uploads', used.uploads.slice(0, 1).join(', ') + (used.uploads.length > 1 ? ` +${used.uploads.length - 1}` : '')]);
  if (used.web) rows.push(['globe', 'Web', `${used.web} lookup${used.web === 1 ? '' : 's'}`]);
  if (used.terminal) rows.push(['terminal', 'Terminal', `${used.terminal} command${used.terminal === 1 ? '' : 's'}`]);
  if (used.computer) rows.push(['monitor', 'Computer', `${used.computer} action${used.computer === 1 ? '' : 's'}`]);
  if (used.memory) rows.push(['bulb', 'Memory', `${used.memory} change${used.memory === 1 ? '' : 's'}`]);
  if (used.media) rows.push(['image', 'Generated media', String(used.media)]);
  for (const c of used.connectors) rows.push(['plug', c, 'Connector']);
  const openOutput = (o) => {
    if (o.kind === 'artifact') return onOpenArtifact(o.id);
    if (o.kind === 'media') return api.revealMedia(o.path);
    openPreview({ project: true, path: o.path });
  };
  return (
    <>
      <Head title="Chat" onClose={onClose} expanded={expanded} onExpand={onExpand} />
      {controls && <div className="side-controls">{controls}</div>}
      <div className="sp-body prog">
        <h4 className="first">Progress</h4>
        {total === 0 ? <div className="muted">Steps will appear here while the assistant works.</div> : (
          <ol className="steps">
            {calls.length > shownCalls.length && <li className="more"><button onClick={() => setShowAll(true)}>{calls.length - shownCalls.length} earlier steps</button></li>}
            {shownCalls.map((c) => {
              const [icon, label] = labelFor(c.name);
              const st = c.status === 'running' ? 'spinner' : c.status === 'awaiting' ? 'warning' : c.status === 'error' || c.status === 'denied' || c.status === 'cancelled' ? 'x' : 'check';
              return (
                <li key={c.id} className={`step ${c.status}`}>
                  <Icon name={st} size={14} className="st" />
                  <span className="lbl"><Icon name={icon} size={13} /> {label}</span>
                  <span className="tgt">{target(c)}</span>
                </li>
              );
            })}
          </ol>
        )}
        <h4>Outputs</h4>
        {outputs.length === 0 ? <div className="muted small">Files, artifacts and generated media will be listed here.</div> : (
          <ul className="outs">
            {outputs.map((o, i) => (
              <li key={i}><button onClick={() => openOutput(o)}>
                <Icon name={o.kind === 'file' ? (FILE_ICON[/\.(xlsx|xls|csv|ods)$/i.test(o.name) ? 'sheet' : 'text'] || 'file') : o.media === 'video' ? 'video' : ICON_OF[o.kind]} size={16} />
                <span className="n">{o.name}</span>
                <span className="k">{o.kind === 'artifact' ? ({ html: 'HTML', svg: 'SVG', markdown: 'MD', spreadsheet: 'Sheet', code: 'Code' }[o.type] || 'Artifact') : o.kind === 'media' ? (o.media === 'video' ? 'Video' : 'Image') : (o.name.split('.').pop() || 'file').toUpperCase()}</span>
              </button></li>
            ))}
          </ul>
        )}
        <h4>Used in this chat</h4>
        {rows.length === 0 ? <div className="muted small">Nothing yet.</div> : (
          <ul className="outs">
            {rows.map(([icon, name, val], i) => <li key={i} className="plainrow"><Icon name={icon} size={16} /><span className="n">{name}</span><span className="k">{val}</span></li>)}
          </ul>
        )}
      </div>
    </>
  );
}

export function ArtifactCard({ a, onOpen }) {
  const sub = { html: 'Web page', svg: 'SVG', markdown: 'Document', spreadsheet: 'Spreadsheet', code: a.language || 'Code' }[a.type];
  return (
    <button className="artifact-card" onClick={onOpen}>
      <span className="ic"><Icon name="artifact" size={20} /></span>
      <span className="tx"><span className="ti">{a.title}</span><span className="su">Artifact · {sub}{a.versions.length > 1 ? ` · v${a.versions.length}` : ''}</span></span>
      <span className="open">Open</span>
    </button>
  );
}
