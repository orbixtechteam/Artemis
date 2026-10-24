import React, { useState } from 'react';
import TitleText from './TitleText.jsx';

/** The chat's title above its messages. Click it to rename (Enter saves, Esc cancels); the project and model sit under it. */
export default function ChatHead({ chat, projectName, onRename }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(chat.title);
  const finish = (ok) => {
    setEditing(false);
    const t = val.trim().slice(0, 80);
    if (ok && t && t !== chat.title) onRename(t);
  };
  const model = String(chat.model || '').replace(/^prov:[^:]+:/, '');
  const sub = [projectName, model].filter(Boolean).join(' · ');
  return (
    <header className="chat-head">
      {editing ? (
        <input className="chat-head-edit" autoFocus value={val} aria-label="Chat title" onChange={(e) => setVal(e.target.value)}
          onBlur={() => finish(true)} onKeyDown={(e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); }} />
      ) : (
        <button type="button" className="chat-head-title" title="Rename" onClick={() => { setVal(chat.title); setEditing(true); }}>
          <TitleText text={chat.title || 'New chat'} />
        </button>
      )}
      {sub && <span className="chat-head-sub">{sub}</span>}
    </header>
  );
}
