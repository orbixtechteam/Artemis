import { priceTag } from './cost.js';

// Claude Code / Codex on the user's own plan login (no API key): Artemis runs the installed CLI for each message.
export const CLI_MODELS = [['cli:claude', 'Claude Code · your Claude plan'], ['cli:codex', 'Codex · your ChatGPT plan']];

/** Groups for the chat model picker: one group per enabled provider, then the installed CLIs (clis: { claude, codex }).
 *  Ids look like "prov:<providerId>:<modelId>" or "cli:claude" / "cli:codex". */
export function modelGroups(current, providers = [], clis = {}) {
  const provGroups = providers.filter((p) => p.enabled !== false && (p.models || []).length).map((p) => ({
    label: p.name + (p.local ? ' (on this computer)' : ''),
    items: p.models.map((m) => { const id = `prov:${p.id}:${m.id}`; const t = priceTag(id); const n = m.name || m.id; return [id, t ? `${n} (${t})` : n]; })
  }));
  const cliItems = CLI_MODELS.filter(([id]) => clis[id.slice(4)]);
  if (cliItems.length) provGroups.push({ label: 'Your subscription (no API key)', items: cliItems });
  const inProv = new Set(provGroups.flatMap((g) => g.items.map(([id]) => id)));
  const c = String(current || '');
  if (c.startsWith('cli:') && !inProv.has(c)) {
    const known = CLI_MODELS.find(([id]) => c === id || c.startsWith(id + ':'));
    return [...provGroups, { label: 'Your subscription (no API key)', items: [[c, known ? `${known[1]}${c === known[0] ? '' : ' · ' + c.split(':').slice(2).join(':')}${clis[c.split(':')[1]] === false ? ' (not installed)' : ''}` : c]] }];
  }
  const orphan = c && !inProv.has(c) ? [{ label: 'Unavailable', items: [[c, c.replace(/^prov:[^:]*:/, '') + ' (provider removed or off)']] }] : [];
  return [...provGroups, ...orphan];
}

/** The model new chats start with: the one set in Settings, else the first model of the first enabled provider. */
export function defaultModel(settings, providers = []) {
  if (settings && settings.model) return settings.model;
  const p = providers.find((x) => x.enabled !== false && (x.models || []).length);
  return p ? `prov:${p.id}:${p.models[0].id}` : '';
}
