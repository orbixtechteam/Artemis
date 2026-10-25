import React, { useEffect, useState } from 'react';
import { askConfirm } from '../../lib/dialog.js';
import ModelPicker from '../ModelPicker.jsx';
import { Icon } from '../Icons.jsx';
import { Group, Row, SwitchRow, Note, Buttons } from './ui.jsx';

export const AGENT_BLANK = { name: '', role: '', description: '', model: '', tools: ['read'], body: '', isNew: true };

export function AgentsTab({ s, set, setS, chatGroups, showToggles = true, listTitle = 'Agents' }) {
  const put = (k) => (v) => (setS ? setS((x) => ({ ...x, [k]: v })) : set(k)({ target: { type: 'checkbox', checked: v } }));
  const api = window.api;
  const [list, setList] = useState([]);
  const [ed, setEd] = useState(null);
  const load = async () => { try { setList(await api.agentsList()); } catch {} };
  useEffect(() => { load(); const off = api.onAgentsChanged && api.onAgentsChanged(load); return () => off && off(); }, []);
  const modelLabel = (id) => { if (!id) return 'Same as chat'; for (const g of chatGroups) for (const [mid, n] of g.items) if (mid === id) return n; return id; };
  const remove = async (a) => {
    const reset = !!a.overrides;
    if (!(await askConfirm({ title: reset ? 'Reset agent' : 'Delete agent', message: reset ? `Reset "${a.name}" to its default?` : `Delete the agent "${a.name}"?`, confirmLabel: reset ? 'Reset' : 'Delete', danger: true }))) return;
    await api.agentsDelete(a.name); load();
  };
  if (ed) return <AgentEditor agent={ed} chatGroups={chatGroups} onDone={(saved) => { setEd(null); if (saved) load(); }} />;
  return (
    <>
      {showToggles && (
        <Group>
          <SwitchRow label="Let Artemis use agents" description={'Artemis plans the work, hands parts to the agents below (up to 4 at once, one level deep) and merges the results. Add "use the Reviewer" to a request to have the output checked.'}
            checked={s.delegateEnabled !== false} onChange={put('delegateEnabled')} />
          <SwitchRow label="Ask before agents write files" description={'On: every write by an agent asks you in the chat ("Coder agent wants to..."). Off: agents write without asking when edits are auto-allowed. Deleting is never available to agents.'}
            checked={s.agentWriteApproval !== false} onChange={put('agentWriteApproval')} />
        </Group>
      )}
      <Group title={listTitle} className="agents-mine" footer={<>Agents are plain .md files (name, description, model, tools, then instructions), like skills. Per-project agents go in &lt;project&gt;/.artemis/agents/.</>}>
        {list.map((a) => (
          <Row key={a.slug + a.source} label={<><span className="agent-mono" aria-hidden="true">{a.name.slice(0, 1).toUpperCase()}</span>{a.name}{a.role ? <span className="pref-dim"> · {a.role}</span> : null} <span className="pref-tag">{a.builtin ? 'built-in' : a.overrides ? 'edited' : a.source}</span></>}
            description={<>{a.description}<span className="agent-chips"><span>{modelLabel(a.model)}</span>{a.tools.map((t) => <span key={t}>{t}</span>)}</span></>}>
            <div className="pref-inline">
              <button type="button" className="pref-btn" onClick={() => setEd({ ...a })} aria-label={'Edit ' + a.name}>Edit…</button>
              {!a.builtin && <button type="button" className="pref-btn" onClick={() => remove(a)}>{a.overrides ? 'Reset' : 'Delete'}</button>}
            </div>
          </Row>
        ))}
        <Row>
          <div className="pref-inline">
            <button type="button" className="pref-btn" onClick={() => setEd({ ...AGENT_BLANK })}><Icon name="plus" size={13} /> New agent…</button>
            <button type="button" className="pref-btn" onClick={() => api.agentsReveal()}>Open agents folder</button>
          </div>
        </Row>
      </Group>
    </>
  );
}

/** The form for one agent (new or existing). onDone(saved) closes it. */
export function AgentEditor({ agent, chatGroups, onDone }) {
  const api = window.api;
  const [ed, setEd] = useState(agent);
  const [groups, setGroups] = useState([]);
  const [err, setErr] = useState('');
  useEffect(() => { api.agentsGroups().then(setGroups).catch(() => {}); }, []);
  const save = async () => {
    setErr('');
    const r = await api.agentsSave({ name: ed.name, role: ed.role, description: ed.description, model: ed.model, tools: ed.tools, body: ed.body });
    if (!r.ok) return setErr(r.error);
    onDone(true);
  };
  const remove = async () => {
    const reset = !!agent.overrides;
    if (!(await askConfirm({ title: reset ? 'Reset agent' : 'Delete agent', message: reset ? `Reset "${agent.name}" to its default?` : `Delete the agent "${agent.name}"?`, confirmLabel: reset ? 'Reset' : 'Delete', danger: true }))) return;
    await api.agentsDelete(agent.name);
    onDone(true);
  };
  const toggle = (g) => setEd({ ...ed, tools: ed.tools.includes(g) ? ed.tools.filter((x) => x !== g) : [...ed.tools, g] });
  return (
    <>
      <Group title={ed.isNew ? 'New agent' : ed.name}>
        <Row label="Name"><input value={ed.name} disabled={!ed.isNew} onChange={(e) => setEd({ ...ed, name: e.target.value })} placeholder="Athena" /></Row>
        <Row label="Role" description="Optional title. You can ask for the agent by name or by role."><input value={ed.role || ''} onChange={(e) => setEd({ ...ed, role: e.target.value })} placeholder="Researcher" /></Row>
        <Row stacked label="What is it for?" description="One line. Artemis reads this to decide when to hand work to this agent."><input value={ed.description} onChange={(e) => setEd({ ...ed, description: e.target.value })} placeholder="Finds and checks facts on the web" /></Row>
        <Row label="Model" description="Put cheap jobs (search, summaries) on a cheap model and hard jobs on a strong one. This is what cuts the cost.">
          <ModelPicker value={ed.model} groups={chatGroups} onChange={(m) => setEd({ ...ed, model: m })} emptyLabel="Same as chat" up={false} align="right" />
        </Row>
      </Group>
      <Group title="Tools">
        {groups.map((g) => <SwitchRow key={g.id} label={g.label} checked={ed.tools.includes(g.id)} onChange={() => toggle(g.id)} />)}
      </Group>
      <Group title="Instructions">
        <Row stacked><textarea rows={9} className="mono" aria-label="Instructions" value={ed.body} onChange={(e) => setEd({ ...ed, body: e.target.value })} spellCheck={false} /></Row>
      </Group>
      {err && <Note tone="err">{err}</Note>}
      <Buttons end>{!agent.isNew && (!agent.builtin || agent.overrides) && <button type="button" className="pref-btn" style={{ marginRight: 'auto' }} onClick={remove}>{agent.overrides ? 'Reset to default' : 'Delete agent'}</button>}<button type="button" className="pref-btn" onClick={() => onDone(false)}>Cancel</button><button type="button" className="pref-btn primary" onClick={save}>Save agent</button></Buttons>
    </>
  );
}
