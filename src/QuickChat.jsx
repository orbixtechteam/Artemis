import React, { useEffect, useRef, useState } from 'react';
import { applyTextSize, applySettingsTheme, loadThemes } from './lib/themes.js';
import Markdown from './components/Markdown.jsx';
import ToolCard from './components/ToolCard.jsx';
import { Icon } from './components/Icons.jsx';
import Logo from './components/Logo.jsx';
import { toApiMessages, uid } from './lib/history.js';
import { AttachmentChip, Thinking, ThinkBlock, thinkMode } from './components/Message.jsx';
import { addThinking, stepParts } from './lib/think.mjs';
import CommandPalette from './components/CommandPalette.jsx';
import Select from './components/Select.jsx';
import ModelPicker from './components/ModelPicker.jsx';
import { modelGroups, defaultModel } from './lib/models.js';
import { filesToAttachments, installDropGuard, onWindowDrop } from './lib/attach.js';

const api = window.api;
const lastStep = (m, fn) => { const steps = [...m.steps]; steps[steps.length - 1] = fn(steps[steps.length - 1]); return { ...m, steps }; };
const patchTool = (m, id, fn) => ({ ...m, steps: m.steps.map((s) => ({ ...s, toolCalls: s.toolCalls.map((t) => (t.id === id ? fn(t) : t)) })) });

function reduce(m, ev) {
  switch (ev.type) {
    case 'chunk': return lastStep(m, (s) => ({ ...s, text: s.text + ev.text }));
    case 'step:new': return { ...m, steps: [...m.steps, { text: '', toolCalls: [] }] };
    case 'thinking': return lastStep(m, (s) => ({ ...s, thinking: addThinking(s.thinking, ev.text) }));
    case 'thinking:end': return lastStep(m, (s) => (s.thinking ? { ...s, thinking: { ...s.thinking, ms: ev.ms } } : s));
    case 'tool:call': return lastStep(m, (s) => ({ ...s, toolCalls: [...s.toolCalls, { id: ev.id, name: ev.name, args: ev.args, status: 'running', startedAt: Date.now() }] }));
    case 'tool:approval': return patchTool(m, ev.id, (t) => ({ ...t, status: 'awaiting', session: ev.session, category: ev.category }));
    case 'tool:result': return patchTool(m, ev.id, (t) => ({ ...t, status: ev.denied ? 'denied' : ev.ok ? 'done' : 'error', result: ev.text, image: ev.image, endedAt: Date.now() }));
    case 'notice': return { ...m, notices: [...(m.notices || []), ev.text] };
    case 'error': return { ...m, error: ev.message };
    default: return m;
  }
}

const settle = (msgs) => msgs.map((m) => (m.steps ? { ...m, steps: m.steps.map((s) => ({ ...s, toolCalls: s.toolCalls.map((t) => (t.status === 'running' || t.status === 'awaiting' ? { ...t, status: 'cancelled' } : t)) })) } : m));

/** The Quick chat. Alone it is the old Quick window; with `embedded` it is the Chat tab inside the Sentinel widget (the widget owns the window, the tabs and the Search tab). */
export default function QuickChat({ embedded = false, onClose, onKeepOpen, focusNonce = 0 } = {}) {
  const keep = (on) => { if (embedded) { if (onKeepOpen) onKeepOpen(on); } else api.quickKeepOpen(on); };
  const close = () => { if (embedded) { if (onClose) onClose(); } else api.quickHide(); };
  const [settings, setSettings] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const [running, setRunning] = useState(false);
  const [atts, setAtts] = useState([]);
  const [drag, setDrag] = useState(false);
  const [mode, setMode] = useState('chat'); // 'chat' or 'search' (Cmd+1 / Cmd+2, or the Quick chat / Quick search shortcut)
  const [snap, setSnap] = useState({ chats: [], actions: [] });
  const [nonce, setNonce] = useState(0);
  const [brains, setBrains] = useState([]);
  const [providers, setProviders] = useState([]);
  const lsGet = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
  const [picked, setPicked] = useState(() => { const v = lsGet('quick-brain'); return v ? (v === 'none' ? '' : v) : null; }); // null = not chosen here: the default brain from Settings
  const brain = picked !== null ? picked : ((settings && settings.defaultBrain) || '');
  const [modelPick, setModelPick] = useState(() => lsGet('quick-model'));
  const setBrain = (v) => { setPicked(v); lsSet('quick-brain', v || 'none'); const b = brains.find((x) => x.slug === v); if (b && b.model) { setModelPick(b.model); lsSet('quick-model', b.model); } };
  const setModel = (v) => { setModelPick(v); lsSet('quick-model', v); };
  useEffect(() => {
    const load = () => { api.brainsList().then(setBrains).catch(() => {}); api.providersList().then((r) => setProviders((r && r.providers) || [])).catch(() => {}); };
    load();
    const off = api.onBrainsChanged && api.onBrainsChanged(load);
    return () => { try { off && off(); } catch {} };
  }, [focusNonce]);
  const reqRef = useRef(null);
  const asstRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const idRef = useRef(uid());

  useEffect(() => {
    if (embedded) { // the widget paints the theme and owns the window: only the settings are needed here
      api.getSettings().then(setSettings);
      return undefined;
    }
    document.documentElement.classList.add('quick');
    // the window lives on after the first open: repaint the theme every time it is shown, otherwise a theme changed in the main window never reaches it
    const paint = (s) => { applyTextSize(s.textSize); document.documentElement.dataset.thinking = s.showThinking || 'collapsed'; return loadThemes(api).then((t) => applySettingsTheme(s, t)); };
    api.getSettings().then((s) => { setSettings(s); paint(s); });
    const offTheme = api.onThemeChanged ? api.onThemeChanged(() => { api.getSettings().then(paint); }) : undefined;
    const offShown = api.onQuickShown((o) => {
      api.getSettings().then((s) => { setSettings(s); paint(s); });
      setMode(o && o.mode === 'search' ? 'search' : 'chat'); setNonce((n) => n + 1);
      api.paletteGet().then((x) => setSnap(x || { chats: [], actions: [] })).catch(() => {});
      setTimeout(() => inputRef.current?.focus(), 30);
    });
    return () => { try { offShown && offShown(); } catch {} try { offTheme && offTheme(); } catch {} };
  }, []);

  useEffect(() => api.onEvent((ev) => {
    if (ev.requestId !== reqRef.current) return;
    if (ev.type === 'done') {
      setMsgs((ms) => settle(ms));
      reqRef.current = null; setRunning(false); keep(false);
      return;
    }
    setMsgs((ms) => ms.map((m) => (m.id === asstRef.current ? reduce(m, ev) : m)));
  }), []);

  // links in answers: the quick window has no browser panel, so http(s) links open in the system browser
  useEffect(() => {
    const h = (e) => { const url = e.detail; if (/^https?:\/\//i.test(url || '') && api.openExternalUrl) api.openExternalUrl(url); };
    window.addEventListener('aid-browser-open', h);
    return () => window.removeEventListener('aid-browser-open', h);
  }, []);
  useEffect(() => { const off1 = installDropGuard(), off2 = onWindowDrop((fl) => addFiles(fl)); return () => { off1(); off2(); }; }, []);
  useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs]);
  useEffect(() => { if (!embedded && api.quickMode) api.quickMode(mode); }, [mode]); // main needs the tab to decide whether a shortcut switches tabs or hides the window
  useEffect(() => { if (!embedded) api.quickResize(mode === 'search' || msgs.length > 0 ? true : atts.length > 0 ? 'chips' : false); }, [mode, msgs.length > 0, atts.length > 0]);
  useEffect(() => { if (embedded && focusNonce) setTimeout(() => inputRef.current?.focus(), 30); }, [focusNonce]);
  useEffect(() => {
    if (embedded) return undefined; // the widget handles Cmd+1 / Cmd+2
    const h = (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      if (e.key === '1') { e.preventDefault(); setMode('chat'); setTimeout(() => inputRef.current?.focus(), 0); }
      else if (e.key === '2') { e.preventDefault(); setMode('search'); setNonce((n) => n + 1); api.paletteGet().then((x) => setSnap(x || { chats: [], actions: [] })).catch(() => {}); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const groups = modelGroups(modelPick || (settings && settings.model), providers);
  const activeModel = modelPick || (settings ? defaultModel(settings, providers) : '');
  const send = () => {
    const t = text.trim();
    const good = atts.filter((a) => a.kind !== 'error');
    if ((!t && !good.length) || running || !settings) return;
    if (!settings.hasApiKey) return;
    const user = { id: uid(), role: 'user', content: t, attachments: good };
    const asst = { id: uid(), role: 'assistant', createdAt: Date.now(), steps: [{ text: '', toolCalls: [] }] };
    const requestId = uid();
    reqRef.current = requestId; asstRef.current = asst.id;
    const history = [...msgs, user];
    setMsgs([...history, asst]); setText(''); setAtts([]); setRunning(true); keep(true);
    api.chat({ requestId, model: activeModel, messages: toApiMessages(history), system: settings.systemPrompt, project: null, maxTokens: settings.maxTokens, brain: brain && (brain === 'council' || brains.some((b) => b.slug === brain)) ? brain : '', brainPick: '' });
  };
  const addFiles = async (list) => {
    const parsed = await filesToAttachments(list);
    if (parsed.length) setAtts((a) => [...a, ...parsed]);
  };
  const pick = async () => {
    keep(true); // the file dialog steals focus; do not hide the window meanwhile
    try { const r = await api.pickFiles(); if (r.length) setAtts((a) => [...a, ...r]); }
    finally { if (!reqRef.current) keep(false); setTimeout(() => inputRef.current?.focus(), 0); }
  };
  const onPaste = (e) => {
    const fl = [...(e.clipboardData?.files || [])];
    if (fl.length) { e.preventDefault(); addFiles(fl); }
  };
  const stop = () => reqRef.current && api.abort(reqRef.current);
  const reset = () => { if (running) stop(); setMsgs([]); setAtts([]); idRef.current = uid(); setTimeout(() => inputRef.current?.focus(), 0); };
  const decide = (id, ok) => {
    api.decide(id, ok);
    if (ok) setMsgs((ms) => ms.map((m) => (m.steps ? patchTool(m, id, (t) => (t.status === 'awaiting' ? { ...t, status: 'running' } : t)) : m)));
  };
  const handoff = () => {
    const first = msgs.find((m) => m.role === 'user');
    api.quickHandoff({ id: idRef.current, title: (first?.content || 'Quick chat').slice(0, 48), model: settings.model, projectId: null, messages: settle(msgs), updatedAt: Date.now() });
    reset(); close();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
  };

  if (!settings) return null;
  return (
    <div
      className={`quick-card${embedded ? ' embedded' : ''} ${drag ? 'dropping' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setDrag(false); addFiles([...e.dataTransfer.files]); }}
    >
      {!embedded && <div className="quick-grip drag" title="Drag to move"><i />
        <div className="quick-tabs nodrag">
          <button className={mode === 'chat' ? 'on' : ''} onClick={() => { setMode('chat'); setTimeout(() => inputRef.current?.focus(), 0); }}>Chat <kbd>⌘1</kbd></button>
          <button className={mode === 'search' ? 'on' : ''} onClick={() => { setMode('search'); setNonce((n) => n + 1); }}>Search <kbd>⌘2</kbd></button>
        </div>
      </div>}
      {!embedded && mode === 'search' ? (
        <CommandPalette key={nonce} embedded open chats={snap.chats} onClose={() => close()}
          actions={snap.actions.map((a) => ({ ...a, run: () => api.paletteRun({ kind: 'action', id: a.id }) }))}
          onOpenChat={(id) => api.paletteRun({ kind: 'chat', id })} onOpenNote={(p) => api.paletteRun({ kind: 'note', path: p })} onOpenFile={(p) => api.paletteRun({ kind: 'file', path: p })} />
      ) : (<>
      <div className="quick-bar drag">
        <Logo size={26} className="quick-logo" />
        <textarea
          ref={inputRef} className="nodrag quick-input" rows={1} autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} onPaste={onPaste}
          placeholder={settings.hasApiKey ? 'Ask anything…' : 'Add a provider in Settings first'}
        />
        <button className="icon-btn nodrag" title="Attach files or images" aria-label="Attach files or images" onClick={pick}><Icon name="paperclip" size={16} /></button>
        {running
          ? <button className="quick-btn stop nodrag" title="Stop" aria-label="Stop" onClick={stop}><Icon name="stop" size={14} /></button>
          : <button className="quick-btn nodrag" title="Send" aria-label="Send" disabled={!text.trim() && !atts.length} onClick={send}><Icon name="arrowUp" size={15} /></button>}
        {msgs.length > 0 && (
          <>
            <button className="icon-btn nodrag" title="New chat" aria-label="New chat" onClick={reset}><Icon name="plus" size={16} /></button>
            <button className="icon-btn nodrag" title="Open in the main window" aria-label="Open in the main window" onClick={handoff}><Icon name="external" size={16} /></button>
          </>
        )}
        <button className="icon-btn nodrag" title="Close (Esc)" aria-label="Close (Esc)" onClick={() => close()}><Icon name="x" size={16} /></button>
      </div>
      {settings.hasApiKey && (brains.length > 0 || groups.length > 0) && (
        <div className="quick-pills nodrag">
          {brains.length > 0 && (
            <Select className="pill-select brain" title="Brain mode: who answers. Council: the brains vote on who answers." value={brain} onChange={(e) => setBrain(e.target.value)}>
              <option value="">No brain</option>
              <option value="council">Council (vote)</option>
              {brains.map((b) => <option key={b.slug} value={b.slug}>{b.name}{b.role ? ` · ${b.role.replace(/^The /, '')}` : ''}</option>)}
            </Select>
          )}
          {groups.length > 0 && <ModelPicker value={activeModel} groups={groups} onChange={setModel} className="model" up={false} align="left" />}
        </div>
      )}
      {atts.length > 0 && (
        <div className="quick-chips">{atts.map((a, i) => <AttachmentChip key={i} a={a} onRemove={() => setAtts(atts.filter((_, j) => j !== i))} />)}</div>
      )}
      {msgs.length > 0 && (
        <div className="quick-list" ref={listRef}>
          {msgs.map((m) => (m.role === 'user' ? (
            <div key={m.id} className="msg user">
              {m.attachments?.length > 0 && <div className="chips right">{m.attachments.map((a, i) => <AttachmentChip key={i} a={a} />)}</div>}
              {m.content && <div className="bubble">{m.content}</div>}
            </div>
          ) : (() => {
            // the same streaming states as the main chat: "Thinking…" with seconds before the first words, then a caret at the end of the text
            const live = running && m.id === asstRef.current;
            const last = m.steps[m.steps.length - 1] || {};
            const parts = m.steps.map(stepParts);
            const lp = parts[parts.length - 1] || {};
            const waiting = live && !lp.text && !(lp.thinking && thinkMode() !== 'hidden') && !(last.toolCalls || []).some((t) => t.status === 'running' || t.status === 'awaiting');
            return (
            <div key={m.id} className={`msg assistant ${live ? 'live' : ''}`}>
              {m.steps.map((s, i) => (
                <React.Fragment key={i}>
                  {parts[i].thinking && <ThinkBlock text={parts[i].thinking} start={parts[i].start} ms={parts[i].ms}
                    live={live && i === m.steps.length - 1 && (parts[i].open || (parts[i].ms === undefined && !parts[i].text.trim() && !s.toolCalls.length))} />}
                  {parts[i].text && <Markdown text={parts[i].text} streaming={live && i === m.steps.length - 1} caret={live && i === m.steps.length - 1 && !s.toolCalls.length} />}
                  {s.toolCalls.map((tc) => <ToolCard key={tc.id} tc={tc} onDecide={decide} />)}
                </React.Fragment>
              ))}
              {waiting && <Thinking since={m.createdAt} />}
              {m.notices?.map((n, i) => <div key={i} className="notice">{n}</div>)}
              {m.error && <div className="error">{m.error}</div>}
            </div>
            );
          })()))}
        </div>
      )}
      </>)}
    </div>
  );
}
