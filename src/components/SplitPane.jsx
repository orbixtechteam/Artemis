import React, { useRef } from 'react';
import { useFollow } from '../lib/stick.js';
import Message from './Message.jsx';
import Composer, { ChatPills } from './Composer.jsx';
import { Icon } from './Icons.jsx';
import FindBar from './FindBar.jsx';

/** The second chat in split view: its own header, message list and message box. h = handlers from App. */
export default function SplitPane({ chat, busy, settings, projects, brains, brain, groups, h, msgH }) {
  const ref = useRef(null);
  const stick = useRef(true);
  const follow = useFollow(ref, stick, chat.id, chat.messages);
  const perm = chat.perm === 'auto' ? 'auto' : chat.perm ? 'ask' : (settings.autoApproveEdits ? 'auto' : 'ask');
  const agents = chat.agents || (settings.delegateEnabled === false ? 'off' : 'on');
  const tools = chat.tools || (settings.toolsEnabled === false ? 'off' : 'on');
  return (
    <section className="split-pane" data-chat-pane={chat.id} data-find-scope="chat">
      <FindBar key={chat.id} targetRef={ref} />
      <header className="split-head">
        <div className="chat-title">{chat.incognito && <Icon name="ghost" size={15} className="incog-ico" />}{chat.title}</div>
        <ChatPills chatId={chat.id} model={chat.model} settings={settings} incognito={chat.incognito}
          perm={perm} onPerm={(v) => h.update({ perm: v })} agents={agents} onAgents={(v) => h.update({ agents: v })} shell={chat.shell || 'sandbox'} onShell={(v) => h.update({ shell: v })} tools={tools} onTools={(v) => h.update({ tools: v })} effort={chat.effort ?? (settings.reasoningEffort || 'auto')} onEffort={(v) => h.update({ effort: v })}
          projectId={chat.projectId} projects={projects} onProject={(id) => h.update({ projectId: id })}
          brains={brains} brain={brain} onBrain={(v) => h.update({ brain: v, councilPick: null })} councilPick={chat.councilPick} onRevote={() => h.update({ councilPick: null })}
          onUsageDetails={h.onUsageDetails} onOpenSettings={h.onOpenSettings} />
        <button className="icon-btn nodrag" title="Close split view" aria-label="Close split view" onClick={h.onClose}><Icon name="x" size={16} /></button>
      </header>
      <section className="messages" ref={ref}>
        {chat.messages.length === 0 ? (
          <div className="empty"><h1>New chat</h1><p>This chat is open next to the other one.</p></div>
        ) : chat.messages.map((m) => {
          const live = busy && m === chat.messages[chat.messages.length - 1] && m.role === 'assistant';
          return <Message key={m.id} m={m} live={live} chatId={chat.id} h={msgH} canDelete={!live} artifacts={chat.artifacts} />;
        })}
      </section>
      {follow.unseen && <div className="jump-anchor"><button type="button" className="jump-latest" onClick={follow.jump} aria-label="Jump to latest message"><Icon name="arrowUp" size={14} className="flip" /> Jump to latest</button></div>}
      <Composer key={chat.id} chatId={chat.id} streaming={busy} onSend={h.onSend} onStop={h.onStop} queue={h.queue} queueHeld={h.queueHeld} onQueue={h.onQueue} onUnqueue={h.onUnqueue} onSendNow={h.onSendNow} onSendNowText={h.onSendNowText} model={chat.model} onModel={(m) => h.update({ model: m })} groups={groups}
        incognito={chat.incognito} settings={settings} onUsageDetails={h.onUsageDetails} onOpenSettings={h.onOpenSettings}
        onCompact={h.onCompact} canCompact={h.canCompact} compacting={h.compacting} />
    </section>
  );
}
