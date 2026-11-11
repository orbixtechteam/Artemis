import React, { memo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { splitThink } from '../lib/think.mjs';
import { stripTags } from '../lib/tts-emotion.mjs';
import { codeOnly } from '../lib/clip.mjs';
import { isWebLink, isAnchor, openFileLink } from '../lib/file-links.js';
import LocalImage from './LocalImage.jsx';

/**
 * Links: http(s) open in the in-app browser (⌘/Ctrl-click: system browser); file paths, ~/ paths and file:// links
 * open in the side viewer (⌘/Ctrl-click: show in Finder). Anchors and other schemes are left to the browser.
 */
function Link({ href, children }) {
  const url = String(href || '');
  const file = isFileLink(url);
  const onClick = (e) => {
    if (isWebLink(url) && /^https?:/i.test(url)) {
      e.preventDefault();
      if ((e.metaKey || e.ctrlKey) && window.api && window.api.openExternalUrl) { e.stopPropagation(); window.api.openExternalUrl(url); return; }
      window.dispatchEvent(new CustomEvent('aid-browser-open', { detail: url }));
      return;
    }
    if (!file) return;
    e.preventDefault(); e.stopPropagation();
    openFileLink(url, { reveal: e.metaKey || e.ctrlKey });
  };
  return <a href={url} title={file ? `${url} — click to open, ⌘-click to show in Finder` : url} className={file ? 'file-link' : undefined} onClick={onClick}>{children}</a>;
}

export function CodeBlock({ children }) {
  const ref = useRef(null);
  const [copied, setCopied] = useState(false);
  const child = React.Children.toArray(children)[0];
  const cls = child?.props?.className || '';
  const lang = (cls.match(/language-([\w-]+)/) || [])[1] || 'code';
  const copy = () => {
    navigator.clipboard.writeText(codeOnly(ref.current?.innerText || ''));
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <div className="codeblock">
      <div className="code-head"><span>{lang}</span><button onClick={copy}>{copied ? 'Copied' : 'Copy'}</button></div>
      <pre ref={ref}>{children}</pre>
    </div>
  );
}

const components = {
  pre: CodeBlock,
  a: Link,
  img: ({ src, alt, title }) => <LocalImage src={src} alt={alt} title={title} />,
  table: ({ children }) => <div className="table-wrap"><table>{children}</table></div>
};

// module constants: new arrays on every render would make react-markdown rebuild its processor each time
const REMARK_PLUGINS = [remarkGfm];
// react-markdown drops unknown schemes by default; keep file:// and local paths, never javascript:/vbscript:
const urlTransform = (u) => (/^\s*(javascript|vbscript):/i.test(String(u || '')) ? '' : u);
/** A link to a local file: file://, an absolute / ~/ / relative path, or a Windows drive path. */
const isFileLink = (u) => !!u && !isWebLink(u) && !isAnchor(u) && (/^file:/i.test(u) || /^[a-z]:[\\/]/i.test(u) || !/^[a-z][a-z0-9+.-]*:/i.test(u));
const REHYPE_PLUGINS = [[rehypeHighlight, { detect: false, ignoreMissing: true }]];

function Body({ text, caret }) {
  return (
    <div className={`md ${caret ? 'streaming' : ''}`}>
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={components} urlTransform={urlTransform}>
        {stripTags(text, { partial: !!caret })}
      </ReactMarkdown>
    </div>
  );
}

/** A model's <think> block: collapsed, opens on click. */
function Think({ text, done, streaming }) {
  const live = streaming && !done;
  return (
    <details className={`think ${live ? 'live' : ''}`}>
      <summary>{live ? 'Thinking…' : 'Thought process'}</summary>
      <div className="think-body">{text || '…'}</div>
    </details>
  );
}

function Markdown({ text, streaming, caret }) {
  if (!/<\/?think(ing)?>/i.test(String(text || ''))) return <Body text={text} caret={caret} />;
  const parts = splitThink(text);
  return (
    <>
      {parts.map((p, i) => (p.type === 'think'
        ? <Think key={i} text={p.text} done={p.done} streaming={streaming} />
        : (p.text.trim() ? <Body key={i} text={p.text} caret={caret && i === parts.length - 1} /> : null)))}
    </>
  );
}

export default memo(Markdown);
