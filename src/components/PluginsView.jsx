import React, { useEffect, useState } from 'react';
import { Icon } from './Icons.jsx';
import { askConfirm } from '../lib/dialog.js';

const api = window.api;

/**
 * The Plugins tab of the Artifacts page: apps Artemis wrote for itself. Each opens in its own window and runs on its own
 * (its panel, or a form per tool); the switch decides whether chats can use its tools.
 */
export default function PluginsView({ q = '', compact = false }) {
  const [list, setList] = useState(null);
  const load = () => api.pluginsList().then((l) => setList(l || [])).catch(() => setList([]));
  useEffect(() => { load(); const off = api.onPluginsChanged && api.onPluginsChanged(load); return () => off && off(); }, []);
  const ask = () => window.dispatchEvent(new CustomEvent('artemis:start-chat', { detail: { text: 'Build me an Artemis plugin that ' } }));
  const remove = (p) => askConfirm({ title: 'Remove plugin', message: `Remove the plugin "${p.name}" and its files?`, confirmLabel: 'Remove', danger: true }).then((ok) => ok && api.pluginsRemove(p.slug).then(load));
  if (!list) return null;
  const needle = q.trim().toLowerCase();
  const shown = list.filter((p) => !needle || `${p.name} ${p.description}`.toLowerCase().includes(needle));
  if (!list.length && compact) return null;
  if (!list.length) {
    return (
      <div className="empty-card plug-empty">
        <Icon name="plug" size={28} />
        <p>No plugins yet. Ask Artemis for a tool or a small app it does not have; it builds it, and it opens here in its own window.</p>
        <button className="primary-btn" onClick={ask}><Icon name="plus" size={15} /> Build a plugin</button>
      </div>
    );
  }
  return (
    <>
      {!compact && <div className="plug-actions">
        <button onClick={() => api.pluginsReveal()}>Open folder</button>
        <button className="primary-btn" onClick={ask}><Icon name="plus" size={15} /> Build a plugin</button>
      </div>}
      {shown.length === 0 ? (compact ? null : <div className="muted art-empty">No match.</div>) : (
        <div className="plug-grid">
          {shown.map((p) => (
            <div key={p.slug} className={`plug-card ${p.enabled && p.ok ? '' : 'off'}`}>
              <button type="button" className="plug-face" disabled={!p.ok} onClick={() => api.openPlugin(p.slug)} title={p.ok ? `Open ${p.name}` : p.error}>
                <span className="plug-tile"><Icon name="plug" size={22} /></span>
                <span className="plug-name">{p.name}{!p.ok && <span className="sched-badge err">broken</span>}</span>
                <span className="plug-desc">{p.ok ? (p.description || 'A plugin') : p.error}</span>
                <span className="plug-sub">{[p.panels.length ? 'App' : 'Tools', p.tools.length ? `${p.tools.length} tool${p.tools.length === 1 ? '' : 's'}` : '', p.version ? 'v' + p.version : ''].filter(Boolean).join(' · ')}</span>
              </button>
              <div className="plug-foot">
                <button type="button" className="plug-open" disabled={!p.ok} onClick={() => api.openPlugin(p.slug)}>Open</button>
                <span className="plug-grow" />
                <label className="switch" title={p.enabled ? 'Chats can use its tools (click to turn off)' : 'Off in chats (click to turn on)'}><input type="checkbox" checked={p.enabled && p.ok} disabled={!p.ok} onChange={(e) => api.pluginsToggle(p.slug, e.target.checked).then(load)} /><i /></label>
                <button className="icon-btn" title="Remove" aria-label={`Remove ${p.name}`} onClick={() => remove(p)}><Icon name="trash" size={15} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
