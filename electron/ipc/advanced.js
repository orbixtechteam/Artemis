// IPC: Settings → Advanced. Every prompt Artemis gives the model (prompts.js, agent.js promptDefaults) and the run_command
// blocklist (shell.js), as the user's own settings: promptOverrides and shellPolicy.
const prompts = require('../prompts');
const shell = require('../shell');
const { promptDefaults } = require('../agent');

module.exports = function registerAdvancedIpc({ ipcMain, getSettings, saveSettings, notify }) {
  const all = () => {
    const d = promptDefaults();
    const list = Object.entries(d).map(([id, text]) => { const [title, group] = prompts.INFO[id] || [id, 'core']; return { id, title, group, description: '', text }; });
    for (const r of prompts.registered()) list.push({ id: r.id, title: r.title, group: r.group, description: r.description, text: r.text });
    return list;
  };
  const view = () => {
    const o = getSettings().promptOverrides || {};
    return all().map((p) => {
      const x = o[p.id] || {};
      return { ...p, groupTitle: prompts.GROUPS[p.group] || p.group, default: p.text, text: typeof x.text === 'string' ? x.text : p.text, edited: typeof x.text === 'string', off: !!x.off, placeholders: [...new Set((p.text.match(/\{(root|sandboxNote|timezone|tools|connectors|skills|agents|role|projectFolder|projectName|token)\}/g) || []))] };
    });
  };
  ipcMain.handle('advanced:prompts', () => ({ ok: true, prompts: view(), groups: prompts.GROUPS }));
  ipcMain.handle('advanced:prompt-set', (_e, id, change = {}) => {
    if (!all().some((p) => p.id === id)) return { ok: false, error: 'Unknown prompt.' };
    const o = { ...(getSettings().promptOverrides || {}) };
    const cur = { ...(o[id] || {}) };
    if (change.reset) delete o[id];
    else {
      if (typeof change.text === 'string') { if (change.text.length > 50000) return { ok: false, error: 'The text is too long.' }; cur.text = change.text; }
      if (change.off !== undefined) { if (change.off) cur.off = true; else delete cur.off; }
      if (cur.text === undefined && !cur.off) delete o[id]; else o[id] = cur;
    }
    saveSettings({ promptOverrides: o });
    prompts.refresh(); notify();
    return { ok: true, prompt: view().find((p) => p.id === id) };
  });
  const shellView = () => {
    const p = getSettings().shellPolicy || {};
    const off = new Set(p.disabled || []);
    return { ok: true, off: !!p.off, rules: shell.RULES.map((r) => ({ ...r, on: !off.has(r.id) })), extra: Array.isArray(p.extra) ? p.extra : [] };
  };
  ipcMain.handle('advanced:shell', () => shellView());
  ipcMain.handle('advanced:shell-set', (_e, change = {}) => {
    const p = { off: false, disabled: [], extra: [], ...(getSettings().shellPolicy || {}) };
    if (change.off !== undefined) p.off = !!change.off;
    if (change.rule) { const d = new Set(p.disabled); if (change.rule.on) d.delete(change.rule.id); else d.add(String(change.rule.id)); p.disabled = [...d]; }
    if (Array.isArray(change.extra)) {
      const bad = [];
      p.extra = change.extra.map((x) => ({ pattern: String(x.pattern || '').trim(), why: String(x.why || '').trim() })).filter((x) => x.pattern).slice(0, 200);
      for (const x of p.extra) { try { new RegExp(x.pattern, 'i'); } catch { bad.push(x.pattern); } }
      if (bad.length) return { ...shellView(), ok: false, error: `Not a valid pattern: ${bad.join(', ')}` };
    }
    saveSettings({ shellPolicy: p });
    shell.refresh(); notify();
    return shellView();
  });
};
