import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Select from './Select.jsx';
import { AttachmentChip } from './Message.jsx';
import ModelPicker from './ModelPicker.jsx';
import { Icon } from './Icons.jsx';
import { ContextMenu } from './TabBar.jsx';
import { filesToAttachments, onWindowDrop } from '../lib/attach.js';
import { startRecording, transcribe, LANGS } from '../lib/voice.js';
import { costOf, fmtUsd } from '../lib/cost.js';
import { fmtTokens } from '../lib/amount.mjs';
import { ClaudeUsageFor } from './ClaudeUsage.jsx';
import { splitMentions, liveMentions, tokenBefore, cleanMentions } from '../lib/mentions.mjs';
import { useSentinelKey } from '../lib/sentinelKey.js';

// Text and attachments typed into a chat that is not on screen right now (another tab or chat), so nothing is lost when you switch.
const drafts = new Map();
// Skills, agents, connectors and Make seen in the last "@" menu: an "@name" typed by hand that matches one of them is a mention too.
let knownMentions = [];

function useOutside(ref, on, cb) {
  useEffect(() => {
    if (!on) return undefined;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) cb(); };
    const k = (e) => { if (e.key === 'Escape') cb(); };
    window.addEventListener('mousedown', h); window.addEventListener('keydown', k);
    return () => { window.removeEventListener('mousedown', h); window.removeEventListener('keydown', k); };
  }, [on]);
}

/** Usage button: today / this month at a glance, with limits when set. */
function UsageMenu({ settings, chatId, model, onDetails, onLimits, stacked }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null);
  const ref = useRef(null);
  useOutside(ref, open, () => setOpen(false));
  const toggle = async () => { const o = !open; setOpen(o); if (o) setRows(null); if (o) { try { const r = await window.api.usageGet(); setRows(Array.isArray(r) ? r : []); } catch { setRows([]); } } };
  const now = new Date(); const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(); const mon0 = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const sum = (from) => (rows || []).filter((r) => r.t >= from).reduce((a, r) => ({ t: a.t + (r.prompt || 0) + (r.completion || 0), c: a.c + costOf(r) }), { t: 0, c: 0 });
  const d = sum(day0), m = sum(mon0);
  const chatRows = (rows || []).filter((r) => chatId && r.chat === chatId);
  const ch = chatRows.reduce((a, r) => ({ t: a.t + (r.prompt || 0) + (r.completion || 0), c: a.c + costOf(r) }), { t: 0, c: 0 });
  const Row = ({ label, v, tokLimit, usdLimit }) => {
    const pct = Math.max(tokLimit ? v.t / tokLimit : 0, usdLimit ? v.c / usdLimit : 0);
    return (
      <div className="um-row">
        <div className="um-top"><span>{label}</span><b>{fmtTokens(v.t) || '0'} tokens · {fmtUsd(v.c)}</b></div>
        {(tokLimit > 0 || usdLimit > 0) && (
          <>
            <div className="um-bar"><i className={pct >= 1 ? 'over' : pct >= 0.8 ? 'warn' : ''} style={{ width: Math.min(100, pct * 100) + '%' }} /></div>
            <div className="muted small">Limit {[tokLimit > 0 ? fmtTokens(tokLimit) + ' tokens' : '', usdLimit > 0 ? fmtUsd(usdLimit) : ''].filter(Boolean).join(' / ')} · {Math.round(pct * 100)}% used</div>
          </>
        )}
      </div>
    );
  };
  return (
    <span className="um-wrap" ref={ref}>
      <button className={`icon-btn ${open ? 'on' : ''} ${stacked ? 'um-row-btn' : ''}`} title="Usage" aria-label="Usage" onClick={toggle}><Icon name="chart" size={stacked ? 15 : 17} />{stacked && <span>Usage</span>}</button>
      {open && (
        <div className="um-pop">
          <div className="um-title">Usage</div>
          {rows === null ? <div className="skeleton-rows" role="status" aria-label="Loading"><i /><i /><i /></div> : (
            <>
              <Row label="This chat" v={ch} />
              <Row label="Today" v={d} tokLimit={settings.dailyTokenLimit} usdLimit={settings.dailyUsdLimit} />
              <Row label="This month" v={m} tokLimit={settings.monthlyTokenLimit} usdLimit={settings.monthlyUsdLimit} />
              <ClaudeUsageFor model={model} />
              <small className="hint">Costs are estimates from list prices.</small>
            </>
          )}
          <div className="um-actions"><button onClick={() => { setOpen(false); onDetails(); }}>Details</button><button onClick={() => { setOpen(false); onLimits(); }}>Set limits</button></div>
        </div>
      )}
    </span>
  );
}

/** Mic button: click to record, click again to turn the speech into text. */
function MicButton({ settings, onText, onVoiceSettings, onError }) {
  const [state, setState] = useState('idle'); // idle | rec | busy
  const [secs, setSecs] = useState(0);
  const [menu, setMenu] = useState(false);
  const [lang, setLang] = useState(settings.voiceLanguage || 'auto');
  const rec = useRef(null); const wrap = useRef(null);
  useOutside(wrap, menu, () => setMenu(false));
  useEffect(() => { setLang(settings.voiceLanguage || 'auto'); }, [settings.voiceLanguage]);
  useEffect(() => {
    if (state !== 'rec') return undefined;
    setSecs(0);
    const t = setInterval(() => setSecs((x) => x + 1), 1000);
    const k = (e) => { if (e.key === 'Escape') { rec.current?.cancel(); rec.current = null; setState('idle'); } };
    window.addEventListener('keydown', k);
    return () => { clearInterval(t); window.removeEventListener('keydown', k); };
  }, [state]);
  useEffect(() => () => { rec.current?.cancel(); }, []);
  const click = async () => {
    if (state === 'busy') return;
    if (state === 'rec') {
      const r = rec.current; rec.current = null; setState('busy');
      try {
        const blob = await r.stop();
        const out = await transcribe(blob, lang);
        if (out.ok) onText(out.text); else onError(out.error);
      } catch (e) { onError((e && e.message) || String(e)); }
      setState('idle');
      return;
    }
    try { rec.current = await startRecording(); setState('rec'); } catch (e) { onError((e && e.message) || String(e)); setState('idle'); }
  };
  const mm = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  return (
    <span className="mic-wrap" ref={wrap}>
      <button className={`icon-btn mic ${state}`} title={state === 'rec' ? 'Stop and transcribe (Esc cancels)' : state === 'busy' ? 'Transcribing…' : 'Dictate'} aria-label={state === 'rec' ? 'Stop and transcribe (Esc cancels)' : state === 'busy' ? 'Transcribing…' : 'Dictate'} onClick={click}>
        {state === 'busy' ? <Icon name="spinner" size={17} /> : state === 'rec' ? <Icon name="stop" size={15} /> : <Icon name="mic" size={17} />}
      </button>
      {state === 'rec' && <span className="mic-time">{mm}</span>}
      {state === 'idle' && <button className="icon-btn mic-more" title="Voice language" aria-label="Voice language" onClick={() => setMenu(!menu)}><Icon name="chevronDown" size={13} /></button>}
      {menu && (
        <div className="um-pop mic-pop">
          <div className="um-title">Dictation language</div>
          {LANGS.map(([id, n]) => <button key={id} className={`menu-item ${lang === id ? 'on' : ''}`} onClick={() => { setLang(id); setMenu(false); window.api.setSettings({ voiceLanguage: id }); }}>{n}{lang === id && <Icon name="check" size={13} />}</button>)}
          <div className="um-actions"><button onClick={() => { setMenu(false); onVoiceSettings(); }}>Voice settings…</button></div>
        </div>
      )}
    </span>
  );
}

/** The per-chat switches (project, brain, tools, agents, permissions) and the usage button. In the main chat they are stacked in the right bar (stacked), in a split pane they sit in its header. */
export function ChatPills({ brains = [], brain, onBrain, councilPick, onRevote, tools, onTools, agents, onAgents, effort = 'auto', onEffort, perm, onPerm, projectId, projects = [], onProject, incognito, settings, chatId, model, onUsageDetails, onOpenSettings, stacked }) {
  return (
    <div className={`top-pills nodrag ${stacked ? 'stacked' : ''}`}>
      {onBrain && brains.length > 0 && (
        <>
          <Select className="pill-select brain" title="Brain mode: who answers in this chat. Council: the three brains vote on who answers and which skills and agents to use." value={brain} onChange={(e) => onBrain(e.target.value)}>
            <option value="">No brain</option>
            <option value="council">Council (vote)</option>
            {brains.map((b) => <option key={b.slug} value={b.slug}>{b.name}{b.role ? ` · ${b.role.replace(/^The /, '')}` : ''}</option>)}
          </Select>
          {brain === 'council' && councilPick && <button className="pill-select revote" title={`Council picked ${councilPick}. Click to ask the council again for the next message.`} onClick={onRevote}>Re-vote</button>}
        </>
      )}
      {onTools && (
        <Select className={`pill-select tools ${tools === 'off' ? 'off' : ''}`} title="Tools in this chat: files, memory, notes, web, terminal and the rest. Off sends a much smaller request (good for small local models and free-tier limits). The default for new chats is in Settings → General." value={tools} onChange={(e) => onTools(e.target.value)}>
          <option value="on">Tools</option>
          <option value="off">No tools</option>
        </Select>
      )}
      {onEffort && (
        <Select className={`pill-select effort ${effort === 'auto' ? 'off' : ''}`} title="Reasoning level for this chat: how much the model thinks before it answers. Low is faster and cheaper, high is slower and thinks harder. Auto leaves it to the model. Models that do not support it ignore it. The default for new chats is in Settings → General." value={effort} onChange={(e) => onEffort(e.target.value)}>
          <option value="auto">Think: auto</option>
          <option value="low">Think: low</option>
          <option value="medium">Think: medium</option>
          <option value="high">Think: high</option>
        </Select>
      )}
      {onAgents && (
        <Select className={`pill-select agents ${agents === 'off' ? 'off' : ''}`} title="Agents in this chat: when on, Artemis can hand parts of the work to your agents (Researcher, Reviewer, …). Off keeps it to one assistant and saves tokens." value={agents} onChange={(e) => onAgents(e.target.value)}>
          <option value="on">Agents</option>
          <option value="off">No agents</option>
        </Select>
      )}
      {onPerm && (
        <Select className={`pill-select perm ${perm}`} title="Auto-allow all: file edits, agent writes, web, terminal, computer control, Make and connectors run without asking. Deleting files still asks." value={perm} onChange={(e) => onPerm(e.target.value)}>
          <option value="ask">Ask first</option>
          <option value="auto">Auto-allow</option>
        </Select>
      )}
      {onProject && (
        <Select className="pill-select" title="Project" disabled={!!incognito} value={projectId || ''} onChange={(e) => onProject(e.target.value || null)}>
          <option value="">No project</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      )}
      <UsageMenu stacked={stacked} settings={settings} chatId={chatId} model={model} onDetails={onUsageDetails} onLimits={() => onOpenSettings('limits')} />
    </div>
  );
}

export default function Composer({ streaming, onSend, onStop, queue = [], queueHeld = false, onQueue, onUnqueue, onSendNow, onSendNowText, disabledReason, placeholder, model, onModel, groups = [], projectId, projects = [], onProject, incognito, settings = {}, chatId, perm = 'auto', onPerm, agents = 'on', onAgents, tools = 'on', onTools, onUsageDetails = () => {}, onOpenSettings = () => {}, sentinel, onSentinel, onCompact, canCompact, compacting, brains = [], brain = '', onBrain, councilPick, onRevote }) {
  const sKey = useSentinelKey();
  const [text, setText] = useState(() => (drafts.get(chatId) || {}).text || '');
  const [micErr, setMicErr] = useState('');
  const [atts, setAtts] = useState(() => (drafts.get(chatId) || {}).atts || []);
  const [mentions, setMentions] = useState(() => cleanMentions((drafts.get(chatId) || {}).mentions));
  useEffect(() => { const keep = atts.filter((a) => !a.pending); if (text || keep.length) drafts.set(chatId, { text, atts: keep, mentions }); else drafts.delete(chatId); }, [text, atts, mentions, chatId]);
  // a token stays a mention only while it reads exactly "@name"; a hand-typed token that matches a known name becomes one
  useEffect(() => {
    setMentions((cur) => { const next = liveMentions(text, [...cur, ...knownMentions]); return JSON.stringify(next) === JSON.stringify(cur) ? cur : next; });
  }, [text]);
  const [drag, setDrag] = useState(false);
  const ta = useRef(null);
  const [items, setItems] = useState({ skills: [], agents: [], connectors: [], files: [] });
  const [sel, setSel] = useState(0);
  const [slashOff, setSlashOff] = useState(() => /(?:^|\s)@[^\s@]*$/.test(text)); // a restored draft ending in @ must not pop the menu open by itself

  // "@" menu: typing @ (at the start or after a space) lists files, skills, agents and connectors
  const m = /(?:^|\s)@([^\s@]*)$/.exec(text);
  const slashOpen = !!m && !slashOff;
  const q = m ? m[1].toLowerCase() : '';
  const folder = (projects.find((p) => p.id === projectId) || {}).folder || undefined;
  useEffect(() => {
    if (!slashOpen) return;
    let live = true;
    Promise.all([window.api.skillsList(folder).catch(() => []), window.api.agentsList(folder).catch(() => []), window.api.mcpStatus().catch(() => []), window.api.libList().catch(() => null), window.api.notesList().catch(() => null)])
      .then(([sk, ag, cn, fl, nt]) => {
        if (!live) return;
        const next = { files: fl && fl.ok ? fl.items : [], notes: nt && nt.ok ? (nt.items || []).filter((x) => !x.dir) : [], skills: (sk || []).filter((x) => x.enabled !== false), agents: ag || [], connectors: (Array.isArray(cn) ? cn : []).filter((x) => x.state === 'connected') };
        setItems(next);
        knownMentions = cleanMentions([...next.skills.map((x) => ({ kind: 'skill', name: x.name })), ...next.agents.map((x) => ({ kind: 'agent', name: x.name })), ...next.connectors.map((x) => ({ kind: 'connector', name: x.name })), ...(settings.makeEnabled !== false && settings.hasMakeToken ? [{ kind: 'make', name: 'Make' }] : [])]);
      });
    return () => { live = false; };
  }, [slashOpen, folder]);
  const entries = !slashOpen ? [] : [
    { kind: 'files', name: 'Add files', desc: '' },
    ...items.files.filter((x) => !q || x.name.toLowerCase().includes(q)).slice(0, 8).map((x) => ({ kind: 'file', name: x.name, path: x.path, desc: (x.path.includes('/') ? x.path.slice(0, x.path.lastIndexOf('/')) + ' · ' : '') + (x.size < 1048576 ? Math.max(1, Math.round(x.size / 1024)) + ' KB' : (x.size / 1048576).toFixed(1) + ' MB') })),
    ...(items.notes || []).filter((x) => !q || (x.name || x.path).toLowerCase().includes(q)).slice(0, 8).map((x) => ({ kind: 'note', name: (x.name || x.path).replace(/\.md$/i, ''), path: x.path, desc: x.path.includes('/') ? x.path.slice(0, x.path.lastIndexOf('/')) : 'Note' })),
    ...items.skills.map((x) => ({ kind: 'skill', name: x.name, desc: x.description })),
    ...items.agents.map((x) => ({ kind: 'agent', name: x.name, desc: x.description })),
    ...(settings.makeEnabled !== false ? [{ kind: 'connector', name: 'Make', make: true, desc: settings.hasMakeToken ? 'Make.com scenarios' : 'Not connected: add your API token in Settings' }] : []),
    ...items.connectors.map((x) => ({ kind: 'connector', name: x.name, desc: `${(x.tools || []).length} tools` }))
  ].filter((e) => !q || e.name.toLowerCase().includes(q));
  const popRef = useRef(null);
  // size and place the @ menu where there is room: above the box, or below it when the box sits near the top (e.g. on Home)
  useLayoutEffect(() => {
    const el = popRef.current; if (!el || !el.parentElement) return;
    const r = el.parentElement.getBoundingClientRect();
    const above = r.top - 64, below = window.innerHeight - r.bottom - 16;
    const flip = above < 230 && below > above;
    const room = Math.max(160, Math.min(340, flip ? below : above));
    el.style.maxHeight = room + 'px';
    el.style.top = flip ? 'calc(100% + 8px)' : 'auto';
    el.style.bottom = flip ? 'auto' : 'calc(100% + 8px)';
    el.scrollTop = 0;
  }, [slashOpen, q]);
  useEffect(() => { const el = popRef.current && popRef.current.querySelector('.slash-item.on'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }); }, [sel]);
  useEffect(() => { setSel(0); }, [q, slashOpen]);
  useEffect(() => { if (!m) setSlashOff(false); }, [!!m]);
  const attachNote = async (rel) => {
    const r = await window.api.notesAttach(rel);
    if (r && r.ok) setAtts((a) => (a.some((x) => x.note === r.attachment.note) ? a : [...a, r.attachment]));
  };
  const attachLib = async (rel) => {
    const r = await window.api.libAttach(rel);
    if (r && r.ok) setAtts((a) => (a.some((x) => x.lib === r.attachment.lib) ? a : [...a, r.attachment]));
  };
  // "Use in chat" from the Files page
  useEffect(() => {
    const take = () => { const q = window.__pendingLibAttach; if (q && q.length) { window.__pendingLibAttach = []; q.forEach(attachLib); } };
    take();
    window.addEventListener('artemis:attach-file', take);
    return () => window.removeEventListener('artemis:attach-file', take);
  }, []);
  const choose = (e) => {
    if (!e) return;
    const base = text.replace(/(^|\s)@[^\s@]*$/, '$1');
    if (e.kind === 'files') { setText(base); pick(); return; }
    if (e.kind === 'note') { setText(base); attachNote(e.path); setTimeout(() => ta.current?.focus(), 0); return; }
    if (e.kind === 'file') { setText(base); attachLib(e.path); setTimeout(() => ta.current?.focus(), 0); return; }
    if (e.make && !settings.hasMakeToken) { setText(base); onOpenSettings('make'); return; }
    // a short highlighted token ("@artemis") instead of a sentence; the model gets the meaning with the send (see mentionHint)
    const mt = { kind: e.make ? 'make' : e.kind, name: e.name };
    const next = base + '@' + e.name + ' ';
    setMentions((cur) => cleanMentions([...cur, mt]));
    setText(next);
    setTimeout(() => { const el = ta.current; if (el) { el.focus(); el.setSelectionRange(next.length, next.length); } }, 0);
  };

  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 220) + 'px';
    syncMirror();
  }, [text, mentions]);

  // placeholders with a spinner while the files are read, replaced by the real chips when parsing is done
  const addFiles = async (list) => {
    const files = [...(list || [])]; if (!files.length) return;
    const tag = 'p' + Math.random().toString(36).slice(2);
    setAtts((a) => [...a, ...files.map((f, i) => ({ pending: tag, key: tag + i, name: f.name, kind: 'pending' }))]);
    let parsed = [];
    try { parsed = await filesToAttachments(files); } catch (e) { parsed = [{ kind: 'error', name: files[0].name, error: (e && e.message) || String(e) }]; }
    setAtts((a) => { const i = a.findIndex((x) => x.pending === tag); const rest = a.filter((x) => x.pending !== tag); if (i < 0) return [...rest, ...parsed]; rest.splice(Math.min(i, rest.length), 0, ...parsed); return rest; });
  };
  // suggestion chips on an empty chat put their text here
  useEffect(() => {
    const h = (e) => { const d = e.detail || {}; if (d.chatId !== chatId) return; setText(d.text || ''); setTimeout(() => { const el = ta.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 0); };
    window.addEventListener('artemis:composer-fill', h);
    return () => window.removeEventListener('artemis:composer-fill', h);
  }, [chatId]);
  const mac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || '');

  useEffect(() => onWindowDrop((fl) => addFiles(fl)), []);

  // the "+" menu: attach, the switches for this chat, and the project (Home and chats pass different handlers)
  const [plus, setPlus] = useState(null);
  const onOff = (v) => (v === 'off' ? 'Off' : 'On');
  const plusItems = () => [
    { label: 'Add files or photos…', onClick: () => pick() },
    (onTools || onAgents || onPerm) && { sep: true },
    onTools && { label: 'Tools', hint: onOff(tools), onClick: () => onTools(tools === 'off' ? 'on' : 'off') },
    onAgents && { label: 'Helper agents', hint: onOff(agents), onClick: () => onAgents(agents === 'off' ? 'on' : 'off') },
    onPerm && { label: 'Ask before acting', hint: perm === 'auto' ? 'Off' : 'On', onClick: () => onPerm(perm === 'auto' ? 'ask' : 'auto') },
    ...(onProject && projects.length ? [{ sep: true }, { label: 'No project', hint: projectId ? '' : '✓', onClick: () => onProject(null) },
      ...projects.slice(0, 8).map((pr) => ({ label: pr.name, hint: pr.id === projectId ? '✓' : '', onClick: () => onProject(pr.id) }))] : []),
  ].filter(Boolean);
  const pick = async () => {
    const r = await window.api.pickFiles();
    if (r.length) setAtts((a) => [...a, ...r]);
  };

  // Highlighted "@" tokens: a backdrop behind the textarea shows the same text with the tokens styled; the textarea text itself is transparent.
  const mirror = useRef(null);
  const shown = liveMentions(text, mentions);
  const hasMirror = shown.length > 0;
  function syncMirror() {
    const el = ta.current, mr = mirror.current;
    if (!el || !mr) return;
    mr.style.height = el.offsetHeight + 'px';
    mr.style.paddingRight = (2 + Math.max(0, el.offsetWidth - el.clientWidth)) + 'px'; // a visible scrollbar narrows the textarea's text
    mr.scrollTop = el.scrollTop;
  }
  const onKeyBackspace = (e) => {
    if (e.key !== 'Backspace' || !shown.length || e.altKey || e.metaKey || e.ctrlKey) return false;
    const el = e.currentTarget;
    if (el.selectionStart !== el.selectionEnd) return false;
    const r = tokenBefore(text, el.selectionStart, shown);
    if (!r) return false;
    e.preventDefault();
    setText(text.slice(0, r.start) + text.slice(r.end));
    setTimeout(() => { const t = ta.current; if (t) t.setSelectionRange(r.start, r.start); }, 0);
    return true;
  };

  const parsing = atts.some((a) => a.pending);
  const hasInput = !!text.trim() || atts.some((a) => a.kind !== 'error' && !a.pending);
  const submit = (fromKey) => {
    if (parsing) return; // wait until the attachments are read
    const good = atts.filter((a) => a.kind !== 'error' && !a.pending);
    if (streaming) {
      // typing while an answer is being written queues the message; the Stop button (or Esc) stops the answer.
      // Enter on an empty box does nothing: an accidental Enter must not throw away an answer.
      if (!text.trim() && !good.length) return fromKey ? undefined : onStop();
      if (!onQueue) return onStop();
      drafts.delete(chatId);
      const qm = liveMentions(text, mentions);
      onQueue(text.trim(), good, qm.length ? { mentions: qm } : undefined);
      setText(''); setAtts([]); setMentions([]);
      return;
    }
    if (!text.trim() && !good.length) return;
    drafts.delete(chatId); // the box may be unmounted by onSend (Home opens the new chat), so its effect would never clear the saved draft
    const sm = liveMentions(text, mentions);
    onSend(text.trim(), good, sm.length ? { mentions: sm } : undefined);
    setText(''); setAtts([]); setMentions([]);
  };

  const onPaste = async (e) => {
    const fl = [...(e.clipboardData?.files || [])];
    if (fl.length) { e.preventDefault(); addFiles(fl); }
  };

  return (
    <footer className="composer-wrap">
      <div
        className={`composer ${drag ? 'drag' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setDrag(false); addFiles([...e.dataTransfer.files]); }}
      >
        {queue.length > 0 && (
          <div className="queue">
            {queue.map((q) => (
              <div key={q.id} className="queue-item">
                <Icon name="clock" size={14} />
                <span className="queue-text">{q.text || `${(q.atts || []).length} attachment${(q.atts || []).length === 1 ? '' : 's'}`}</span>
                <button className="queue-send" onClick={() => onSendNow && onSendNow(q.id)} title="Stop the current answer and send this now">Send now</button>
                <button className="icon-btn" onClick={() => onUnqueue && onUnqueue(q.id)} title="Remove from the queue" aria-label="Remove from the queue"><Icon name="x" size={13} /></button>
              </div>
            ))}
            {queueHeld && <div className="queue-note">Queue paused because you stopped the answer. Press Send now to continue.</div>}
          </div>
        )}
        {atts.length > 0 && (
          <div className="chips">{atts.map((a, i) => <AttachmentChip key={a.key || i} a={a} onRemove={a.pending ? undefined : () => setAtts(atts.filter((_, j) => j !== i))} />)}</div>
        )}
        {slashOpen && entries.length > 0 && (
          <div className="slash-pop" ref={popRef}>
            {['files', 'file', 'note', 'skill', 'agent', 'connector'].map((k) => {
              const rows = entries.filter((e) => e.kind === k);
              if (!rows.length) return null;
              return (
                <div key={k}>
                  {k !== 'files' && <div className="slash-title">{k === 'file' ? 'Files' : k === 'note' ? 'Notes' : k === 'skill' ? 'Skills' : k === 'agent' ? 'Agents' : 'Connectors'}</div>}
                  {rows.map((e) => {
                    const i = entries.indexOf(e);
                    return (
                      <button key={k + e.name} className={`slash-item ${i === sel ? 'on' : ''}`} onMouseEnter={() => setSel(i)} onMouseDown={(ev) => { ev.preventDefault(); choose(e); }}>
                        <Icon name={k === 'files' ? 'paperclip' : k === 'file' || k === 'note' ? 'file' : k === 'skill' ? 'sparkle' : k === 'connector' ? 'plug' : 'user'} size={15} />
                        <span className="slash-name">{e.name}</span>
                        {e.desc && <span className="slash-desc">{e.desc}</span>}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
        <div className="ta-wrap">
        {hasMirror && (
          <div className="ta-mirror" ref={mirror} aria-hidden="true">
            {splitMentions(text, shown).map((p, i) => (p.mention ? <span key={i} className="mention">{p.text}</span> : <React.Fragment key={i}>{p.text}</React.Fragment>))}{'\u200b'}
          </div>
        )}
        <textarea
          ref={ta} rows={1} value={text} autoFocus className={hasMirror ? 'has-mirror' : undefined}
          onScroll={syncMirror}
          placeholder={disabledReason || placeholder || 'Message Artemis…'}
          aria-label="Message"
          onChange={(e) => { setSlashOff(false); setText(e.target.value); }}
          onBlur={() => setSlashOff(true)}
          onPaste={onPaste}
          onKeyDown={(e) => {
            if (slashOpen && entries.length) {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => (i + 1) % entries.length); return; }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => (i - 1 + entries.length) % entries.length); return; }
              if ((e.key === 'Enter' || e.key === 'Tab') && !e.nativeEvent.isComposing) { e.preventDefault(); choose(entries[sel]); return; }
            }
            if (slashOpen && e.key === 'Escape') { e.preventDefault(); setSlashOff(true); return; }
            // Esc stops the answer (unless a tool approval is waiting: then Esc is "Deny", handled by the approval card)
            if (e.key === 'Escape' && streaming && onStop && !document.querySelector('.approve[data-pending="1"]')) { e.preventDefault(); onStop(); return; }
            // Cmd/Ctrl+Enter while an answer is being written = "Send now": stop the answer and send this (or the first queued message) at once
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.nativeEvent.isComposing && streaming && !parsing) {
              if (hasInput && onSendNowText) { e.preventDefault(); const good = atts.filter((a) => a.kind !== 'error' && !a.pending); const qm = liveMentions(text, mentions); drafts.delete(chatId); onSendNowText(text.trim(), good, qm.length ? { mentions: qm } : undefined); setText(''); setAtts([]); setMentions([]); return; }
              if (!hasInput && queue.length && onSendNow) { e.preventDefault(); onSendNow(queue[0].id); return; }
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(true); return; }
            if (!e.nativeEvent.isComposing) onKeyBackspace(e); // Backspace right after a token removes the whole token
          }}
        />
        </div>
        {micErr && <div className="mic-err" onClick={() => setMicErr('')}>{micErr}</div>}
        <div className="composer-bar">
          <button className={`icon-btn plus-btn ${plus ? 'open' : ''}`} title="Add files, a project or tools. You can also drag or paste files here." aria-label="Add files, a project or tools" aria-haspopup="menu" aria-expanded={!!plus}
            onMouseDown={(e) => { if (plus) e.stopPropagation(); }} onClick={(e) => { if (plus) { setPlus(null); return; } const r = e.currentTarget.getBoundingClientRect(); const items = plusItems(); setPlus({ x: r.left, y: Math.max(8, r.top - 12 - items.length * 30), items }); }}><Icon name="plus" size={18} /></button>
          <ContextMenu menu={plus} onClose={() => setPlus(null)} />
          <MicButton settings={settings} onVoiceSettings={() => onOpenSettings('voice')} onError={setMicErr}
            onText={(t) => { setMicErr(''); setText((x) => (x && !/\s$/.test(x) ? x + ' ' : x) + t); setTimeout(() => ta.current?.focus(), 0); }} />
          {onSentinel && <button className={`icon-btn sentinel-btn ${sentinel && sentinel !== 'off' ? 'on' : ''}`} title={sentinel && sentinel !== 'off' ? `Sentinel is on. Click to turn off${sKey}` : `Sentinel mode: say “${window.__wakeWord || 'Wake up'}” to talk hands-free${sKey}`} aria-label={sentinel && sentinel !== 'off' ? `Sentinel is on. Click to turn off${sKey}` : `Sentinel mode: say “${window.__wakeWord || 'Wake up'}” to talk hands-free${sKey}`} onClick={onSentinel}><Icon name="shield" size={17} /></button>}
          <span className="bar-spacer" />
          {onModel && <ModelPicker value={model} groups={groups} onChange={onModel} className="model" />}
          {onCompact && <button className="icon-btn compact-btn" disabled={!canCompact} title={compacting ? 'Compacting…' : canCompact ? 'Compact: summarize earlier messages to save tokens' : 'Compact is available once the chat has a few messages'} onClick={onCompact}>{compacting ? <Icon name="spinner" size={16} /> : <Icon name="compact" size={16} />}<span className="btn-label">Compact</span></button>}
          <button className={`send ${streaming && !(hasInput && onQueue) ? 'stop' : ''}`} onClick={() => submit(false)} disabled={parsing && !streaming} title={streaming ? (hasInput && onQueue ? 'Add to the queue' : 'Stop (Esc)') : parsing ? 'Reading attachments…' : 'Send'} aria-label={streaming ? (hasInput && onQueue ? 'Add to the queue' : 'Stop') : 'Send'}><Icon name={streaming && !(hasInput && onQueue) ? 'stop' : 'arrowUp'} size={16} /></button>
        </div>
      </div>
    </footer>
  );
}
