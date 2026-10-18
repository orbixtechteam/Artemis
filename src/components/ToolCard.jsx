import React, { memo, useEffect, useRef, useState } from 'react';
import { openPreview } from '../lib/preview.js';
import { lineDiff, withContext } from '../lib/diff.js';
import { Icon } from './Icons.jsx';

const LABELS = {
  list_dir: ['folderOpen', 'Listed folder'],
  read_file: ['file', 'Read file'],
  search_files: ['search', 'Searched files'],
  write_file: ['pencil', 'Writing file'],
  edit_file: ['edit', 'Editing file'],
  write_spreadsheet: ['sheet', 'Creating spreadsheet'],
  update_cells: ['calc', 'Updating cells'],
  create_folder: ['folderPlus', 'Created folder'],
  move_file: ['move', 'Moving file'],
  delete_file: ['trash', 'Deleting'],
  web_search: ['globe', 'Searched the web'],
  web_fetch: ['globe', 'Read web page'],
  run_command: ['terminal', 'Terminal command'],
  computer: ['monitor', 'Computer'],
  terminal_run: ['terminal', 'Ran in terminal'],
  terminal_read: ['terminal', 'Read terminal'],
  notes_list: ['file', 'Browsed Notes'],
  notes_search: ['search', 'Searched Notes'],
  notes_read: ['file', 'Read a note'],
  notes_write: ['pencil', 'Wrote a note'],
  notes_append: ['pencil', 'Added to a note'],
  send_to_phone: ['phone', 'Sent to phone'],
  schedule_task: ['clock', 'Scheduled a task'],
  list_schedules: ['clock', 'Listed scheduled tasks'],
  delete_schedule: ['trash', 'Deleted a scheduled task'],
  create_artifact: ['artifact', 'Created artifact'],
  generate_image: ['image', 'Generated image'],
  generate_video: ['video', 'Generated video'],
  memory_save: ['bulb', 'Saved to memory'],
  memory_forget: ['bulb', 'Removed from memory'],
  use_skill: ['sparkle', 'Used skill'],
  create_skill: ['sparkle', 'Saved a skill'],
  update_skill: ['sparkle', 'Improved a skill'],
  search_chats: ['search', 'Searched your chats'],
  read_chat: ['file', 'Read a chat'],
  delegate: ['sparkle', 'Agents'],
  browser_tabs: ['globe', 'Browser tabs'],
  browser_navigate: ['globe', 'Opened page'],
  browser_read_page: ['globe', 'Read page'],
  browser_get_text: ['globe', 'Read page text'],
  browser_find: ['search', 'Found on page'],
  browser_click: ['globe', 'Clicked'],
  browser_type: ['pencil', 'Typed'],
  browser_form_input: ['pencil', 'Filled a field'],
  browser_key: ['globe', 'Pressed keys'],
  browser_scroll: ['globe', 'Scrolled'],
  browser_screenshot: ['image', 'Browser screenshot'],
  browser_javascript: ['code', 'Ran page script'],
  browser_console: ['code', 'Read console'],
  browser_network: ['code', 'Read network'],
  browser_wait: ['clock', 'Waited']
};

export function labelFor(name) {
  if (LABELS[name]) return LABELS[name];
  const m = /^mcp__(.+?)__(.+)$/.exec(name);
  if (m) return ['plug', `${m[1].replace(/_/g, ' ')} · ${m[2].replace(/_/g, ' ')}`];
  return ['wrench', name];
}

const FILE_TOOLS = new Set(['write_file', 'edit_file', 'write_spreadsheet', 'update_cells']);

export function target(tc) {
  const a = tc.args || {};
  if (tc.name === 'move_file') return `${a.from} to ${a.to}`;
  if (tc.name === 'memory_save') return a.text;
  if (tc.name === 'memory_forget') return a.id;
  if (tc.name === 'use_skill' || tc.name === 'create_skill' || tc.name === 'update_skill') return a.name || '';
  if (tc.name === 'search_chats') return a.query || '';
  if (tc.name === 'delegate') return (Array.isArray(a.tasks) && a.tasks.length ? a.tasks.map((t) => (typeof t === 'string' ? t : `${t.agent || 'Helper'}: ${t.task}`)).join(' | ') : `${a.agent ? a.agent + ': ' : ''}${a.task || ''}`).slice(0, 100);
  if (tc.name === 'search_files') return [a.query, a.name].filter(Boolean).join(' · ');
  if (tc.name === 'update_cells') return `${a.path} (${(a.cells || []).length} cells)`;
  if (tc.name === 'send_to_phone') return a.file_path || (a.screenshot ? 'screenshot' : a.text || '');
  if (tc.name === 'create_artifact') return a.title || '';
  if (tc.name === 'generate_image' || tc.name === 'generate_video') return String(a.prompt || '').slice(0, 100);
  if (tc.name === 'web_search') return a.query || '';
  if (tc.name === 'web_fetch') return a.url || '';
  if (tc.name.startsWith('browser_')) return String(a.url || a.query || a.keys || (a.ref ? a.ref + (a.text != null ? ': ' + a.text : a.value != null ? ' = ' + a.value : '') : a.text != null ? a.text : a.x != null ? `${a.x},${a.y}` : a.action || a.direction || a.code || '')).slice(0, 120);
  if (tc.name === 'run_command') return a.command || '';
  if (tc.name === 'computer') return [a.action, a.text || a.keys || (a.x != null ? `${a.x},${a.y}` : '')].filter(Boolean).join(' ');
  return a.path || '';
}

/** Shortens the middle of a long path or command so both ends stay readable. */
export function midTrunc(str, n = 64) {
  const t = String(str || '');
  if (t.length <= n) return t;
  const keep = n - 1; const head = Math.ceil(keep * 0.45);
  return t.slice(0, head) + '…' + t.slice(t.length - (keep - head));
}

// targets that are paths, URLs or commands: shown in monospace
const MONO = new Set(['read_file', 'list_dir', 'write_file', 'edit_file', 'write_spreadsheet', 'update_cells', 'create_folder', 'move_file', 'delete_file', 'run_command', 'terminal_run', 'web_fetch', 'notes_read', 'notes_write', 'notes_append']);
// completed calls of these only look at things: a run of them folds into one row
export const READ_ONLY = new Set(['read_file', 'list_dir', 'search_files', 'notes_list', 'notes_search', 'notes_read', 'terminal_read', 'search_chats', 'read_chat', 'web_fetch', 'web_search', 'list_schedules']);

function UnifiedDiff({ before, after }) {
  const rows = withContext(lineDiff(before, after), 3);
  const shown = rows.slice(0, 400);
  return (
    <pre className="udiff">
      {shown.map((r, i) => (
        <div key={i} className={`ud-row ${r.type === '+' ? 'add' : r.type === '-' ? 'del' : r.type === '…' ? 'gap' : ''}`}>
          <span className="ud-sign">{r.type === '…' ? '⋯' : r.type}</span>{r.text || ' '}
        </div>
      ))}
      {rows.length > shown.length && <div className="ud-row gap"><span className="ud-sign">⋯</span>{rows.length - shown.length} more lines</div>}
    </pre>
  );
}

function Preview({ tc }) {
  const a = tc.args || {};
  const clip = (s, n = 1500) => (s && s.length > n ? s.slice(0, n) + '\n…' : s || '');
  if (tc.name === 'edit_file') return <UnifiedDiff before={a.old_string} after={a.new_string} />;
  if (tc.name === 'write_file') return <pre className="plain">{clip(a.content)}</pre>;
  if (tc.name === 'write_spreadsheet' || tc.name === 'update_cells') {
    return <pre className="plain">{clip(JSON.stringify(tc.name === 'update_cells' ? a.cells : a.sheets, null, 1))}</pre>;
  }
  if (tc.name === 'run_command') return <pre className="plain">{a.command}</pre>;
  return null;
}

const fmtDur = (ms) => (ms < 1000 ? `${Math.max(1, Math.round(ms))}ms` : ms < 60000 ? `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s` : `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`);

function StatusIcon({ status }) {
  if (status === 'running') return <span className="tool-status running" title="Running" aria-label="Running"><Icon name="spinner" size={14} className="spin" /></span>;
  if (status === 'done') return <span className="tool-status ok" title="Done" aria-label="Done"><Icon name="check" size={14} /></span>;
  if (status === 'error') return <span className="tool-status err" title="Failed" aria-label="Failed"><Icon name="x" size={14} /></span>;
  return null;
}

function firstLine(t) { const l = String(t || '').split('\n').find((x) => x.trim()) || ''; return l.length > 160 ? l.slice(0, 159) + '…' : l; }

const HINTS = {
  computer: 'The assistant will see your screen and control the mouse and keyboard until this task ends. Stop any time with Cmd/Ctrl+Shift+Esc or the Stop button.',
  media: 'The assistant can generate images and videos until this task ends. This uses credits on your image/video provider.',
  phone: 'The assistant can send messages, files and screenshots to your phone until this task ends.',
  mcp: 'The assistant can use this connector\'s tools until this task ends.',
  shell: 'The assistant will run terminal commands on your machine until this task ends.',
  terminal_read: 'The assistant can read the integrated terminal\'s output until this task ends. It cannot type into it without asking.',
  make: 'The assistant can change and run your Make.com scenarios until this task ends.',
  notes: 'The assistant can browse, search and read your Notes until this task ends. Writing a note still asks every time.',
  library: 'The assistant can browse, search and read your Files library until this task ends. Changing a file still asks every time.',
  schedule: 'The assistant can create scheduled tasks until this task ends.',
  schedule_edit: 'The assistant can change your existing scheduled tasks until this task ends.',
  schedule_delete: 'The assistant can delete scheduled tasks until this task ends.',
  location: 'The assistant can look up your approximate location from your IP address for this task.',
  'outside-read': 'The assistant can read files in this folder outside the project (read-only) until this task ends.',
  'sensitive-read': 'This location may hold credentials, browser or app data, so it is asked every time.',
  'browser-js': 'The assistant can run JavaScript in the integrated browser\'s pages until this task ends. It can read and change anything on the page, including pages where you are signed in.',
  generic: 'Allowing applies to this kind of action until this task ends.'
};
const hintFor = (cat) => {
  const c = String(cat || '');
  if (HINTS[c]) return HINTS[c];
  if (c.startsWith('browser-site:')) return `The assistant can open pages, click, type and fill forms on ${c.slice(13)} in the integrated browser until this task ends. You see everything it does in the browser panel and can stop it any time.`;
  if (c.startsWith('mcp-read:')) return `The assistant can use the read-only tools of ${c.slice(9)} until this task ends.`;
  if (c.startsWith('mcp:')) return HINTS.mcp;
  return HINTS.generic;
};

function Hint({ text }) {
  const cut = text.indexOf('. ');
  if (text.length < 110 || cut < 0) return <small className="hint">{text}</small>;
  return <details className="hint hint-more"><summary>{text.slice(0, cut + 1)}</summary>{text.slice(cut + 2)}</details>;
}

/** The approval box: what will happen, the diff for edits, Allow / Deny. ⌘↵ allows and Esc denies, only on the newest pending card. */
function Approve({ tc, onDecide }) {
  const ref = useRef(null);
  useEffect(() => {
    const k = (e) => {
      const isAllow = e.key === 'Enter' && (e.metaKey || e.ctrlKey);
      const isDeny = e.key === 'Escape';
      if (!isAllow && !isDeny) return;
      const all = document.querySelectorAll('.approve[data-pending="1"]');
      if (!ref.current || all[all.length - 1] !== ref.current) return;
      if (isDeny && document.querySelector('.modal.dialog, .ctx-menu, .slash-pop')) return; // Esc belongs to the pop-up
      e.preventDefault(); e.stopPropagation();
      onDecide(tc.id, isAllow);
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [tc.id, onDecide]);
  const path = tc.args && tc.args.path;
  const mac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || '');
  return (
    <div className="approve" ref={ref} data-pending="1">
      {tc.agent && <div className="approve-who">{tc.agent} agent wants to: {tc.summary || labelFor(tc.name)[1]}</div>}
      {path && (tc.name === 'edit_file' || tc.name === 'write_file') && <div className="approve-file" title={path}><Icon name="file" size={13} /> <code>{midTrunc(path, 80)}</code></div>}
      <Preview tc={tc} />
      {tc.session && <Hint text={hintFor(tc.category)} />}
      <div className="approve-actions">
        <button className="primary" onClick={() => onDecide(tc.id, true)} title={`${mac ? '⌘' : 'Ctrl+'}Enter`}>{tc.session ? 'Allow for this task' : 'Allow'} <kbd>{mac ? '⌘↵' : 'Ctrl+↵'}</kbd></button>
        <button className="secondary" onClick={() => onDecide(tc.id, false)} title="Esc">Deny <kbd>Esc</kbd></button>
        <span style={{ flex: 1 }} />
        {path && <button className="ghost" onClick={() => openPreview({ project: true, path, action: 'reveal' })}>Open folder</button>}
      </div>
    </div>
  );
}

/** Splits a step's tool calls into single cards and runs of 2+ finished read-only calls. */
export function groupToolCalls(list) {
  const out = []; let run = [];
  const flush = () => {
    if (run.length >= 2) out.push({ key: 'g' + run[0].id, group: run });
    else run.forEach((tc) => out.push({ key: tc.id, tc }));
    run = [];
  };
  for (const tc of list || []) {
    if (READ_ONLY.has(tc.name) && tc.status === 'done' && !(tc.agents && tc.agents.length)) run.push(tc);
    else { flush(); out.push({ key: tc.id, tc }); }
  }
  flush();
  return out;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
function groupLabel(calls) {
  const c = {}; calls.forEach((t) => { c[t.name] = (c[t.name] || 0) + 1; });
  const parts = [];
  const files = (c.read_file || 0) + (c.notes_read || 0) + (c.read_chat || 0);
  if (files) parts.push(`Read ${plural(files, 'file', 'files')}`);
  if (c.list_dir || c.notes_list) parts.push(`listed ${plural((c.list_dir || 0) + (c.notes_list || 0), 'folder', 'folders')}`);
  const searches = (c.search_files || 0) + (c.notes_search || 0) + (c.search_chats || 0) + (c.web_search || 0);
  if (searches) parts.push(`${plural(searches, 'search', 'searches')}`);
  if (c.web_fetch) parts.push(`fetched ${plural(c.web_fetch, 'page', 'pages')}`);
  const other = calls.length - files - (c.list_dir || 0) - (c.notes_list || 0) - searches - (c.web_fetch || 0);
  if (other > 0) parts.push(plural(other, 'other step', 'other steps'));
  const s = parts.join(', ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const ToolGroup = memo(function ToolGroup({ calls, onDecide }) {
  const [open, setOpen] = useState(false);
  const dur = calls.reduce((a, t) => a + (t.startedAt && t.endedAt ? t.endedAt - t.startedAt : 0), 0);
  return (
    <div className="tool group done">
      <button className="tool-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="tool-icon"><Icon name="layers" size={15} /></span>
        <span className="tool-label">{groupLabel(calls)}</span>
        <span className="tool-target" />
        {dur > 0 && <span className="tool-dur">{fmtDur(dur)}</span>}
        <StatusIcon status="done" />
        <span className="chev"><Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} /></span>
      </button>
      {open && <div className="tool-group-body">{calls.map((tc) => <ToolCard key={tc.id} tc={tc} onDecide={onDecide} />)}</div>}
    </div>
  );
});

const kTok = (n) => (n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n || 0));

function AgentCard({ a, onDecide }) {
  const [open, setOpen] = useState(a.status === 'running');
  const waiting = (a.tools || []).some((t) => t.status === 'awaiting');
  const badge = { running: waiting ? 'waiting for you' : 'working…', done: 'done', error: 'failed', cancelled: 'stopped' }[a.status] || '';
  const last = (a.tools || []).slice(-1)[0];
  return (
    <div className={`agent-card ${a.status}`}>
      <button className="agent-head" onClick={() => setOpen(!open)}>
        <span className="agent-name">{a.name || 'Agent'}</span>{a.role && <span className="agent-role">{a.role}</span>}
        <span className="agent-model">{a.model || ''}</span>
        <span className="agent-stat">{(a.tools || []).length} {(a.tools || []).length === 1 ? "tool" : "tools"} · {kTok((a.prompt || 0) + (a.completion || 0))} tokens</span>
        <span className={`badge ${a.status}`}>{badge}</span>
        <span className="chev"><Icon name={open || waiting ? 'chevronDown' : 'chevronRight'} size={14} /></span>
      </button>
      <div className="agent-task">{a.task}</div>
      {(open || waiting) && (
        <div className="agent-body">
          {(a.tools || []).map((t) => <ToolCard key={t.id} tc={t} onDecide={onDecide} />)}
          {a.status === 'running' && !waiting && a.text && <div className="agent-live">{a.text}</div>}
          {a.error && <div className="agent-err">{a.error}</div>}
        </div>
      )}
      {!open && !waiting && a.status === 'running' && last && <div className="agent-last">{labelFor(last.name)[1]} {target(last)}</div>}
    </div>
  );
}

function ToolCard({ tc, onDecide }) {
  const status = tc.status;
  const [open, setOpen] = useState(status === 'error');
  const prev = useRef(status);
  useEffect(() => { if (status === 'error' && prev.current !== 'error') setOpen(true); prev.current = status; }, [status]);
  const [icon, label] = labelFor(tc.name);
  const awaiting = status === 'awaiting';
  const badge = { awaiting: 'awaiting approval', denied: 'denied', cancelled: 'cancelled' }[status] || '';
  const tgt = target(tc);
  const mono = MONO.has(tc.name);
  const dur = tc.startedAt && tc.endedAt ? tc.endedAt - tc.startedAt : 0;
  return (
    <div className={`tool ${status}`}>
      <button className="tool-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="tool-icon"><Icon name={icon} size={15} /></span>
        <span className="tool-label">{label}</span>
        <span className={`tool-target ${mono ? 'mono' : ''}`} title={tgt}>{mono ? midTrunc(tgt, 72) : tgt}</span>
        {badge && <span className={`badge ${status}`}>{badge}</span>}
        {dur > 0 && <span className="tool-dur">{fmtDur(dur)}</span>}
        <StatusIcon status={status} />
        <span className="chev"><Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} /></span>
      </button>
      {status === 'error' && tc.result && <div className="tool-err-line">{firstLine(tc.result)}</div>}
      {tc.agents && tc.agents.length > 0 && <div className="agent-list">{tc.agents.filter(Boolean).map((a, i) => <AgentCard key={i} a={a} onDecide={onDecide} />)}</div>}
      {awaiting && <Approve tc={tc} onDecide={onDecide} />}
      {tc.status === 'done' && FILE_TOOLS.has(tc.name) && tc.args?.path && (
        <div className="file-actions">
          <button onClick={() => openPreview({ project: true, path: tc.args.path })}>Preview</button>
          <button onClick={() => openPreview({ project: true, path: tc.args.path, action: 'open' })}>Open</button>
          <button onClick={() => openPreview({ project: true, path: tc.args.path, action: 'reveal' })}>Open folder</button>
          <button onClick={() => openPreview({ project: true, path: tc.args.path, action: 'phone' })}>Send to phone</button>
        </div>
      )}
      {tc.image && !awaiting && <img className="shot" src={tc.image} alt="screenshot" />}
      {open && !awaiting && (
        <div className="tool-body">
          <Preview tc={tc} />
          {tc.result != null && <pre className="plain">{tc.result.length > 4000 ? tc.result.slice(0, 4000) + '\n…' : tc.result}</pre>}
        </div>
      )}
    </div>
  );
}

export default memo(ToolCard);
