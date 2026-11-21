import React, { useEffect, useState } from 'react';
import { askConfirm } from '../../lib/dialog.js';
import { Group, Row, Buttons, Switch } from './ui.jsx';

const AREAS = [
  ['chats', 'Chats', (s) => `${s.chats.count} chats`],
  ['media', 'Images in chats', (s) => `${s.media.count} files, ${Math.round(s.media.bytes / 1048576)} MB`],
  ['projects', 'Projects', (s) => `${s.projects.count} projects (folders on this Mac stay here)`],
  ['memory', 'Memory', (s) => `${s.memory.count} memory files, merged with the server's`],
  ['skills', 'Skills, agents and brains', (s) => `${s.skills.count} files`],
  ['teams', 'Agent teams', (s) => `${s.teams.count} teams`],
  ['settings', 'Settings and providers', (s) => `your choices and ${s.settings.count} providers (not this Mac's paths or ports)`],
  ['connectors', 'Connectors', (s) => `${s.connectors.count} connectors`]
];
const PHASE = { preparing: 'Preparing…', sending: 'Sending', applying: 'The server is applying it…', done: 'Done' };

/** Settings → Server & devices → Move my data: this Mac's data to the paired server (the Mac keeps its copy). */
export function MoveDataGroup() {
  const [sv, setSv] = useState(null);
  const [on, setOn] = useState(() => new Set(AREAS.map((a) => a[0])));
  const [automations, setAutomations] = useState('keep');
  const [telegram, setTelegram] = useState('keep');
  const [prog, setProg] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { window.api.serverMigrateSurvey().then((r) => (r.ok ? setSv(r.survey) : setError(r.error))); }, []);
  useEffect(() => window.api.onServerMigrateProgress((p) => setProg(p)), []);

  const flip = (k) => setOn((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const all = on.size === AREAS.length;
  const start = async () => {
    const ok = await askConfirm({ title: 'Move your data to the server?', message: 'The server backs up its own data first, then adds yours. Your data on this Mac is not changed' + (automations === 'move' ? ', except that the moved scheduled tasks are switched off here so they do not run twice' : '') + (telegram === 'move' ? ', and the Telegram bot moves to the server' : '') + '.', confirmLabel: 'Move' });
    if (!ok) return;
    setError(''); setResult(null); setProg({ phase: 'preparing' });
    const r = await window.api.serverMigrateRun({ areas: [...on, ...(automations === 'move' ? ['automations'] : [])], automations, telegram });
    setProg(null);
    if (!r.ok) return setError(r.error);
    setResult(r.migration.report);
  };

  if (!sv) return <Group title="Move my data to the server"><Row label={error ? '' : 'Looking at your data…'} error={error} /></Group>;
  const running = !!prog;
  const pct = prog && prog.phase === 'sending' && prog.bytesTotal ? Math.round((prog.bytes / prog.bytesTotal) * 100) : null;
  return (
    <Group title="Move my data to the server" footer="Safe to repeat: chats and files already on the server are recognised and not added twice.">
      <Row label="Everything" description="Or pick below."><Switch checked={all} disabled={running} onChange={(v) => setOn(new Set(v ? AREAS.map((a) => a[0]) : []))} /></Row>
      {AREAS.map(([k, label, desc]) => <Row key={k} label={label} description={desc(sv)}><Switch checked={on.has(k)} disabled={running} onChange={() => flip(k)} /></Row>)}
      <Row label="Scheduled tasks, heartbeats and webhooks" description={`${sv.automations.count} here. Move: they run on the server (also when this Mac is off) and are switched off here.`}>
        <select className="pref-input" value={automations} disabled={running} onChange={(e) => setAutomations(e.target.value)}><option value="keep">Keep on this Mac</option><option value="move">Move to the server</option></select>
      </Row>
      {sv.telegram.configured && (
        <Row label="Telegram bot" description="One bot can run in one place. Move: the server answers on Telegram and this Mac stops.">
          <select className="pref-input" value={telegram} disabled={running} onChange={(e) => setTelegram(e.target.value)}><option value="keep">Keep on this Mac</option><option value="move">Move to the server</option></select>
        </Row>
      )}
      {running && <Row label={PHASE[prog.phase] || prog.phase} description={prog.phase === 'sending' ? `${prog.done} of ${prog.total} files${pct != null ? ` · ${pct}%` : ''}` : ''}><progress max={100} value={pct != null ? pct : undefined} /></Row>}
      {error && <Row error={error} />}
      {result && (
        <Row stacked label="Moved" description={`Server backup: ${result.backup}`}>
          <ul className="pref-list" style={{ margin: 0, paddingLeft: 18 }}>
            <li>Chats: {result.chats.added} added, {result.chats.merged} updated, {result.chats.skipped} already there{result.chats.failed ? `, ${result.chats.failed} failed` : ''}</li>
            <li>Images: {result.media.copied} copied · Memory: {result.memory.added} added, {result.memory.merged} merged</li>
            <li>Projects: {result.projects.added} added{result.projects.withoutFolder.length ? ` (without their Mac folder: ${result.projects.withoutFolder.join(', ')})` : ''}</li>
            {result.secrets.stored > 0 && <li>{result.secrets.stored} keys and secrets stored encrypted on the server</li>}
            {(result.providers.missingKeys || []).length > 0 && <li className="pref-err-text">No key on the server yet for: {result.providers.missingKeys.join(', ')}. Add the key on this Mac (Settings → Models); it goes to the server on its own.</li>}
            {result.connectors.updated > 0 && <li>{result.connectors.updated} connectors got their sign-in on the server</li>}
            {result.connectors.needSetup.map((c) => <li key={c.name}>Set up again on the server: {c.name} ({c.why})</li>)}
            {result.files.conflicts.length > 0 && <li>Kept the server's version of: {result.files.conflicts.slice(0, 5).join(', ')}{result.files.conflicts.length > 5 ? '…' : ''}</li>}
            {result.failures.map((f, i) => <li key={i} className="pref-err-text">{f.what}: {f.error}</li>)}
          </ul>
        </Row>
      )}
      <Row><Buttons end><button type="button" className="pref-btn primary" disabled={running || (!on.size && automations !== 'move' && telegram !== 'move')} onClick={start}>{running ? 'Moving…' : result ? 'Move again' : 'Move to the server'}</button></Buttons></Row>
    </Group>
  );
}
