import React, { useEffect, useState } from 'react';
import Select from './Select.jsx';
import { askConfirm } from '../lib/dialog.js';
import { Icon } from './Icons.jsx';
import ListTools from './ListTools.jsx';
import { filterSort } from '../lib/listfilter.mjs';

const api = window.api;
const blank = () => ({ name: '', description: '', body: '', scope: 'user', isNew: true });

function Editor({ skill, projects, onClose, onSaved }) {
  const [s, setS] = useState(skill);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setS({ ...s, [k]: e.target.value });
  const root = s.projectFolder || '';
  const save = async () => {
    setBusy(true); setErr('');
    try {
      const r = await api.skillsSave({ name: s.name, description: s.description, body: s.body, scope: s.scope }, root);
      if (!r.ok) return setErr(r.error);
      onSaved();
    } finally { setBusy(false); }
  };
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal wide">
        <h2>{s.isNew ? 'New skill' : 'Edit skill'}</h2>
        <label className="field"><span>Name</span><input value={s.name} onChange={set('name')} disabled={!s.isNew} placeholder="Weekly report" /></label>
        <label className="field"><span>When should Artemis use it?</span><input value={s.description} onChange={set('description')} placeholder="Use when I ask for the weekly sales report" /><small>One line. It is shown to the assistant in every chat, so keep it short and specific.</small></label>
        <label className="field"><span>Instructions</span><textarea rows={12} value={s.body} onChange={set('body')} placeholder={'1. Open the latest sales sheet\n2. Summarize totals per region\n3. Write 5 bullet points, no more'} spellCheck={false} style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12.5 }} /></label>
        {s.isNew && projects.some((p) => p.folder) && (
          <label className="field"><span>Available in</span>
            <Select value={s.projectFolder || ''} onChange={(e) => setS({ ...s, projectFolder: e.target.value, scope: e.target.value ? 'project' : 'user' })}>
              <option value="">Every chat</option>
              {projects.filter((p) => p.folder).map((p) => <option key={p.id} value={p.folder}>Only in project "{p.name}"</option>)}
            </Select>
          </label>
        )}
        {err && <small className="hint err">{err}</small>}
        <div className="actions-row"><span style={{ flex: 1 }} /><button onClick={onClose}>Cancel</button><button className="primary" onClick={save} disabled={busy}>Save</button></div>
      </div>
    </div>
  );
}

export default function SkillsView({ projects = [] }) {
  const [list, setList] = useState([]);
  const [edit, setEdit] = useState(null);
  const [msg, setMsg] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('new');
  const shown = filterSort(list, { q, sort, text: (sk) => `${sk.name} ${sk.description}`, at: (sk) => sk.updated });
  const folders = projects.filter((p) => p.folder);
  const load = async () => {
    try {
      const out = await api.skillsList();
      for (const p of folders) for (const sk of (await api.skillsList(p.folder)) || []) if (sk.source === 'project') out.push({ ...sk, projectFolder: p.folder, projectName: p.name });
      setList(out);
    } catch {}
  };
  useEffect(() => { load(); const off = api.onSkillsChanged(load); return () => off && off(); }, [projects.length]);
  const open = async (sk) => { const full = await api.skillsGet(sk.name, sk.projectFolder); if (full) setEdit({ ...full, scope: full.source, projectFolder: sk.projectFolder }); };
  const doImport = async () => {
    const r = await api.skillsImport();
    if (r.canceled) return;
    setMsg(r.ok ? `Imported "${r.name}".` : r.error);
    load();
  };
  return (
    <div className="page">
      <div className="page-head">
        <h1>Skills</h1>
        <div className="row" style={{ gap: 8, flex: 'none' }}>
          <button onClick={doImport}>Import…</button>
          <button onClick={() => api.skillsReveal()}>Open folder</button>
          <button className="primary-btn" onClick={() => setEdit(blank())}><Icon name="plus" size={15} /> New skill</button>
        </div>
      </div>
      <p className="page-sub">Skills are saved instructions for tasks you repeat. Artemis loads one when it fits your request. It can also write and improve skills itself when you teach it a routine (turn this off in Settings → Tools &amp; safety).</p>
      {msg && <small className="hint">{msg}</small>}
      {list.length === 0 ? (
        <div className="empty-card">
          <Icon name="sparkle" size={28} />
          <p>No skills yet. Write one, import a SKILL.md, or just tell Artemis "remember how to do this" after a task.</p>
          <button className="primary-btn" onClick={() => setEdit(blank())}>Create your first skill</button>
        </div>
      ) : (
        <>
        <ListTools q={q} onQ={setQ} sort={sort} onSort={setSort} placeholder="Search skills…" />
        {shown.length === 0 && <div className="mem-empty">No skills match your search.</div>}
        <div className="sched-list">
          {shown.map((sk) => (
            <div key={sk.slug + sk.source} className={`sched-row ${sk.enabled ? '' : 'off'}`}>
              <div className="sched-main">
                <div className="sched-name">{sk.name}{sk.byAgent && <span className="sched-badge" title="Written by Artemis">learned</span>}{sk.source === 'project' && <span className="sched-badge">{sk.projectName || 'project'}</span>}</div>
                <div className="sched-sub">{sk.description}</div>
              </div>
              <button className="icon-btn" title="Edit" aria-label="Edit" onClick={() => open(sk)}><Icon name="pencil" size={15} /></button>
              <button className="icon-btn" title="Delete" aria-label="Delete" onClick={() => askConfirm({ title: 'Delete skill', message: `Delete the skill "${sk.name}"?`, confirmLabel: 'Delete', danger: true }).then((ok) => ok && api.skillsDelete(sk.name, sk.projectFolder).then(load))}><Icon name="trash" size={15} /></button>
              <label className="switch" title={sk.enabled ? 'Turn off' : 'Turn on'}><input type="checkbox" checked={sk.enabled} onChange={(e) => api.skillsToggle(sk.name, e.target.checked, sk.projectFolder).then(load)} /><i /></label>
            </div>
          ))}
        </div>
        </>
      )}
      {edit && <Editor skill={edit} projects={projects} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </div>
  );
}
