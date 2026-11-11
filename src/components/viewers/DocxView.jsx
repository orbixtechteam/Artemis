import React, { useEffect, useState } from 'react';
import { Icon } from '../Icons.jsx';

const api = window.api;

/** A Word document as a readable page (headings, lists, tables, images), in the same type as Artemis Docs. */
export default function DocxView({ path }) {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    let off = false;
    setState({ loading: true });
    api.docxHtml(path).then((r) => { if (!off) setState(r && r.ok ? { html: r.html } : { error: (r && r.error) || 'Could not open this document.' }); })
      .catch((e) => { if (!off) setState({ error: e.message }); });
    return () => { off = true; };
  }, [path]);
  if (state.loading) return <div className="pdfv-msg"><Icon name="spinner" size={16} className="spin" /> Opening document…</div>;
  if (state.error) return <div className="pdfv-msg">{state.error}</div>;
  const onClick = (e) => { // links in the document open in the browser, never inside the app window
    const a = e.target.closest && e.target.closest('a[href]'); if (!a) return;
    e.preventDefault();
    const href = a.getAttribute('href') || '';
    if (/^https?:/i.test(href) && api.openExternalUrl) api.openExternalUrl(href);
  };
  return <article className="docpage" onClick={onClick} dangerouslySetInnerHTML={{ __html: state.html }} />;
}
