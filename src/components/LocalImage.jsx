import React, { useEffect, useState } from 'react';
import { localMediaUrl, isWebLink } from '../lib/file-links.js';
import { openLightbox } from '../lib/viewer-bus.js';

/** An image in an answer: web and data images as they are, local paths through artemis-file://. Click to open the lightbox. */
export default function LocalImage({ src, alt, title }) {
  const raw = String(src || '');
  const direct = isWebLink(raw) || /^(data:image\/|blob:|artemis-media:|artemis-file:)/i.test(raw);
  const [res, setRes] = useState(direct ? { url: raw, path: '' } : undefined);
  useEffect(() => {
    if (direct) { setRes({ url: raw, path: '' }); return; }
    let off = false;
    localMediaUrl(raw).then((r) => { if (!off) setRes(r); });
    return () => { off = true; };
  }, [raw]);
  if (res === undefined) return <span className="md-img loading" aria-label={alt || 'Loading image'} />;
  if (!res) return <span className="md-img missing" title={raw}>{alt || 'Image'} (not found)</span>;
  const name = alt || (res.path || raw).split(/[\\/]/).pop();
  return (
    <img className="md-img" src={res.url} alt={alt || ''} title={title || name} loading="lazy"
      onClick={() => openLightbox([{ src: res.url, name, path: res.path }], 0)} />
  );
}
