import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Markdown from '../Markdown.jsx';
import { Icon } from '../Icons.jsx';
import { Avatar, Stack, LEAD, teamState, usd, tokens, elapsed } from './parts.jsx';

const STATUS_LABEL = { todo: 'to do', doing: 'doing', review: 'review', done: 'done' };
const time = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** One team: the room where its agents talk (left) and its tasks, members and budget (right). */
export default function TeamRoom({ team: t, roster, you, onBack, onEdit }) {
  const r = t.run || { messages: [], tasks: [], active: {}, spent: { usd: 0, tokens: 0 } };
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const scroller = useRef(null);
  const stick = useRef(true);
  const st = teamState(t);
  const members = t.members.map((m) => m.name);
  const roleOf = (n) => (n === LEAD ? 'lead' : (roster.find((a) => a.name === n) || {}).role || '');
  const taskOf = (id) => r.tasks.find((k) => k.id === id);
  const act = async (fn) => { setErr(''); const res = await fn(t.id); if (res && res.ok === false) setErr(res.error); };

  useLayoutEffect(() => { const el = scroller.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [r.messages.length, Object.keys(r.active || {}).length]);
  useEffect(() => { stick.current = true; }, [t.id]);
  const onScroll = () => { const el = scroller.current; if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; };

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setText(''); stick.current = true;
    const res = await window.api.teamsSay(t.id, body);
    if (res && res.ok === false) setErr(res.error);
  };
  const mention = (n) => setText((x) => (x && !/\s$/.test(x) ? x + ' ' : x) + '@' + n + ' ');

  const done = r.tasks.filter((k) => k.status === 'done').length;
  const budget = t.budgetUsd ? t.budgetUsd + (r.extraUsd || 0) : 0;

  const bubble = (m) => {
    if (m.from === 'you') return (
      <div key={m.id} className="tm-m you"><Avatar you name={you} /><div className="tm-body"><div className="tm-bubble">{m.text}</div></div></div>
    );
    if (m.kind === 'status') return <div key={m.id} className="tm-status">{m.text}</div>;
    const who = (
      <div className="tm-who"><b>{m.from}</b>{m.from === LEAD ? <span>lead</span> : null}{m.to ? <span className="tm-to">to {m.to}</span> : null}<span>· {time(m.t)}</span></div>
    );
    let extra = null;
    if (m.kind === 'plan') {
      const list = (m.tasks || []).map(taskOf).filter(Boolean);
      extra = list.length > 0 && (
        <div className="tm-card"><h4>Plan · {list.length} task{list.length === 1 ? '' : 's'}</h4>
          <ul className="tm-plan">{list.map((k) => <li key={k.id}><Avatar name={k.assignee} size="sm" /><span>{k.title}</span><em>{k.assignee}</em></li>)}</ul>
        </div>
      );
    } else if (m.kind === 'approval') {
      extra = (
        <div className="tm-card tm-approve">
          <div className="tm-r-t"><b>{m.decided == null ? 'Needs your OK' : 'Asked to'}</b><small>{m.text}</small></div>
          {m.decided == null
            ? <><button type="button" onClick={() => window.api.decide(m.approvalId, false)}>Deny</button><button type="button" className="primary" onClick={() => window.api.decide(m.approvalId, true)}>Allow</button></>
            : <span className={`tm-chip ${m.decided ? 'ok' : ''}`}>{m.decided ? 'Allowed' : 'Denied'}</span>}
        </div>
      );
    } else if (m.kind === 'review') {
      extra = <span className={`tm-hand ${m.verdict === 'changes' ? 'req' : 'ok'}`}><Avatar name={m.to} size="xs" />{m.verdict === 'changes' ? `Changes requested · back to ${m.to}` : 'Approved'}</span>;
    } else if (m.kind === 'result' && taskOf(m.task)) {
      extra = <span className="tm-hand"><Icon name="check" size={12} />Finished · {taskOf(m.task).title}</span>;
    }
    const body = m.kind === 'approval' ? null : (
      <div className={`tm-text ${m.kind === 'error' ? 'err' : ''} ${m.kind === 'summary' ? 'summary' : ''}`}>
        {m.kind === 'summary' ? <div className="tm-card tm-result"><h4>Result</h4><Markdown text={m.text} /></div> : <Markdown text={m.text} />}
      </div>
    );
    return <div key={m.id} className="tm-m"><Avatar name={m.from} /><div className="tm-body">{who}{body}{extra}</div></div>;
  };

  return (
    <div className="tm-room-page">
      <div className="tm-tb">
        <button type="button" className="tm-ib" aria-label="Back to Agents" title="Back to Agents" onClick={onBack}><Icon name="chevronLeft" size={16} /></button>
        <h1>{t.name}</h1>
        <span className={`tm-pill ${st.dot}`}><i className={`tm-dot ${st.dot}`} />{st.label}{r.status === 'working' ? ` · ${elapsed(t)}` : ''}</span>
        <span className="sp" />
        <Stack names={[LEAD, ...members]} />
        {r.status === 'working' && <>
          <button type="button" className="quiet" onClick={() => act(window.api.teamsPause)}><Icon name="pause" size={14} />Pause</button>
          <button type="button" onClick={() => act(window.api.teamsStop)}><Icon name="stop" size={12} />Stop</button>
        </>}
        {(r.status === 'paused' || r.status === 'failed') && <>
          <button type="button" className="primary" onClick={() => act(window.api.teamsResume)}><Icon name="play" size={13} />Resume</button>
          <button type="button" onClick={() => act(window.api.teamsStop)}>Stop</button>
        </>}
        {r.status !== 'working' && <button type="button" onClick={onEdit}>Edit</button>}
        {(r.status === 'idle' || !r.status) && <button type="button" className="primary" onClick={() => act(window.api.teamsStart)}><Icon name="play" size={13} />Start</button>}
        {(r.status === 'done' || r.status === 'stopped') && <button type="button" onClick={() => act(window.api.teamsStart)}><Icon name="refresh" size={13} />Run again</button>}
      </div>
      <div className="tm-room">
        <section className="tm-thread" aria-label="Team room">
          <div className="tm-msgs" ref={scroller} onScroll={onScroll}>
            {r.messages.length === 0 && <div className="tm-empty"><b>Nothing here yet</b><span>Start the team and its agents will plan and talk here.</span></div>}
            {r.messages.map(bubble)}
            {Object.entries(r.active || {}).map(([n, what]) => (
              <div key={'a-' + n} className="tm-typing"><Avatar name={n} size="sm" /><span className="tm-dots" aria-hidden="true"><i /><i /><i /></span>{n}{what ? ` · ${what}` : ''}…</div>
            ))}
          </div>
          {err && <div className="tm-err" role="alert">{err}</div>}
          <div className="tm-compose">
            <textarea value={text} rows={2} aria-label="Message the team" placeholder={r.status === 'done' ? 'Ask a follow-up, or give the team more to do…' : 'Message the team, or @mention one agent…'}
              onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
            <div className="tm-ct">
              {members.map((n) => <button type="button" key={n} className="tm-chipbtn" onClick={() => mention(n)}><Icon name="at" size={12} />{n}</button>)}
              <button type="button" className="tm-go" aria-label="Send" disabled={!text.trim()} onClick={send}><Icon name="arrowUp" size={15} /></button>
            </div>
          </div>
        </section>
        <aside className="tm-panel" aria-label="Team">
          <div className="tm-ph"><span>Goal</span></div>
          <p className="tm-goal">{t.goal}</p>
          <div className="tm-ph"><span>Tasks</span><span>{r.tasks.length ? `${done} of ${r.tasks.length} done` : ''}</span></div>
          {r.tasks.length === 0 ? <p className="tm-none">{r.status === 'working' ? 'Artemis is planning…' : 'No tasks yet.'}</p> : (
            <div className="tm-kan">
              {r.tasks.map((k) => (
                <div key={k.id} className={`tm-tk ${k.status}`} title={k.title}><Avatar name={k.status === 'review' ? (t.members.find((m) => /review/i.test(roleOf(m.name))) || {}).name || k.assignee : k.assignee} size="sm" /><span>{k.title}</span><em className={`tm-st ${k.status}`}>{STATUS_LABEL[k.status]}</em></div>
              ))}
            </div>
          )}
          <div className="tm-ph"><span>Members</span><span>{members.length + 1}</span></div>
          {[LEAD, ...members].map((n) => {
            const what = (r.active || {})[n];
            const mine = r.tasks.filter((k) => k.assignee === n);
            const asks = r.messages.some((m) => m.kind === 'approval' && m.decided == null && m.from === n);
            const sub = asks ? 'Waiting for you' : what || (n === LEAD ? (r.status === 'working' ? 'Watching the plan' : 'Idle') : mine.length ? `${mine.filter((k) => k.status === 'done').length} of ${mine.length} tasks done` : 'Idle');
            return <div key={n} className="tm-mem"><Avatar name={n} size="sm" /><div className="tm-r-t"><b>{n}</b><small>{sub}</small></div><i className={`tm-dot ${asks ? 'wait' : what ? 'work' : ''}`} /></div>;
          })}
          <div className="tm-ph"><span>Spent</span><span>{usd(r.spent.usd)}{budget ? ` of ${usd(budget)}` : ''}</span></div>
          {budget > 0 && <div className="tm-meter" role="progressbar" aria-label="Budget used" aria-valuenow={Math.min(100, Math.round((r.spent.usd / budget) * 100))} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${Math.min(100, (r.spent.usd / budget) * 100)}%` }} /></div>}
          <div className="tm-mrow"><span>{tokens(r.spent.tokens)} tokens</span><span>{t.minutes ? `Pauses at ${t.minutes + (r.extraMin || 0)} min` : 'No time limit'}</span></div>
        </aside>
      </div>
    </div>
  );
}
