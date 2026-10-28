import React, { memo, useEffect, useRef, useState } from 'react';
import Markdown from './Markdown.jsx';
import ToolCard, { ToolGroup, groupToolCalls } from './ToolCard.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';
import { classifyError } from '../lib/errors.js';
import MediaBlock from './MediaBlock.jsx';
import { ArtifactCard } from './SidePanel.jsx';
import { assistantText } from '../lib/history.js';
import { splitMentions } from '../lib/mentions.mjs';
import { openPreview } from '../lib/preview.js';
import { speak, stopSpeaking } from '../lib/voice.js';
import { createFollower } from '../lib/follow.js';
import { Icon, FILE_ICON } from './Icons.jsx';
import { stepParts, thoughtLabel, lastThinkLine } from '../lib/think.mjs';
import { stripFences } from '../lib/clip.mjs';

function CopyButton({ getText }) {
  const [done, setDone] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(getText()); setDone(true); setTimeout(() => setDone(false), 1200); }}>
      {done ? 'Copied' : 'Copy'}
    </button>
  );
}

// What Read aloud is reading right now, kept outside the buttons: switching tabs (or any re-render that unmounts the message)
// must not stop the voice. A button that mounts again for the same message shows "Stop" and the highlight carries on.
let reading = null; // { msgId, fol }
const readListeners = new Set();
const setReading = (r) => { reading = r; readListeners.forEach((fn) => fn(r)); };

function ReadButton({ getText, msgId }) {
  const [on, setOn] = useState(() => !!reading && reading.msgId === msgId);
  useEffect(() => {
    const fn = (r) => setOn(!!r && r.msgId === msgId);
    readListeners.add(fn);
    return () => { readListeners.delete(fn); }; // unmounting never stops the voice
  }, [msgId]);
  const stop = () => { const r = reading; setReading(null); try { r && r.fol.clear(); } catch {} stopSpeaking(); };
  const click = () => {
    if (on) { stop(); return; }
    if (reading) { try { reading.fol.clear(); } catch {} }
    // follow along: highlight the sentence being read; the message is looked up each time, so it works after switching back to its tab
    const fol = createFollower(() => document.querySelector(`.msg[data-msg="${msgId}"]`));
    const me = { msgId, fol };
    setReading(me);
    const ok = speak(getText(), {
      language: (window.__voiceLang || 'auto'),
      onChunk: (t) => { if (reading === me) fol.follow(t); },
      onEnd: () => { try { fol.clear(); } catch {} if (reading === me) setReading(null); }
    });
    if (!ok && reading === me) setReading(null);
  };
  return <button onClick={click} title={on ? 'Stop reading' : 'Read aloud (the text is highlighted as it is read)'}>{on ? 'Stop' : 'Read aloud'}</button>;
}

function DeleteButton({ onDelete }) {
  const [sure, setSure] = useState(false);
  useEffect(() => { if (!sure) return; const t = setTimeout(() => setSure(false), 2500); return () => clearTimeout(t); }, [sure]);
  return <button className={sure ? 'danger' : ''} onClick={() => (sure ? onDelete() : setSure(true))}>{sure ? 'Click to confirm' : 'Delete'}</button>;
}

function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function AttachmentChip({ a, onRemove }) {
  return (
    <span className={`chip ${a.kind === 'error' ? 'bad' : a.pending ? 'pending' : 'clickable'} ${a.kind === 'image' && (a.dataUrl || a.url) ? 'has-thumb' : ''}`} title={a.pending ? `Reading ${a.name}…` : a.error || a.path || a.name} onClick={() => a.kind !== 'error' && !a.pending && openPreview(a)}>
      {a.pending ? <Icon name="spinner" size={16} className="spin" /> : a.kind === 'image' && (a.dataUrl || a.url) ? <img src={a.dataUrl || a.url} alt="" /> : <Icon name={a.name?.toLowerCase().endsWith('.zip') ? 'file' : (FILE_ICON[a.kind] || 'file')} size={16} />}
      <span className="chip-name">{a.name}</span>
      {a.truncated && <span className="chip-note">truncated</span>}
      {onRemove && <button aria-label={`Remove ${a.name || 'attachment'}`} title="Remove" onClick={(e) => { e.stopPropagation(); onRemove(); }}><Icon name="x" size={13} /></button>}
    </span>
  );
}

function BrainHeader({ brain, council }) {
  const v = council && council.verdict;
  return (
    <div className="brain-head">
      {brain && <span className="brain-chip"><Icon name="shield" size={12} /> {brain.name}{brain.role ? <i> · {brain.role.replace(/^The /, '')}</i> : null}</span>}
      {council && council.pending && <span className="muted small">Council is voting…</span>}
      {council && council.votes && (
        <details className="council">
          <summary>Council vote: {v.answerer}{v.unanimous ? ' (unanimous)' : ''}{v.voters ? ` · ${v.voters} voted` : ''}{council.tokens ? ` · ${council.tokens.toLocaleString()} tokens` : ''}</summary>
          {council.votes.map((x) => (
            <div key={x.brain} className="vote">
              <b>{x.brain}</b> {x.ok ? <>→ {x.answerer}{x.skills && x.skills.length ? <span className="muted"> · skills: {x.skills.join(', ')}</span> : null}{x.agents && x.agents.length ? <span className="muted"> · agents: {x.agents.join(', ')}</span> : null}{x.reason ? <div className="muted small">{x.reason}</div> : null}</> : <span className="muted">no vote ({x.reason})</span>}
            </div>
          ))}
          {v && (v.skills.length > 0 || v.agents.length > 0) && <div className="vote muted small">Decision: {v.skills.length ? `skills ${v.skills.join(', ')}` : ''}{v.skills.length && v.agents.length ? '; ' : ''}{v.agents.length ? `agents ${v.agents.join(', ')}` : ''}</div>}
        </details>
      )}
    </div>
  );
}

/** Before the first token: a shimmer with the seconds spent waiting. */
export function Thinking({ since }) {
  const [now, setNow] = useState(() => Date.now());
  const t0 = useRef(since || Date.now()); // messages without a time (phone, scheduled runs) count from when this appeared
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const secs = Math.max(0, Math.floor((now - t0.current) / 1000));
  return <div className="thinking-shimmer" role="status" aria-live="polite"><span className="shimmer-text">Thinking…</span>{secs >= 1 && <span className="thinking-secs">{secs}s</span>}</div>;
}

export const thinkMode = () => { try { return document.documentElement.dataset.thinking || 'collapsed'; } catch { return 'collapsed'; } };

/**
 * The model's reasoning for one step: a collapsible callout before the step's answer. While it streams the header says
 * "Thinking…" with a live seconds counter (and the last line, faintly); afterwards "Thought for Ns". Collapsed by default
 * (Settings → General → Thinking); hidden entirely when that setting is "hidden" (CSS, so the choice applies at once).
 */
export function ThinkBlock({ text, live, ms, start }) {
  const [open, setOpen] = useState(() => thinkMode() === 'expanded');
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  const t0 = useRef(start || Date.now());
  const body = useRef(null);
  const stick = useRef(true); // follow the end while it streams, unless the reader scrolled up
  useEffect(() => { if (!live) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [live]);
  useEffect(() => { const el = body.current; if (open && live && el && stick.current) el.scrollTop = el.scrollHeight; }, [text, open, live]);
  const secs = Math.max(0, Math.floor((now - (start || t0.current)) / 1000));
  const line = live && !open ? lastThinkLine(text) : '';
  const copy = () => { try { navigator.clipboard.writeText(text || ''); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch {} };
  return (
    <div className={`thinkblock ${live ? 'live' : ''} ${open ? 'open' : ''}`}>
      <button type="button" className="thinkblock-head" aria-expanded={open} onClick={() => setOpen((o) => !o)} title={open ? 'Hide the thinking' : 'Show the thinking'}>
        <Icon name="sparkle" size={13} className="thinkblock-icon" />
        {live
          ? <><span className="shimmer-text">Thinking…</span>{secs >= 1 && <span className="thinking-secs">{secs}s</span>}</>
          : <span className="thinkblock-label">{thoughtLabel(ms)}</span>}
        {line && <span className="thinkblock-line">{line}</span>}
        <Icon name="chevronRight" size={12} className="thinkblock-chev" />
      </button>
      {open && (
        <div className="thinkblock-body" ref={body} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24; }}>
          {text ? <Markdown text={text} /> : <span className="muted">…</span>}
          {!live && text && <button type="button" className="thinkblock-copy" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>}
        </div>
      )}
    </div>
  );
}

/** A failed answer: what happened in plain words, the raw text on demand, and the action that fixes it. */
function ErrorCard({ text, onAction }) {
  const c = classifyError(text);
  const raw = String(text || '');
  return (
    <div className={`error-card ${c.kind}`} role="alert">
      <div className="error-head">
        <span className="error-icon"><Icon name={c.icon} size={16} /></span>
        <div className="error-main">
          <div className="error-title">{c.title}</div>
          {c.hint && <div className="error-hint">{c.hint}</div>}
        </div>
        {c.action && onAction && <button type="button" className={c.action === 'retry' ? '' : 'primary'} onClick={() => onAction(c.action)}>{c.label}</button>}
      </div>
      {raw && <details className="error-raw"><summary>Details</summary><pre>{raw}</pre></details>}
    </div>
  );
}

function MessageView({ m, live, chatId, h, canDelete = true, artifacts }) {
  const onDelete = canDelete && h && h.remove ? () => h.remove(chatId, m.id) : undefined;
  const onDecide = h && h.decide;
  if (m.role === 'user' && m.compacted) {
    return (
      <details className="msg compacted" data-msg={m.id}>
        <summary><Icon name="layers" size={14} /> Earlier conversation compacted ({m.compacted} messages summarized)</summary>
        <div className="compacted-body">{m.content}</div>
      </details>
    );
  }
  if (m.role === 'user') {
    return (
      <div className="msg user" data-msg={m.id}>
        {m.attachments?.length > 0 && <div className="chips right">{m.attachments.map((a, i) => <AttachmentChip key={i} a={a} />)}</div>}
        {m.content && <div className="bubble">{m.mentions?.length ? splitMentions(m.content, m.mentions).map((p, i) => (p.mention ? <span key={i} className="mention">{p.text}</span> : <React.Fragment key={i}>{p.text}</React.Fragment>)) : m.content}</div>}
        <div className="actions">{m.createdAt && <time className="ts">{fmtTime(m.createdAt)}</time>}<CopyButton getText={() => m.content} />{onDelete && <DeleteButton onDelete={onDelete} />}</div>
      </div>
    );
  }
  const steps = m.steps || [];
  const lastStep = steps[steps.length - 1] || {};
  const toolBusy = (lastStep.toolCalls || []).some((t) => t.status === 'running' || t.status === 'awaiting');
  const parts = steps.map(stepParts);
  const lastParts = parts[parts.length - 1] || {};
  // waiting for words: before the first token, or after a tool step before the next text arrives (a thinking block shows its own state instead)
  const waiting = live && !lastParts.text && !(lastParts.thinking && thinkMode() !== 'hidden') && !toolBusy;
  const onAction = (a) => {
    if (!h) return;
    if (a === 'retry') h.regenerate && h.regenerate(chatId, m);
    else if (a === 'compact') h.compact && h.compact(chatId);
    else if (a === 'providers') h.openSettings && h.openSettings('providers');
  };
  return (
    <div className={`msg assistant ${live ? 'live' : ''}`} data-msg={m.id}>
      {(m.brain || m.council) && <BrainHeader brain={m.brain} council={m.council} />}
      {steps.map((s, i) => (
        <React.Fragment key={i}>
          {parts[i].thinking && <ThinkBlock text={parts[i].thinking} start={parts[i].start} ms={parts[i].ms}
            live={live && i === steps.length - 1 && (parts[i].open || (parts[i].ms === undefined && !parts[i].text.trim() && !(s.toolCalls || []).length))} />}
          {parts[i].text && <Markdown text={parts[i].text} streaming={live && i === steps.length - 1} caret={live && i === steps.length - 1 && !(s.toolCalls || []).length} />}
          {groupToolCalls((s.toolCalls || []).filter((tc) => tc.name !== 'create_artifact' || tc.status === 'awaiting')).map((g) => (g.group
            ? <ToolGroup key={g.key} calls={g.group} onDecide={onDecide} />
            : <ToolCard key={g.tc.id} tc={g.tc} onDecide={onDecide} />))}
          {[...new Set(s.artifactRefs || [])].map((id) => (artifacts && artifacts[id] ? <ArtifactCard key={id} a={artifacts[id]} onOpen={() => h && h.openArtifact && h.openArtifact(chatId, id)} /> : null))}
          {s.media?.map((it, j) => <MediaBlock key={j} item={it} />)}
        </React.Fragment>
      ))}
      {waiting && <Thinking since={m.createdAt} />}
      {m.notices?.map((n, i) => <div key={i} className="notice">{n}</div>)}
      {m.error && <ErrorCard text={m.error} onAction={live ? undefined : onAction} />}
      {!live && (
        <div className="actions">
          <CopyButton getText={() => stripFences(assistantText(m))} />
          <ReadButton msgId={m.id} getText={() => assistantText(m, true)} />
          <button onClick={() => h && h.regenerate && h.regenerate(chatId, m)}>Regenerate</button>
          {onDelete && <DeleteButton onDelete={onDelete} />}
          {m.createdAt && <time className="ts">{fmtTime(m.createdAt)}</time>}
        </div>
      )}
    </div>
  );
}

function rawOf(m) {
  if (m.role === 'user') return m.content || '';
  try { return assistantText(m) || JSON.stringify(m, null, 2); } catch { try { return JSON.stringify(m, null, 2); } catch { return ''; } }
}

/** One message, guarded: a message that fails to render shows a small card instead of taking the chat down. */
function Message(props) {
  const { m } = props;
  return (
    <ErrorBoundary resetKey={m} fallback={
      <div className="msg msg-broken" data-msg={m.id}>
        <span>This message couldn't be displayed</span> · <button type="button" className="link-btn" onClick={() => navigator.clipboard.writeText(rawOf(m))}>Copy raw</button>
      </div>
    }>
      <MessageView {...props} />
    </ErrorBoundary>
  );
}

export default memo(Message);
