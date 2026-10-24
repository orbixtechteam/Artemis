import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icons.jsx';
import Logo from './Logo.jsx';
import { captureFrame } from '../lib/speaker.js';

/*
 * The lock screen and the small jobs that go with it. Mounted once in App. The page keeps running behind the lock (Sentinel must keep
 * hearing its owner), but main blocks every acting channel while locked, so this overlay is a courtesy, not the protection.
 *  - the lock screen: password, Touch ID, recovery code, the lockdown countdown, a hint when the owner's voice can unlock
 *  - the password prompt main asks for to approve a sensitive action when Touch ID is not available
 *  - one webcam frame when main asks for it (unauthorized-access alert)
 *  - activity pings, so "lock after N minutes idle" counts typing and mouse use inside this window
 */
function useClock(until) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!until) return undefined;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [until]);
}
const fmt = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const r = s % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`; };

function PasswordPrompt({ req, onDone }) {
  const [pw, setPw] = useState('');
  const ref = useRef(null);
  useEffect(() => { ref.current && ref.current.focus(); }, []);
  const send = () => { if (pw) onDone(pw); };
  return (
    <div className="overlay dialog-overlay lock-prompt-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onDone(null); }}>
      <div className="modal dialog" role="alertdialog" aria-modal="true" aria-labelledby="lock-prompt-title">
        <h2 id="lock-prompt-title">Enter your Artemis password</h2>
        <p className="dialog-msg">{req.reason || 'Touch ID is not available, so Artemis needs your password to approve this.'}</p>
        <input ref={ref} type="password" className="lock-input" autoComplete="off" spellCheck={false} placeholder="Password" value={pw} aria-label="Artemis password"
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } else if (e.key === 'Escape') { e.preventDefault(); onDone(null); } }} />
        <div className="actions-row">
          <button onClick={() => onDone(null)}>Cancel</button>
          <button className="primary" onClick={send} disabled={!pw}>Approve</button>
        </div>
      </div>
    </div>
  );
}

export default function LockHost({ sentinel }) {
  const [st, setSt] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [pw, setPw] = useState('');
  const [code, setCode] = useState('');
  const [mode, setMode] = useState('password'); // 'password' | 'recovery'
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [auth, setAuth] = useState(null);
  const skew = useRef(0);
  const touchTried = useRef(false);
  const input = useRef(null);

  const apply = useCallback((s) => {
    if (!s) return;
    if (s.now) skew.current = Date.now() - s.now;
    setSt((p) => ({ ...(p || {}), ...s }));
    if (s.config) setCfg(s.config);
  }, []);
  const reload = useCallback(() => window.api.lockStatus().then(apply).catch(() => {}), [apply]);

  useEffect(() => {
    if (!window.api || !window.api.lockStatus) return undefined;
    reload();
    const off = [
      window.api.onLockState((s) => { apply(s); if (s && !s.locked) { setPw(''); setCode(''); setErr(''); setMode('password'); touchTried.current = false; } window.api.lockStatus().then((x) => x && x.config && setCfg(x.config)).catch(() => {}); }),
      window.api.onLockAuthRequest((r) => setAuth(r)),
      window.api.onLockSnap(({ id }) => { captureFrame().then((d) => window.api.lockSnapResult(id, d)).catch(() => window.api.lockSnapResult(id, null)); })
    ];
    return () => off.forEach((f) => { try { f && f(); } catch {} });
  }, [apply, reload]);

  const locked = !!(st && st.locked);
  const until = st && st.lockdown && st.lockdown.active ? st.lockdown.until : 0;
  useClock(until);
  const left = until ? until - (Date.now() - skew.current) : 0;
  const inLockdown = left > 0;
  // when the countdown ends, ask main again so the screen offers the normal unlock methods
  useEffect(() => { if (until && left <= 0) reload(); }, [until, left, reload]);

  // the page behind the lock cannot be reached from the keyboard, and Tab stays on the lock screen
  useEffect(() => {
    document.body.classList.toggle('app-locked', locked);
    const root = document.getElementById('root');
    if (root) { try { root.inert = locked; } catch {} }
    return () => { document.body.classList.remove('app-locked'); if (root) { try { root.inert = false; } catch {} } };
  }, [locked]);

  // activity pings (at most one every 4 s) so the idle timer counts what happens in this window
  useEffect(() => {
    if (!window.api || locked) return undefined;
    let last = 0;
    const ping = () => { const n = Date.now(); if (n - last < 4000) return; last = n; window.api.lockActivity().catch(() => {}); };
    const evs = ['keydown', 'mousedown', 'mousemove', 'wheel', 'touchstart'];
    evs.forEach((e) => window.addEventListener(e, ping, { passive: true, capture: true }));
    return () => evs.forEach((e) => window.removeEventListener(e, ping, { capture: true }));
  }, [locked]);

  const unlockWith = useCallback(async (method, value) => {
    setBusy(true); setErr('');
    try {
      const r = await window.api.lockUnlock(method, value);
      if (r && r.ok) { setPw(''); setCode(''); return; }
      if (r && r.cancelled) return;
      setErr((r && r.error) || 'Could not unlock.');
      setPw(''); reload();
    } catch (e) { setErr((e && e.message) || 'Could not unlock.'); } finally { setBusy(false); }
  }, [reload]);

  const touch = useCallback(() => { if (!inLockdown) unlockWith('touchid', ''); }, [unlockWith, inLockdown]);
  // offer Touch ID once as soon as the lock screen is up and this window has focus
  useEffect(() => {
    if (!locked) { touchTried.current = false; return undefined; }
    if (!st.touchId || inLockdown || touchTried.current) return undefined;
    const go = () => { if (touchTried.current || !document.hasFocus()) return; touchTried.current = true; touch(); };
    const t = setTimeout(go, 350);
    window.addEventListener('focus', go);
    return () => { clearTimeout(t); window.removeEventListener('focus', go); };
  }, [locked, st && st.touchId, inLockdown, touch]);
  useEffect(() => { if (locked && !inLockdown && input.current) input.current.focus(); }, [locked, inLockdown, mode]);

  const submit = (e) => {
    e && e.preventDefault();
    if (busy) return;
    if (mode === 'recovery') { if (code.trim()) unlockWith('recovery', code.trim()); } else if (pw) unlockWith('password', pw);
  };

  const answer = (v) => { const r = auth; setAuth(null); if (r) window.api.lockAuthAnswer(r.id, v); };
  const prompt = auth && createPortal(<PasswordPrompt key={auth.id} req={auth} onDone={answer} />, document.body);
  if (!locked) return prompt || null;

  const sState = sentinel || 'off';
  const voiceHint = cfg && cfg.voiceUnlock && !inLockdown
    ? (sState === 'off' ? 'Voice unlock is on, but Sentinel is off. Turn Sentinel on to unlock by voice.' : `Say “${window.__wakeWord || 'Wake up'}”, then speak. Your voice unlocks Artemis.`)
    : '';
  const why = { start: 'Locked when Artemis started', idle: 'Locked after a period of inactivity', sleep: 'Locked when the Mac went to sleep', manual: 'Locked', ai: 'Locked', mcp: 'Locked', voice: 'Locked: another voice was heard', lockdown: 'Locked after too many failed attempts' }[st.reason] || 'Locked';

  return createPortal(
    <>
      <div className="lock-screen" role="dialog" aria-modal="true" aria-label="Artemis is locked">
        <form className="lock-card" onSubmit={submit}>
          <div className="lock-mark" aria-hidden="true"><Logo size={72} /><span className="lock-badge"><Icon name="lock" size={13} /></span></div>
          <h1 className="lock-title">Artemis is locked</h1>
          <p className="lock-sub">{why}</p>
          {inLockdown ? (
            <div className="lock-down" role="alert">
              <div className="lock-count">{fmt(left)}</div>
              <p>Too many failed attempts. Voice, password and Touch ID are off until the timer ends.</p>
              <p className="lock-small">Your recovery code still works.</p>
              {mode !== 'recovery' && <button type="button" className="lock-link" onClick={() => { setMode('recovery'); setErr(''); }}>Use recovery code</button>}
            </div>
          ) : null}
          {(!inLockdown || mode === 'recovery') && (
            mode === 'recovery'
              ? <input ref={input} className="lock-input mono" autoComplete="off" spellCheck={false} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX" aria-label="Recovery code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} disabled={busy} />
              : <input ref={input} type="password" className="lock-input" autoComplete="off" spellCheck={false} placeholder="Password" aria-label="Password" value={pw} onChange={(e) => setPw(e.target.value)} disabled={busy || inLockdown} />
          )}
          {err && <div className="lock-err" role="alert">{err}</div>}
          {(!inLockdown || mode === 'recovery') && (
            <div className="lock-actions">
              <button type="submit" className="primary" disabled={busy || (mode === 'recovery' ? !code.trim() : !pw)}>{busy ? 'Checking…' : 'Unlock'}</button>
              {st.touchId && !inLockdown && <button type="button" onClick={touch} disabled={busy}><Icon name="fingerprint" size={15} /> Use Touch ID</button>}
            </div>
          )}
          {!inLockdown && (
            <button type="button" className="lock-link" onClick={() => { setMode(mode === 'recovery' ? 'password' : 'recovery'); setErr(''); }}>
              {mode === 'recovery' ? 'Use password' : 'Forgot your password? Use the recovery code'}
            </button>
          )}
          {voiceHint && <p className="lock-voice"><Icon name="mic" size={14} /> {voiceHint}</p>}
        </form>
      </div>
      {prompt}
    </>,
    document.body
  );
}
