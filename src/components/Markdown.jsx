import React, { memo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { splitThink } from '../lib/think.mjs';
import { stripTags } from '../lib/tts-emotion.mjs';
import { codeOnly } from '../lib/clip.mjs';

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
  // http(s) links open in the in-app browser; ⌘/Ctrl-click opens the system browser instead
  a: ({ href, children }) => <a href={href} title={href} onClick={(e) => {
    if (!/^https?:\/\//i.test(href || '')) return;
    e.preventDefault();
    if ((e.metaKey || e.ctrlKey) && window.api && window.api.openExternalUrl) { e.stopPropagation(); window.api.openExternalUrl(href); return; }
    window.dispatchEvent(new CustomEvent('aid-browser-open', { detail: href }));
  }}>{children}</a>,
  table: ({ children }) => <div className="table-wrap"><table>{children}</table></div>
};

// module constants: new arrays on every render would make react-markdown rebuild its processor each time
const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [[rehypeHighlight, { detect: false, ignoreMissing: true }]];

function Body({ text, caret }) {
  return (
    <div className={`md ${caret ? 'streaming' : ''}`}>
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={components}>
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
