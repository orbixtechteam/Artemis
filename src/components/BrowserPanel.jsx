import React, { useEffect, useRef, useState } from 'react';
import { Icon } from './Icons.jsx';

const api = window.api;

/** Turns what the user typed into a URL (adds https://, or searches when it is not a link). */
export function toUrl(raw) {
  const t = String(raw || '').trim();
  if (!t) return '';
  if (/^https?:\/\//i.test(t)) return t;
  if (/^localhost(:\d+)?(\/.*)?$/.test(t)) return 'http://' + t;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(t)) return 'https://' + t;
  return 'https://www.google.com/search?q=' + encodeURIComponent(t);
}

const shownUrl = (u) => (!u || u === 'about:blank' ? '' : u);
const Lock = () => (
  <svg className="bp-lock" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

/**
 * The integrated browser: tab strip, toolbar and an empty box the native page view is laid over.
 * Tabs live in the main process (electron/browser.js); this only shows their state. agent: the run currently driving it.
 */
export default function BrowserPanel({ url, onUrl, onClose, full = false, agent = null, onStopAgent }) {
  const body = useRef(null);
  const input = useRef(null);
  const [st, setSt] = useState({ tabs: [], activeId: null });
  const [text, setText] = useState(shownUrl(url));
  const [editing, setEditing] = useState(false);
  const tab = st.tabs.find((t) => t.id === st.activeId) || null;
  const cur = tab ? tab.url : url;
  useEffect(() => { if (!editing) setText(shownUrl(cur)); }, [cur, editing]);

  // The native web view is laid over this empty box. Its position can change without its size changing (sidebar, tabs, split view),
  // so the box is measured every frame and the bounds are sent whenever they differ from the last ones sent.
  useEffect(() => {
    let raf = 0; let last = '';
    const tick = () => {
      const el = body.current;
      if (el) {
        const r = el.getBoundingClientRect();
        const b = { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
        const key = b.x + ',' + b.y + ',' + b.width + ',' + b.height;
        if (key !== last) { last = key; api.browserBounds(b); }
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    const offUrl = api.onBrowserUrl((u) => { onUrl && onUrl(u); });
    const offState = api.onBrowserState ? api.onBrowserState((s) => s && setSt(s)) : null;
    api.browserTabs && api.browserTabs().then((s) => s && setSt(s)).catch(() => {});
    return () => { cancelAnimationFrame(raf); offUrl?.(); offState?.(); };
  }, []);

  const go = () => {
    const u = toUrl(text); if (!u) return;
    setEditing(false); input.current && input.current.blur();
    onUrl && onUrl(u);
    if (!st.tabs.length) api.browserTabNew(u).then(setSt).catch(() => {}); else api.browserNavigate(u);
  };
  const newTab = () => { api.browserTabNew('').then((s) => { s && setSt(s); setTimeout(() => input.current && input.current.focus(), 50); }).catch(() => {}); };
  const secure = /^https:\/\//i.test(cur || '');
  const loading = !!(tab && tab.loading);

  return (
    <aside className={`browser-panel ${full ? 'full' : ''}`}>
      <div className="bp-tabs" role="tablist">
        {st.tabs.map((t) => (
          <div key={t.id} role="tab" aria-selected={t.id === st.activeId} className={`bp-tab ${t.id === st.activeId ? 'on' : ''}`} title={(t.title || '') + (t.url ? '\n' + t.url : '')}
            onClick={() => api.browserTabSelect(t.id).then(setSt).catch(() => {})}
            onAuxClick={(e) => { if (e.button === 1) api.browserTabClose(t.id).then(setSt).catch(() => {}); }}>
            {t.loading ? <Icon name="spinner" size={13} className="spin bp-fav" /> : t.favicon ? <img className="bp-fav" src={t.favicon} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} /> : <Icon name="globe" size={13} className="bp-fav" />}
            <span className="bp-tab-title">{t.title || shownUrl(t.url) || 'New tab'}</span>
            <button className="bp-tab-x" title="Close tab" aria-label="Close tab" onClick={(e) => { e.stopPropagation(); api.browserTabClose(t.id).then(setSt).catch(() => {}); }}><Icon name="x" size={12} /></button>
          </div>
        ))}
        <button className="icon-btn bp-newtab" title="New tab" aria-label="New tab" onClick={newTab}><Icon name="plus" size={15} /></button>
        <div className="bp-tabs-fill" />
        <button className="icon-btn" title="Close browser" aria-label="Close browser" onClick={onClose}><Icon name="x" size={16} /></button>
      </div>
      <div className="bp-bar">
        <button className="icon-btn" title="Back" disabled={tab && !tab.canBack} onClick={() => api.browserNav('back')}><Icon name="arrowRight" size={16} style={{ transform: 'scaleX(-1)' }} /></button>
        <button className="icon-btn" title="Forward" disabled={tab && !tab.canForward} onClick={() => api.browserNav('forward')}><Icon name="arrowRight" size={16} /></button>
        {loading
          ? <button className="icon-btn" title="Stop loading" onClick={() => api.browserNav('stop')}><Icon name="x" size={15} /></button>
          : <button className="icon-btn" title="Reload" onClick={() => api.browserNav('reload')}><Icon name="refresh" size={15} /></button>}
        <div className={`bp-urlbox ${loading ? 'loading' : ''}`}>
          {secure && !editing ? <Lock /> : <Icon name="globe" size={13} className="bp-lock" />}
          <input ref={input} className="bp-url" value={text} spellCheck={false} placeholder="Search or enter address"
            onChange={(e) => setText(e.target.value)} onFocus={(e) => { setEditing(true); e.target.select(); }} onBlur={() => setEditing(false)}
            onKeyDown={(e) => { if (e.key === 'Enter') go(); else if (e.key === 'Escape') { setText(shownUrl(cur)); e.currentTarget.blur(); } }} />
          {loading && <span className="bp-progress" />}
        </div>
        <button className="icon-btn" title="Open in your browser" disabled={!/^https?:/i.test(cur || '')} onClick={() => api.openExternalUrl(cur)}><Icon name="external" size={15} /></button>
      </div>
      {tab && tab.error && <div className="bp-error">{tab.error}</div>}
      {agent && (
        <div className="bp-agent" role="status">
          <span className="bp-agent-dot" />
          <span className="bp-agent-text">{agent.who || 'Artemis'}{agent.team ? <span className="muted"> ({agent.team})</span> : null} is using the browser{agent.tool ? <span className="muted"> · {agent.tool.replace(/^browser_/, '').replace(/_/g, ' ')}</span> : null}</span>
          {!agent.team && <button className="bp-agent-stop" onClick={onStopAgent}><Icon name="stop" size={12} /> Stop</button>}
        </div>
      )}
      <div className="bp-body" ref={body}>
        {!st.tabs.length && <div className="bp-empty muted">Type an address or a search above.</div>}
      </div>
    </aside>
  );
}
