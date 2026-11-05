import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Markdown from '../Markdown.jsx';
import { Icon } from '../Icons.jsx';
import { labelFor, target } from '../ToolCard.jsx';
import { Avatar, Stack, LEAD, teamState, usd, tokens, elapsed, isCli, modelLabel, splitFiles, joinFiles, plural, taskTitle, MODES } from './parts.jsx';
import { readImage } from '../../lib/attach.js';
import { useMentionMenu, MentionMenu } from './MentionMenu.jsx';

const STATUS_LABEL = { todo: 'to do', doing: 'doing', review: 'review', done: 'done', waiting: 'waiting' };
const time = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const STEP_ICON = { running: 'spinner', done: 'check', error: 'warning', denied: 'x', stopped: 'x' };
const noThink = (s) => String(s || '').replace(/<(think|thinking)>[\s\S]*?(<\/\1>|$)/gi, '').trim();
const GROUP_MS = 5 * 60000; // messages from one sender this close together share one header
/** "Today", "Yesterday" or a date, for the line between days. */
function dayLabel(t) {
  const d = new Date(t), n = new Date(), y = new Date(); y.setDate(n.getDate() - 1);
  if (d.toDateString() === n.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', ...(d.getFullYear() !== n.getFullYear() ? { year: 'numeric' } : {}) });
}
const plainKind = (m) => !m.kind || m.kind === 'msg';

/** One step as a line: "Searched the web · artemis 1.5". */
function stepLine(st) {
  if (st.name === 'team_ask') return [`Asked ${st.args.to || 'a teammate'}`, st.args.question || ''];
  return [labelFor(st.name)[1], target({ name: st.name, args: st.args || {} }) || ''];
}

function Steps({ steps }) {
  return (
    <ol className="tm-steps">
      {steps.map((st, i) => {
        const [label, what] = stepLine(st);
        return <li key={st.id + i} className={'st-' + st.status}><Icon name={STEP_ICON[st.status] || 'check'} size={12} /><span>{label}</span>{what ? <em title={what}>{what}</em> : null}{st.by ? <small>{st.by}</small> : null}</li>;
      })}
    </ol>
  );
}

/** An agent at work: what it is doing now, the end of what it is writing, and its steps so far. */
function LiveCard({ live }) {
  const [open, setOpen] = useState(false);
  const cur = [...live.steps].reverse().find((st) => st.status === 'running');
  const text = noThink(live.text);
  const now = cur ? stepLine(cur).filter(Boolean).join(' · ') : live.thinking ? 'Thinking…' : text ? 'Writing…' : live.steps.length ? 'Working out the next step…' : 'Starting…';
  return (
    <div className="tm-live" aria-live="polite">
      <Avatar name={live.name} size="sm" />
      <div className="tm-live-b">
        <div className="tm-live-h"><b>{live.name}</b>{live.what ? <span>{live.what}</span> : null}</div>
        <div className="tm-live-now"><span className="tm-dots" aria-hidden="true"><i /><i /><i /></span><span>{now}</span></div>
        {text && !cur && <div className="tm-live-text">{text.length > 320 ? '…' + text.slice(-320) : text}</div>}
        {live.steps.length > 0 && <button type="button" className="tm-steps-btn" aria-expanded={open} onClick={() => setOpen(!open)}><Icon name={open ? 'chevronDown' : 'chevronRight'} size={11} />{plural(live.steps.length, 'step')}</button>}
        {open && <Steps steps={live.steps} />}
      </div>
    </div>
  );
}

/** Files sent with a message: pictures inline, everything else as a chip. A click opens the file. */
function Files({ files }) {
  if (!files.length) return null;
  return (
    <div className="tm-files">
      {files.map((f) => (
        <button type="button" key={f.path} className={f.url ? 'img' : ''} title={f.path} onClick={() => window.api.openPath(f.path)}>
          {f.url ? <img src={f.url} alt={f.name} /> : <><Icon name="paperclip" size={13} /><span>{f.name}</span></>}
        </button>
      ))}
    </div>
  );
}

/** Why the team stopped and what the button does, as one line above the composer. */
function pauseNote(t, r) {
  const budget = t.budgetUsd ? t.budgetUsd + (r.extraUsd || 0) : 0;
  switch (r.reason) {
    case 'budget': return { text: `It spent its ${usd(budget)} budget.`, more: `Resuming allows another ${usd(t.budgetUsd)}.`, go: `Resume · +${usd(t.budgetUsd)}` };
    case 'tokens': return { text: `It used its ${tokens(t.budgetTokens + (r.extraTokens || 0))} tokens.`, more: `Resuming allows another ${tokens(t.budgetTokens)}.`, go: `Resume · +${tokens(t.budgetTokens)}` };
    case 'time': return { text: `It reached its ${t.minutes + (r.extraMin || 0)} min time limit.`, more: `Resuming gives it another ${t.minutes} min.`, go: `Resume · +${t.minutes} min` };
    case 'restart': return { text: 'Artemis closed while the team was working.', more: 'Finished tasks are kept; the rest start again.', go: 'Resume' };
    default: return { text: 'Paused.', more: 'Nothing runs until you resume it.', go: 'Resume' };
  }
}

/**
 * One conversation: where the agents talk (left) and the team's tasks, members and budget (right).
 * `dm` narrows the General room to one agent: only their messages, and whatever you write goes to them.
 * `general` is the room with every agent, which has no goal to run again or settings to edit.
 */
export default function TeamRoom({ team: t, roster, you, youAvatar = '', onEdit, onBack, title = null, dm = '', general = false }) {
  const r = t.run || { messages: [], tasks: [], live: {}, spent: { usd: 0, tokens: 0 } };
  const lives = Object.values(r.live || {}).filter((l) => !dm || l.name === dm);
  const shown = dm ? r.messages.filter((m) => m.from === dm || m.to === dm) : r.messages;
  const [files, setFiles] = useState([]); // attached to the message being written
  const [drag, setDrag] = useState(false);
  const picker = useRef(null);
  const [text, setText] = useState('');
  const [logs, setLogs] = useState({}); // message id -> its task's steps are shown
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [goalOpen, setGoalOpen] = useState(false);
  const [flash, setFlash] = useState('');
  const scroller = useRef(null);
  const taRef = useRef(null);
  const stick = useRef(true);
  const [away, setAway] = useState(false); // scrolled up while new things arrive
  const st = teamState(t);
  const members = t.members.map((m) => m.name);
  const isTeam = !dm && !general;
  const roleOf = (n) => (n === LEAD ? 'lead' : (roster.find((a) => a.name === n) || {}).role || '');
  // the team's reviewer setting; teams saved before it: a member whose role says "review"
  const reviewerName = typeof t.reviewer === 'string' ? t.reviewer : ((t.members.find((m) => /review/i.test(roleOf(m.name))) || {}).name || '');
  const taskOf = (id) => r.tasks.find((k) => k.id === id);
  const act = async (fn) => {
    setErr(''); setBusy(true);
    try { const res = await fn(t.id); if (res && res.ok === false) setErr(res.error); } finally { setBusy(false); }
  };

  useLayoutEffect(() => { const el = scroller.current; if (!el) return; if (stick.current) el.scrollTop = el.scrollHeight; else setAway(true); }, [shown.length, lives.length, lives.reduce((n, l) => n + l.steps.length + (l.text ? 1 : 0), 0)]);
  useEffect(() => { stick.current = true; setGoalOpen(false); setAway(false); }, [t.id]);
  const onScroll = () => { const el = scroller.current; if (!el) return; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; if (stick.current) setAway(false); };
  const toEnd = () => { const el = scroller.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }); stick.current = true; setAway(false); };
  /** Scrolls the thread to one message and marks it for a moment. */
  const jump = (id) => {
    const el = scroller.current && scroller.current.querySelector(`[data-mid="${CSS.escape(id)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setFlash(id); setTimeout(() => setFlash((f) => (f === id ? '' : f)), 1600);
  };

  const send = async () => {
    const typed = text.trim();
    if (!typed && !files.length) return;
    const body = joinFiles(dm && !new RegExp('@' + dm + '\\b', 'i').test(typed) ? `@${dm} ${typed}`.trim() : typed, files);
    setText(''); setFiles([]); stick.current = true; setAway(false);
    const res = await window.api.teamsSay(t.id, body);
    if (res && res.ok === false) setErr(res.error);
  };
  // a file goes into the Files library, so agents can open it by its path
  const addFiles = async (list) => {
    setErr('');
    const root = await window.api.libRoot();
    for (const f of list) {
      try {
        let p = ''; try { p = window.api.pathForFile(f); } catch {}
        const res = p ? await window.api.libAddPaths([p]) : await window.api.libAddBuffer(f.name || 'file', new Uint8Array(await f.arrayBuffer()));
        const item = res && (res.item || (res.items && res.items[0]));
        if (!item) throw new Error((res && res.error) || 'Could not store this file.');
        const url = f.type && f.type.startsWith('image/') ? (await readImage(f)).url || '' : '';
        setFiles((x) => [...x, { name: item.name || f.name || 'file', path: `${root}/${item.path}`, url }]);
      } catch (e) { setErr(`${f.name || 'File'}: ${e.message}`); }
    }
  };
  const onPaste = (e) => { const list = [...e.clipboardData.files]; if (list.length) { e.preventDefault(); addFiles(list); } };
  const mention = (n) => {
    setText((x) => (new RegExp('@' + n + '\\b').test(x) ? x : (x && !/\s$/.test(x) ? x + ' ' : x) + '@' + n + ' '));
    requestAnimationFrame(() => { const ta = taRef.current; if (ta) { ta.focus(); ta.selectionStart = ta.selectionEnd = ta.value.length; } });
  };
  const menu = useMentionMenu({ text, setText, ta: taRef, members, lead: LEAD, roster });

  const done = r.tasks.filter((k) => k.status === 'done').length;
  const budget = t.budgetUsd ? t.budgetUsd + (r.extraUsd || 0) : 0;
  const asks = dm ? [] : r.messages.filter((m) => m.kind === 'approval' && m.decided == null);
  const resultOf = (k) => [...r.messages].reverse().find((m) => m.kind === 'result' && m.task === k.id);
  const waitingOn = (k) => (k.after || []).map(taskOf).filter((x) => x && x.status !== 'done');
  const paused = !dm && (r.status === 'paused' || r.status === 'failed');
  const lastErr = r.status === 'failed' ? [...r.messages].reverse().find((m) => m.kind === 'error') : null;

  // what needs you, right above the composer: an approval to give, or why the team stopped and how to go on
  let note = null;
  if (asks.length) {
    note = { tone: 'wait', icon: 'shield', text: asks.length === 1 ? `${asks[0].from} is waiting for your OK.` : `${asks.length} requests are waiting for your OK.`, more: asks.length === 1 ? asks[0].text : '', actions: [['Show', () => jump(asks[0].id), '']] };
  } else if (paused && r.status === 'failed') {
    note = { tone: 'err', icon: 'warning', text: 'The team stopped on an error.', more: lastErr ? lastErr.text : 'Resume to try again, or tell the team what to change.', actions: [['Try again', () => act(window.api.teamsResume), 'primary']] };
  } else if (paused) {
    const p = pauseNote(t, r);
    note = { tone: 'wait', icon: 'pause', text: p.text, more: p.more, actions: [['Stop', () => act(window.api.teamsStop), ''], [p.go, () => act(window.api.teamsResume), 'primary']] };
  }

  const bubble = (m, i, list) => {
    const prev = list[i - 1];
    const day = !prev || new Date(prev.t).toDateString() !== new Date(m.t).toDateString();
    const cont = !day && prev && prev.from === m.from && (prev.to || '') === (m.to || '') && plainKind(prev) && plainKind(m) && m.t - prev.t < GROUP_MS;
    const sep = day ? <div key={'d' + m.id} className="tm-day" role="separator"><span>{dayLabel(m.t)}</span></div> : null;
    const cls = (base) => `${base}${cont ? ' cont' : ''}${flash === m.id ? ' flash' : ''}`;
    if (m.from === 'you') {
      const sp = splitFiles(m.text);
      return [sep, <div key={m.id} data-mid={m.id} className={cls('tm-m you')}>{cont ? <span className="tm-av-gap" /> : <Avatar you name={you} src={youAvatar} />}<div className="tm-body">{sp.text && <div className="tm-bubble">{sp.text}</div>}<Files files={sp.files} /></div></div>];
    }
    if (m.kind === 'status') return [sep, <div key={m.id} data-mid={m.id} className="tm-status">{m.text}</div>];
    const who = cont ? null : (
      <div className="tm-who"><b>{m.from}</b>{m.from === LEAD ? <span className="tm-lead">lead</span> : null}{m.to ? <span className="tm-to"><Icon name="chevronRight" size={10} />{m.to}</span> : null}<time dateTime={new Date(m.t).toISOString()}>{time(m.t)}</time></div>
    );
    let extra = null;
    if (m.kind === 'plan') {
      const ks = (m.tasks || []).map(taskOf).filter(Boolean);
      extra = ks.length > 0 && (
        <div className="tm-card"><h4>Plan · {plural(ks.length, 'task')}</h4>
          <ol className="tm-plan">{ks.map((k, n) => <li key={k.id}><span className="tm-plan-n">{n + 1}</span><span title={k.title}>{taskTitle(k)}</span><Avatar name={k.assignee} size="xs" /><em>{k.assignee}</em></li>)}</ol>
        </div>
      );
    } else if (m.kind === 'approval') {
      extra = (
        <div className={`tm-card tm-approve ${m.decided == null ? 'open' : ''}`}>
          <Icon name="shield" size={15} />
          <div className="tm-r-t"><b>{m.decided == null ? 'Needs your OK' : 'Asked you first'}</b><small title={m.text}>{m.text}</small></div>
          {m.decided == null
            ? <><button type="button" onClick={() => window.api.decide(m.approvalId, false)}>Deny</button><button type="button" className="primary" onClick={() => window.api.decide(m.approvalId, true)}>Allow</button></>
            : <span className={`tm-chip ${m.decided ? 'ok' : 'no'}`}>{m.decided ? 'Allowed' : 'Denied'}</span>}
        </div>
      );
    } else if (m.kind === 'review') {
      extra = <span className={`tm-hand ${m.verdict === 'changes' ? 'req' : 'ok'}`}><Icon name={m.verdict === 'changes' ? 'refresh' : 'check'} size={12} />{m.verdict === 'changes' ? `Changes requested · back to ${m.to}` : 'Approved'}</span>;
    } else if (m.kind === 'result' && taskOf(m.task)) {
      const k = taskOf(m.task);
      const log = m.steps || [];
      extra = <>
        {log.length
          ? <button type="button" className="tm-hand" aria-expanded={!!logs[m.id]} onClick={() => setLogs((o) => ({ ...o, [m.id]: !o[m.id] }))}><Icon name="check" size={12} /><span className="tm-hand-t">Finished · {taskTitle(k)}</span><span className="tm-hand-n">{plural(log.length, 'step')}</span><Icon name={logs[m.id] ? 'chevronDown' : 'chevronRight'} size={11} /></button>
          : <span className="tm-hand"><Icon name="check" size={12} /><span className="tm-hand-t">Finished · {taskTitle(k)}</span></span>}
        {logs[m.id] && <Steps steps={log} />}
      </>;
    }
    const body = m.kind === 'approval' ? null : (
      <div className={`tm-text ${m.kind === 'error' ? 'err' : ''} ${m.kind === 'summary' ? 'summary' : ''}`}>
        {m.kind === 'summary' ? <div className="tm-card tm-result"><h4><Icon name="check" size={12} />Result</h4><Markdown text={m.text} /></div> : <Markdown text={m.text} />}
      </div>
    );
    return [sep, <div key={m.id} data-mid={m.id} className={cls('tm-m')}>{cont ? <span className="tm-av-gap" /> : <Avatar name={m.from} />}<div className="tm-body">{who}{body}{extra}</div></div>];
  };

  // nothing said yet: say what happens next, and offer the next step
  const empty = shown.length === 0 && lives.length === 0 && (
    dm ? <div className="tm-empty"><Avatar name={dm} size="lg" /><b>{dm}</b><span>{roleOf(dm) ? `${roleOf(dm)} · ` : ''}Write to {dm} directly. Files and pictures work too.</span></div>
      : general ? (
        <div className="tm-empty">
          <span className="tm-av tm-group lg"><Icon name="users" size={18} /></span>
          <b>Everyone, in one chat</b>
          <span>Write to all agents, or pick one to get them on it.</span>
          {members.length > 0 && <div className="tm-pick-row">{members.map((n) => <button type="button" key={n} onClick={() => mention(n)}><Avatar name={n} size="sm" /><span><b>{n}</b><small>{roleOf(n)}</small></span></button>)}</div>}
        </div>
      ) : (
        <div className="tm-empty">
          <Stack names={[LEAD, ...members]} size="lg" />
          <b>{r.status === 'working' ? 'Artemis is planning…' : 'Ready when you are'}</b>
          <span>{r.status === 'working' ? 'The plan shows up here in a moment.' : `${(MODES.find((x) => x[0] === t.mode) || MODES[0])[2]} You can watch, answer questions and step in here.`}</span>
          {(!r.status || r.status === 'idle') && <button type="button" className="tm-cta" disabled={busy} onClick={() => act(window.api.teamsStart)}><Icon name="play" size={13} />Start the team</button>}
        </div>
      )
  );

  const goalLong = (t.goal || '').length > 180;

  return (
    <div className="tm-room-page">
      <div className="tm-tb">
        {onBack && <button type="button" className="tm-ib tm-back" aria-label="Back to Agents" title="Back to Agents" onClick={onBack}><Icon name="chevronLeft" size={16} /></button>}
        {dm ? <Avatar name={dm} size="sm" /> : general ? <span className="tm-av tm-group sm"><Icon name="users" size={12} /></span> : null}
        {title || <h1 title={dm || t.name}>{dm || t.name}</h1>}
        {dm ? <span className="tm-role">{roleOf(dm)}</span> : (general && !r.status) || (general && r.status === 'idle') ? <span className="tm-role">{plural(members.length, 'agent')}</span> : <span className={`tm-pill ${st.dot}`}><i className={`tm-dot ${st.dot}`} />{st.label}{r.status === 'working' ? ` · ${elapsed(t)}` : ''}</span>}
        <span className="sp" />
        {isTeam && <Stack names={[LEAD, ...members]} />}
        {!dm && r.status === 'working' && <>
          <button type="button" className="quiet" disabled={busy} onClick={() => act(window.api.teamsPause)} title="Finish the steps in progress, then wait"><Icon name="pause" size={14} />Pause</button>
          <button type="button" disabled={busy} onClick={() => act(window.api.teamsStop)} title="End this run now"><Icon name="stop" size={12} />Stop</button>
        </>}
        {paused && asks.length > 0 && <button type="button" disabled={busy} onClick={() => act(window.api.teamsResume)}><Icon name="play" size={13} />Resume</button>}
        {(dm || (!general && r.status !== 'working')) && <button type="button" onClick={onEdit}>{dm ? 'Edit agent' : 'Edit'}</button>}
        {isTeam && (r.status === 'idle' || !r.status) && <button type="button" className="primary" disabled={busy} onClick={() => act(window.api.teamsStart)}><Icon name="play" size={13} />Start</button>}
        {isTeam && (r.status === 'done' || r.status === 'stopped') && <button type="button" disabled={busy} onClick={() => act(window.api.teamsStart)} title="Start over on the same goal; the notebook keeps what this run learned"><Icon name="refresh" size={13} />Run again</button>}
      </div>
      <div className="tm-room">
        <section className={`tm-thread ${drag ? 'drag' : ''}`} aria-label="Conversation" onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setDrag(false); addFiles([...e.dataTransfer.files]); }}>
          <div className="tm-msgs-wrap">
            <div className="tm-msgs" ref={scroller} onScroll={onScroll}>
              {empty}
              {shown.map(bubble)}
              {lives.map((l) => <LiveCard key={l.name + l.since} live={l} />)}
            </div>
            {away && <button type="button" className="tm-latest" onClick={toEnd}><Icon name="chevronDown" size={12} />Latest</button>}
          </div>
          {note && (
            <div className={`tm-note-bar ${note.tone}`} role="status">
              <Icon name={note.icon} size={15} />
              <div className="tm-r-t"><b>{note.text}</b>{note.more ? <small title={note.more}>{note.more}</small> : null}</div>
              {note.actions.map(([label, fn, cls]) => <button type="button" key={label} className={cls} disabled={busy} onClick={fn}>{label}</button>)}
            </div>
          )}
          {err && <div className="tm-err" role="alert">{err}</div>}
          <div className="tm-compose">
            <MentionMenu menu={menu} />
            {files.length > 0 && <div className="tm-attached">{files.map((f, i) => <span key={f.path}>{f.url ? <img src={f.url} alt="" /> : <Icon name="paperclip" size={12} />}<em>{f.name}</em><button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}><Icon name="x" size={11} /></button></span>)}</div>}
            <textarea ref={taRef} value={text} rows={2} aria-label="Write a message" placeholder={dm ? `Message ${dm}…` : general ? 'Message everyone, or @mention one agent…' : paused ? 'Write to resume the team, or @mention one agent…' : r.status === 'done' || r.status === 'stopped' ? 'Ask a follow-up, or give the team more to do…' : 'Message the team, or @mention one agent…'}
              onPaste={onPaste} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (menu.onKey(e)) return; if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
            <div className="tm-ct">
              <button type="button" className="tm-ib" aria-label="Attach files" title="Attach files. You can also drag or paste them here." onClick={() => picker.current && picker.current.click()}><Icon name="paperclip" size={15} /></button>
              <input ref={picker} type="file" multiple hidden onChange={(e) => { addFiles([...e.target.files]); e.target.value = ''; }} />
              <span className="tm-chiprow">{isTeam && members.map((n) => <button type="button" key={n} className="tm-chipbtn" title={`Mention ${n}`} onClick={() => mention(n)}><Avatar name={n} size="xs" />{n}</button>)}</span>
              <button type="button" className="tm-go" aria-label="Send" disabled={!text.trim() && !files.length} onClick={send}><Icon name="arrowUp" size={15} /></button>
            </div>
          </div>
        </section>
        {isTeam && <aside className="tm-panel" aria-label="Team">
          <section className="tm-ps">
            <div className="tm-ph"><span>Goal</span></div>
            <p className={`tm-goal ${goalOpen ? 'open' : ''}`}>{t.goal}</p>
            {goalLong && <button type="button" className="tm-more" onClick={() => setGoalOpen(!goalOpen)}>{goalOpen ? 'Show less' : 'Show more'}</button>}
          </section>
          <section className="tm-ps">
            <div className="tm-ph"><span>Tasks</span><span>{r.tasks.length ? `${done} of ${r.tasks.length} done` : ''}</span></div>
            {r.tasks.length > 0 && <div className="tm-tr" aria-hidden="true">{r.tasks.map((k) => <i key={k.id} className={k.status} />)}</div>}
            {r.tasks.length === 0 ? <p className="tm-none">{r.status === 'working' ? 'Artemis is planning…' : 'Artemis splits the goal into tasks when the team starts.'}</p> : (
              <div className="tm-kan">
                {r.tasks.map((k) => {
                  const res = resultOf(k);
                  const wait = k.status === 'todo' ? waitingOn(k) : [];
                  const status = wait.length ? 'waiting' : k.status;
                  const who = k.status === 'review' ? reviewerName || k.assignee : k.assignee;
                  const tip = [taskTitle(k), `${who}${k.status === 'review' ? ' is reviewing' : ''}`, wait.length ? `Starts after: ${wait.map(taskTitle).join('; ')}` : '', res ? 'Click to see the result' : ''].filter(Boolean).join('\n');
                  const inner = <><Avatar name={who} size="sm" /><span>{taskTitle(k)}</span><em className={`tm-st ${status}`}>{STATUS_LABEL[status]}</em></>;
                  return res
                    ? <button type="button" key={k.id} className={`tm-tk ${k.status} tm-tk-go`} title={tip} onClick={() => jump(res.id)}>{inner}</button>
                    : <div key={k.id} className={`tm-tk ${k.status}`} title={tip}>{inner}</div>;
                })}
              </div>
            )}
          </section>
          <section className="tm-ps">
            <div className="tm-ph"><span>Members</span><span>{members.length + 1}</span></div>
            {[LEAD, ...members].map((n) => {
              const what = lives.filter((l) => l.name === n).map((l) => l.what).join(', ');
              const mine = r.tasks.filter((k) => k.assignee === n);
              const ask = asks.find((m) => m.from === n);
              const sub = ask ? 'Waiting for your OK' : what || (n === LEAD ? (r.status === 'working' ? 'Watching the plan' : 'Plans and sums up') : mine.length ? `${mine.filter((k) => k.status === 'done').length} of ${plural(mine.length, 'task')} done` : n === reviewerName ? 'Checks finished work' : roleOf(n) || 'No tasks yet');
              const runsOn = n === LEAD ? '' : (t.members.find((m) => m.name === n) || {}).model;
              const dot = ask ? 'wait' : what ? 'work' : '';
              return (
                <button type="button" key={n} className="tm-mem" title={ask ? 'Show the request' : `Mention ${n} in your message`} onClick={() => (ask ? jump(ask.id) : mention(n))}>
                  <Avatar name={n} size="sm" />
                  <span className="tm-r-t"><b>{n}{n === reviewerName ? <span className="tm-tag">reviewer</span> : null}{isCli(runsOn) ? <span className="tm-tag">{modelLabel(runsOn)}</span> : null}</b><small>{sub}</small></span>
                  {dot ? <i className={`tm-dot ${dot}`} /> : null}
                </button>
              );
            })}
          </section>
          <section className="tm-ps">
            <div className="tm-ph"><span>Spent</span><span title={r.spent.usd || !r.spent.tokens ? undefined : 'Set prices for these models in Settings → Models & providers to see costs'}>{r.spent.usd || !r.spent.tokens ? usd(r.spent.usd) : 'Not priced'}{budget ? ` of ${usd(budget)}` : ''}</span></div>
            {budget > 0 && <div className={`tm-meter ${r.spent.usd >= budget ? 'over' : r.spent.usd >= budget * 0.8 ? 'near' : ''}`} role="progressbar" aria-label="Budget used" aria-valuenow={Math.min(100, Math.round((r.spent.usd / budget) * 100))} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${Math.min(100, (r.spent.usd / budget) * 100)}%` }} /></div>}
            <div className="tm-mrow"><span>{tokens(r.spent.tokens)} tokens{t.budgetTokens ? ` of ${tokens(t.budgetTokens + (r.extraTokens || 0))}` : ''}</span><span>{t.minutes ? `${r.workMs ? Math.round(r.workMs / 60000) + ' of ' : 'Up to '}${t.minutes + (r.extraMin || 0)} min` : 'No time limit'}</span></div>
          </section>
          {t.repeat && <section className="tm-ps"><div className="tm-ph"><span>Runs by itself</span></div><p className="tm-none">{t.repeat.type === 'interval' ? `Every ${Math.round((t.repeat.every || 60) / 60)} h` : `${t.repeat.type === 'weekdays' ? 'Weekdays' : 'Every day'} at ${t.repeat.at || '09:00'}`}. Each run reads the notebook.</p></section>}
          {t.notebook && (
            <details className="tm-ps tm-note">
              <summary className="tm-ph"><span><Icon name="chevronRight" size={10} />Notebook</span><span>{plural(t.notebook.split('\n## ').length, 'run')}</span></summary>
              <div className="tm-note-body"><Markdown text={t.notebook} /></div>
              <button type="button" className="tm-more" onClick={() => act(window.api.teamsNotebookClear)}>Clear notebook</button>
            </details>
          )}
        </aside>}
      </div>
    </div>
  );
}
