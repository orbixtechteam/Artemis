import { costOf, fmtUsd } from '../lib/cost.js';
import Select from './Select.jsx';
import { askConfirm } from '../lib/dialog.js';
import React, { useEffect, useState, useContext } from 'react';
import { PageContext } from '../lib/pageContext.js';
import { Row, Switch, Segmented } from './settings/ui.jsx';
import { splitSheets } from '../lib/preview.js';
import { Icon } from './Icons.jsx';
import ProjectLogo from './ProjectLogo.jsx';
import ListTools from './ListTools.jsx';
import { filterSort } from '../lib/listfilter.mjs';
import { ClaudeUsageFor } from './ClaudeUsage.jsx';

export function Modal({ title, sub, onClose, children, wide, cls, bare }) {
  const page = useContext(PageContext);
  useEffect(() => {
    if (page) return undefined; // a page is closed with its tab, not with Escape
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose, page]);
  if (page) {
    return (
      <div className={`modal page ${wide ? 'wide' : ''} ${cls || ''}`}>
        {!bare && <div className="page-head"><h1>{title}</h1></div>}
        {sub && <p className="page-sub">{sub}</p>}
        {children}
      </div>
    );
  }
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'wide' : ''} ${cls || ''}`}>
        {!bare && <h2>{title}</h2>}
        {sub && <p className="muted small">{sub}</p>}
        {children}
      </div>
    </div>
  );
}

export const Field = ({ label, hint, children }) => (
  <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>
);

export function ImportRow() {
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true); setMsg('');
    try {
      const r = await window.api.importChats();
      if (r.canceled) return;
      if (!r.ok) return setMsg(r.error);
      window.dispatchEvent(new CustomEvent('aid-import', { detail: r }));
      const extras = (r.projects?.length || r.memory?.length) ? ` Also found ${r.projects?.length || 0} project${r.projects?.length === 1 ? '' : 's'} and ${r.memory?.length || 0} memories.` : '';
      setMsg(`Read ${r.chats.length} ${r.source} chat${r.chats.length === 1 ? '' : 's'}.${extras} Already imported chats are skipped.`);
    } finally { setBusy(false); }
  };
  return (
    <Row label="Import chats" description={msg || 'Bring your history from ChatGPT or Claude: request your data export in their settings, then choose the .zip (or conversations.json) here.'}>
      <button type="button" className="pref-btn" onClick={go} disabled={busy}>{busy ? 'Reading…' : 'Import…'}</button>
    </Row>
  );
}

export function UsageModal({ onClose, projects = [], chats = [] }) {
  const page = useContext(PageContext);
  const [rows, setRows] = useState(null);
  const [range, setRange] = useState('30'); // days or 'all'
  const [proj, setProj] = useState('');     // '' = all projects, '__none' = no project
  useEffect(() => { window.api.usageGet().then(setRows).catch(() => setRows([])); }, []);

  const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n)));
  const since = range === 'all' ? 0 : Date.now() - Number(range) * 864e5;
  const list = (rows || []).filter((r) => r.t >= since && (!proj || (proj === '__none' ? !r.project : r.project === proj)));

  const group = (keyFn) => {
    const m = new Map();
    for (const r of list) {
      const k = keyFn(r) || '—';
      const g = m.get(k) || { key: k, prompt: 0, completion: 0, requests: 0, est: 0, cost: 0 };
      g.cost += costOf(r); g.prompt += r.prompt; g.completion += r.completion; g.requests++; if (r.estimated) g.est++;
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => b.prompt + b.completion - (a.prompt + a.completion));
  };
  const total = list.reduce((a, r) => ({ p: a.p + r.prompt, c: a.c + r.completion, e: a.e + (r.estimated ? 1 : 0) }), { p: 0, c: 0, e: 0 });
  const byModel = group((r) => String(r.model || '').replace(/^prov:[^:]+:/, ''));
  const byProject = group((r) => r.project || '(no project)');
  const titles = Object.fromEntries(chats.map((c) => [c.id, c.title || 'Untitled']));
  const byChat = group((r) => (r.chat ? titles[r.chat] || 'Deleted chat' : '(phone, scheduled or older)')).slice(0, 12);
  const max = (arr) => Math.max(1, ...arr.map((g) => g.prompt + g.completion));

  // last 14 days bar chart
  const days = [];
  for (let i = 13; i >= 0; i--) { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i); days.push({ start: d.getTime(), label: d.getDate(), tokens: 0 }); }
  for (const r of list) { const d = days.find((x) => r.t >= x.start && r.t < x.start + 864e5); if (d) d.tokens += r.prompt + r.completion; }
  const dayMax = Math.max(1, ...days.map((d) => d.tokens));

  const Table = ({ title, data }) => (
    <div className="usage-block">
      <div className="section-title">{title}</div>
      {data.length === 0 ? <div className="muted small">No data.</div> : (
        <div className="usage-table">
          <div className="usage-row usage-hd"><span>Name</span><span /><span>Tokens</span><span>Cost</span><span>In / out</span><span>Req</span></div>
          {data.map((g) => (
            <div key={g.key} className="usage-row" title={`${g.requests} requests`}>
              <div className="usage-name" title={g.key}>{g.key}</div>
              <div className="usage-bar"><i style={{ width: `${((g.prompt + g.completion) / max(data)) * 100}%` }} /></div>
              <b className="usage-n">{fmt(g.prompt + g.completion)}</b>
              <span className="usage-n">{fmtUsd(g.cost)}</span>
              <span className="usage-n muted">{fmt(g.prompt)} / {fmt(g.completion)}</span>
              <span className="usage-n muted">{g.requests}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <Modal title="Usage" onClose={onClose} wide>
      <div className="usage-bar-row">
        <Segmented label="Period" value={range} onChange={setRange} options={[['1', '24 hours'], ['7', '7 days'], ['30', '30 days'], ['all', 'All time']]} />
        <Select value={proj} onChange={(e) => setProj(e.target.value)} aria-label="Project">
          <option value="">All projects</option><option value="__none">No project</option>
          {projects.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
        </Select>
      </div>
      {rows === null ? <div className="skeleton-rows" role="status" aria-label="Loading"><i /><i /><i /></div> : (
        <>
          <div className="usage-cards">
            <div><span className="muted small">Total tokens</span><b>{fmt(total.p + total.c)}</b></div>
            <div><span className="muted small">Prompt (in)</span><b>{fmt(total.p)}</b></div>
            <div><span className="muted small">Response (out)</span><b>{fmt(total.c)}</b></div>
            <div><span className="muted small">Requests</span><b>{list.length}</b></div>
            <div title="Estimated from list prices and the prices set per model in Providers; cached tokens are billed at 10%; image/video generation is not included"><span className="muted small">Est. cost</span><b>{fmtUsd(list.reduce((t, r) => t + costOf(r), 0))}</b></div>
          </div>
          <div className="usage-chart" title="Tokens per day, last 14 days">
            {days.map((d) => <div key={d.start} className="usage-col" title={`${new Date(d.start).toLocaleDateString()}: ${fmt(d.tokens)} tokens`}><i style={{ height: `${(d.tokens / dayMax) * 100}%` }} /><span>{d.label}</span></div>)}
          </div>
          <ClaudeUsageFor compact={false} />
          <Table title="By model" data={byModel} />
          <Table title="By chat" data={byChat} />
          <Table title="By project" data={byProject} />
          <small className="hint">
            {total.e > 0 ? `${total.e} of ${list.length} requests were estimated (~4 characters per token) because the endpoint did not report usage. ` : ''}
            Incognito chats are not counted. Only token counts are stored, never message text.
          </small>
        </>
      )}
      <div className="actions-row">
        {rows && rows.length > 0 && <button className="danger" onClick={() => askConfirm({ title: 'Reset stats', message: 'Delete all usage stats?', confirmLabel: 'Delete', danger: true }).then((ok) => ok && window.api.usageClear().then(setRows))}>Reset stats</button>}
        <span style={{ flex: 1 }} />
        {!page && <button className="primary" onClick={onClose}>Done</button>}
      </div>
    </Modal>
  );
}

export function MemoryModal({ memory, enabled, onChange, onToggle, onClose }) {
  const page = useContext(PageContext);
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('new');
  // MEMORY.md has no per-fact dates, so a fact's place in the file is its age (new facts are appended)
  const shown = filterSort(memory, { q, sort, text: (m) => m.text, at: (_, i) => i });
  const add = () => {
    if (!text.trim()) return;
    onChange([...memory, { id: Math.random().toString(36).slice(2, 8), text: text.trim().slice(0, 500), createdAt: Date.now() }]);
    setText('');
  };
  return (
    <Modal title="Memory" sub="The assistant knows these facts in every chat. You can say “remember this” in a chat, and the assistant can save facts itself." onClose={onClose} wide>
      <div className="mem-card">
        <div className="mem-on">
          <span><b>Memory</b><small>{enabled ? `${memory.length} fact${memory.length === 1 ? '' : 's'} known in every chat` : 'Off: chats start without these facts'}</small></span>
          <Switch checked={enabled} onChange={onToggle} label="Memory on" />
        </div>
        <div className="mem-add">
          <input value={text} placeholder="Add a new fact…" aria-label="New fact" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
          <button className="primary" onClick={add} disabled={!text.trim()}>Add</button>
        </div>
      </div>
      {memory.length > 0 && <ListTools q={q} onQ={setQ} sort={sort} onSort={setSort} placeholder="Search memory…" />}
      <div className="mem-list">
        {shown.length === 0 && <div className="mem-empty">{memory.length ? 'No facts match your search.' : 'Nothing remembered yet.'}</div>}
        {shown.map((m) => (
          <div key={m.id} className="mem-item">
            <input value={m.text} aria-label="Fact" onChange={(e) => onChange(memory.map((x) => (x.id === m.id ? { ...x, text: e.target.value } : x)))} />
            <button title="Delete" aria-label="Delete" onClick={() => onChange(memory.filter((x) => x.id !== m.id))}><Icon name="x" size={14} /></button>
          </div>
        ))}
      </div>
      <div className="actions-row">
        {memory.length > 0 && <button onClick={() => askConfirm({ title: 'Delete memory', message: 'Delete all memory?', confirmLabel: 'Delete all', danger: true }).then((ok) => ok && onChange([]))}>Delete all</button>}
        <span style={{ flex: 1 }} />
        {!page && <button className="primary" onClick={onClose}>Done</button>}
      </div>
    </Modal>
  );
}

export function ProjectModal({ project, onSave, onDelete, onClose }) {
  const [p, setP] = useState(project || { name: '', instructions: '', folder: '' });
  const pick = async () => { const f = await window.api.pickFolder(); if (f) setP({ ...p, folder: f, name: p.name || f.split(/[\\/]/).pop() }); };
  const [logoErr, setLogoErr] = useState('');
  const pickLogo = async () => { const r = await window.api.pickProjectLogo(p.folder); if (r?.ok) { setLogoErr(''); setP((x) => ({ ...x, logo: r.logo })); } else if (r && !r.canceled) setLogoErr(r.error || 'Could not set the logo.'); };
  const clearLogo = async () => { await window.api.clearProjectLogo(p.folder); setP((x) => ({ ...x, logo: '' })); };
  return (
    <Modal title={project ? 'Project settings' : 'New project'} onClose={onClose}>
      <Field label="Project name"><input autoFocus value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} /></Field>
      <Field label="Project logo" hint={logoErr || "Shown in the sidebar. Saved in the project's .artemis folder."}>
        <div className="mem-add">
          <ProjectLogo logo={p.logo} size={32} />
          <button onClick={pickLogo}>Choose…</button>
          {p.logo && <button onClick={clearLogo}>Remove</button>}
        </div>
      </Field>
      <Field label="Project folder" hint="The assistant can read and write files in this folder (writes ask for approval).">
        <div className="mem-add">
          <input readOnly value={p.folder || ''} placeholder="No folder selected" />
          <button onClick={pick}>Choose…</button>
          {p.folder && <button onClick={() => setP({ ...p, folder: '' })}>Remove</button>}
        </div>
      </Field>
      <Field label="Project instructions" hint="Added to every chat in this project.">
        <textarea rows={5} value={p.instructions} onChange={(e) => setP({ ...p, instructions: e.target.value })} placeholder="e.g. This project is for client reports. Write formally." />
      </Field>
      <div className="actions-row">
        {project && <button className="danger" onClick={() => askConfirm({ title: 'Delete project', message: 'Delete this project? Files in the folder are kept; chats become project-less.', confirmLabel: 'Delete', danger: true }).then((ok) => ok && onDelete(project.id))}>Delete project</button>}
        <span style={{ flex: 1 }} />
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!p.name.trim()} onClick={() => onSave({ ...p, name: p.name.trim() })}>Save</button>
      </div>
    </Modal>
  );
}


export function FilePreviewModal({ file, onClose }) {
  const a = file;
  const [note, setNote] = useState(file._note || '');
  const sheets = a.kind === 'sheet' ? splitSheets(a.text) : null;
  const [tab, setTab] = useState(0);
  const phone = async () => {
    const r = await window.api.sendFileToPhone(a.path);
    setNote(r.ok ? 'Sent to your phone.' : r.error);
  };
  const shown = sheets ? sheets[Math.min(tab, sheets.length - 1)] : null;
  return (
    <Modal title={a.name} onClose={onClose} wide>
      <div className="preview">
        {a.kind === 'image' && (a.dataUrl || a.url) && <img className="preview-img" src={a.dataUrl || a.url} alt={a.name} />}
        {shown && (
          <>
            {sheets.length > 1 && <div className="tabs">{sheets.map((sh, i) => <button key={i} className={i === tab ? 'active' : ''} onClick={() => setTab(i)}>{sh.name}</button>)}</div>}
            <div className="table-wrap">
              <table>
                <tbody>{shown.rows.slice(0, 200).map((r, i) => <tr key={i}>{r.map((c, j) => (i === 0 ? <th key={j}>{c}</th> : <td key={j}>{c}</td>))}</tr>)}</tbody>
              </table>
              {shown.rows.length > 200 && <small>Showing the first 200 rows of {shown.rows.length}.</small>}
            </div>
          </>
        )}
        {a.kind !== 'image' && !shown && <pre className="plain preview-text">{(a.text || '').slice(0, 30000)}{(a.text || '').length > 30000 ? '\n…' : ''}</pre>}
        {a.kind === 'error' && <div className="error">{a.error}</div>}
      </div>
      {note && <small className="hint">{note}</small>}
      <div className="actions-row">
        {a.path && <button onClick={() => window.api.openPath(a.path)}>Open</button>}
        {a.path && <button onClick={() => window.api.revealPath(a.path)}>Show in folder</button>}
        {a.path && <button onClick={phone}>Send to phone</button>}
        <button className="primary" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}

// ---------- Connectors (MCP) ----------
const splitArgs = (str) => {
  const out = []; const re = /"([^"]*)"|'([^']*)'|(\S+)/g; let m;
  while ((m = re.exec(str || ''))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
};
const parseLines = (text, sep) => {
  const o = {};
  for (const line of String(text || '').split('\n')) {
    const i = line.indexOf(sep);
    if (i > 0) o[line.slice(0, i).trim()] = line.slice(i + sep.length).trim();
  }
  return o;
};
const dumpLines = (obj, sep) => Object.entries(obj || {}).map(([k, v]) => `${k}${sep}${v}`).join('\n');

const PRESETS = [
  { label: 'Filesystem', name: 'Filesystem', type: 'stdio', command: 'npx', args: '-y @modelcontextprotocol/server-filesystem ~/Documents' },
  { label: 'Memory', name: 'Memory', type: 'stdio', command: 'npx', args: '-y @modelcontextprotocol/server-memory' },
  { label: 'Fetch', name: 'Fetch', type: 'stdio', command: 'uvx', args: 'mcp-server-fetch' }
];

const FULL_ACCESS_KEYS = ['toolsEnabled', 'shellEnabled', 'computerEnabled', 'webEnabled', 'notesAi', 'memoryEnabled', 'connectorsEnabled', 'skillsEnabled', 'delegateEnabled', 'browserTools'];

/** Artemis's own tools, listed like a connector, with one switch that gives them full access. */
function ArtemisBuiltin({ settings, onApply }) {
  const [tools, setTools] = useState([]);
  const [show, setShow] = useState(false);
  useEffect(() => { window.api.artemisTools().then(setTools).catch(() => {}); }, []);
  const s = settings || {};
  const full = FULL_ACCESS_KEYS.every((k) => s[k] !== false && !!s[k]) && !!s.autoApproveEdits;
  const toggle = () => onApply?.(full ? { autoApproveEdits: false } : { ...Object.fromEntries(FULL_ACCESS_KEYS.map((k) => [k, true])), autoApproveEdits: true });
  return (
    <div className="conn connected">
      <Icon name="check" size={16} className="conn-state" />
      <div className="conn-main">
        <div className="conn-name">Artemis <span className="muted small">built-in</span></div>
        <div className="muted small conn-sub">
          {tools.length} tool{tools.length === 1 ? '' : 's'}{show ? '' : ': ' + tools.slice(0, 6).map((t) => t.name).join(', ') + (tools.length > 6 ? '…' : '')}
          {tools.length > 0 && <> · <button type="button" className="text-link" onClick={() => setShow(!show)}>{show ? 'Hide tools' : 'Show all tools'}</button></>}
        </div>
        <div className="muted small conn-sub">Full access: every Artemis tool (files, terminal, computer control, web, notes, memory, connectors) is on and runs without asking. Deleting files still asks. Turn it off to go back to "ask every time".</div>
        {show && (
          <div className="conn-tools">
            {tools.map((t) => (
              <div key={t.name} className="conn-tool"><code>{t.name}</code>{t.description ? <span className="muted small">{t.description}</span> : null}</div>
            ))}
          </div>
        )}
      </div>
      <span className="muted small">Full access</span>
      <Switch checked={full} onChange={toggle} label="Full access" />
    </div>
  );
}

export function ConnectorsModal({ onClose, onChanged, settings, onApply }) {
  const page = useContext(PageContext);
  const [list, setList] = useState([]);
  const [status, setStatus] = useState([]);
  const [form, setForm] = useState(null); // editing/adding
  const [importText, setImportText] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState({}); // connector id -> its tool list is expanded

  const refresh = async () => {
    const st = await window.api.mcpStatus();
    setStatus(st); onChanged?.(st.filter((x) => x.state === 'connected').length);
    return st;
  };
  useEffect(() => {
    window.api.mcpList().then(setList);
    refresh();
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, []);

  const persist = async (next) => {
    setBusy(true); setList(next);
    try { setStatus(await window.api.mcpSave(next)); onChanged?.((await window.api.mcpStatus()).filter((x) => x.state === 'connected').length); }
    finally { setBusy(false); }
  };
  const stOf = (id) => status.find((s) => s.id === id);

  const saveForm = async () => {
    const f = form;
    if (!f.name.trim()) return setErr('Name is required.');
    if (f.type === 'stdio' && !f.command.trim()) return setErr('Command is required.');
    if (f.type === 'http' && !/^https?:\/\//.test(f.url.trim())) return setErr('Enter a valid http(s) URL.');
    const authHeaders = {};
    if (f.type === 'http' && f.authType && f.authToken.trim()) {
      if (f.authType === 'bearer') authHeaders.Authorization = `Bearer ${f.authToken.trim()}`;
      if (f.authType === 'apiKey') authHeaders['X-API-Key'] = f.authToken.trim();
    }
    const item = {
      id: f.id || Math.random().toString(36).slice(2, 10), name: f.name.trim(), type: f.type, enabled: true,
      command: f.command.trim(), args: splitArgs(f.args), env: parseLines(f.env, '='), url: f.url.trim(),
      headers: { ...parseLines(f.headers, ':'), ...authHeaders },
      oauth: f.oauthAccessToken ? { accessToken: f.oauthAccessToken, refreshToken: f.oauthRefreshToken || '', expiresAt: f.oauthExpiresAt || 0 } : undefined,
      authorizationUrl: f.authorizationUrl?.trim() || '', tokenUrl: f.tokenUrl?.trim() || '', clientId: f.clientId?.trim() || '', scope: f.scope?.trim() || ''
    };
    setErr(''); setForm(null);
    await persist(f.id ? list.map((x) => (x.id === f.id ? item : x)) : [...list, item]);
  };
  const edit = (c) => {
    const headers = c.headers || {};
    const authType = headers.Authorization?.startsWith('Bearer ') ? 'bearer' : headers['X-API-Key'] ? 'apiKey' : 'none';
    const authToken = authType === 'bearer' ? headers.Authorization.slice(7) : authType === 'apiKey' ? headers['X-API-Key'] : '';
    const visibleHeaders = { ...headers };
    delete visibleHeaders.Authorization; delete visibleHeaders['X-API-Key'];
    setForm({ id: c.id, name: c.name, type: c.type, command: c.command || '', args: (c.args || []).map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' '), env: dumpLines(c.env, '='), url: c.url || '', headers: dumpLines(visibleHeaders, ': '), authType, authToken, authorizationUrl: c.authorizationUrl || '', tokenUrl: c.tokenUrl || '', clientId: c.clientId || '', clientSecret: c.clientSecret || '', scope: c.scope || '', oauthAccessToken: c.oauth?.accessToken || '', oauthRefreshToken: c.oauth?.refreshToken || '', oauthExpiresAt: c.oauth?.expiresAt || 0 });
  };
  const doImport = async () => {
    const r = await window.api.mcpImport(importText);
    if (!r.ok) return setErr(r.error);
    setErr(''); setShowImport(false); setImportText('');
    await persist([...list, ...r.servers]);
  };
  const f = form;
  const setF = (k) => (e) => setForm({ ...f, [k]: e.target.value });
  const setUrl = (e) => {
    const url = e.target.value;
    const google = /drivemcp\.googleapis\.com/i.test(url);
    setForm({ ...f, url,
      ...(google && !f.authorizationUrl ? { authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth' } : {}),
      ...(google && !f.tokenUrl ? { tokenUrl: 'https://oauth2.googleapis.com/token' } : {}),
      ...(google && !f.scope ? { scope: 'https://www.googleapis.com/auth/drive.readonly' } : {})
    });
  };

  return (
    <Modal title="Connectors" sub="Connect MCP servers so the assistant can use their tools (databases, GitHub, Notion, browsers, files…). Each connector asks for approval once per task, unless its tool is read-only." onClose={onClose} wide>
      <ArtemisBuiltin settings={settings} onApply={onApply} />
      {list.length === 0 && !f && <div className="empty-card small-card"><Icon name="plug" size={24} /><span>No connectors yet.</span></div>}
      {list.map((c) => {
        const st = stOf(c.id);
        const state = !c.enabled ? 'off' : st?.state || 'connecting';
        const icon = state === 'connected' ? 'check' : state === 'error' ? 'warning' : state === 'off' ? 'x' : 'spinner';
        return (
          <div key={c.id} className={`conn ${state}`}>
            <Icon name={icon} size={16} className="conn-state" />
            <div className="conn-main">
              <div className="conn-name">{c.name} <span className="muted small">{c.type === 'http' ? 'remote' : 'local'}</span></div>
              <div className="muted small conn-sub">
                {state === 'connected' ? `${st.tools.length} tool${st.tools.length === 1 ? '' : 's'}${open[c.id] ? '' : ': ' + st.tools.slice(0, 6).join(', ') + (st.tools.length > 6 ? '…' : '')}` : state === 'error' ? st.error : state === 'off' ? 'Disabled' : 'Connecting…'}
                {state === 'connected' && st.tools.length > 0 && <> · <button type="button" className="text-link" onClick={() => setOpen({ ...open, [c.id]: !open[c.id] })}>{open[c.id] ? 'Hide tools' : 'Show all tools'}</button></>}
              </div>
              {state === 'connected' && open[c.id] && (
                <div className="conn-tools">
                  {(st.toolInfo || st.tools.map((n) => ({ name: n }))).map((t) => (
                    <div key={t.name} className="conn-tool">
                      <code>{t.name}</code>{t.readOnly ? <span className="conn-ro">read-only</span> : null}
                      {t.description ? <span className="muted small">{t.description}</span> : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <Switch checked={c.enabled !== false} label={'Enable ' + c.name} onChange={() => persist(list.map((x) => (x.id === c.id ? { ...x, enabled: !(x.enabled !== false) } : x)))} />
            <button className="icon-btn" title="Edit" aria-label="Edit" onClick={() => edit(c)}><Icon name="pencil" size={15} /></button>
            <button className="icon-btn" title="Remove" aria-label="Remove" onClick={() => askConfirm({ title: 'Remove connector', message: `Remove "${c.name}"?`, confirmLabel: 'Remove', danger: true }).then((ok) => ok && persist(list.filter((x) => x.id !== c.id)))}><Icon name="trash" size={15} /></button>
          </div>
        );
      })}

      {f && (
        <div className="conn-form">
          <div className="row">
            <Field label="Name"><input autoFocus value={f.name} onChange={setF('name')} placeholder="e.g. GitHub" /></Field>
            <Field label="Type">
              <Select value={f.type} onChange={setF('type')}><option value="stdio">Local (command)</option><option value="http">Remote (URL)</option></Select>
            </Field>
          </div>
          {f.type === 'stdio' ? (
            <>
              <div className="row">
                <Field label="Command"><input value={f.command} onChange={setF('command')} placeholder="npx" /></Field>
                <Field label="Arguments"><input value={f.args} onChange={setF('args')} placeholder="-y @modelcontextprotocol/server-github" /></Field>
              </div>
              <Field label="Environment variables" hint="One per line: KEY=value (e.g. GITHUB_PERSONAL_ACCESS_TOKEN=…). Stored on this computer."><textarea rows={3} value={f.env} onChange={setF('env')} /></Field>
            </>
          ) : (
            <>
              <Field label="Server URL"><input value={f.url} onChange={setUrl} placeholder="https://example.com/mcp" /></Field>
              <div className="row">
                <Field label="Authentication">
                  <Select value={f.authType || 'none'} onChange={setF('authType')}>
                    <option value="none">None</option><option value="bearer">Bearer token</option><option value="apiKey">API key (X-API-Key)</option>
                  </Select>
                </Field>
                {(f.authType && f.authType !== 'none') && <Field label={f.authType === 'bearer' ? 'Bearer token' : 'API key'} hint="Stored locally with the connector settings."><input type="password" autoComplete="off" value={f.authToken || ''} onChange={setF('authToken')} placeholder="Paste token…" /></Field>}
              </div>
              <Field label="Additional headers" hint="One per line: Header: value."><textarea rows={3} value={f.headers} onChange={setF('headers')} /></Field>
              <fieldset className="group"><legend>OAuth 2.1</legend>
                <div className="row"><Field label="Authorization URL"><input value={f.authorizationUrl || ''} onChange={setF('authorizationUrl')} placeholder="https://provider/authorize" /></Field><Field label="Token URL"><input value={f.tokenUrl || ''} onChange={setF('tokenUrl')} placeholder="https://provider/token" /></Field></div>
                <div className="row"><Field label="Client ID"><input value={f.clientId || ''} onChange={setF('clientId')} /></Field><Field label="Client secret (optional)" hint="Google OAuth client secret is required for this flow."><input type="password" autoComplete="off" value={f.clientSecret || ''} onChange={setF('clientSecret')} /></Field></div>
                <Field label="Scope"><input value={f.scope || ''} onChange={setF('scope')} placeholder="https://www.googleapis.com/auth/drive.readonly" /></Field>
                <div className="row"><button type="button" onClick={async () => { const r = await window.api.mcpOAuthStart(f); if (r.ok) setForm({ ...f, oauthAccessToken: r.oauth.accessToken, oauthRefreshToken: r.oauth.refreshToken, oauthExpiresAt: r.oauth.expiresAt }); else setErr(r.error); }}>Sign in with OAuth</button>{f.oauthAccessToken && <small className="hint">OAuth connected</small>}</div>
              </fieldset>
            </>
          )}
          <div className="actions-row"><button onClick={() => { setForm(null); setErr(''); }}>Cancel</button><button className="primary" onClick={saveForm}>{f.id ? 'Save' : 'Add connector'}</button></div>
        </div>
      )}

      {showImport && (
        <div className="conn-form">
          <Field label="Paste JSON" hint='Claude Desktop format: {"mcpServers": {"name": {"command": "npx", "args": [...]}}}'>
            <textarea rows={6} value={importText} onChange={(e) => setImportText(e.target.value)} />
          </Field>
          <div className="actions-row"><button onClick={() => { setShowImport(false); setErr(''); }}>Cancel</button><button className="primary" disabled={!importText.trim()} onClick={doImport}>Import</button></div>
        </div>
      )}

      {err && <div className="error">{err}</div>}
      {!f && !showImport && (
        <>
          <div className="preset-row">
            <button className="primary" onClick={() => setForm({ name: '', type: 'stdio', command: '', args: '', env: '', url: '', headers: '', authType: 'none', authToken: '' })}><Icon name="plus" size={14} /> Add connector</button>
            <button onClick={() => setShowImport(true)}><Icon name="upload" size={14} /> Import JSON</button>
            <span className="muted small">Quick add:</span>
            {PRESETS.map((p) => <button key={p.label} onClick={() => setForm({ ...p, env: '', url: '', headers: '', authType: 'none', authToken: '' })}>{p.label}</button>)}
          </div>
          {busy && <small className="hint">Connecting…</small>}
        </>
      )}
      {!page && <div className="actions-row"><span style={{ flex: 1 }} /><button className="primary" onClick={onClose}>Done</button></div>}
    </Modal>
  );
}


export function PermissionsModal({ onClose, firstRun }) {
  const [st, setSt] = useState(null);
  const refresh = () => window.api.permStatus().then(setSt).catch(() => setSt({ supported: false, items: [] }));
  useEffect(() => { refresh(); window.addEventListener('focus', refresh); return () => window.removeEventListener('focus', refresh); }, []);
  const ask = async (id) => { setSt(await window.api.permRequest(id)); };
  const mark = { granted: ['Allowed', 'ok'], denied: ['Not allowed', 'bad'], 'not-determined': ['Not asked yet', 'warn'], unknown: ['Check in System Settings', 'warn'], restricted: ['Restricted', 'bad'] };
  return (
    <Modal title={firstRun ? 'Welcome to Artemis — a few permissions' : 'Permissions'} onClose={onClose}>
      <p className="muted small" style={{ marginTop: 0 }}>Artemis only needs these for computer control and notifications. Everything is optional, and you can change it later in System Settings.</p>
      {st === null ? <div className="muted">Checking…</div> : !st.supported ? <div className="muted">Nothing to set up on this system.</div> : (
        <div className="perm-list">
          {st.items.map((i) => {
            const [label, tone] = mark[i.status] || mark.unknown;
            return (
              <div key={i.id} className="perm-row">
                <div className="perm-main"><b>{i.title}</b><span className="muted small">{i.why}</span></div>
                <span className={`perm-state ${tone}`}>{label}</span>
                <button onClick={() => ask(i.id)} disabled={i.status === 'granted'}>{i.status === 'granted' ? 'Done' : i.id === 'notifications' ? 'Test' : 'Allow'}</button>
              </div>
            );
          })}
        </div>
      )}
      <small className="hint">macOS may ask you to restart Artemis after you allow Screen Recording or Accessibility. If you run Artemis from a terminal, allow the terminal app instead.</small>
      <div className="actions-row"><span style={{ flex: 1 }} /><button className="primary" onClick={onClose}>{firstRun ? 'Continue' : 'Done'}</button></div>
    </Modal>
  );
}

export function ProfileModal({ settings, avatar, onAvatar, onSave, onClose }) {
  const api = window.api;
  const [name, setName] = useState(settings.profileName || '');
  const [about, setAbout] = useState(settings.profileAbout || '');
  const [place, setPlace] = useState(settings.profileLocation || '');
  const [err, setErr] = useState('');
  const pick = async () => {
    setErr('');
    const r = await api.profilePickAvatar();
    if (r && r.ok) onAvatar(r.avatar); else if (r && r.error) setErr(r.error);
  };
  const clear = async () => { const r = await api.profileClearAvatar(); onAvatar(r.avatar); };
  return (
    <Modal title="Your profile" onClose={onClose}>
      <div className="pf-head">
        {avatar ? <img className="pf-avatar" src={avatar} alt="" /> : <span className="pf-avatar blank">{name.trim().slice(0, 1).toUpperCase() || '?'}</span>}
        <div className="pf-actions">
          <button onClick={pick}>{avatar ? 'Change picture' : 'Add picture'}</button>
          {avatar && <button onClick={clear}>Remove</button>}
          <button onClick={() => api.profileReveal()}>Open folder</button>
        </div>
      </div>
      <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="How Artemis should address you" /></Field>
      <Field label="Where you are" hint="City and country. Artemis uses it for “near me” questions without asking. Leave empty and it can look up your approximate location from your IP address instead (it asks first).">
        <input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="City, country" />
      </Field>
      <Field label="About you">
        <textarea rows={7} value={about} onChange={(e) => setAbout(e.target.value)} placeholder={'Your role, what you work on, the languages you use, how you like answers (short, direct, ...).\nArtemis reads this in every chat.'} />
        <small>Saved on this computer only. Your picture (GIFs work too) is stored in ~/.artemis/user/images. Leave empty to share nothing.</small>
      </Field>
      {err && <small className="hint err">{err}</small>}
      <div className="actions-row"><span style={{ flex: 1 }} /><button onClick={onClose}>Cancel</button><button className="primary" onClick={() => onSave({ profileName: name.trim(), profileAbout: about.trim(), profileLocation: place.trim() })}>Save</button></div>
    </Modal>
  );
}
