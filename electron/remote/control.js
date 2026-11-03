// Settings and state that can be changed from the phone (used by the Telegram bot).
const TOOL_KEYS = {
  web: ['webEnabled', 'Web search'],
  terminal: ['shellEnabled', 'Terminal'],
  computer: ['computerEnabled', 'Computer control'],
  memory: ['memoryEnabled', 'Memory'],
  connectors: ['connectorsEnabled', 'Connectors'],
  tools: ['toolsEnabled', 'Tools in new chats'],
  notes: ['notesAi', 'Notes knowledge base'],
  auto: ['autoApproveEdits', 'Auto-approve file edits']
};

/** deps: { getSettings, saveSettings, models:[[id,name]], readStore(name), mcpStatus(), memory:{list,add,remove}, isBusy() } */
function createControl(deps) {
  const models = () => (typeof deps.models === 'function' ? deps.models() : deps.models).map(([id, name]) => ({ id, name }));
  const settings = () => deps.getSettings();
  // The model picked from the phone, as long as it is still in the list (its provider may have been switched off since);
  // otherwise the Default model from Settings.
  // A desktop chat continued from the phone keeps its own model.
  const currentModel = () => {
    const lm = deps.linkedModel && deps.linkedModel();
    if (lm) return typeof deps.liveModel === 'function' ? deps.liveModel(lm) : lm;
    const st = settings(); const r = st.remoteModel;
    const ids = models().map((x) => x.id);
    const pick = r && (ids.includes(r) || /^[\w.\-]+\/[\w.\-:]+$/.test(r) && !/^prov:/.test(r)) ? r : st.model;
    return typeof deps.liveModel === 'function' ? deps.liveModel(pick) : pick;
  };
  const projects = () => (deps.readStore('projects') || []).map((p) => ({ id: p.id, name: p.name, folder: p.folder || '', instructions: p.instructions || '' }));

  function resolveProject() {
    const s = settings();
    const p = s.remoteProjectId && projects().find((x) => x.id === s.remoteProjectId);
    if (p) return p;
    return s.remoteFolder ? { id: '', name: 'Phone folder', folder: s.remoteFolder, instructions: '' } : null;
  }

  function setModel(query) {
    const save = (id) => { if (deps.linkedModel && deps.linkedModel()) deps.setLinkedModel(id); else deps.saveSettings({ remoteModel: id }); };
    const q = String(query || '').trim();
    if (!q) return { ok: false, error: 'Tell me which model.' };
    const list = models();
    if (/^\d+$/.test(q)) {
      const m = list[Number(q) - 1];
      if (m) { save(m.id); return { ok: true, model: m.id, name: m.name }; }
    }
    const lower = q.toLowerCase();
    const exact = list.find((m) => m.id.toLowerCase() === lower);
    if (exact) { save(exact.id); return { ok: true, model: exact.id, name: exact.name }; }
    const hits = list.filter((m) => m.id.toLowerCase().includes(lower) || m.name.toLowerCase().includes(lower));
    if (hits.length === 1) { save(hits[0].id); return { ok: true, model: hits[0].id, name: hits[0].name }; }
    if (hits.length > 1) return { ok: false, error: `Several models match "${q}": ${hits.map((m) => m.id).join(', ')}`, matches: hits };
    if (/^[\w.\-]+\/[\w.\-:]+$/.test(q)) { save(q); return { ok: true, model: q, name: q, custom: true }; }
    return { ok: false, error: `No model matches "${q}". Send /model to see the list.` };
  }

  function setProject(id) {
    if (!id) { deps.saveSettings({ remoteProjectId: '' }); return { ok: true, project: null }; }
    const p = projects().find((x) => x.id === id || x.name.toLowerCase() === String(id).toLowerCase());
    if (!p) return { ok: false, error: 'Project not found.' };
    deps.saveSettings({ remoteProjectId: p.id });
    return { ok: true, project: p };
  }

  function tools() {
    const s = settings();
    return Object.entries(TOOL_KEYS).map(([key, [field, label]]) => ({ key, label, on: key === 'auto' ? !!s[field] : s[field] !== false }));
  }
  function toggle(key, value) {
    const def = TOOL_KEYS[key];
    if (!def) return { ok: false, error: `Unknown switch "${key}". Use: ${Object.keys(TOOL_KEYS).join(', ')}.` };
    const cur = tools().find((t) => t.key === key).on;
    const next = value === undefined ? !cur : !!value;
    deps.saveSettings({ [def[0]]: next });
    return { ok: true, key, label: def[1], on: next };
  }

  // model providers added in Settings → Providers
  const providers = () => (deps.providers ? deps.providers.list() : []);
  function toggleProvider(key, value) {
    if (!deps.providers) return { ok: false, error: 'Providers are not available.' };
    const list = providers();
    const q = String(key || '').toLowerCase();
    const p = list[Number(q)] && /^\d+$/.test(q) ? list[Number(q)] : list.find((x) => x.key === key || x.name.toLowerCase() === q || x.name.toLowerCase().includes(q));
    if (!p) return { ok: false, error: `No provider "${key}". Send /providers to see them.` };
    const next = value === undefined ? !p.on : !!value;
    deps.providers.set(p.key, next);
    return { ok: true, name: p.name, on: next };
  }

  function info() {
    const s = settings();
    const m = models().find((x) => x.id === currentModel());
    const p = resolveProject();
    return {
      model: currentModel(), modelName: m ? m.name : currentModel(), project: p, tools: tools(),
      connectors: deps.mcpStatus().map((c) => ({ name: c.name, state: c.state, tools: c.tools.length })),
      memoryCount: (deps.memory.list() || []).length, busy: deps.isBusy(), fullControl: !!s.remoteAllowDangerous
    };
  }

  function statusText() {
    const i = info();
    const on = i.tools.filter((t) => t.on).map((t) => t.label).join(', ') || 'none';
    return [
      `Model: ${i.modelName}`,
      `Project: ${i.project ? `${i.project.name}${i.project.folder ? ' (' + i.project.folder + ')' : ''}` : 'none'}`,
      `Switches on: ${on}`,
      `Connectors: ${i.connectors.length ? i.connectors.map((c) => `${c.name} (${c.state}, ${c.tools} tools)`).join('; ') : 'none'}`,
      `Memory: ${i.memoryCount} item${i.memoryCount === 1 ? '' : 's'}`,
      `Phone has full control: ${i.fullControl ? 'yes' : 'no'}`,
      `Task running: ${i.busy ? 'yes' : 'no'}`
    ].join('\n');
  }

  return {
    providers, toggleProvider, models, currentModel, setModel, projects, setProject, resolveProject, tools, toggle, info, statusText,
    memoryList: () => deps.memory.list() || [],
    memoryAdd: (text) => deps.memory.add(String(text).slice(0, 500)),
    memoryRemove: (id) => deps.memory.remove(String(id)),
    TOOL_KEYS
  };
}

module.exports = { createControl, TOOL_KEYS };
