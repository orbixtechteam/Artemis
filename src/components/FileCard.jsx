import React from 'react';
import { Icon } from './Icons.jsx';
import { fileType, typeLabel, fmtSize } from '../lib/file-types.js';
import { openFileLink, rememberFile } from '../lib/file-links.js';

const api = window.api;

/**
 * A file the assistant handed over (present_files, or a deliverable it wrote): name and "Table · CSV" under a tinted
 * type icon. Click opens it in the side viewer; hover shows Save as and Show in folder; drag it out to Finder or another app.
 */
export function FileCard({ file, active = false }) {
  if (file.kind === 'plugin') return <PluginCard plugin={file} />;
  const t = fileType(file.name);
  const open = () => openFileLink(file.path);
  const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
  return (
    <div className={`file-card${active ? ' active' : ''}`} role="button" tabIndex={0} title={file.path}
      onClick={open} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
      draggable onDragStart={(e) => { e.preventDefault(); api.dragOut && api.dragOut(file.path); }}>
      <span className={`fc-icon tint-${t.tint}`}><Icon name={t.icon} size={18} /></span>
      <span className="fc-text">
        <span className="fc-name">{file.name}</span>
        <span className="fc-sub">{typeLabel(file.name)}{file.size >= 0 ? <span className="fc-size"> · {fmtSize(file.size)}</span> : null}</span>
      </span>
      <span className="fc-actions">
        <button type="button" className="fc-btn" title="Save as…" aria-label={`Save ${file.name} as`} onClick={stop(() => api.saveFileAs(file.path))}><Icon name="download" size={15} /></button>
        <button type="button" className="fc-btn" title="Show in folder" aria-label={`Show ${file.name} in folder`} onClick={stop(() => api.revealPath(file.path))}><Icon name="folderOpen" size={15} /></button>
      </span>
    </div>
  );
}

/** A plugin Artemis built: opens as its own app window. */
function PluginCard({ plugin: p }) {
  const open = () => api.openPlugin(p.slug);
  const sub = [p.panels ? 'App' : null, p.tools ? `${p.tools} tool${p.tools === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ');
  return (
    <div className="file-card plugin-card" role="button" tabIndex={0} title={p.description || p.name} onClick={open} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}>
      <span className="fc-icon tint-violet"><Icon name="plug" size={18} /></span>
      <span className="fc-text">
        <span className="fc-name">{p.name}</span>
        <span className="fc-sub">Plugin{sub ? ' · ' + sub : ''}</span>
      </span>
      <button type="button" className="pc-open" onClick={(e) => { e.stopPropagation(); open(); }}>Open</button>
    </div>
  );
}

/** The cards of one answer step. */
export default function FileCards({ files }) {
  if (!files || !files.length) return null;
  for (const f of files) if (f.kind !== 'plugin') rememberFile(f.path);
  return <div className="file-cards">{files.map((f) => <FileCard key={f.path} file={f} />)}</div>;
}
