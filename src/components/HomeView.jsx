import React, { useEffect, useState } from 'react';
import { Icon } from './Icons.jsx';
import Logo from './Logo.jsx';
import Composer, { ChatPills } from './Composer.jsx';
import { dayGroup } from '../lib/history.js';
import { formatAccelerator } from '../lib/shortcuts.mjs';

const greet = () => { const h = new Date().getHours(); return h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };
const when = (t) => { if (!t) return ''; const d = new Date(t); const same = d.toDateString() === new Date().toDateString(); return (same ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };

// The Home page: the logo, a greeting, the chat box, and the chats to jump back into. Everything else lives in
// the sidebar (places, workspace) and the profile menu (usage, logs, terminal), so Home stays quiet.
export default function HomeView({ chats, projects, settings, statusOf, onSend, onOpenChat, onGo, composerProps }) {
  const mac = window.api?.platform === 'darwin';
  const st = settings || {};
  const keys = { palette: formatAccelerator(st.paletteShortcut ?? 'CommandOrControl+K', mac), quickChat: formatAccelerator(st.quickChatShortcut, mac) };
  const [draft, setDraft] = useState({}); // choices for the chat that the box below starts
  const up = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const cp = composerProps || {};
  const brain = draft.brain !== undefined ? draft.brain : (st.defaultBrain || '');
  const model = draft.model || cp.defaultModel;
  const [jobs, setJobs] = useState([]);
  useEffect(() => {
    let live = true;
    const load = () => Promise.resolve(window.api.scheduleList && window.api.scheduleList()).then((j) => live && setJobs(Array.isArray(j) ? j : [])).catch(() => {});
    load(); const id = setInterval(load, 30000);
    return () => { live = false; clearInterval(id); };
  }, []);

  const recent = chats.filter((c) => c.messages.length && !c.incognito).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3);
  const upcoming = jobs.filter((j) => j.enabled && j.nextRun).sort((a, b) => a.nextRun - b.nextRun).slice(0, 3);
  const name = (st.profileName || '').split(' ')[0];
  const projectName = (id) => (projects.find((p) => p.id === id) || {}).name;

  return (
    <div className="page home-page">
      <div className="home-col">
        <Logo size={60} className="home-logo" />
        <h1 className="home-title">{greet()}{name ? ', ' + name : ''}</h1>
        {!model && (
          <div className="home-setup">
            <Icon name="plug" size={16} />
            <span>Add a model provider to start chatting.</span>
            <button className="primary" onClick={() => onGo('providers')}>Add provider</button>
          </div>
        )}
        <div className="home-compose">
          <Composer key="home" chatId="draft:home" streaming={false} onStop={() => {}} onSend={(t, a, x) => { onSend(t, a, { ...draft, brain, model, ...(x || {}) }); setDraft({}); }} placeholder="Ask anything"
            model={model} onModel={(m) => up({ model: m })} groups={cp.groups || []} projects={projects} projectId={draft.projectId || null} onProject={(id) => up({ projectId: id })}
            settings={settings} onUsageDetails={cp.onUsageDetails} onOpenSettings={cp.onOpenSettings}
            tools={draft.tools || 'on'} onTools={(v) => up({ tools: v })} agents={draft.agents || 'on'} onAgents={(v) => up({ agents: v })}
            brains={cp.brains || []} brain={brain} onBrain={(v) => up({ brain: v })} />
          <div className="home-pills">
            <ChatPills stacked={false} brains={cp.brains || []} brain={brain} onBrain={(v) => { const b = (cp.brains || []).find((x) => x.slug === v); up({ brain: v, ...(b && b.model ? { model: b.model } : {}) }); }}
              tools={draft.tools || (st.toolsEnabled === false ? 'off' : 'on')} onTools={(v) => up({ tools: v })}
              agents={draft.agents || (st.delegateEnabled === false ? 'off' : 'on')} onAgents={(v) => up({ agents: v })}
              perm={draft.perm || (st.autoApproveEdits ? 'auto' : 'ask')} onPerm={(v) => up({ perm: v })}
              projectId={draft.projectId || null} projects={projects} onProject={(id) => up({ projectId: id })}
              model={model} settings={settings} onUsageDetails={cp.onUsageDetails} onOpenSettings={cp.onOpenSettings} />
          </div>
        </div>

        {recent.length > 0 && (
          <section className="home-sec" aria-labelledby="home-recent">
            <div className="home-cap"><span id="home-recent">Jump back in</span><button className="link" onClick={() => onGo('palette')}>All chats</button></div>
            <div className="home-cards">
              {recent.map((c) => {
                const s = statusOf(c);
                const proj = c.projectId && projectName(c.projectId);
                return (
                  <button key={c.id} className={`home-card ${s || ''}`} onClick={() => onOpenChat(c.id)}>
                    <b>{c.title}</b>
                    <span>{s === 'running' ? <><i className="live" aria-hidden="true" />Working</> : s === 'awaiting' ? 'Needs your approval' : dayGroup(c.updatedAt)}{proj ? ' · ' + proj : ''}</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {upcoming.length > 0 && (
          <section className="home-sec" aria-labelledby="home-next">
            <div className="home-cap"><span id="home-next">Coming up</span><button className="link" onClick={() => onGo('schedule')}>Scheduled</button></div>
            <div className="home-list">
              {upcoming.map((j) => (
                <button key={j.id} onClick={() => onGo('schedule')}><Icon name="clock" size={14} /><span className="t">{j.name}</span><span className="when">{when(j.nextRun)}</span></button>
              ))}
            </div>
          </section>
        )}

        <p className="home-keys">
          {keys.palette && <>Search everything <kbd>{keys.palette}</kbd></>}
          {keys.palette && keys.quickChat && <span aria-hidden="true"> · </span>}
          {keys.quickChat && <>Quick chat from any app <kbd>{keys.quickChat}</kbd></>}
        </p>
      </div>
    </div>
  );
}
