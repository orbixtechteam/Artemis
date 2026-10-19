import React, { useEffect, useRef } from 'react';
import { Icon } from './Icons.jsx';
import { useSentinelKey } from '../lib/sentinelKey.js';

const TEXT = {
  idle: 'Say “Wake up”',
  listening: 'Listening…',
  thinking: 'Thinking…',
  speaking: 'Speaking…'
};

/** Floating status for Sentinel mode: what it is doing right now, plus a stop button. */
export default function SentinelPill({ state, info, err, heard, said, onStop, onSkip, onDismiss, onSettings, onLogs, floating = false, external = false, expanded = false, onToggle, muted = false, onMute, noTalk = false, canExpand = false }) {
  const sKey = useSentinelKey();
  const bar = useRef(null);
  useEffect(() => {
    const h = (e) => { if (bar.current) bar.current.style.transform = `scaleY(${0.25 + Math.min(1, e.detail || 0) * 0.75})`; };
    window.addEventListener('sentinel-level', h);
    return () => window.removeEventListener('sentinel-level', h);
  }, []);
  const talk = useRef(null);
  useEffect(() => { if (expanded && talk.current) talk.current.scrollTop = talk.current.scrollHeight; }, [expanded, said, heard]);
  if (external || (state === 'off' && !err)) return null;
  return (
    <div className={`sentinel ${state}${floating ? ' sw' : ''}${expanded ? ' big' : ''}`} role="status">
      {state !== 'off' && (
        <div className="sn-main">
          <span className="sn-orb" title={floating ? 'Drag to move' : ''}><i ref={bar} /></span>
          <span className="sn-text">
            <b>Artemis · Sentinel</b>
            {state === 'loading'
              ? <span>{info && info.step ? `${info.step}/${info.of} · ` : ''}{(info && info.text) || 'Starting…'}{info && typeof info.progress === 'number' ? ` ${info.progress}%` : ''}{info && info.sec ? ` ${info.sec}s` : ''}</span>
              : <span>{muted ? 'Mic muted · click the mic to listen' : state === 'listening' && info && info.tap ? `Listening… press ${info.tap} again to send` : state === 'listening' && info && info.session ? 'Listening · say “bye bye” to end' : state === 'idle' && info && info.pttOnly ? 'Press push-to-talk to speak' : (state === 'idle' ? `Say “${window.__wakeWord || 'Wake up'}”` : (TEXT[state] || ''))}</span>}
          </span>
          {state === 'loading' && onLogs && <button className="sn-btn" title="See what is happening in the Logs" aria-label="See what is happening in the Logs" onClick={onLogs}><Icon name="terminal" size={12} /></button>}
          {(state === 'speaking' || state === 'thinking' || state === 'listening') && <button className="sn-btn" title="Stop and wait for the wake phrase again" aria-label="Stop and wait for the wake phrase again" onClick={onSkip}><Icon name="stop" size={11} /></button>}
          {floating && onMute && state !== 'loading' && <button className={`sn-btn mic${muted ? ' muted' : ''}`} title={muted ? 'Turn the microphone back on' : 'Mute the microphone'} aria-label={muted ? 'Turn the microphone back on' : 'Mute the microphone'} aria-pressed={muted} onClick={onMute}><Icon name="mic" size={12} /></button>}
          {floating && onToggle && (heard || said || canExpand) && <button className="sn-btn" title={expanded ? 'Smaller' : 'Bigger: read the full messages'} aria-label={expanded ? 'Smaller' : 'Bigger: read the full messages'} onClick={onToggle}><Icon name={expanded ? 'compact' : 'expand'} size={12} /></button>}
          <button className="sn-btn off" title={`Turn Sentinel off${sKey}`} aria-label={`Turn Sentinel off${sKey}`} onClick={onStop}><Icon name="x" size={12} /></button>
        </div>
      )}
      {!noTalk && state !== 'off' && state !== 'loading' && (heard || said) && (
        <div className="sn-talk" ref={talk}>
          {heard && <p className="you" title={heard}><b>You</b><span>{heard}</span></p>}
          {said ? <p className="artemis" title={said}><b>Artemis</b><span>{said}</span></p> : (heard && state === 'thinking' ? <p className="artemis dim"><b>Artemis</b><span>…</span></p> : null)}
        </div>
      )}
      {err && (
        <div className="sn-err">
          <span>{err}</span>
          {/speech-to-text|Providers|Settings → Voice/i.test(err) && <button onClick={onSettings}>Voice settings</button>}
          {onLogs && <button onClick={onLogs}>Logs</button>}
          <button onClick={onDismiss}>Dismiss</button>
        </div>
      )}
    </div>
  );
}
