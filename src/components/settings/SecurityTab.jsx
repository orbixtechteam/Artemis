import React, { useCallback, useEffect, useRef, useState } from 'react';
import Select from '../Select.jsx';
import { askConfirm } from '../../lib/dialog.js';
import { recordWav, ENROLL_PHRASES } from '../../lib/speaker.js';
import { Group, Row, SwitchRow, Note, Buttons } from './ui.jsx';

/*
 * Settings → Security: the app lock (password, recovery code, Touch ID), when it locks, recognising your voice, what happens on
 * unauthorized access, and Touch ID before sensitive actions. All decisions are made in the main process; this page only asks.
 */
const IDLE = [[0, 'Never'], [1, '1 minute'], [5, '5 minutes'], [10, '10 minutes'], [15, '15 minutes'], [30, '30 minutes'], [60, '1 hour']];
const SENSITIVE = [
  ['delete', 'Deleting files and notes'],
  ['shell', 'Running terminal commands'],
  ['computer', 'Controlling the computer (screen, mouse, keyboard)'],
  ['connectorWrite', 'Connected apps that change things (send, create, delete)'],
  ['write', 'Writing and editing files and notes']
];
const when = (t) => (t ? new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

export function SecurityTab() {
  const [st, setSt] = useState(null);       // lock status + config
  const [sp, setSp] = useState(null);       // speaker status
  const [tg, setTg] = useState(null);       // Telegram status
  const [msg, setMsg] = useState({});       // small messages per area
  const [pw, setPw] = useState({ a: '', b: '' });
  const [code, setCode] = useState('');     // recovery code, shown once
  const [ask, setAsk] = useState(null);     // { label, run } waiting for the password / Touch ID
  const [askPw, setAskPw] = useState('');
  const [dl, setDl] = useState(null);       // model download progress
  const [enr, setEnr] = useState(null);     // enrolment: { i, count, phase: 'idle' | 'rec' | 'send', level }
  const [test, setTest] = useState(null);   // test my voice: { phase, result }
  const rec = useRef(null);
  const cfg = (st && st.config) || {};
  const note = (k, text, tone = '') => setMsg((m) => ({ ...m, [k]: text ? { text, tone } : null }));

  const loadAll = useCallback(() => {
    window.api.lockStatus().then(setSt).catch(() => {});
    window.api.speakerStatus().then(setSp).catch(() => {});
    window.api.remoteStatus && window.api.remoteStatus().then((r) => setTg(r && r.telegram)).catch(() => {});
  }, []);
  useEffect(() => {
    loadAll();
    const offState = window.api.onLockState(() => window.api.lockStatus().then(setSt).catch(() => {}));
    const offProg = window.api.onSpeakerProgress((p) => setDl(p));
    window.addEventListener('focus', loadAll);
    return () => { try { offState && offState(); offProg && offProg(); } catch {} window.removeEventListener('focus', loadAll); if (rec.current) { rec.current.cancel(); rec.current = null; } };
  }, [loadAll]);

  // ---- asking for the password (or Touch ID) before something that weakens the lock ----
  const withAuth = (label, run) => {
    if (!st || !st.enabled) return run({});
    setAskPw(''); setAsk({ label, run });
    return undefined;
  };
  const confirmAuth = async (how) => {
    const a = ask; if (!a) return;
    const auth = how === 'touchid' ? { touchid: true } : { password: askPw };
    const r = await a.run(auth);
    if (r && r.ok === false) { note('auth', r.error || 'That did not work.', 'bad'); return; }
    setAsk(null); setAskPw(''); note('auth', '');
  };
  const apply = async (patch, auth) => {
    const r = await window.api.lockConfig(patch, auth || {});
    if (r && r.ok && r.status) setSt(r.status); else if (r && r.ok) loadAll();
    return r;
  };
  const toggle = (patch) => apply(patch).then((r) => { if (r && !r.ok) note('lock', r.error, 'bad'); else note('lock', ''); return r; });

  // ---- password ----
  const savePassword = async () => {
    note('pw', '');
    if (pw.a.length < 6) return note('pw', 'Use at least 6 characters.', 'bad');
    if (pw.a !== pw.b) return note('pw', 'The two passwords are not the same.', 'bad');
    const go = async (auth) => {
      const r = await window.api.lockSetup({ password: pw.a, current: auth });
      if (!r.ok) { note('pw', r.error, 'bad'); return r; }
      setSt(r.status); setPw({ a: '', b: '' }); setCode(r.recoveryCode || '');
      if (!r.status.enabled) { const r2 = await window.api.lockConfig({ enabled: true }, {}); if (r2.ok && r2.status) setSt(r2.status); }
      note('pw', st && st.hasPassword ? 'Password changed.' : 'Password set. The lock is on.', 'ok');
      return r;
    };
    if (st && st.hasPassword) withAuth('change the password', go); else go({});
  };
  const newCode = () => withAuth('make a new recovery code', async (auth) => {
    const r = await window.api.lockRecovery(auth);
    if (!r.ok) return r;
    setCode(r.recoveryCode || ''); loadAll(); return r;
  });
  const lockNow = async () => { const r = await window.api.lockLock(); if (!r.ok) note('lock', r.error, 'bad'); };

  // ---- voice ----
  const download = async () => {
    setDl({ pct: 0, detail: 'Starting…' }); note('voice', '');
    const r = await window.api.speakerDownload();
    setDl(null);
    if (!r.ok) note('voice', r.error, 'bad'); else note('voice', 'The voice recognition model is ready.', 'ok');
    loadAll();
  };
  const startRec = async (maxMs, onWav) => {
    try {
      const r = await recordWav({ maxMs, onLevel: (l) => setEnr((e) => (e ? { ...e, level: l } : e)) });
      rec.current = r;
      r.done.then((o) => { if (rec.current === r) rec.current = null; if (!o.cancelled) onWav(o); });
      return true;
    } catch (e) { note('voice', (e && e.message) || String(e), 'bad'); return false; }
  };
  const enrollStart = async () => { await window.api.speakerEnrollReset(); note('voice', ''); setEnr({ i: 0, count: 0, phase: 'idle', level: 0 }); };
  const enrollRecord = async () => {
    if (!enr) return;
    if (enr.phase === 'rec') { rec.current && rec.current.stop(); return; }
    const ok = await startRec(9000, async (o) => {
      setEnr((e) => e && { ...e, phase: 'send', level: 0 });
      const r = await window.api.speakerEnrollAdd(o.wav);
      if (!r.ok) { note('voice', r.error, 'bad'); setEnr((e) => e && { ...e, phase: 'idle' }); return; }
      note('voice', '');
      setEnr((e) => e && { ...e, phase: 'idle', count: r.count, i: Math.min(e.i + 1, ENROLL_PHRASES.length - 1), more: e.i + 1 < ENROLL_PHRASES.length });
    });
    if (ok) setEnr((e) => e && { ...e, phase: 'rec' });
  };
  const enrollDone = async () => {
    const r = await window.api.speakerEnrollFinish();
    if (!r.ok) return note('voice', r.error, 'bad');
    setEnr(null);
    note('voice', r.weak ? 'Saved, but the sentences did not sound very alike (noise, or more than one voice). Re-enrol in a quiet room for better results.' : 'Your voice is saved.', r.weak ? 'warn' : 'ok');
    loadAll();
  };
  const enrollCancel = async () => { if (rec.current) rec.current.cancel(); rec.current = null; await window.api.speakerEnrollReset(); setEnr(null); };
  const testVoice = async () => {
    if (test && test.phase === 'rec') { rec.current && rec.current.stop(); return; }
    setTest({ phase: 'rec' });
    const ok = await startRec(6000, async (o) => {
      setTest({ phase: 'send' });
      const r = await window.api.speakerTest(o.wav);
      setTest({ phase: 'done', r });
    });
    if (!ok) setTest(null);
  };
  const removeVoice = (what) => withAuth(what === 'model' ? 'remove the voice model' : 'remove your voice', async (auth) => {
    const r = await window.api.speakerRemove(what, auth);
    if (!r.ok) return r;
    setSp(r.status); loadAll(); return r;
  });
  const confirmRemove = async (what) => {
    const ok = await askConfirm({ title: what === 'model' ? 'Remove the voice model?' : 'Remove your voice?', message: what === 'model' ? 'The model file (about 28 MB) is deleted. Voice recognition stops until you download it again. Your saved voice stays.' : 'Your saved voice is deleted. “Only respond to my voice” and voice unlock turn off.', confirmLabel: 'Remove', danger: true });
    if (ok) removeVoice(what);
  };
  const photoToggle = async (v) => {
    if (v) { try { await window.api.permRequest('camera'); } catch {} }
    toggle({ photoOnLockdown: v });
  };
  const sendTest = async () => {
    note('alert', 'Sending…');
    try { const r = await (window.api.lockTestAlert ? window.api.lockTestAlert() : Promise.resolve({ ok: false, error: 'Not available in this version.' })); note('alert', r.ok ? 'Test alert sent to Telegram.' : r.error || 'Could not send.', r.ok ? 'ok' : 'bad'); }
    catch (e) { note('alert', (e && e.message) || 'Could not send.', 'bad'); }
  };

  if (!st) return <Note>Loading…</Note>;
  const m = (k) => (msg[k] ? <Note tone={msg[k].tone}>{msg[k].text}</Note> : null);
  const modelReady = !!(sp && sp.model && sp.model.ready);
  const enrolled = !!(sp && sp.enrolled);
  const runtimeBad = sp && sp.runtime && !sp.runtime.ok;
  const lockOn = !!st.enabled;
  const tgPaired = !!(tg && tg.paired);
  const level = (enr && enr.level) || 0;

  return (
    <>
      <Note>Locks the Artemis window so nobody can use it while you are away. It is an app lock, not disk encryption: it does not protect files from someone with full access to your Mac account. Tasks you scheduled keep running while it is locked.</Note>

      {ask && (
        <Group title="Confirm it is you">
          <Row stacked label={`Enter your password to ${ask.label}`} error={msg.auth && msg.auth.tone === 'bad' ? msg.auth.text : ''}>
            <input type="password" className="pref-input wide" autoFocus autoComplete="off" value={askPw} onChange={(e) => setAskPw(e.target.value)} placeholder="Password" aria-label="Current password"
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirmAuth('password'); } else if (e.key === 'Escape') setAsk(null); }} />
          </Row>
          <Row>
            <div className="pref-inline">
              <button type="button" className="pref-btn primary" onClick={() => confirmAuth('password')} disabled={!askPw}>Confirm</button>
              {st.touchIdAvailable && <button type="button" className="pref-btn" onClick={() => confirmAuth('touchid')}>Use Touch ID</button>}
              <button type="button" className="pref-btn" onClick={() => { setAsk(null); note('auth', ''); }}>Cancel</button>
            </div>
          </Row>
        </Group>
      )}

      <Group title="App lock" footer={st.hasPassword ? 'The password is stored only as a salted scrypt hash. Nothing can read it back.' : 'Choose a password first. You will get a one-time recovery code: keep it somewhere safe, it is the only way back in if you forget the password.'}>
        {st.hasPassword && (
          <SwitchRow label="Lock Artemis with the password" description={lockOn ? (st.locked ? 'Locked right now.' : 'On.') : 'Off. Turning it off needs your password or Touch ID.'}
            checked={lockOn} onChange={(v) => (v ? toggle({ enabled: true }) : withAuth('turn the lock off', (auth) => apply({ enabled: false }, auth).then((r) => (r && !r.ok ? r : { ok: true }))))} />
        )}
        {st.hasPassword && lockOn && (
          <Row label="Lock now" description={<>Also: the shortcut set in Keyboard shortcuts, the menu bar icon, or say “Artemis, lock”.</>}>
            <button type="button" className="pref-btn" onClick={lockNow}>Lock now</button>
          </Row>
        )}
        <Row stacked label={st.hasPassword ? 'Change password' : 'Set a password'}>
          <div className="pref-inline wrap grow">
            <input type="password" className="pref-input" autoComplete="new-password" placeholder="New password" aria-label="New password" value={pw.a} onChange={(e) => setPw({ ...pw, a: e.target.value })} />
            <input type="password" className="pref-input" autoComplete="new-password" placeholder="Repeat it" aria-label="Repeat the new password" value={pw.b} onChange={(e) => setPw({ ...pw, b: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') savePassword(); }} />
            <button type="button" className="pref-btn primary" onClick={savePassword} disabled={!pw.a || !pw.b}>{st.hasPassword ? 'Change' : 'Set password'}</button>
          </div>
        </Row>
        {m('pw')}
        {code && (
          <Row stacked label="Your recovery code" description="Shown once. Write it down or store it in a password manager. It unlocks Artemis even during a lockdown.">
            <div className="pref-inline wrap">
              <code className="sec-code" aria-label="Recovery code">{code}</code>
              <button type="button" className="pref-btn" onClick={() => { try { navigator.clipboard.writeText(code); note('code', 'Copied.', 'ok'); } catch {} }}>Copy</button>
              <button type="button" className="pref-btn" onClick={() => { setCode(''); note('code', ''); }}>I saved it</button>
            </div>
          </Row>
        )}
        {m('code')}
        {st.hasPassword && (
          <Row label="Recovery code" description={st.hasRecovery ? 'One is saved. A new code replaces it.' : 'None yet.'}>
            <button type="button" className="pref-btn" onClick={newCode}>Make a new code</button>
          </Row>
        )}
        {m('lock')}
      </Group>

      {st.hasPassword && (
        <>
          <Group title="When to lock">
            <SwitchRow label="When Artemis starts" description="The lock screen appears every time the app opens." checked={!!cfg.lockOnStart} onChange={(v) => toggle({ lockOnStart: v })} />
            <Row label="After being idle" description="No keyboard, mouse or Sentinel use for this long. Idle time of the whole Mac counts too.">
              <Select value={cfg.idleMinutes || 0} onChange={(e) => toggle({ idleMinutes: Number(e.target.value) })} aria-label="Lock after idle time">
                {IDLE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </Row>
            <SwitchRow label="When the Mac sleeps or the screen locks" description="Locks as soon as the lid closes or you lock the screen." checked={!!cfg.lockOnSleep} onChange={(v) => toggle({ lockOnSleep: v })} />
          </Group>

          <Group title="Unlock with" footer="The password always works. Touch ID needs a Mac with a fingerprint reader.">
            <SwitchRow label="Touch ID" description={st.touchIdAvailable ? 'Touch the sensor instead of typing.' : 'Not available on this Mac.'} checked={!!cfg.touchIdUnlock && st.touchIdAvailable} disabled={!st.touchIdAvailable} onChange={(v) => toggle({ touchIdUnlock: v })} />
            <SwitchRow label="My voice (Sentinel)" description={enrolled && modelReady ? 'While locked, Sentinel keeps listening. Say the wake phrase, then speak: if it is your voice, Artemis unlocks. Any other voice hears “Unauthorized access.”' : 'Needs the voice model and your enrolled voice (below).'}
              checked={!!cfg.voiceUnlock && enrolled && modelReady} disabled={!(enrolled && modelReady)} onChange={(v) => toggle({ voiceUnlock: v })} />
          </Group>

          <Group title="Sensitive actions" footer="Asked when you approve the action in a chat. Not asked in chats set to approve everything, when you approve from the phone, or for scheduled tasks, which always run.">
            <SwitchRow label="Touch ID before sensitive actions" description={st.touchIdAvailable ? 'Instead of a password. If Touch ID fails to start, the password is asked.' : 'Touch ID is not available on this Mac, so the password is asked.'}
              checked={!!cfg.sensitiveTouchId} onChange={(v) => toggle({ sensitiveTouchId: v })} />
            {cfg.sensitiveTouchId && SENSITIVE.map(([k, label]) => (
              <SwitchRow key={k} label={label} checked={!!(cfg.sensitive && cfg.sensitive[k])} onChange={(v) => toggle({ sensitive: { [k]: v } })} />
            ))}
          </Group>
        </>
      )}

      <Group title="Voice recognition" footer={<>Runs on this Mac, nothing is sent anywhere and no recordings are kept. A recording or a cloned voice can fool it, which is why sensitive actions can ask for Touch ID. Model: WeSpeaker CAM++ (CC BY 4.0), run with sherpa-onnx tooling and ONNX Runtime.</>}>
        {runtimeBad && <Row label="Speech engine missing" description={sp.runtime.error} />}
        <Row label="Voice model" description={modelReady ? `Downloaded (${Math.round(sp.model.size / 1048576)} MB).` : dl ? `Downloading… ${dl.pct || 0}%${dl.detail ? ' · ' + dl.detail : ''}` : 'About 28 MB, downloaded once.'}>
          {modelReady
            ? <button type="button" className="pref-btn danger" onClick={() => confirmRemove('model')}>Remove</button>
            : <button type="button" className="pref-btn primary" onClick={download} disabled={!!dl || runtimeBad}>{dl ? 'Downloading…' : 'Download'}</button>}
        </Row>
        <Row label="Your voice" description={enrolled ? `Saved ${when(sp.enrolled.createdAt)} from ${sp.enrolled.n} sentences.` : 'Not saved yet. You read a few sentences aloud.'}>
          <div className="pref-inline">
            <button type="button" className="pref-btn primary" onClick={enrollStart} disabled={!modelReady || !!enr || runtimeBad}>{enrolled ? 'Record again' : 'Enrol my voice'}</button>
            {enrolled && <button type="button" className="pref-btn danger" onClick={() => confirmRemove('print')}>Remove</button>}
          </div>
        </Row>
        {enr && (
          <Row stacked label={`Sentence ${Math.min(enr.i + 1, ENROLL_PHRASES.length)} of ${ENROLL_PHRASES.length}: read it aloud`} description="In your normal voice, in a quiet room, close to the microphone. Record at least three.">
            <div className="sec-enroll">
              <p className="sec-phrase">“{ENROLL_PHRASES[enr.i]}”</p>
              <div className="sec-meter" aria-hidden="true"><span style={{ width: `${Math.round(level * 100)}%` }} /></div>
              <div className="pref-inline wrap">
                <button type="button" className="pref-btn primary" onClick={enrollRecord} disabled={enr.phase === 'send' || (enr.i >= ENROLL_PHRASES.length - 1 && enr.count >= ENROLL_PHRASES.length)}>
                  {enr.phase === 'rec' ? 'Stop' : enr.phase === 'send' ? 'Checking…' : 'Record'}
                </button>
                <span className="pref-badge">{enr.count} saved</span>
                <button type="button" className="pref-btn" onClick={enrollDone} disabled={enr.count < 3 || enr.phase !== 'idle'}>Done</button>
                <button type="button" className="pref-btn" onClick={enrollCancel}>Cancel</button>
              </div>
            </div>
          </Row>
        )}
        {m('voice')}
        {enrolled && modelReady && (
          <>
            <Row label="Test my voice" description={test && test.phase === 'done' ? (test.r.ok ? `Score ${test.r.score.toFixed(2)} (needs ${test.r.threshold.toFixed(2)}): ${test.r.match ? 'recognised as you.' : 'not recognised.'}` : test.r.error) : test && test.phase === 'rec' ? 'Listening… say a sentence, then press Stop.' : 'Say a sentence and see the score. Nothing is counted as a failed attempt.'}>
              <button type="button" className="pref-btn" onClick={testVoice} disabled={test && test.phase === 'send'}>{test && test.phase === 'rec' ? 'Stop' : 'Test'}</button>
            </Row>
            <SwitchRow label="Only respond to my voice" description="On: Sentinel ignores anyone else, push-to-talk too, and another voice hears “Unauthorized access.” Off: anyone can talk to it." checked={!!cfg.voiceOnly} onChange={(v) => toggle({ voiceOnly: v })} />
            <SwitchRow label="Let other voices chat only" description="On: another voice can talk to Artemis, but nothing is executed for it: no tools, no files, no memory, no commands, and it cannot see your chats. Nothing locks and no alert is raised. Off: another voice is refused as set below. (“Only respond to my voice” takes priority.)" checked={!!cfg.strangerChatOnly} onChange={(v) => toggle({ strangerChatOnly: v })} />
            {lockOn && <SwitchRow label="Lock Artemis when another voice speaks" description="On: the first voice that is not yours locks the app right away (after “Unauthorized access.”). Off: it is only refused, and repeated attempts lock it as set under Unauthorized access." checked={!!cfg.lockOnStranger} onChange={(v) => toggle({ lockOnStranger: v })} />}
            <Row label="Strictness" description={`Higher is stricter: fewer strangers get in, but you may be refused more often (${(cfg.voiceThreshold || 0.45).toFixed(2)}). Use Test my voice to find a good value.`}>
              <div className="pref-slider">
                <input type="range" min="0.25" max="0.7" step="0.01" value={cfg.voiceThreshold || 0.45} aria-label="Voice recognition strictness"
                  onChange={(e) => setSt((x) => ({ ...x, config: { ...x.config, voiceThreshold: Number(e.target.value) } }))}
                  onMouseUp={(e) => toggle({ voiceThreshold: Number(e.target.value) })} onKeyUp={(e) => toggle({ voiceThreshold: Number(e.target.value) })} onBlur={(e) => toggle({ voiceThreshold: Number(e.target.value) })} />
                <output className="pref-slider-val">{(cfg.voiceThreshold || 0.45).toFixed(2)}</output>
              </div>
            </Row>
          </>
        )}
      </Group>

      {st.hasPassword && (
        <Group title="Unauthorized access" footer="After repeated failures Artemis locks for 5 minutes, then 15, 60 and 240 if it keeps happening. During a lockdown voice, password and Touch ID are off; only the recovery code works.">
          <Row label="Failed voice attempts" description="Strangers' voices within the window below.">
            <Select value={cfg.maxVoiceFails || 3} onChange={(e) => toggle({ maxVoiceFails: Number(e.target.value) })} aria-label="Failed voice attempts before lockdown">
              {[2, 3, 4, 5, 8].map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
          </Row>
          <Row label="Failed password or Touch ID attempts">
            <Select value={cfg.maxPasswordFails || 5} onChange={(e) => toggle({ maxPasswordFails: Number(e.target.value) })} aria-label="Failed password attempts before lockdown">
              {[3, 4, 5, 8, 10].map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
          </Row>
          <Row label="Counted within">
            <Select value={cfg.failWindowMin || 5} onChange={(e) => toggle({ failWindowMin: Number(e.target.value) })} aria-label="Window for counting failed attempts">
              {[1, 5, 10, 30, 60].map((n) => <option key={n} value={n}>{n} min</option>)}
            </Select>
          </Row>
          <SwitchRow label="Tell me on Telegram" description={tgPaired ? 'A message goes to your paired Telegram when a lockdown starts. If the Mac is offline, it is sent when it is back.' : 'Needs the Telegram bot paired (Phone section). Until then nothing is sent.'}
            checked={!!cfg.alertTelegram} onChange={(v) => toggle({ alertTelegram: v })} />
          {cfg.alertTelegram && (
            <SwitchRow label="Send a photo from the camera" description="One webcam picture goes with the alert. It is not saved on this Mac. Needs camera access." checked={!!cfg.photoOnLockdown} onChange={photoToggle} />
          )}
          {cfg.alertTelegram && (
            <Row label="Send a test alert" description="Checks that Telegram reaches you.">
              <button type="button" className="pref-btn" onClick={sendTest} disabled={!tgPaired}>Send test</button>
            </Row>
          )}
          {m('alert')}
          <SwitchRow label="Pause the phone while locked" description="Off: you can keep chatting with Artemis from Telegram while the computer is locked. On: it does not answer from the phone until you unlock it here." checked={!!cfg.pausePhone} onChange={(v) => toggle({ pausePhone: v })} />
        </Group>
      )}
    </>
  );
}
