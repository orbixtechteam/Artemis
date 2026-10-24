import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { Icon } from './Icons.jsx';

const api = window.api;
const FALLBACK = {
  background: '#1b1b1a', foreground: '#e8e6df', cursor: '#e8e6df', selectionBackground: 'rgba(120,160,255,.35)',
  black: '#2b2b29', red: '#e06c75', green: '#98c379', yellow: '#e5c07b', blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#dcdcd4',
  brightBlack: '#6b6a64', brightRed: '#ef8b93', brightGreen: '#b1d995', brightYellow: '#f0d08f', brightBlue: '#82c0f5', brightMagenta: '#d89be8', brightCyan: '#7ccbd5', brightWhite: '#ffffff'
};

/** Terminal palette taken from the active theme's CSS variables, so it follows theme changes. */
function themeFromCss() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n, fb) => (cs.getPropertyValue(n) || '').trim() || fb;
  const bg = v('--code', v('--bg', FALLBACK.background)); // the same surface as the terminal's frame
  const text = v('--text', FALLBACK.foreground);
  const accent = v('--accent', FALLBACK.blue);
  const border = v('--border', FALLBACK.black);
  const muted = v('--muted', FALLBACK.brightBlack);
  return {
    ...FALLBACK,
    background: bg,
    foreground: text,
    cursor: text,
    cursorAccent: bg,
    selectionBackground: accent + '55',
    black: border, brightBlack: muted,
    white: text, brightWhite: text,
    blue: accent, brightBlue: accent,
    red: v('--danger', FALLBACK.red), brightRed: v('--danger', FALLBACK.brightRed),
    green: v('--ok', FALLBACK.green), brightGreen: v('--ok', FALLBACK.brightGreen),
    yellow: v('--warn', FALLBACK.yellow), brightYellow: v('--warn', FALLBACK.brightYellow),
  };
}

/** One xterm bound to one PTY session. If `id` is null a new session is opened and reported via onId. */
export function TerminalView({ id, cwd, active = true, onId, onExit }) {
  const host = useRef(null);
  const term = useRef(null);
  const fit = useRef(null);
  const sid = useRef(id || null);
  const [exited, setExited] = useState(null);

  // Follow theme changes (data-theme / custom theme vars on <html>).
  useEffect(() => {
    const apply = () => { try { if (term.current) term.current.options.theme = themeFromCss(); } catch {} };
    const obs = new MutationObserver(apply);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-vars', 'data-accent', 'style'] });
    return () => obs.disconnect();
  }, []);

  const doFit = useCallback(() => {
    const el = host.current; if (!el || !term.current || !fit.current || el.clientWidth < 20 || el.clientHeight < 20) return;
    try { fit.current.fit(); if (sid.current) api.termResize(sid.current, term.current.cols, term.current.rows); } catch {}
  }, []);

  useEffect(() => {
    const t = new XTerm({ fontFamily: '"SF Mono", ui-monospace, Menlo, Monaco, Consolas, monospace', fontSize: 12.5, lineHeight: 1.25, cursorBlink: true, scrollback: 5000, allowProposedApi: true, macOptionIsMeta: true, theme: themeFromCss() });
    const f = new FitAddon();
    t.loadAddon(f);
    t.loadAddon(new WebLinksAddon((_e, url) => api.openExternalUrl ? api.openExternalUrl(url) : window.open(url)));
    t.open(host.current);
    term.current = t; fit.current = f;
    try { f.fit(); } catch {}

    let dead = false;
    const offs = [];
    const buffer = [];
    let ready = false;
    offs.push(api.onTermData((m) => {
      if (!m || m.id !== sid.current) { if (m && !sid.current) buffer.push(m); return; }
      t.write(m.data);
    }));
    offs.push(api.onTermExit((m) => {
      if (m && m.id === sid.current) { setExited(m.code ?? 0); t.write(`\r\n\x1b[2m[process exited${m.code != null ? ` with code ${m.code}` : ''}]\x1b[0m\r\n`); onExit && onExit(sid.current, m.code); }
    }));
    t.onData((d) => { if (sid.current && !exited) api.termInput(sid.current, d); });

    (async () => {
      try {
        if (sid.current) {
          const snap = await api.termSnapshot(sid.current);
          if (dead) return;
          if (snap && snap.ok === false) { t.write('\x1b[31mSession no longer exists.\x1b[0m\r\n'); setExited(-1); return; }
          const text = typeof snap === 'string' ? snap : snap?.data || '';
          if (text) t.write(text);
          api.termResize(sid.current, t.cols, t.rows);
        } else {
          const r = await api.termOpen({ cols: t.cols, rows: t.rows, cwd });
          if (dead) { if (r?.id) api.termClose(r.id); return; }
          if (!r || r.error || !r.id) { t.write(`\x1b[31m${(r && r.error) || 'Could not start the terminal (python3 is required).'}\x1b[0m\r\n`); setExited(-1); return; }
          sid.current = r.id; onId && onId(r.id);
        }
        ready = true;
        for (const m of buffer) if (m.id === sid.current) t.write(m.data);
      } catch (e) { t.write(`\x1b[31m${e.message}\x1b[0m\r\n`); }
    })();

    const ro = new ResizeObserver(() => doFit());
    ro.observe(host.current);
    // keep the xterm palette in sync when the user switches theme
    const themeObs = new MutationObserver(() => { try { t.options.theme = themeFromCss(); } catch {} });
    themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-vars', 'style', 'class'] });
    return () => { dead = true; ro.disconnect(); themeObs.disconnect(); offs.forEach((o) => o && o()); t.dispose(); term.current = null; };
    // eslint-disable-next-line
  }, []);

  useEffect(() => { if (active) { setTimeout(() => { doFit(); term.current && term.current.focus(); }, 30); } }, [active, doFit]);

  return <div className="term-host" ref={host} onClick={() => term.current && term.current.focus()} />;
}

/** Docked terminal panel at the bottom of the main area. tabs: [{key, id|null, title}] */
export function TerminalDock({ tabs, activeKey, cwd, height, onHeight, onSelect, onNew, onClose, onId, onExit, onPopOut, onHide, full = false }) {
  const drag = useRef(null);
  const startDrag = (e) => {
    drag.current = { y: e.clientY, h: height };
    const mv = (ev) => { const d = drag.current; if (d) onHeight(Math.max(120, Math.min(window.innerHeight - 160, d.h + (d.y - ev.clientY)))); };
    const up = () => { drag.current = null; window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
  };
  return (
    <div className="term-dock" style={full ? undefined : { height }}>
      {!full && <div className="term-resize" onMouseDown={startDrag} />}
      <div className="term-bar">
        <div className="term-tabs">
          {tabs.map((t, i) => (
            <div key={t.key} className={'term-tab' + (t.key === activeKey ? ' on' : '')} onClick={() => onSelect(t.key)}>
              <Icon name="terminal" size={13} /> <span>{t.title || `Terminal ${i + 1}`}</span>
              <button className="term-x" title="Close" aria-label="Close" onClick={(e) => { e.stopPropagation(); onClose(t.key); }}>×</button>
            </div>
          ))}
          <button className="term-btn" title="New terminal" aria-label="New terminal" onClick={onNew}>+</button>
        </div>
        <div className="term-actions">
          <button className="term-btn" title="Open in a window" aria-label="Open in a window" onClick={() => onPopOut(activeKey, false)}><Icon name="external" size={14} /></button>
          <button className="term-btn" title="Open as floating window (always on top)" aria-label="Open as floating window (always on top)" onClick={() => onPopOut(activeKey, true)}><Icon name="pin" size={14} /></button>
          {!full && <button className="term-btn" title="Hide panel (sessions keep running)" aria-label="Hide panel (sessions keep running)" onClick={onHide}>⌄</button>}
        </div>
      </div>
      <div className="term-body">
        {tabs.map((t) => (
          <div key={t.key} className="term-pane" style={{ display: t.key === activeKey ? 'block' : 'none' }}>
            <TerminalView id={t.id} cwd={cwd} active={t.key === activeKey} onId={(id) => onId(t.key, id)} onExit={(id) => onExit && onExit(t.key, id)} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Content of a standalone terminal window (#terminal=<id>). */
export function TerminalWindow({ id }) {
  const [float, setFloat] = useState(false);
  const mac = /Mac/i.test(navigator.platform);
  const toggle = async () => { const r = await api.termFloat(!float); setFloat(!!r); };
  useEffect(() => { document.title = 'Terminal'; }, []);
  return (
    <div className="term-win">
      <div className={'term-win-bar' + (mac ? ' pad-mac' : '')}>
        <span className="term-win-title"><Icon name="terminal" size={14} /> Terminal</span>
        <div className="term-actions nodrag">
          <button className={'term-btn' + (float ? ' on' : '')} title={float ? 'Floating: always on top (click to turn off)' : 'Keep on top of other windows'} aria-label={float ? 'Floating: always on top (click to turn off)' : 'Keep on top of other windows'} onClick={toggle}><Icon name="pin" size={14} /> {float ? 'Floating' : 'Float'}</button>
          <button className="term-btn" title="Move back into the app" onClick={() => api.termDock(id)}>Dock back</button>
        </div>
      </div>
      <div className="term-win-body"><TerminalView id={id} active /></div>
    </div>
  );
}
