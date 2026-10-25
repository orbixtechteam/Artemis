import React, { useEffect, useState } from 'react';
import { askConfirm } from '../../lib/dialog.js';
import { Group, Row, SwitchRow, Switch, Note, Buttons } from './ui.jsx';

const ORDER = ['core', 'files', 'tools', 'memory', 'agents', 'safety', 'automation'];
const PH = {
  '{root}': 'the project or Files folder', '{sandboxNote}': 'how the sandbox is set up', '{timezone}': 'your time zone', '{tools}': 'the tools that can be switched on',
  '{connectors}': 'your connectors', '{skills}': 'your skills', '{agents}': 'your helper agents', '{role}': 'the helper agent\'s own instructions',
  '{projectFolder}': 'the project folder', '{projectName}': 'the project name', '{token}': 'the "nothing to report" word'
};

function PromptRow({ p, open, onToggle, onChange }) {
  const [draft, setDraft] = useState(p.text);
  const [err, setErr] = useState('');
  useEffect(() => { setDraft(p.text); }, [p.text]);
  const dirty = draft !== p.text;
  const apply = async (change) => { setErr(''); const r = await window.api.advancedPromptSet(p.id, change); if (!r.ok) setErr(r.error); else onChange(r.prompt); };
  const status = p.off ? 'Off' : p.edited ? 'Edited' : '';
  return (
    <div className={`adv-prompt ${open ? 'open' : ''} ${p.off ? 'off' : ''}`}>
      <div className="adv-prompt-head">
        <button type="button" className="adv-prompt-title" aria-expanded={open} onClick={onToggle}>
          <span>{p.title}</span>{status && <span className={`adv-badge ${p.off ? 'off' : ''}`}>{status}</span>}
        </button>
        <Switch checked={!p.off} onChange={(on) => apply({ off: !on })} label={`Use "${p.title}"`} />
      </div>
      {open && (
        <div className="adv-prompt-body">
          {p.description && <p className="pref-row-desc">{p.description}</p>}
          <textarea className="mono" rows={Math.min(14, Math.max(4, Math.ceil(draft.length / 110)))} value={draft} spellCheck={false} aria-label={p.title} onChange={(e) => setDraft(e.target.value)} />
          {p.placeholders.length > 0 && <p className="pref-row-desc">Filled in when used: {p.placeholders.map((x) => <span key={x}><code>{x}</code> {PH[x] || ''}; </span>)}</p>}
          {err && <div className="pref-row-err" role="alert">{err}</div>}
          <Buttons end>
            {(p.edited || p.off) && <button type="button" className="pref-btn" onClick={() => apply({ reset: true })}>Reset to default</button>}
            {dirty && <button type="button" className="pref-btn" onClick={() => setDraft(p.text)}>Undo</button>}
            <button type="button" className="pref-btn primary" disabled={!dirty} onClick={() => apply({ text: draft })}>Save</button>
          </Buttons>
        </div>
      )}
    </div>
  );
}

/** Settings → Advanced: everything Artemis tells the model, and the command blocklist. All of it is yours to change. */
export function AdvancedTab() {
  const [list, setList] = useState(null);
  const [groups, setGroups] = useState({});
  const [open, setOpen] = useState(null);
  const [q, setQ] = useState('');
  const [sh, setSh] = useState(null);
  const [own, setOwn] = useState('');
  const [shErr, setShErr] = useState('');
  const toText = (extra) => (extra || []).map((x) => (x.why ? `${x.pattern} => ${x.why}` : x.pattern)).join('\n');
  useEffect(() => {
    window.api.advancedPrompts().then((r) => { if (r.ok) { setList(r.prompts); setGroups(r.groups || {}); } }).catch(() => {});
    window.api.advancedShell().then((r) => { setSh(r); setOwn(toText(r.extra)); }).catch(() => {});
  }, []);
  const update = (p) => setList((l) => l.map((x) => (x.id === p.id ? p : x)));
  const shSet = async (change) => { setShErr(''); const r = await window.api.advancedShellSet(change); if (r.ok === false && r.error) setShErr(r.error); setSh(r); return r; };
  const saveOwn = async () => {
    const extra = own.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const i = l.indexOf('=>'); return i < 0 ? { pattern: l } : { pattern: l.slice(0, i).trim(), why: l.slice(i + 2).trim() }; });
    const r = await shSet({ extra });
    if (r.ok !== false) setOwn(toText(r.extra));
  };
  const resetAll = async () => {
    if (!(await askConfirm({ title: 'Reset all prompts?', message: 'Every edited or switched-off prompt goes back to its default.', confirmLabel: 'Reset all', danger: true }))) return;
    for (const p of list.filter((x) => x.edited || x.off)) { const r = await window.api.advancedPromptSet(p.id, { reset: true }); if (r.ok) update(r.prompt); }
  };
  const term = q.trim().toLowerCase();
  const shown = (list || []).filter((p) => !term || (p.title + ' ' + p.text + ' ' + p.id).toLowerCase().includes(term));
  const changed = (list || []).filter((p) => p.edited || p.off).length;
  const ownDirty = sh && own !== toText(sh.extra);
  return (
    <>
      <Note>These are all the instructions Artemis gives the model in its own words: who it is, how to use each tool, how scheduled tasks, heartbeats and webhooks behave. They are defaults, not rules. Change any of them or switch them off; your versions are used everywhere, also in the background gateway. Your own instructions (General → Custom instructions), projects and agents come on top.</Note>
      <Group title="System prompts" footer={changed ? `${changed} changed.` : 'All prompts are at their defaults.'}>
        <Row>
          <div className="pref-inline" style={{ width: '100%' }}>
            <input className="pref-input wide" placeholder="Find a prompt…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a prompt" />
            {changed > 0 && <button type="button" className="pref-btn" onClick={resetAll}>Reset all</button>}
          </div>
        </Row>
        {!list && <Row description="Loading…" />}
        {list && ORDER.filter((g) => shown.some((p) => p.group === g)).map((g) => (
          <div key={g} className="adv-group">
            <div className="adv-group-title">{groups[g] || g}</div>
            {shown.filter((p) => p.group === g).map((p) => <PromptRow key={p.id} p={p} open={open === p.id || (!!term && shown.length <= 3)} onToggle={() => setOpen(open === p.id ? null : p.id)} onChange={update} />)}
          </div>
        ))}
      </Group>
      {sh && (
        <Group title="Command blocklist" footer="Checked before run_command runs, on this computer and in the sandbox. The commands still ask for your approval unless you allowed them.">
          <SwitchRow label="Block dangerous commands" checked={!sh.off} onChange={(on) => shSet({ off: !on })}
            description={sh.off ? 'Off: every command can run.' : 'Commands matching one of the rules below are refused before they run.'} />
          {!sh.off && sh.rules.map((r) => (
            <Row key={r.id} label={r.id} description={r.why}>
              <Switch checked={r.on} onChange={(on) => shSet({ rule: { id: r.id, on } })} label={r.id} />
            </Row>
          ))}
          {!sh.off && (
            <Row stacked label="Your own rules" description={<>One per line: a word or a regular expression (not case sensitive), optionally followed by <code>=&gt; reason</code>. Example: <code>git\s+push =&gt; no pushing from Artemis</code></>} error={shErr}>
              <textarea className="mono" rows={4} value={own} spellCheck={false} onChange={(e) => setOwn(e.target.value)} />
            </Row>
          )}
          {!sh.off && ownDirty && <Buttons end><button type="button" className="pref-btn primary" onClick={saveOwn}>Save rules</button></Buttons>}
        </Group>
      )}
    </>
  );
}
