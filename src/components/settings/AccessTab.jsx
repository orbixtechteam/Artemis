import React, { useEffect, useState } from 'react';
import { askConfirm } from '../../lib/dialog.js';
import { Group, Row, SwitchRow, Note } from './ui.jsx';
import { GatewayCard } from './GatewayCard.jsx';

/** Lets other apps (Claude Code, the Claude proxy, Claude Desktop …) control Artemis through MCP. */
export function McpServerCard() {
  const [i, setI] = useState(null);
  const [port, setPort] = useState('');
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState('');
  const load = () => window.api.mcpServerInfo().then((x) => { setI(x); setPort(String(x.port)); }).catch(() => {});
  useEffect(() => { load(); }, []);
  const apply = async (o) => { setI(await window.api.mcpServerSet(o)); };
  const url = i ? `http://127.0.0.1:${i.port}/mcp` : '';
  const tok = i && i.token ? i.token : '<token>';
  const cmd = `claude mcp add --transport http --scope user artemis ${url} --header "Authorization: Bearer ${tok}"`;
  const json = JSON.stringify({ mcpServers: { artemis: { type: 'http', url, headers: { Authorization: `Bearer ${tok}` } } } }, null, 2);
  const copy = async (what, text) => { try { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(''), 1500); } catch {} };
  return (
    <Group title="Let other apps control Artemis (MCP server)" footer={i && i.enabled ? <>The Claude proxy starts Claude Code, which reads this list, so adding Artemis once makes its tools appear there too (restart the proxy). If it still asks for permission in headless mode, allow <code>mcp__artemis</code> in the Claude Code settings. Tools: artemis_status, set_theme, set_setting, list/set providers, memory, notes, terminal_run …</> : null}>
      <SwitchRow label="Artemis MCP server" checked={!!(i && i.enabled)} onChange={(v) => i && apply({ enabled: v })} disabled={!i}
        description={<>{i && i.running ? `Running on 127.0.0.1:${i.port}. ` : 'Off. '}Claude Code, the Claude proxy or any MCP app can then change the theme and settings, switch providers on or off, use memory and Notes, and run commands in the Artemis terminal. It only listens on this Mac and needs the token below. Permissions that give Artemis more power (terminal, computer control, auto-approve, phone, keys) cannot be changed this way. Running a command or editing a note always asks you first.</>}
        error={i && i.error ? i.error : ''} />
      {i && i.enabled && (
        <>
          <Row label="Port" description="Saved when you leave the field.">
            <input className="pref-input narrow" inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))} onBlur={() => port && String(i.port) !== port && apply({ port })} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
          </Row>
          <Row label="Token" description="Apps send it as a bearer token.">
            <div className="pref-inline">
              <input className="pref-input" readOnly type={show ? 'text' : 'password'} value={i.token} onFocus={(e) => e.target.select()} aria-label="MCP server token" />
              <button type="button" className="pref-btn" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button>
              <button type="button" className="pref-btn" onClick={() => askConfirm({ title: 'Make a new token?', message: 'Apps that use the old token will stop working until you give them the new one.', confirmLabel: 'New token' }).then((ok) => ok && apply({ resetToken: true }))}>New token</button>
            </div>
          </Row>
          <SwitchRow label="Don't ask before running commands from outside" description="Off: Artemis asks (a window appears) each time an outside app wants to run a command or edit a note."
            checked={!!i.alwaysAllow} onChange={(v) => apply({ alwaysAllow: v })} />
          <Row stacked label="Add it to Claude Code" description="Run this once in a terminal.">
            <textarea readOnly rows={3} className="mono" value={cmd} onFocus={(e) => e.target.select()} />
          </Row>
          <Row>
            <div className="pref-inline">
              <button type="button" className="pref-btn" onClick={() => copy('cmd', cmd)}>{copied === 'cmd' ? 'Copied' : 'Copy command'}</button>
              <button type="button" className="pref-btn" onClick={() => copy('json', json)}>{copied === 'json' ? 'Copied' : 'Copy JSON config'}</button>
              <button type="button" className="pref-btn" onClick={() => copy('url', url)}>{copied === 'url' ? 'Copied' : 'Copy address'}</button>
            </div>
          </Row>
        </>
      )}
    </Group>
  );
}

export function AccessTab({ s, set, setS, projects = [], goTo }) {
  const [st, setSt] = useState(null);
  const [sec, setSec] = useState(null); // security summary: { lock, speaker, telegram }
  const [dirs, setDirs] = useState({ files: '', notes: '' });
  useEffect(() => { Promise.all([window.api.defaultFilesFolder().catch(() => ''), window.api.notesRoot().catch(() => '')]).then(([files, notes]) => setDirs({ files: files || '', notes: (notes && (notes.root || notes)) || '' })); }, []);
  const refresh = () => {
    window.api.permStatus().then(setSt).catch(() => setSt({ supported: false, items: [] }));
    Promise.all([window.api.lockStatus().catch(() => null), window.api.speakerStatus().catch(() => null), (window.api.remoteStatus ? window.api.remoteStatus() : Promise.resolve(null)).catch(() => null)])
      .then(([lock, speaker, remote]) => setSec({ lock, speaker, telegram: remote && remote.telegram }));
  };
  useEffect(() => { refresh(); window.addEventListener('focus', refresh); return () => window.removeEventListener('focus', refresh); }, []);
  const ask = async (id) => { setSt(await window.api.permRequest(id)); };
  const mark = { granted: ['Allowed', 'ok'], denied: ['Not allowed', 'bad'], 'not-determined': ['Not asked yet', 'warn'], unknown: ['Check in System Settings', 'warn'], restricted: ['Restricted', 'bad'], available: ['Available', 'ok'], unavailable: ['Not on this Mac', 'warn'] };
  const testable = (i) => i.id === 'notifications' || i.id === 'touchid';
  const phoneOn = !!s.telegramEnabled;
  const lk = sec && sec.lock; const cf = (lk && lk.config) || {}; const sp = sec && sec.speaker; const tg = sec && sec.telegram;
  const camera = st && st.items ? st.items.find((x) => x.id === 'camera') : null;
  const secRows = !sec ? [] : [
    ['App lock', lk && lk.enabled ? (lk.locked ? 'Locked right now.' : 'Password required to open Artemis.') : lk && lk.hasPassword ? 'A password is set, but the lock is off.' : 'No password yet.', lk && lk.enabled ? ['On', 'ok'] : ['Off', 'warn']],
    ['Voice recognition', sp && sp.enrolled ? (cf.voiceOnly ? 'Artemis answers only your voice.' : 'Your voice is saved. “Only respond to my voice” is off.') : sp && sp.model && sp.model.ready ? 'The model is downloaded, but your voice is not enrolled.' : 'Not set up. Needs a 28 MB model and a few sentences from you.', sp && sp.enrolled ? ['Set up', 'ok'] : ['Not set up', 'warn']],
    ['Touch ID for sensitive actions', lk && lk.touchIdAvailable ? (cf.sensitiveTouchId ? 'Asked before deleting, terminal, computer control and connector changes.' : 'Available, but not used for sensitive actions.') : 'This Mac has no Touch ID, so the password is used.', cf.sensitiveTouchId ? ['On', 'ok'] : ['Off', 'warn']],
    ['Alerts on Telegram', tg && tg.paired ? (cf.alertTelegram ? 'You get a message when someone keeps failing to unlock.' : 'Telegram is paired, but alerts are off.') : 'Pair the Telegram bot in Phone first.', tg && tg.paired && cf.alertTelegram ? ['On', 'ok'] : ['Off', 'warn']],
    ['Photo with the alert', camera ? (cf.photoOnLockdown ? (camera.status === 'granted' ? 'One camera photo goes with the alert.' : 'Turned on, but Artemis may not use the camera yet. Allow it above.') : 'Off. No photo is taken.') : 'Camera status is unknown.', cf.photoOnLockdown && camera && camera.status === 'granted' ? ['On', 'ok'] : cf.photoOnLockdown ? ['Needs camera access', 'bad'] : ['Off', 'warn']]
  ];
  const rows = [
    ['toolsEnabled', 'Files and tools', 'Read and write files in the project folder, create artifacts.', s.toolsEnabled],
    ['shellEnabled', 'Terminal', 'Run commands on this computer, also in the visible terminal panel. Asks once per task.', s.shellEnabled],
    ['notesAi', 'Notes (knowledge base)', 'Let Artemis search and read your Notes. Asks once per task; writing a note asks every time.', s.notesAi !== false],
    ['computerEnabled', 'Computer control', 'See the screen, move the mouse, type. Asks once per task. Emergency stop: Cmd+Shift+Esc.', s.computerEnabled],
    ['webEnabled', 'Internet', 'Search the web and open pages.', s.webEnabled],
    ['browserTools', 'Browser control', 'Let Artemis use the integrated browser: open pages, click, type and fill forms while you watch. Asks once per site per task.', s.browserTools !== false],
    ['memoryEnabled', 'Memory', 'Remember facts about you between chats.', s.memoryEnabled],
    ['connectorsEnabled', 'Connectors', 'Use your connected apps (MCP servers).', s.connectorsEnabled !== false],
    ['skillsEnabled', 'Skills', 'Load your saved instructions.', s.skillsEnabled !== false],
    ['delegateEnabled', 'Agents', 'Hand parts of a task to helper agents.', s.delegateEnabled !== false]
  ];
  const put = (k) => (v) => (setS ? setS((x) => ({ ...x, [k]: v })) : set(k)({ target: { type: 'checkbox', checked: v } }));
  return (
    <>
      <Note>Everything Artemis can reach, in one place. Switch features off here, or open the macOS permission it needs.</Note>
      <Group title="macOS permissions" footer="After allowing Screen Recording or Accessibility, macOS may ask you to restart Artemis. If you run Artemis from a terminal, allow the terminal app instead. This list refreshes when you come back from System Settings.">
        {st === null ? <Row label="Checking…" /> : !st.supported ? <Row description="macOS permissions are not used on this system." /> : st.items.map((i) => {
          const [label, tone] = mark[i.status] || mark.unknown;
          return (
            <Row key={i.id} label={i.title} description={i.why}>
              <div className="pref-inline">
                <span className={`pref-badge ${tone}`}>{label}</span>
                <button type="button" className="pref-btn" onClick={() => ask(i.id)} disabled={i.status === 'granted' || i.status === 'unavailable'} aria-label={(i.status === 'granted' ? 'Done: ' : testable(i) ? 'Test ' : 'Allow ') + i.title}>{i.status === 'granted' ? 'Done' : testable(i) ? 'Test' : 'Allow'}</button>
              </div>
            </Row>
          );
        })}
      </Group>
      <Group title="Security" footer="Scheduled tasks keep running while Artemis is locked. They never wait for the lock or for Touch ID.">
        {sec === null ? <Row label="Checking…" /> : secRows.map(([title, why, [label, tone]]) => (
          <Row key={title} label={title} description={why}>
            <div className="pref-inline">
              <span className={`pref-badge ${tone}`}>{label}</span>
              {goTo && <button type="button" className="pref-btn" onClick={() => goTo('security')} aria-label={'Open Security settings for ' + title}>Open</button>}
            </div>
          </Row>
        ))}
      </Group>
      <Group title="Folders Artemis can reach" footer="macOS may also ask separately the first time a folder such as Documents or Desktop is used. You can review that in System Settings → Privacy & Security → Files and Folders.">
        {[
          ['Default files folder', 'Used by chats that have no project. File tools stay inside it.', dirs.files],
          ...projects.filter((p) => p.folder).map((p) => ['Project: ' + p.name, 'File tools stay inside this folder in chats of this project.', p.folder]),
          ['Notes', s.notesAi !== false ? 'Artemis can search and read these notes (asks once per task); writing a note always asks.' : 'Notes access for Artemis is off.', dirs.notes]
        ].filter((r) => r[2]).map(([title, why, dir]) => (
          <Row key={title + dir} label={title} description={<><span>{why}</span><code className="pref-code">{dir}</code></>}>
            <button type="button" className="pref-btn" onClick={() => window.api.revealPath(dir)} aria-label={'Show ' + title + ' in Finder'}>Show</button>
          </Row>
        ))}
        <Row label="Terminal and computer control" description={s.shellEnabled || s.computerEnabled ? 'Not limited to folders: a command can reach anything your Mac user can. Each task asks first.' : 'Off, so no commands run and no folder outside the ones above is reachable.'}>
          <span className={`pref-badge ${s.shellEnabled || s.computerEnabled ? 'warn' : 'ok'}`}>{s.shellEnabled || s.computerEnabled ? 'Any folder' : 'Off'}</span>
        </Row>
      </Group>
      <Group title="What Artemis may use">
        {rows.map(([key, title, why, on]) => (
          <SwitchRow key={key} label={title} description={why} checked={!!on} onChange={put(key)} />
        ))}
        <Row label="Phone (Telegram)" description="Lets you chat with Artemis from your phone and lets it send you files. Set up in the Phone section.">
          <span className={`pref-badge ${phoneOn ? 'ok' : 'warn'}`}>{phoneOn ? 'On' : 'Off'}</span>
        </Row>
        <SwitchRow label="Approve everything in new chats" description={<>Off: Artemis asks before edits, the terminal, the computer and scheduled tasks. On: it does not ask. <span className={`pref-badge inline ${s.autoApproveEdits ? 'bad' : 'ok'}`}>{s.autoApproveEdits ? 'No questions' : 'Asks first'}</span></>}
          checked={!!s.autoApproveEdits} onChange={put('autoApproveEdits')} />
      </Group>
      <McpServerCard />
      <GatewayCard />
    </>
  );
}
