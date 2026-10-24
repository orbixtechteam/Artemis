// Appearance themes as plain JSON, so a palette can be added or tweaked without rebuilding the app.
// Sources, later wins by id: built-in electron/themes -> <userData>/themes -> <project folder>/.artemis/themes.
// A file looks like { "id": "my-theme", "name": "My theme", "group": "Gods", "dark": true,
//   "preview": ["#130808", "#c9923a", "#8c1c1c"], "vars": { "--bg": "#130808", ... } }.
// A palette is two files with the same "family" (one "dark": true, one false); Appearance then follows
// Light / Dark / Automatic. A file without a family is a single custom theme with a fixed scheme.
// "system" is reserved: it follows the OS and has no palette of its own.
const fs = require('fs');
const path = require('path');

const MAX_NAME = 60, MAX_GROUP = 40, MAX_VARS = 80, MAX_VALUE = 120, MAX_FILES = 200;
const RESERVED = new Set(['system']);
const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const VAR_RE = /^--[a-z0-9-]{1,40}$/;
// values end up in a stylesheet, so anything that could break out of a declaration is refused
const BLOCKED = /[;{}<>@\\]|url\s*\(|expression|javascript:/i;

const builtinDir = () => path.join(__dirname, 'themes');

// Every palette must define these, or the app would fall back to an empty variable. Keys a theme file
// leaves out get the light defaults, so a half-filled file still renders (copy a built-in file to be safe).
const CORE = {
  '--theme-bg': '#faf9f5', '--theme-side': '#f0eee6', '--theme-panel': '#ffffff', '--theme-user': '#f0eee6',
  '--theme-code': '#f5f4ee', '--theme-text': '#1f1e1d', '--theme-muted': '#73726c', '--theme-border': '#e3e0d5',
  '--theme-accent': '#c96442', '--theme-accent-text': '#ffffff', '--theme-hover': 'rgba(0,0,0,.05)',
  '--theme-active': 'rgba(0,0,0,.08)', '--theme-add': 'rgba(46,125,79,.14)', '--theme-del': 'rgba(179,38,30,.13)',
};

const cleanVars = (raw) => {
  const out = {};
  for (const [k, v] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
    if (Object.keys(out).length >= MAX_VARS) break;
    const key = String(k).trim();
    const val = String(v == null ? '' : v).trim();
    if (!VAR_RE.test(key) || !val || val.length > MAX_VALUE) continue;
    if (BLOCKED.test(val)) continue;
    out[key] = val;
  }
  return out;
};

/** Reads one theme file; returns null when it is not usable (never throws). */
function parseFile(file) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || path.basename(file, '.json')).trim().toLowerCase();
  if (!ID_RE.test(id) || RESERVED.has(id)) return null;
  const vars = cleanVars(raw.vars);
  if (!Object.keys(vars).length) return null;
  const preview = Array.isArray(raw.preview) ? raw.preview.filter((c) => typeof c === 'string').slice(0, 3) : [];
  const family = String(raw.family || '').trim().toLowerCase();
  return {
    id,
    name: String(raw.name || id).slice(0, MAX_NAME),
    ...(ID_RE.test(family) && !RESERVED.has(family) ? { family } : {}),
    ...(raw.about ? { about: String(raw.about).slice(0, MAX_NAME) } : {}),
    group: String(raw.group || 'My themes').slice(0, MAX_GROUP),
    dark: raw.dark !== false,
    preview: preview.length === 3 ? preview : [vars['--theme-bg'], vars['--theme-accent'], vars['--theme-panel'] || vars['--theme-side']],
    vars: { ...CORE, ...vars },
    file,
  };
}

const jsonFiles = (dir) => {
  try {
    return fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.json')).sort().slice(0, MAX_FILES).map((f) => path.join(dir, f));
  } catch { return []; }
};

/** dirs: { user, project } (built-in is always read). Returns { themes, errors, folder, count }. */
function list(dirs = {}) {
  const sources = [['builtin', builtinDir()], ['user', dirs.user], ['project', dirs.project]].filter(([, d]) => d);
  const byId = new Map();
  const errors = [];
  let count = 0;
  for (const [source, dir] of sources) {
    for (const file of jsonFiles(dir)) {
      count++;
      const theme = parseFile(file);
      if (!theme) { errors.push({ file, source }); continue; }
      byId.set(theme.id, { ...theme, source });
    }
  }
  const order = (t) => (t.source === 'builtin' ? 0 : t.source === 'user' ? 1 : 2);
  const themes = [...byId.values()].sort((a, b) => order(a) - order(b) || a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
  return { themes, errors, folder: dirs.project || dirs.user || builtinDir(), count };
}

/** The folder Settings should open: the project one when the project has a folder, else the user one. */
function folders(dirs = {}) {
  return { user: dirs.user || null, project: dirs.project || null };
}

/** Copies picked .json files into the target folder (project wins when it exists). */
function importFiles(files, dirs = {}) {
  const dir = dirs.project || dirs.user;
  if (!dir) throw new Error('No themes folder to import into.');
  fs.mkdirSync(dir, { recursive: true });
  const added = [];
  for (const file of (files || []).slice(0, MAX_FILES)) {
    const src = String(file || '');
    if (!src.toLowerCase().endsWith('.json') || !fs.existsSync(src)) continue;
    const theme = parseFile(src);
    if (!theme || RESERVED.has(theme.id)) throw new Error(`Not a theme file (or id "system"): ${path.basename(src)}`);
    const dest = path.join(dir, theme.id + '.json');
    const tmp = dest + '.tmp-' + Date.now().toString(36);
    fs.writeFileSync(tmp, JSON.stringify({ ...theme, vars: theme.vars }, null, 2) + '\n');
    fs.renameSync(tmp, dest);
    added.push(theme.id);
  }
  if (!added.length) throw new Error('No theme .json file selected.');
  return { added, folder: dir, ...list(dirs) };
}

/** Deletes one theme file from the folder that holds it (only inside our own theme folders). */
function removeFile(file, dirs = {}) {
  const target = path.resolve(String(file || ''));
  const allowed = [dirs.user, dirs.project].filter(Boolean).map((d) => path.resolve(d));
  if (!target.toLowerCase().endsWith('.json') || !allowed.some((d) => target.startsWith(d + path.sep))) throw new Error('That file is not inside a themes folder.');
  fs.unlinkSync(target);
  return list(dirs);
}

/** Light or dark for the native window chrome: a fixed theme wins, else Appearance (old settings only had theme). */
function nativeSource(settings = {}, themeList = []) {
  const id = settings.theme || 'system';
  const fixed = !['system', 'light', 'dark'].includes(id) && themeList.find((t) => t.id === id);
  if (fixed) return fixed.dark === false ? 'light' : 'dark';
  const mode = id === 'light' || id === 'dark' ? id : settings.appearance || 'system'; // theme light/dark (older settings, MCP) forces the scheme
  return ['light', 'dark'].includes(mode) ? mode : 'system';
}

module.exports = { list, folders, importFiles, removeFile, parseFile, cleanVars, nativeSource, builtinDir, RESERVED };