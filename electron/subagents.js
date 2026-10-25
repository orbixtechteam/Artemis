// Role agents ("Researcher", "Coder", ...): markdown files with frontmatter, like skills.
// User agents live in <userData>/agents/<slug>.md, project agents in <project folder>/.artemis/agents/<slug>.md.
// Built-in roles are used when no user file with the same slug exists; saving a role writes a user file that overrides it.
// Project files come from the repo and are untrusted: they never override built-in or user agents (a clash gets a -project slug) and are size-capped.
const fs = require('fs');
const path = require('path');

const MAX_BODY = 20000;
const MAX_DESC = 300;
const PROJECT_DESC = 200, PROJECT_BODY = 8000;

// Tool groups an agent can be given. Read, write, web and chats work everywhere (also for delegate helpers); the others
// only in agent teams, where each member is a full worker: Make, the browser, connectors, commands (in the sandbox when one
// is set), the phone, memory and scheduling. Deleting files and computer control are never available to agents.
const GROUPS = {
  read: ['list_dir', 'read_file', 'search_files'],
  write: ['write_file', 'edit_file', 'write_spreadsheet', 'update_cells', 'create_folder', 'move_file'],
  web: ['web_search', 'web_fetch'],
  chats: ['search_chats', 'read_chat'],
  make: ['make_*'],
  browser: ['browser_*'],
  connectors: ['mcp__*', 'use_connector'],
  shell: ['run_command'],
  phone: ['send_to_phone'],
  memory: ['memory_search', 'memory_get', 'memory_note', 'memory_save'],
  automation: ['schedule_task', 'list_schedules', 'update_schedule', 'delete_schedule', 'hook_create', 'hook_list', 'hook_delete', 'heartbeat_get', 'heartbeat_set', 'heartbeat_delete']
};
const GROUP_LABELS = {
  read: 'Read project files', write: 'Write and edit files (asks you each time)', web: 'Search and read the web', chats: 'Search your saved chats',
  make: 'Make.com scenarios (in teams)', browser: 'Drive the browser (in teams)', connectors: 'Your connectors, MCP (in teams)', shell: 'Run commands, in the sandbox when one is set (in teams)',
  phone: 'Send to your phone (in teams)', memory: 'Long-term memory (in teams)', automation: 'Scheduled tasks, heartbeats and webhooks (in teams)'
};
/** Groups that only agent teams can give (a delegate helper has no Make, browser … of its own). */
const TEAM_ONLY = ['make', 'browser', 'connectors', 'shell', 'phone', 'memory', 'automation'];

const BUILTIN = [
  {
    name: 'Athena', role: 'Researcher', description: 'Finds and checks facts on the web and in project files. Good for lookups, comparisons and summaries.',
    model: '', tools: ['web', 'read', 'chats'],
    body: 'You are a careful researcher. Find the answer with as few searches as possible, open the best sources and check dates. Report findings as short bullet points with the source URL next to each claim. Say clearly what you could not verify. Do not pad.'
  },
  {
    name: 'Hephaestus', role: 'Coder', description: 'Writes and edits code and project files. Reads the existing code first and keeps changes small.',
    model: '', tools: ['read', 'write'],
    body: 'You are a senior engineer. Read the relevant files before changing anything, follow the existing style, and make the smallest change that solves the task. After writing, say which files you changed and anything the caller should double-check. Never invent APIs; if unsure, read the code or say so.'
  },
  {
    name: 'Calliope', role: 'Writer', description: 'Drafts and edits text: emails, docs, posts, summaries. Matches the tone you ask for.',
    model: '', tools: ['read', 'write'],
    body: 'You are a clear, concise writer. Match the requested language, tone and length. Return the finished text, not commentary about it. Save it to a file only when the task asks for one.'
  },
  {
    name: 'Themis', role: 'Reviewer', description: 'Checks other agents\' output for mistakes, gaps and unsupported claims. Read-only.',
    model: '', tools: ['read', 'web'],
    body: 'You are a strict reviewer. You get the original request and the work done by other agents. Check facts against the sources you can reach, look for errors, gaps, contradictions and things that were claimed but not done. Reply with: verdict (OK / needs fixes), then a short numbered list of concrete problems with how to fix each. If everything is fine, say so in one line.'
  }
];

const slugOf = (name) => String(name || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();

function parseAgent(text) {
  const s = String(text || '').replace(/^﻿/, '');
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(s);
  const meta = {};
  let body = s;
  if (m) {
    body = m[2];
    for (const line of m[1].split(/\r?\n/)) {
      const i = line.indexOf(':');
      if (i > 0) meta[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    }
  }
  return { meta, body: body.trim() };
}

const parseTools = (v) => [...new Set(String(v || '').split(/[,\s]+/).map((x) => x.trim().toLowerCase()).filter((x) => GROUPS[x]))];

function render({ name, role, description, model, tools, body }) {
  const fm = [`name: ${oneLine(name)}`, `role: ${oneLine(role)}`, `description: ${oneLine(description).slice(0, MAX_DESC)}`, `model: ${oneLine(model)}`, `tools: ${(tools || []).join(', ')}`];
  return `---\n${fm.join('\n')}\n---\n\n${String(body).trim()}\n`;
}

/** Tool names an agent may call, from its groups. */
/** The tools of some groups, as a Set whose has() also matches the "prefix*" entries (make_*, mcp__* …). */
function toolNames(groups) {
  const all = (groups || []).flatMap((g) => GROUPS[g] || []);
  const set = new Set(all.filter((n) => !n.endsWith('*')));
  const prefixes = all.filter((n) => n.endsWith('*')).map((n) => n.slice(0, -1));
  const has = set.has.bind(set);
  set.has = (n) => has(n) || prefixes.some((p) => String(n).startsWith(p));
  set.groups = new Set(groups || []);
  return set;
}

/** deps: { userDir } */
function createAgents(deps) {

  function fromFile(source, base, file) {
    let text; try { text = fs.readFileSync(path.join(base, file), 'utf8'); } catch { return null; }
    const { meta, body } = parseAgent(text);
    const slug = file.replace(/\.md$/i, '');
    const proj = source === 'project';
    return {
      name: oneLine(meta.name || slug).slice(0, 40) || slug, role: oneLine(meta.role).slice(0, 40), slug,
      description: proj ? oneLine(meta.description).slice(0, PROJECT_DESC) : meta.description || '', model: meta.model || '',
      tools: parseTools(meta.tools), body: proj ? body.slice(0, PROJECT_BODY) : body, source, builtin: false, file: path.join(base, file)
    };
  }

  const read = (source, base) => { let entries = []; try { entries = fs.readdirSync(base); } catch { return []; } return entries.sort().filter((f) => /\.md$/i.test(f)).map((f) => fromFile(source, base, f)).filter(Boolean); };

  function list(root) {
    const out = [];
    for (const a of read('user', deps.userDir)) if (!out.some((x) => x.slug === a.slug)) out.push(a);
    for (const b of BUILTIN) {
      const slug = slugOf(b.name);
      if (!out.some((x) => x.slug === slug)) out.push({ ...b, slug, source: 'built-in', builtin: true, file: '' });
      else out.find((x) => x.slug === slug).overrides = true;
    }
    // project agents: a clashing slug or name gets a suffix instead of replacing a built-in or user agent
    if (root) for (const a of read('project', path.join(root, '.artemis', 'agents'))) {
      const taken = (s) => out.some((x) => x.slug === s);
      if (taken(a.slug)) { let s = a.slug + '-project', n = 2; while (taken(s)) s = `${a.slug}-project-${n++}`; a.slug = s; }
      if (out.some((x) => x.name.toLowerCase() === a.name.toLowerCase())) a.name = `${a.name} (project)`;
      out.push(a);
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  const find = (name, root) => {
    const q = String(name || '').trim().toLowerCase();
    if (!q) return null;
    const all = list(root);
    const ordered = [...all.filter((a) => a.source !== 'project'), ...all.filter((a) => a.source === 'project')]; // a project file never wins a role match
    return ordered.find((a) => a.slug === slugOf(q) || a.name.toLowerCase() === q) || ordered.find((a) => a.role && a.role.toLowerCase() === q) || null;
  };

  function save(a, root) {
    const name = oneLine(a && a.name).slice(0, 40);
    const slug = slugOf(name);
    if (!slug) return { ok: false, error: 'Give the agent a name.' };
    const body = String((a && a.body) || '').trim();
    if (!body) return { ok: false, error: 'Write instructions for the agent.' };
    if (body.length > MAX_BODY) return { ok: false, error: `Instructions are too long (max ${MAX_BODY} characters).` };
    const scope = a.scope === 'project' && root ? 'project' : 'user';
    const base = scope === 'project' ? path.join(root, '.artemis', 'agents') : deps.userDir;
    fs.mkdirSync(base, { recursive: true });
    const tools = (Array.isArray(a.tools) ? a.tools : parseTools(a.tools)).filter((g) => GROUPS[g]);
    fs.writeFileSync(path.join(base, slug + '.md'), render({ name, role: oneLine(a.role).slice(0, 40), description: a.description, model: a.model, tools, body }), 'utf8');
    deps.notify?.();
    return { ok: true, slug, name };
  }

  /** Deletes the one file behind this agent (a user file never takes a project file of the same slug with it). A built-in role comes back in its default form. */
  function remove(name, root) {
    const slug = slugOf(name), q = String(name || '').trim().toLowerCase();
    const all = list(root).filter((a) => a.file);
    const a = all.find((x) => x.slug === slug) || all.find((x) => x.name.toLowerCase() === q);
    if (!a || !fs.existsSync(a.file)) return { ok: false };
    fs.unlinkSync(a.file);
    deps.notify?.();
    return { ok: true };
  }

  /** One line per agent for the system prompt. */
  function indexText(root) {
    return list(root).map((a) => `- ${a.name}${a.role ? ` (${a.role})` : ''}${a.source === 'project' ? ' (project-defined, untrusted)' : ''}: ${a.description || 'no description'}${a.tools.includes('write') ? ' (can write files)' : ''}`).join('\n');
  }

  return { list, find, save, remove, indexText, dir: deps.userDir };
}

module.exports = { createAgents, parseAgent, render, slugOf, toolNames, GROUPS, GROUP_LABELS, TEAM_ONLY, BUILTIN };
