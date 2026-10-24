// The tools Artemis offers to other apps through its MCP server (see mcp-server.js).
// Rule: anything that only looks, or that changes how Artemis looks and which model it uses, runs at once.
// Anything that can run commands or write the user's notes asks the user first, in a native dialog.
// Permissions that widen what Artemis may do (terminal, computer control, auto-approve, phone, keys, endpoints) can NOT be changed from here.

// Themes are JSON now (electron/themes, <userData>/themes, <project>/.artemis/themes): the live list comes from
// the themes() callback main passes in, this constant is only the fallback when that is missing.
const THEME_IDS = ['system', 'light', 'dark'];

const bool = { type: 'boolean' };
const str = (max = 200) => ({ type: 'string', maxLength: max });
// Accent names; the colours live in src/lib/palette.mjs (ACCENTS). '' = the palette's own accent.
const ACCENT_IDS = ['', 'gold', 'blue', 'violet', 'rose', 'red', 'orange', 'green', 'graphite'];
let themeIds = THEME_IDS;
let paletteIds = ['artemis'];
const knownThemes = () => themeIds;
/** Settings that may be changed from outside. key -> validator that returns the cleaned value or throws. */
const SAFE_SETTINGS = {
  theme: (v) => { if (!knownThemes().includes(v)) throw new Error(`theme must be one of: ${knownThemes().join(', ')}`); return v; },
  palette: (v) => { if (!paletteIds.includes(v)) throw new Error(`palette must be one of: ${paletteIds.join(', ')}`); return v; },
  appearance: (v) => { if (!['system', 'light', 'dark'].includes(v)) throw new Error('appearance must be system, light or dark'); return v; },
  accent: (v) => { v = v == null ? '' : String(v); if (!ACCENT_IDS.includes(v)) throw new Error(`accent must be one of: ${ACCENT_IDS.map((a) => a || '""').join(', ')}`); return v; },
  textSize: (v) => { if (!['small', 'medium', 'large'].includes(v)) throw new Error('textSize must be small, medium or large'); return v; },
  personality: (v) => String(v).slice(0, 60),
  personalityCustom: (v) => String(v).slice(0, 2000),
  model: (v) => { v = String(v).trim(); if (!v) throw new Error('model is empty'); return v.slice(0, 200); }, // the Default model for new chats
  reflectModel: (v) => String(v).slice(0, 200),
  titleModel: (v) => String(v).slice(0, 200), scheduleModel: (v) => String(v).slice(0, 200), autoTitles: Boolean,
  toolsEnabled: Boolean, memoryEnabled: Boolean, webEnabled: Boolean, notesAi: Boolean, autoLearn: Boolean, skillsEnabled: Boolean,
  connectorsEnabled: Boolean, chatSearchEnabled: Boolean, delegateEnabled: Boolean, closeToTray: Boolean, updateAuto: Boolean, updateDownload: Boolean, updateInstall: Boolean,
  voiceAutoRead: Boolean, voiceLanguage: (v) => String(v).slice(0, 12),
  ttsEngine: (v) => { if (!['system', 'openai', 'piper', 'chatterbox'].includes(v)) throw new Error('ttsEngine must be system, openai (Kokoro), chatterbox or piper'); return v; },
  ttsUrl: (v) => { v = String(v).trim().replace(/\/+$/, ''); if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(v)) throw new Error('ttsUrl must be a local address such as http://localhost:8880'); return v; },
  ttsModel: (v) => String(v).slice(0, 100), ttsVoice: (v) => String(v).slice(0, 100), ttsVoiceEn: (v) => String(v).slice(0, 100),
  cbUrl: (v) => { v = String(v).trim().replace(/\/+$/, ''); if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(v)) throw new Error('cbUrl must be a local address such as http://localhost:8004'); return v; },
  cbVoice: (v) => String(v).slice(0, 200), cbHybrid: Boolean,
  cbExaggeration: (v) => Math.min(2, Math.max(0.25, Number(v) || 0.5)), cbCfg: (v) => Math.min(1, Math.max(0, Number(v) || 0)),
  cbTemperature: (v) => Math.min(2, Math.max(0.05, Number(v) || 0.8)), cbSpeed: (v) => Math.min(2, Math.max(0.5, Number(v) || 1)),
  sentinelInterrupt: Boolean, sentinelWake: (v) => String(v).slice(0, 40),
  sentinelEngine: (v) => { if (!['vosk', 'oww'].includes(v)) throw new Error('sentinelEngine must be vosk or oww'); return v; },
  sentinelOwwModel: (v) => { const s = String(v); if (s && !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$/.test(s)) throw new Error('sentinelOwwModel must be the name of an imported wake word model'); return s; },
  sentinelOwwThreshold: (v) => Math.min(0.95, Math.max(0.2, Number(v) || 0.5)), sentinelAuto: Boolean,
  sentinelSensitivity: (v) => { if (!['high', 'normal', 'low'].includes(v)) throw new Error('sentinelSensitivity must be high, normal or low'); return v; },
  profileName: (v) => String(v).slice(0, 100), profileAbout: (v) => String(v).slice(0, 2000)
};
const READ_KEYS = [...Object.keys(SAFE_SETTINGS), 'shellEnabled', 'computerEnabled', 'autoApproveEdits'];

const READ_FS = new Set(['read_file', 'list_dir', 'search_files']);
const GRANT_MS = 10 * 60 * 1000;
// "Allow for 10 minutes" answers. Module scope: main rebuilds the tool list on every request.
const sharedGrants = new Map();

function buildArtemisTools(d) {
  const grants = d.grants || sharedGrants;
  // the theme list is JSON on disk, so refresh it from main whenever the tools are (re)built
  try {
    const live = d.themes && d.themes();
    if (Array.isArray(live) && live.length) {
      themeIds = [...new Set([...THEME_IDS, ...live.map((t) => t.id)])];
      const fams = [...new Set(live.map((t) => t.family).filter(Boolean))];
      if (fams.length) paletteIds = fams;
    }
  } catch {}
  const asked = async (key, title, detail) => {
    if ((grants.get(key) || 0) > Date.now()) return true;
    grants.delete(key);
    const r = await d.confirm({ title, detail, key });
    if (r === 'grant') { grants.set(key, Date.now() + GRANT_MS); return true; }
    return r === true || r === 'once';
  };
  const ro = { readOnlyHint: true };
  const t = (name, description, properties, required, run, annotations) => ({ name: 'artemis_' + name, description, inputSchema: { type: 'object', properties: properties || {}, ...(required && required.length ? { required } : {}) }, ...(annotations ? { annotations } : {}), run });
  const notesOn = () => d.getSettings().notesAi !== false;
  const needNotes = () => { if (!notesOn()) throw new Error('Notes access is switched off in Artemis (Settings → Access → Notes).'); };

  return [
    t('status', 'Shows what Artemis is doing now: default model, theme, text size, which features are on, providers, connectors and memory size.', {}, [], async () => {
      const s = d.getSettings(); const i = d.control.info();
      return { defaultModel: s.model, theme: s.theme, textSize: s.textSize, features: i.tools, providers: d.control.providers(), connectors: i.connectors, memoryItems: i.memoryCount, taskRunning: i.busy };
    }, ro),
    t('get_settings', 'Reads Artemis settings that are safe to show (no keys or tokens). Pass keys to read only some.', { keys: { type: 'array', items: { type: 'string' } } }, [], async ({ keys }) => {
      const s = d.getSettings(); const want = Array.isArray(keys) && keys.length ? keys.filter((k) => READ_KEYS.includes(k)) : READ_KEYS;
      return Object.fromEntries(want.map((k) => [k, s[k]]));
    }, ro),
    t('set_setting', `Changes one Artemis setting. Allowed keys: ${Object.keys(SAFE_SETTINGS).join(', ')}. Permissions that give Artemis more power (terminal, computer control, auto-approve, phone, API keys, endpoints) cannot be changed here: the user does that in Settings → Access.`,
      { key: { type: 'string', enum: Object.keys(SAFE_SETTINGS) }, value: { description: 'New value (boolean, string)' } }, ['key', 'value'], async ({ key, value }) => {
        const check = SAFE_SETTINGS[key];
        if (!check) throw new Error(`"${key}" cannot be changed from here. Allowed: ${Object.keys(SAFE_SETTINGS).join(', ')}`);
        const clean = check === Boolean ? (value === true || value === 'true') : check(value);
        d.applySettings({ [key]: clean });
        return { ok: true, key, value: clean };
      }),
    t('lock', 'Locks Artemis now (the app lock from Settings → Security). It only locks: unlocking needs the password, Touch ID or the owner\'s voice on the computer.', {}, [], async () => {
      if (!d.lockNow) throw new Error('The app lock is not available.');
      const r = d.lockNow();
      if (!r || !r.ok) throw new Error((r && r.error) || 'The app lock is not set up (Settings → Security).');
      return { locked: true };
    }),
    t('set_theme', `Changes the color theme. Themes: ${knownThemes().join(', ')}.`, { theme: { type: 'string', enum: knownThemes() } }, ['theme'], async ({ theme }) => {
      d.applySettings({ theme: SAFE_SETTINGS.theme(theme) }); return { ok: true, theme };
    }),
    t('list_themes', 'Lists the available themes.', {}, [], async () => knownThemes(), ro),
    t('list_providers', 'Lists the model providers added in Settings → Providers and whether each is on.', {}, [], async () => d.control.providers(), ro),
    t('set_provider_enabled', 'Turns a model provider on or off. provider is its key or name.', { provider: str(), enabled: bool }, ['provider', 'enabled'], async ({ provider, enabled }) => {
      const r = d.control.toggleProvider(String(provider), !!enabled); if (!r.ok) throw new Error(r.error); return r;
    }),
    t('list_models', 'Lists the chat models that can be picked (ids as used in set_setting model).', {}, [], async () => d.control.models().map((m) => ({ id: m.id, name: m.name })), ro),
    t('memory_list', 'Lists what Artemis remembers about the user.', {}, [], async () => d.control.memoryList(), ro),
    t('memory_add', 'Saves one short fact about the user to Artemis memory.', { text: str(500) }, ['text'], async ({ text }) => {
      if (!String(text || '').trim()) throw new Error('text is empty'); return d.control.memoryAdd(String(text));
    }),
    t('memory_remove', 'Removes one memory entry by id (see memory_list).', { id: str(60) }, ['id'], async ({ id }) => ({ ok: d.control.memoryRemove(String(id)) })),
    t('skills_list', 'Lists the skills Artemis has (name and when to use).', {}, [], async () => d.skills(), ro),
    t('notes_search', 'Searches the user\'s Notes (markdown). Returns matching notes with a snippet.', { query: str(200) }, ['query'], async ({ query }) => { needNotes(); return d.notes.search(String(query)); }, ro),
    t('notes_list', 'Lists all notes and folders.', {}, [], async () => { needNotes(); return d.notes.list(); }, ro),
    t('notes_read', 'Reads one note by its path (see notes_list).', { path: str(500) }, ['path'], async ({ path }) => { needNotes(); return d.notes.read(String(path), { max: 200000 }); }, ro),
    t('notes_write', 'Replaces the text of an existing note. The user is asked to confirm.', { path: str(500), text: { type: 'string' } }, ['path', 'text'], async ({ path, text }) => {
      needNotes();
      if (!(await asked('notes', 'Let an outside app edit a note?', `Replace the text of "${path}" (${String(text).length} characters).`))) throw new Error('The user declined.');
      return d.notes.write(String(path), String(text));
    }),
    t('notes_create', 'Creates a new note (optionally in a folder). The user is asked to confirm.', { name: str(200), folder: str(500), text: { type: 'string' } }, ['name'], async ({ name, folder, text }) => {
      needNotes();
      if (!(await asked('notes', 'Let an outside app create a note?', `New note "${name}"${folder ? ' in ' + folder : ''}.`))) throw new Error('The user declined.');
      return d.notes.create(String(name), folder ? String(folder) : '', String(text || ''));
    }),
    t('terminal_run', 'Types a command into Artemis\'s visible terminal and returns the last lines of output. The user is asked to confirm each time (or for 10 minutes).', { command: str(4000), wait_ms: { type: 'integer', minimum: 0, maximum: 60000 } }, ['command'], async ({ command, wait_ms }) => {
      const cmd = String(command || '');
      if (!cmd.trim()) throw new Error('command is empty');
      if (!(await asked('terminal', 'Let an outside app run a command in the Artemis terminal?', cmd.slice(0, 600)))) throw new Error('The user declined.');
      const out = await d.term.run(cmd.endsWith('\n') ? cmd : cmd + '\n', Math.min(60000, Math.max(0, Number(wait_ms) || 8000)));
      return out || '(no output yet; call artemis_terminal_read)';
    }),

    t('view_image', 'Shows you an image file: pictures the user attached in Artemis (the path is in their message) or images inside a project folder. Pass the full file path.', { path: str(1000) }, ['path'], async ({ path: file }) => {
      const fs = require('fs'), nodePath = require('path');
      const real = fs.realpathSync(nodePath.resolve(String(file || '')));
      const roots = [d.imagesDir, ...(d.files ? d.files.projects().map((p) => p.folder) : [])].filter(Boolean).map((r) => { try { return fs.realpathSync(r); } catch { return null; } }).filter(Boolean);
      if (!roots.some((r) => real === r || real.startsWith(r + nodePath.sep))) throw new Error('That file is outside the attached pictures and the project folders.');
      const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }[nodePath.extname(real).toLowerCase()];
      if (!mime) throw new Error('Only png, jpg, gif and webp images can be shown.');
      if (fs.statSync(real).size > 8 * 1024 * 1024) throw new Error('The image is larger than 8 MB.');
      return { __content: [{ type: 'image', mimeType: mime, data: fs.readFileSync(real).toString('base64') }, { type: 'text', text: nodePath.basename(real) }] };
    }, ro),
    t('projects', "Lists the user's Artemis projects with their folders. Use a project's name as \"project\" in the artemis_fs_* tools.", {}, [], async () => {
      const ps = d.files ? d.files.projects() : [];
      return ps.length ? ps : 'No projects yet.';
    }, ro),
    ...(d.files ? d.files.defs().map((def) => {
      const f = def.function;
      const props = { project: { type: 'string', description: 'Name of the Artemis project whose folder to use (see artemis_projects). Optional when there is only one project.' }, ...(f.parameters.properties || {}) };
      return t('fs_' + f.name, f.description + ' Works inside the chosen project folder.' + (READ_FS.has(f.name) ? ' Absolute or ~ paths elsewhere on the computer can be read after the user approves.' : '') + ' The user is asked to confirm changes and commands (once, or for 10 minutes).', props, f.parameters.required || [], async (args) => {
        const { project, ...rest } = args || {};
        if (f.name === 'run_command' && d.getSettings().shellEnabled === false) throw new Error('Shell commands are switched off in Artemis (Settings → Access).');
        const root = d.files.rootOf(project);
        const approve = async (info) => {
          const del = info.name === 'delete_file';
          const shellCmd = info.category === 'shell' || info.name === 'run_command';
          const read = !del && !shellCmd && (info.category === 'outside-read' || READ_FS.has(info.name));
          const key = del ? 'fs:delete:' + Math.random() : shellCmd ? 'fs:shell' : read ? 'fs:read' : 'fs:write';
          const title = del ? 'Delete this from your project?' : shellCmd ? 'Let an outside app run a command on your computer?' : read ? 'Let an outside app read files on your computer?' : 'Let an outside app change your files?';
          return asked(key, title, String(info.summary || info.name).slice(0, 600) + '\nProject folder: ' + root);
        };
        const r = await d.files.run(f.name, rest, { root, approve });
        if (r && r.denied) throw new Error(r.text);
        if (r && r.ok === false) throw new Error(r.text || 'failed');
        return (r && (r.text !== undefined ? r.text : JSON.stringify(r))) || '(done)';
      });
    }) : []),
    t('computer', "Sees and controls the user's Mac screen, like a person would: open apps and links, list the buttons of the front window, click them, type, press keys, scroll, take a screenshot. Prefer this over the terminal for anything that is done by clicking. Cheapest way: action \"open\" (app or https url), then \"ui\" to list clickable elements and \"click_ui\" with a name; chain steps with \"actions\"; use \"screenshot\" or look:true when you must see the screen, and always check with a screenshot after a click before telling the user it worked (never guess coordinates; they are pixels of the latest screenshot). The user is asked to confirm (once, or for 10 minutes).", {
      action: { type: 'string', enum: ['screenshot', 'ui', 'click_ui', 'open', 'mouse_move', 'left_click', 'double_click', 'right_click', 'left_click_drag', 'scroll', 'type', 'key', 'wait', 'capture_screen', 'record_screen_start', 'record_screen_stop'] },
      actions: { type: 'array', description: 'Several actions in one call (max 15), each with the same fields as a single action.', items: { type: 'object' } },
      look: { type: 'boolean' }, query: str(200), role: str(40), app: str(200), url: str(2000), text: { type: 'string' }, keys: str(100), direction: str(10),
      x: { type: 'number' }, y: { type: 'number' }, end_x: { type: 'number' }, end_y: { type: 'number' }, amount: { type: 'number' }, ms: { type: 'number' },
      process: str(200), path: str(1000), display: str(10), window: {}, format: str(10), audio: { type: 'boolean' }, max_seconds: { type: 'number' },
      region: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' } } }
    }, [], async (args) => {
      if (!d.computer) throw new Error('Computer control is not available here.');
      if (d.getSettings().computerEnabled === false) throw new Error('Computer control is switched off in Artemis (Settings → Access). Ask the user to turn it on.');
      const list = Array.isArray(args.actions) && args.actions.length ? args.actions : [args];
      const what = list.map((a) => a && a.action).filter(Boolean).join(', ') || 'screenshot';
      const only = list.every((a) => a && (a.action === 'screenshot' || a.action === 'ui' || a.action === 'wait'));
      if (!only && !(await asked('computer', 'Let an outside app control your computer?', `Actions: ${what}${args.url ? '\n' + args.url : ''}${args.app ? '\n' + args.app : ''}${args.text ? '\nType: ' + String(args.text).slice(0, 120) : ''}`))) throw new Error('The user said no.');
      const r = await d.computer.run(args);
      const content = [{ type: 'text', text: String((r && r.text) || '') || '(done)' }];
      const m = r && typeof r.image === 'string' ? /^data:([^;]+);base64,(.+)$/.exec(r.image) : null;
      if (m) content.push({ type: 'image', mimeType: m[1], data: m[2] });
      return r && r.ok === false ? (() => { throw new Error(content[0].text); })() : { __content: content };
    }),
    t('terminal_read', 'Reads the last lines of the Artemis terminal without typing anything.', { lines: { type: 'integer', minimum: 1, maximum: 300 } }, [], async ({ lines }) => d.term.read(Math.min(300, Math.max(1, Number(lines) || 80)), 0), ro)
  ];
}

module.exports = { buildArtemisTools, SAFE_SETTINGS, THEME_IDS, READ_KEYS, sharedGrants };
