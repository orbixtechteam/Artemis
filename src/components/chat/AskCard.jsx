import React, { useEffect, useRef, useState } from 'react';
import { Icon } from '../Icons.jsx';

/**
 * Questions from the assistant (ask_user, Claude Code's AskUserQuestion), Claude-style: one question at a time,
 * compact numbered options (1-9 on the keyboard), "Something else" inline, Back / Next / Submit.
 * A single-choice pick moves on by itself. After answering, the card shrinks to a one-line summary per question.
 */
export default function AskCard({ id, questions }) {
  const qs = questions || [];
  const [at, setAt] = useState(0);
  const [pick, setPick] = useState(() => qs.map(() => []));
  const [other, setOther] = useState(() => qs.map(() => ''));
  const [sent, setSent] = useState(null);
  const box = useRef(null);
  const otherRef = useRef(null);

  const answerOf = (i) => [...pick[i], ...(other[i].trim() ? [other[i].trim()] : [])].join(', ');
  const answered = (i) => !!answerOf(i);
  const allAnswered = qs.every((_, i) => answered(i));
  const last = at === qs.length - 1;
  const q = qs[at];

  useEffect(() => { box.current && box.current.focus({ preventScroll: true }); }, [at]);

  const submit = (skip) => {
    const answers = {};
    if (!skip) qs.forEach((x, i) => { answers[x.question] = answerOf(i); });
    setSent(skip ? 'skipped' : answers);
    window.api.answer(id, skip ? null : answers);
  };
  const next = () => { if (!answered(at)) return; if (last) { if (allAnswered) submit(false); } else setAt(at + 1); };
  const choose = (label) => {
    const multi = !!q.multiSelect;
    const cur = pick[at];
    const val = multi ? (cur.includes(label) ? cur.filter((x) => x !== label) : [...cur, label]) : (cur[0] === label ? [] : [label]);
    setPick((p) => p.map((c, j) => (j === at ? val : c)));
    if (!multi) setOther((o) => o.map((c, j) => (j === at ? '' : c)));
    if (!multi && val.length && !last) setTimeout(() => setAt((a) => Math.min(a + 1, qs.length - 1)), 140); // one choice: move on
  };
  const onKey = (e) => {
    if (e.target && e.target.tagName === 'INPUT') return;
    const n = Number(e.key);
    if (n >= 1 && n <= q.options.length) { e.preventDefault(); choose(q.options[n - 1].label); }
    else if (e.key === 'Enter') { e.preventDefault(); next(); }
    else if (e.key === 'ArrowLeft' && at > 0) { e.preventDefault(); setAt(at - 1); }
    else if (e.key === 'ArrowRight' && !last && answered(at)) { e.preventDefault(); setAt(at + 1); }
  };

  if (sent) return <AskSummary questions={qs} answers={sent === 'skipped' ? null : sent} />;
  if (!q) return null;
  return (
    <div className="askc" ref={box} tabIndex={-1} onKeyDown={onKey} role="group" aria-label="Questions from the assistant">
      {qs.length > 1 && (
        <div className="askc-steps" role="tablist">
          {qs.map((x, i) => (
            <button key={i} type="button" role="tab" aria-selected={i === at} className={`askc-step${i === at ? ' on' : ''}${answered(i) ? ' ok' : ''}`}
              onClick={() => (i <= at || qs.slice(0, i).every((_, k) => answered(k))) && setAt(i)}>
              {answered(i) && i !== at ? <Icon name="check" size={11} /> : <span className="askc-step-n">{i + 1}</span>}
              <span className="askc-step-t">{x.header || `Question ${i + 1}`}</span>
            </button>
          ))}
          <span className="askc-count">{at + 1} / {qs.length}</span>
        </div>
      )}
      <div className="askc-q">{q.question}{q.multiSelect && <span className="askc-multi">Choose any</span>}</div>
      <div className="askc-opts" role={q.multiSelect ? 'group' : 'radiogroup'}>
        {q.options.map((o, k) => {
          const on = pick[at].includes(o.label);
          return (
            <button key={o.label} type="button" role={q.multiSelect ? 'checkbox' : 'radio'} aria-checked={on} className={`askc-opt${on ? ' on' : ''}`} onClick={() => choose(o.label)}>
              <span className="askc-key">{k + 1}</span>
              <span className="askc-txt"><span className="askc-label">{o.label}</span>{o.description && <span className="askc-desc">{o.description}</span>}</span>
              <span className={`askc-check${q.multiSelect ? ' box' : ''}`}>{on && <Icon name="check" size={13} />}</span>
            </button>
          );
        })}
        <label className={`askc-opt askc-other${other[at].trim() ? ' on' : ''}`}>
          <span className="askc-key"><Icon name="edit" size={12} /></span>
          <input ref={otherRef} value={other[at]} placeholder="Something else…" aria-label="Your own answer"
            onChange={(e) => { const v = e.target.value; setOther((p) => p.map((x, j) => (j === at ? v : x))); if (v && !q.multiSelect) setPick((p) => p.map((x, j) => (j === at ? [] : x))); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); next(); } }} />
        </label>
      </div>
      <div className="askc-foot">
        <button type="button" className="askc-skip" onClick={() => submit(true)}>Skip</button>
        <span className="askc-hint">Press 1–{Math.min(9, q.options.length)} to choose</span>
        {at > 0 && <button type="button" className="secondary" onClick={() => setAt(at - 1)}>Back</button>}
        <button type="button" className="primary" disabled={last ? !allAnswered : !answered(at)} onClick={next}>{last ? 'Submit' : 'Next'}</button>
      </div>
    </div>
  );
}

/** What was answered (or that the question was skipped), one line per question. */
export function AskSummary({ questions, answers }) {
  return (
    <div className="askc done">
      {!answers
        ? <div className="askc-summary muted">Skipped — the assistant chose for you.</div>
        : (questions || []).map((x) => (
          <div key={x.question} className="askc-summary">
            <Icon name="check" size={13} className="askc-sum-icon" />
            <span className="askc-sum-q">{x.header || x.question}</span>
            <span className="askc-sum-a">{answers[x.question]}</span>
          </div>
        ))}
    </div>
  );
}
