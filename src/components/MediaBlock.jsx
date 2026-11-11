import React from 'react';
import { Icon } from './Icons.jsx';
import { openLightbox } from '../lib/viewer-bus.js';

const api = window.api;
const urlOf = (p) => `artemis-file://f/${encodeURIComponent(p)}`;

/** A generated image or video in an answer. Served from disk (artemis-file://), never as base64 through IPC. */
export default function MediaBlock({ item }) {
  const [failed, setFailed] = React.useState(false);
  const src = urlOf(item.path);
  const name = String(item.path || '').split(/[\\/]/).pop();
  return (
    <figure className="media">
      {failed ? <div className="notice">The generated file is no longer on this computer.</div>
        : item.kind === 'video' ? <video src={src} controls loop playsInline onError={() => setFailed(true)} />
        : <img src={src} alt={item.prompt || 'generated image'} loading="lazy" onError={() => setFailed(true)}
            onClick={() => openLightbox([{ src, name, path: item.path, caption: item.prompt }], 0)} />}
      <figcaption>
        <span>{item.model}</span>
        {!failed && <>
          <button onClick={() => api.saveFileAs(item.path)}><Icon name="download" size={14} /> Save as…</button>
          <button onClick={() => api.revealPath(item.path)}><Icon name="folderOpen" size={14} /> Show in folder</button>
        </>}
      </figcaption>
    </figure>
  );
}
