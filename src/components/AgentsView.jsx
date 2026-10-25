import React from 'react';
import { AgentsTab } from './settings/AgentsTab.jsx';
import { Group } from './settings/ui.jsx';
import { liveAgents } from '../lib/agents.js';
import { labelFor, target } from './ToolCard.jsx';

const kTok = (n) => (n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n || 0));

export default function AgentsView({ settings, chats, runningIds, groups, onOpenChat }) {
  const live = liveAgents(chats, runningIds);
  const chatGroups = groups.filter((g) => !/^(Image|Video)/.test(g.label));
  return (
    <div className="page agents-page">
      <div className="page-head"><h1>Agents</h1></div>
      <p className="page-sub">Specialists Artemis hands parts of a task to. Mention one in a chat, e.g. "@Athena research …", or let Artemis pick.</p>
      <Group title="Running now" plain>
        {live.length === 0 ? <div className="agents-idle">No agents are working right now.</div> : (
          <div className="proc-grid">
            {live.map((a, i) => {
              const tools = a.tools || [];
              const waiting = tools.find((t) => t.status === 'awaiting');
              const running = [...tools].reverse().find((t) => t.status === 'running');
              const now = waiting ? `Waiting for your approval: ${labelFor(waiting.name)[1]} ${target(waiting)}` : running ? `${labelFor(running.name)[1]} ${target(running)}` : (a.text ? 'Thinking and writing…' : 'Starting…');
              const done = tools.filter((t) => t.status === 'done' || t.status === 'error' || t.status === 'denied').slice(-4);
              return (
                <button key={i} className={`proc-card ${waiting ? 'waiting' : ''}`} onClick={() => onOpenChat(a.chatId)} title="Open the chat">
                  <div className="proc-top">
                    <span className="proc-dot" />
                    <b>{a.name}</b>{a.role ? <span className="muted">{a.role}</span> : null}
                    <span className={`badge ${waiting ? 'awaiting' : 'running'}`}>{waiting ? 'waiting for you' : 'working…'}</span>
                  </div>
                  <div className="proc-task">{a.task}</div>
                  <div className="proc-now"><span className="proc-label">Now</span>{now}</div>
                  {a.text && !running && !waiting && <div className="proc-text">{a.text.slice(-160)}</div>}
                  {done.length > 0 && (
                    <ul className="proc-log">
                      {done.map((t) => <li key={t.id} className={t.status}>{labelFor(t.name)[1]} <span className="muted">{target(t)}</span></li>)}
                    </ul>
                  )}
                  <div className="agent-chips"><span>{a.model || 'same as chat'}</span><span>{tools.length} tools</span><span>{kTok((a.prompt || 0) + (a.completion || 0))} tokens</span><span>{a.chatTitle}</span></div>
                </button>
              );
            })}
          </div>
        )}
      </Group>
      <AgentsTab s={settings} set={() => () => {}} chatGroups={chatGroups} showToggles={false} listTitle="Your agents" />
    </div>
  );
}
