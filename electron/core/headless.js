// Headless Artemis: the agent, saved chats, memory, skills, agents and scheduled tasks without Electron or a window,
// behind the gateway API. Started with `artemis gateway` (electron/core/cli.js), e.g. on a server or at login.
// It reads the same data folder as the desktop app; the two never run on one folder at the same time (instance.json).
//
// It can run next to the desktop app on the same folder: chats are shared through artemis.db (the app merges what this
// process writes), and while this process runs it owns the background services: scheduled tasks, the Telegram bot and
// the gateway API. Locks: <data>/headless.lock (this process) and desktop.lock (the app).
//
// Tools: files, web, memory, notes, skills, helper agents, scheduled tasks, connectors (MCP), Telegram (send_to_phone),
// the browser (Playwright, optional), computer control (macOS, when allowed in Settings) and run_command, which runs in
// the sandbox from Settings (Docker or SSH), or on this machine only with --allow-shell. Not here: the terminal panel,
// image/video generation and Make.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { runAgent, stripThinkText } = require('../agent');
const providersLib = require('../providers');
const chatSearch = require('../chatsearch');
const { createSkills } = require('../skills');
const { createAgents } = require('../subagents');
const { createNotes } = require('../notes');
const { createScheduler } = require('../scheduler');
const prompts = require('../prompts');
const { createHeartbeats, fromSettings: hbFromSettings, fileOf: hbFileOf, scopedTeams } = require('./heartbeat');
const { createTeams } = require('../teams');
const { createTeamRunner } = require('./teamrun');
const { createMake } = require('../make');
const { createHooks } = require('./hooks');
const { createHookService } = require('./hookservice');
const { checkLimits, costOf } = require('../limits');
const personality = require('../personality');
const brainsLib = require('../brains');
const web = require('../web');
const { openDb } = require('./db');
const { createSessions } = require('./sessions');
const { createMediaStore } = require('./mediastore');
const { createWorkspace } = require('./workspace');
const { createMemIndex } = require('./memindex');
const { createMemoryApi, embedderFrom } = require('./memory-api');
const { flushMemory } = require('./memflush');
const { createSecretReader } = require('./secrets');
const gatewayLib = require('./gateway');
const { createClients } = require('./clients');
const { createSecretStore } = require('./secret-store');
const { createMigrations } = require('./migrate-import');
const { createTurnBuilder } = require('./turn-builder');
const { toApiMessages } = require('./history');
const { sandboxFromSettings, hideHostShellTools } = require('./sandbox');
const { createPwBrowser, loadPlaywright } = require('./pwbrowser');
const { createMcpManager, hideServers, isSelfConnector } = require('../mcp');
const { createRemote } = require('../remote');
const { createComputer } = require('../computer');
const { summarizeAll } = require('../agent');
const files = require('../files');
const tools = require('../tools');

const APPROVAL_TIMEOUT = 10 * 60 * 1000;
const envName = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]+/g, '_');

function createHeadless({ dataDir, keysFrom = '', host = '127.0.0.1', port, publicHosts, allowedOrigins, webRoot, serverName, allowShell = false, keychain = true, scheduler: schedOn = true, telegram: tgOn = true, connectors: mcpOn = true, browser: browserOn = true, computer: computerOn = true, telegramApi, log = (lv, area, m) => console.error(`[${lv}] ${area}: ${m}`) }) {
  const L = (area) => (lv, m) => log(lv, area, m);
  const file = (n) => path.join(dataDir, n);
  const readJson = (name, fb) => { try { return JSON.parse(fs.readFileSync(file(name + '.json'), 'utf8')); } catch { return fb; } };
  function writeJson(name, data, mode) {
    const f = file(name + '.json'); const tmp = f + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data), mode ? { mode } : undefined); fs.renameSync(tmp, f);
  }
  const settings = () => readJson('settings', {});
  prompts.setSource(() => settings().promptOverrides); // Settings → Advanced, written by the app
  require('../shell').setSource(() => settings().shellPolicy);
  const headlessCfg = () => readJson('headless', {}); // { keys: { <providerId>: "..." }, braveKey, telegramToken, token }
  const lockAlive = (mode) => { try { const l = JSON.parse(fs.readFileSync(file(mode + '.lock'), 'utf8')); return l && l.pid && l.pid !== process.pid && gatewayLib.alive(l.pid) ? l : null; } catch { return null; } };
  const secrets = createSecretReader({ keychain, log: L('secrets') });
  const secretStore = createSecretStore({ dataDir, log: L('secrets') }); // keys set on the server itself (or moved here from a desktop)

  const readProviders = () => { const l = readJson('providers', []); const list = Array.isArray(l) ? l : []; providersLib.registerHeaders(list); return list; };
  const keyCache = new Map();
  // --keys-from <the desktop app's data folder>: a server on the same Mac uses the app's saved keys (macOS asks once for the keychain)
  const otherKey = (id) => { if (!keysFrom) return ''; try { return secrets.decrypt(JSON.parse(fs.readFileSync(path.join(keysFrom, 'providerkeys.json'), 'utf8'))[id]); } catch { return ''; } };
  function getProviderKey(id) {
    if (keyCache.has(id)) return keyCache.get(id);
    const v = process.env['ARTEMIS_KEY_' + envName(id)] || (headlessCfg().keys || {})[id] || secretStore.get('provider:' + id) || secrets.decrypt(readJson('providerkeys', {})[id]) || otherKey(id) || '';
    keyCache.set(id, v);
    return v;
  }
  const SECRET_FIELDS = { telegramToken: 'telegramTokenEnc', braveKey: 'braveKeyEnc', makeToken: 'makeTokenEnc', gatewayToken: 'gatewayTokenEnc', hooksTunnelToken: 'hooksTunnelTokenEnc' };
  function getSecret(name, field = SECRET_FIELDS[name]) {
    return process.env['ARTEMIS_' + envName(name.replace(/([A-Z])/g, '_$1'))] || (name === 'telegramToken' && process.env.TELEGRAM_BOT_TOKEN) || secretStore.get(name) || headlessCfg()[name] || secrets.decrypt(settings()[field]) || '';
  }
  /** Secrets set while headless (cannot use the OS encryption the app uses): kept in headless.json, readable by this user only. */
  const setSecret = (name, value) => writeJson('headless', { ...headlessCfg(), [name]: value }, 0o600);
  const saveSettings = (patch) => writeJson('settings', { ...settings(), ...patch });
  /** A model id with a provider (prov:<id>:<model>); old ids without one fall back to the first enabled provider's first model. */
  function pickModel(id) {
    const st = settings();
    const want = id || st.gatewayModel || st.model || '';
    if (providersLib.parseModel(want)) return want;
    const p = readProviders().find((x) => x.enabled !== false && (x.models || []).length);
    return p ? providersLib.prefixId(p.id, p.models[0].id) : want;
  }

  // ---- storage ----
  const db = openDb(file('artemis.db'), { log: L('db') });
  if (!db) throw new Error('The headless gateway needs node:sqlite (Node.js 22.13 or newer).');
  const media = createMediaStore({ dir: file('media'), log: L('media') });
  const sessions = createSessions({ db, log: L('db'), writer: 'headless', media });
  if (db.getMeta('chatsImported') !== '1') {
    const arr = readJson('chats', []);
    if (Array.isArray(arr) && arr.length) sessions.sync(arr);
    db.setMeta('chatsImported', '1');
  }
  if (db.getMeta('mediaMigrated') !== '1') { // same one-time move as the desktop app (main.js migrateChatImages)
    try {
      if (db.get("SELECT COUNT(*) AS n FROM messages WHERE json LIKE '%data:image/%'").n) {
        const backup = file('artemis.pre-media.db');
        if (!fs.existsSync(backup)) db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
        const r = sessions.migrateMedia();
        log('info', 'media', `Chat images moved to the media folder: ${r.messages} messages in ${r.chats} chats`);
      }
      db.setMeta('mediaMigrated', '1');
    } catch (e) { log('error', 'media', 'Moving chat images to files failed, will retry on next start: ' + e.message); }
  }
  let mirrorTimer = null;
  const mirror = () => { if (mirrorTimer || lockAlive('desktop')) return; // the app keeps chats.json up to date while it runs
     mirrorTimer = setTimeout(() => { mirrorTimer = null; try { writeJson('chats', sessions.toArray()); } catch (e) { log('warn', 'db', 'chats.json backup copy failed: ' + e.message); } }, 3000); };

  const st0 = settings();
  const ws = st0.memoryV2 === false ? null : createWorkspace({ dir: st0.workspaceFolder || file('workspace'), log: L('memory') });
  if (ws) ws.ensure(readJson('memory', []));
  const index = ws ? createMemIndex({ db, workspace: ws, log: L('memory'), embedder: embedderFrom({ getSettings: settings, readProviders, getProviderKey }) }) : null;
  const memoryApi = ws ? createMemoryApi({ workspace: ws, index }) : null;

  const skills = createSkills({ userDir: file('skills'), getDisabled: () => settings().disabledSkills || [], setDisabled: (list) => writeJson('settings', { ...settings(), disabledSkills: list }) });
  const agents = createAgents({ userDir: file('agents') });
  const brains = brainsLib.createBrains({ userDir: file('brains') });
  const docs = path.join(os.homedir(), 'Documents');
  const notesRoot = () => settings().notesFolder || (fs.existsSync(path.join(docs, 'Ares Notes')) ? path.join(docs, 'Ares Notes') : path.join(docs, 'Artemis Notes'));
  const notes = createNotes({ getRoot: notesRoot });
  const filesDir = () => { const d = fs.existsSync(path.join(docs, 'Artemis')) ? path.join(docs, 'Artemis') : file('files'); try { fs.mkdirSync(d, { recursive: true }); } catch {} return d; };
  const projectFiles = require('./project-files').createProjectFiles({ dir: path.join(dataDir, 'project-files'), files });
  const projectFor = (id) => { const p = id ? (readJson('projects', []) || []).find((x) => x.id === id) : null; return p ? { name: p.name, instructions: p.instructions, knowledge: projectFiles.knowledge(p), ...(p.folder && fs.existsSync(p.folder) ? { folder: p.folder } : {}) } : null; };

  // ---- usage (same file and shape as the desktop app) ----
  // own file (usage-headless.json), appended to, so the app (which writes usage.json) and this process never overwrite each other
  let pendingUsage = [], usageTimer = null;
  const ownUsage = () => { const l = readJson('usage-headless', []); return Array.isArray(l) ? l : []; };
  const flushUsage = () => {
    if (usageTimer) { clearTimeout(usageTimer); usageTimer = null; }
    if (!pendingUsage.length) return;
    try { const l = ownUsage().concat(pendingUsage); pendingUsage = []; writeJson('usage-headless', l.slice(-20000)); } catch {}
  };
  const recordUsage = (e) => { pendingUsage.push(e); if (!usageTimer) usageTimer = setTimeout(flushUsage, 2000); };
  const allUsage = () => { const app = readJson('usage', []); return [...(Array.isArray(app) ? app : []), ...ownUsage(), ...pendingUsage]; };
  const limitState = () => checkLimits(allUsage(), settings(), Date.now(), providersLib.priceMap(readProviders()));

  // ---- sandbox, connectors, browser, computer ----
  let sbCache = { key: null, sb: null };
  const sandbox = () => {
    const st = settings();
    const key = JSON.stringify([st.sandbox, st.sandboxImage, st.sandboxNetwork, st.sandboxMemory, st.sandboxCpus, st.sandboxSshHost, st.sandboxSshDir, st.sandboxWritable]);
    if (key !== sbCache.key) sbCache = { key, sb: sandboxFromSettings(st, L('sandbox')) };
    return sbCache.sb;
  };
  const MCP_ENC = 'enc:';
  const mcpDec = (v) => (typeof v === 'string' && v.startsWith(MCP_ENC) ? secrets.decrypt(v.slice(MCP_ENC.length)) : typeof v === 'string' && v.startsWith('sec:') ? secretStore.get(v.slice(4)) : v);
  const mapVals = (o, f) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, f(v)])) : o);
  const mapMcp = (c, f) => (!c || typeof c !== 'object' ? c : { ...c, env: mapVals(c.env, f), headers: mapVals(c.headers, f), ...(c.clientSecret !== undefined ? { clientSecret: f(c.clientSecret) } : {}), ...(c.oauth && typeof c.oauth === 'object' ? { oauth: { ...c.oauth, accessToken: f(c.oauth.accessToken), refreshToken: f(c.oauth.refreshToken) } } : {}) });
  const readMcpList = () => { const l = readJson('mcp', []); return Array.isArray(l) ? l.map((c) => mapMcp(c, mcpDec)) : []; };
  const mcp = mcpOn ? createMcpManager() : null;
  // a connector that is Artemis itself (the desktop app's MCP server, a gateway on this computer): never dialled on the server
  const isSelf = (c) => isSelfConnector(c, [Number(settings().mcpServerPort) || 8788, Number(settings().gatewayPort) || 8789, Number(port) || 0].filter(Boolean));
  const liveMcpList = () => readMcpList().filter((c) => !isSelf(c));
  // connectors as the agents see them: without one that is Artemis itself (its MCP server or a gateway on this computer)
  const agentMcp = () => hideServers(mcp, () => mcp.slugsWhere((c) => isSelfConnector(c, [Number(settings().mcpServerPort) || 8788, Number(settings().gatewayPort) || 8789, Number(port) || 0].filter(Boolean))));
  if (mcp) mcp.setTokenSaver((id, oauth) => { // refreshed OAuth tokens: stored as plain values; the app encrypts them again when it starts
    try { const raw = readJson('mcp', []); writeJson('mcp', raw.map((c) => (c.id === id ? { ...c, oauth: { ...(c.oauth || {}), ...oauth } } : c)), 0o600); } catch (e) { log('warn', 'mcp', 'could not save refreshed tokens: ' + e.message); }
  });
  let pw = null, pwOk = null;
  const browserAvailable = () => { if (pwOk === null) { try { loadPlaywright(); pwOk = true; } catch { pwOk = false; } } return pwOk; };
  // the app's browser sign-ins (browser-cookies.enc, written by the app, encrypted with its safeStorage key)
  let cookieCache = { mtime: 0, list: null };
  const appCookies = () => {
    try {
      const f = file('browser-cookies.enc'); const m = fs.statSync(f).mtimeMs;
      if (m !== cookieCache.mtime) { const json = secrets.decrypt(fs.readFileSync(f, 'utf8').trim()); cookieCache = { mtime: m, list: json ? JSON.parse(json) : null }; if (!json) log('warn', 'browser', 'the app\'s browser sign-ins could not be decrypted (Keychain)'); }
      return cookieCache.list ? { version: cookieCache.mtime, list: cookieCache.list } : null;
    } catch { return null; }
  };
  const browserFor = () => { if (!pw) pw = createPwBrowser({ profileDir: file('headless-browser'), channel: settings().headlessBrowserChannel || '', headless: settings().headlessBrowserVisible !== true, log: L('browser'), cookies: appCookies }); return pw.agent(); };
  const computer = process.platform === 'darwin' && computerOn ? createComputer({}) : null;
  let remote = null;

  // ---- runs and approvals ----
  const runs = new Map();       // runId -> AbortController
  const approvals = new Map();  // approval id -> resolve(bool)

  function searchVia(st) {
    if (st.searchEngine === 'brave') { const k = getSecret('braveKey', 'braveKeyEnc'); return k ? (q, sig) => web.braveSearch({ key: k, query: q, signal: sig }) : null; }
    if (!st.searchProvider) return null;
    const r = providersLib.resolve(`prov:${st.searchProvider}:x`, readProviders(), getProviderKey);
    return r.error ? null : (q, sig) => web.endpointSearch({ baseUrl: r.baseUrl, key: r.key, query: q, signal: sig, model: st.searchModel || 'perplexity/sonar' });
  }

  async function flushFor(text, modelId, chatId) {
    try {
      const st = settings();
      const pick = pickModel(st.memoryModel || st.scheduleModel || modelId);
      let r = providersLib.resolve(pick, readProviders(), getProviderKey);
      if (r.error) r = providersLib.resolve(modelId, readProviders(), getProviderKey);
      if (r.error) return;
      const ask = (system, user) => brainsLib.askJson({ url: providersLib.joinUrl(r.baseUrl, 'chat/completions'), key: r.key, model: r.model, system, user, signal: AbortSignal.timeout(90000),
        onUsage: (u) => recordUsage({ t: Date.now(), model: pick, chat: chatId || '', project: '', source: 'memory', prompt: u.prompt, completion: u.completion, cached: 0, estimated: false }) });
      await flushMemory({ transcript: text, ask, workspace: ws, log: L('memory') });
    } catch (e) { log('warn', 'memory', 'flush failed: ' + e.message); }
  }

  /** One agent run. Returns { text, steps, error }. */
  async function run({ runId, messages, modelId, project, chatId, send, unattended = false, allowEdits = false, restrict = false, system = '', source = '', watchTeamId = '', incognito = false, brain = null, brainPick = '', toolsMode = '', agentsMode = '', effort = '', permMode = '', mentions = [] }) {
    const st = settings();
    let route = providersLib.resolve(modelId, readProviders(), getProviderKey);
    if (route.error) throw new Error(route.error + (/key/i.test(route.error) ? ` Set ARTEMIS_KEY_${envName(String(modelId).split(':')[1] || '')} or add it to ${file('headless.json')}.` : ''));
    const lim = limitState();
    if (lim.blocked) throw new Error(lim.blocked);
    const controller = new AbortController();
    runs.set(runId, controller);
    const mine = new Set();
    controller.signal.addEventListener('abort', () => { for (const id of mine) { const r = approvals.get(id); if (r) { approvals.delete(id); r(false); } } }, { once: true });
    // Brains, as in the desktop: talk as one personality, or let the council vote on who answers (chat "brain" setting)
    let persona = '';
    const wanted = unattended ? '' : String(brain !== null && brain !== undefined ? brain : (st.defaultBrain || ''));
    if (wanted && !route.error) {
      const root0 = project && project.folder ? project.folder : null;
      let chosen = null, hint = '';
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      const lastText = lastUser ? (typeof lastUser.content === 'string' ? lastUser.content : Array.isArray(lastUser.content) ? lastUser.content.map((x) => x.text || '').join(' ') : '') : '';
      const stuck = wanted === 'council' && brainPick ? brains.find(brainPick) : null;
      if (stuck) chosen = stuck;
      else if (wanted === 'council' && lastText.trim().split(/\s+/).length <= 3) chosen = brains.list()[0];
      else if (wanted === 'council') {
        const all = brains.list();
        send({ type: 'council:start' });
        try {
          const tail = messages.slice(-4).map((m) => `${m.role === 'user' ? 'USER' : 'ASSISTANT'}: ${(typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? m.content.map((x) => x.text || '').join(' ') : '').slice(0, 1200)}`);
          const outV = await brainsLib.deliberate({ brains: all, conversation: tail, skillsIndex: st.skillsEnabled !== false ? skills.indexText(root0) : '', agentsIndex: agentsMode !== 'off' ? agents.indexText(root0) : '',
            call: async (b, sys, user) => { const r = providersLib.resolve(b.model || modelId, readProviders(), getProviderKey); if (r.error) throw new Error(r.error); return brainsLib.askJson({ url: providersLib.joinUrl(r.baseUrl, 'chat/completions'), key: r.key, model: r.model, system: sys, user, signal: AbortSignal.timeout(90000) }); } });
          send({ type: 'council', votes: outV.votes, verdict: outV.verdict });
          chosen = all.find((b) => b.name === outV.verdict.answerer) || all[0];
          hint = brainsLib.verdictHint(outV.verdict);
        } catch (e) { send({ type: 'notice', text: 'The council could not vote: ' + e.message }); }
      } else chosen = brains.find(wanted);
      if (chosen) {
        persona = brainsLib.personaText(chosen) + (hint ? '\n\n' + hint : '');
        send({ type: 'brain', name: chosen.name, role: chosen.role, slug: chosen.slug, model: chosen.model || '', council: wanted === 'council' });
        if (chosen.model) { const r = providersLib.resolve(chosen.model, readProviders(), getProviderKey); if (r.error) send({ type: 'notice', text: `${chosen.name}'s model is not available (${r.error}) so the chat model was used.` }); else route = r; }
      }
    }
    const steps = ['']; let error = '';
    const out = (ev) => {
      if (ev.type === 'chunk' && !ev.agent) steps[steps.length - 1] += ev.text;
      else if (ev.type === 'step:new') steps.push('');
      else if (ev.type === 'error') error = ev.message || 'Error';
      send(ev);
    };
    const root = project && project.folder ? project.folder : filesDir();
    try {
      await runAgent({
        persona, sessionId: chatId, userData: dataDir, spillDir: require('path').join(dataDir, 'spill'), mentions: Array.isArray(mentions) ? mentions.slice(0, 20) : [],
        baseUrl: route.baseUrl, key: route.key, model: route.model, noToolCalls: !!route.noTools, messages, maxTokens: st.maxTokens || 8192, reasoningEffort: effort && effort !== 'auto' ? effort : (st.reasoningEffort || ''),
        custom: [st.systemPrompt || '', system].filter(Boolean).join('\n\n'), personality: personality.text(st), userName: st.profileName || '', userAbout: st.profileAbout || '', userLocation: st.profileLocation || '',
        project, root, defaultRoot: !(project && project.folder),
        sandbox: sandbox(), webEnabled: st.webEnabled !== false, searchVia: searchVia(st),
        // run_command: in the sandbox when one is set; on this machine only with --allow-shell, never for restricted runs
        shellEnabled: st.shellEnabled !== false && (!!sandbox() || (allowShell && !restrict)),
        computer: computer && st.computerEnabled !== false && !restrict && !unattended ? computer : null,
        browser: browserOn && st.browserTools !== false && !restrict && !unattended && browserAvailable() ? browserFor() : null,
        mcp: mcp && st.connectorsEnabled !== false ? (sandbox() ? hideHostShellTools(agentMcp()) : agentMcp()) : null, mcpLazy: st.connectorsLazy !== false, mcpCodeMode: st.mcpCodeMode === true, lazyTools: st.toolsLazy !== false, fullFileAccess: st.fullFileAccess !== false,
        phone: remote ? remote.phone() : null,
        schedule: unattended ? null : { list: () => sched.list(), save: (j) => sched.save(j), remove: (id) => sched.remove(id), hooks: hooksTools, heartbeat: heartbeatTools },
        teams: unattended ? (watchTeamId ? scopedTeams({ list: async () => teams.list(), projects: () => readJson('projects', []), start: async (id) => teams.start(id) }, watchTeamId) : null) : {
          agents: (root) => agents.list(root || null).map(({ file, ...a }) => a), projects: () => readJson('projects', []).map((p) => ({ id: p.id, name: p.name, folder: p.folder || '', instructions: p.instructions || '' })), saveAgent: (a) => agents.save(a), removeAgent: (name) => agents.remove(name),
          list: async () => teams.list(), get: async (id) => teams.list().find((t) => t.id === id || String(t.name).toLowerCase() === String(id).toLowerCase()) || null,
          save: async (d) => { const t = teams.save(d); syncTeamJob(t); return t; }, start: async (id) => teams.start(id), remove: async (id) => { const j = sched.list().find((x) => x.teamId === id); if (j) sched.remove(j.id); return teams.remove(id); }
        },
        notes: st.notesAi !== false ? notes : null,
        skills: st.skillsEnabled !== false ? { index: () => skills.indexText(project && project.folder), get: (n) => skills.get(n, project && project.folder), save: (o) => skills.save(o, project && project.folder) } : null,
        autoLearn: st.autoLearn !== false && !unattended && !incognito,
        chats: st.chatSearchEnabled !== false ? { search: (q, n) => sessions.search(q, { limit: n, projects: readJson('projects', []) }), read: (id, last, offset) => sessions.read(id, last, offset) } : null,
        delegateEnabled: agentsMode ? agentsMode !== 'off' : st.delegateEnabled !== false,
        agents: { find: (n) => agents.find(n, project && project.folder), list: () => agents.list(project && project.folder), index: () => agents.indexText(project && project.folder) },
        resolveModel: (id) => providersLib.resolve(id, readProviders(), getProviderKey), usageModel: modelId,
        computerHooks: { onStart() {}, onEnd() {} },
        shouldStop: () => limitState().blocked,
        runTokenBudget: Number(st.runTokenBudget) || undefined, contextTokens: Number(st.contextTokens) || undefined,
        toolsEnabled: toolsMode ? toolsMode !== 'off' : st.toolsEnabled !== false, memoryEnabled: !incognito && st.memoryEnabled !== false && !!memoryApi, incognito: !!incognito,
        memoryApi, onCompact: memoryApi && st.memoryFlush !== false ? (t) => flushFor(t, modelId, chatId) : null,
        onUsage: (u) => recordUsage({ t: Date.now(), model: u.model || modelId, chat: chatId || '', project: (project && project.name) || '', source: source || (unattended ? 'schedule' : 'gateway'), prompt: u.prompt, completion: u.completion, cached: u.cached || 0, cacheWrite: u.cacheWrite || 0, estimated: u.estimated }),
        autoApprove: unattended ? !!allowEdits : permMode ? permMode === 'auto' : !!st.autoApproveEdits, autoAll: !unattended && permMode === 'auto', agentAutoApprove: false,
        approve: (info) => unattended ? Promise.resolve(info.category === 'phone' || (info.name === 'run_command' && !!sandbox()) || (info.name === 'team_start' && !!watchTeamId)) : new Promise((resolve) => {
          mine.add(info.id);
          const timer = setTimeout(() => { if (approvals.delete(info.id)) resolve(false); }, APPROVAL_TIMEOUT);
          approvals.set(info.id, (ok) => { clearTimeout(timer); resolve(ok); });
          out({ type: 'tool:approval', id: info.id, category: info.category, session: !!info.session, summary: info.summary, agent: info.agent });
        }),
        send: out, signal: controller.signal
      });
    } catch (e) { if (e.name !== 'AbortError') { error = e.message || String(e); send({ type: 'error', message: error }); } }
    finally { runs.delete(runId); for (const id of mine) { const r = approvals.get(id); if (r) { approvals.delete(id); r(false); } } }
    return { text: steps.map((t) => t.trim()).filter(Boolean).pop() || '', steps: steps.map((t) => t.trim()).filter(Boolean), error };
  }

  // ---- scheduled tasks ----
  const sched = createScheduler({
    read: () => readJson('schedules', []), write: (l) => writeJson('schedules', l), changed: () => {},
    run: async (job) => {
      if (job.teamId) {
        const t = teams.get(job.teamId);
        if (!t) return { ok: false, error: 'The team no longer exists.' };
        if (!teams.isWorking(job.teamId)) { teams.start(job.teamId); log('info', 'teams', `team "${t.name}" started by its schedule`); }
        return { ok: true };
      }
      const runId = 'sch-' + crypto.randomBytes(5).toString('hex');
      const modelId = pickModel(job.model || settings().scheduleModel);
      let res;
      if (job.reminder) res = { text: String(job.prompt || '').trim(), steps: [String(job.prompt || '').trim()], error: '' };
      else res = await run({ runId, messages: [{ role: 'user', content: job.prompt }], modelId, project: projectFor(job.projectId), chatId: runId, send: () => {}, unattended: true, allowEdits: job.allowEdits, restrict: true, system: prompts.text('scheduled', prompts.defaultOf('scheduled')) });
      sessions.appendTurn(runId, { user: job.prompt, steps: res.steps.map((t) => ({ text: t, toolCalls: [] })), assistant: res.error ? `Failed: ${res.error}` : '', title: job.name, source: 'schedule', model: modelId, projectId: job.projectId || null });
      mirror();
      log('info', 'schedule', `${job.name}: ${res.error ? 'failed: ' + res.error : 'done'}`);
      if (job.notifyPhone) {
        const ph = remote && remote.phone();
        const summary = (res.error ? `Failed: ${res.error}` : res.text || 'Finished.').slice(0, 600);
        if (ph) await ph.send(`⏰ ${job.name}\n\n${summary}`).catch((e) => log('warn', 'schedule', 'Telegram: ' + e.message));
        else log('warn', 'schedule', `${job.name}: should go to the phone, but Telegram is not connected and paired`);
      }
      return res.error ? { ok: false, error: res.error } : { ok: true };
    }
  });

  // ---- heartbeat and webhooks (same as in the app; they run here while this process owns the background jobs) ----
  async function backgroundRun({ prompt, model, allowEdits, projectId, source, teamId }) {
    const modelId = pickModel(model || settings().scheduleModel);
    const runId = 'bg-' + crypto.randomBytes(5).toString('hex');
    const res = await run({ runId, messages: [{ role: 'user', content: prompt }], modelId, project: projectFor(projectId), chatId: runId, send: () => {}, unattended: true, allowEdits: !!allowEdits, restrict: true, system: prompts.text('background', prompts.defaultOf('background')), source, watchTeamId: teamId });
    return { text: res.text, error: res.error, model: modelId };
  }
  async function backgroundTell({ chatId, title, user, text, model, source, phone, icon }) {
    try { sessions.appendTurn(chatId || 'bg-' + crypto.randomBytes(5).toString('hex'), { user, assistant: text, title, via: source, source, model: model || '' }); mirror(); } catch (e) { log('warn', source, 'could not save the chat: ' + e.message); }
    if (!phone) return;
    const ph = remote && remote.phone();
    if (ph) await ph.send(`${icon} ${title}\n\n${String(text).slice(0, 3500)}`);
    else log('warn', source, `${title}: should go to the phone, but Telegram is not connected and paired`);
  }
  const heartbeat = createHeartbeats({
    list: () => readJson('heartbeats', null) || hbFromSettings(settings()),
    saveList: (l) => writeJson('heartbeats', l),
    checklist: (hb) => (ws ? ws.readText(hbFileOf(hb)) || '' : null),
    writeChecklist: (hb, text) => { if (!ws) throw new Error('Heartbeats need the memory workspace.'); const f = ws.abs(hbFileOf(hb)); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.tmp', text.endsWith('\n') ? text : text + '\n'); fs.renameSync(f + '.tmp', f); },
    removeChecklist: (hb) => { if (ws) fs.rmSync(ws.abs(hbFileOf(hb)), { force: true }); },
    run: ({ prompt, model, projectId, teamId }) => backgroundRun({ prompt, model, projectId, teamId, source: 'heartbeat' }),
    deliver: ({ text, model, hb }) => backgroundTell({ chatId: 'heartbeat-' + hb.id, title: hb.name === 'Heartbeat' ? 'Heartbeat' : `Heartbeat: ${hb.name}`, user: `Heartbeat check (${hbFileOf(hb)})`, text, model, source: 'heartbeat', phone: hb.phone !== false, icon: '💓' }),
    readState: () => readJson('heartbeat-state', {}), writeState: (x) => writeJson('heartbeat-state', x), log: L('heartbeat')
  });
  const hooks = createHooks({
    read: () => readJson('hooks', []), write: (l) => writeJson('hooks', l, 0o600),
    run: (hook, ev) => backgroundRun({ prompt: ev.prompt, model: hook.model, allowEdits: hook.allowEdits, projectId: hook.projectId, source: 'webhook' }),
    deliver: (hook, { text, event }) => backgroundTell({ title: `Webhook: ${hook.name}`, user: `Webhook "${hook.name}"${event ? ` · ${event}` : ''}`, text, source: 'webhook', phone: hook.notifyPhone !== false, icon: '🔔', model: hook.model }),
    log: L('webhooks')
  });
  const hookService = createHookService({
    hooks, owner: 'headless', settings, tunnelToken: () => process.env.ARTEMIS_TUNNEL_TOKEN || headlessCfg().tunnelToken || getSecret('hooksTunnelToken'),
    writeState: (x) => writeJson('hooks-state', x), log: L('webhooks')
  });
  const hookPort = () => Number(settings().hooksPort) || 8790;
  const hookUrls = (h) => { const x = hookService.info(); return { local: `http://127.0.0.1:${hookPort()}/hooks/${h.name}`, public: x.publicUrl ? `${x.publicUrl}/hooks/${h.name}` : '' }; };
  const hooksTools = {
    list: () => hooks.list().map((h) => ({ ...h, urls: hookUrls(h) })),
    save: (o) => { const h = hooks.save(o); if (!settings().hooksEnabled) { writeJson('settings', { ...settings(), hooksEnabled: true }); hookService.sync().catch(() => {}); } return { ...h, urls: hookUrls(h) }; },
    remove: (id) => hooks.remove(id), info: () => hookService.info()
  };
  const heartbeatTools = {
    list: () => heartbeat.status(),
    save: (o) => { const hb = heartbeat.save(o); return heartbeat.status().find((x) => x.id === hb.id); },
    remove: (id) => heartbeat.remove(id)
  };
  let hookTimer = null;

  /** The scheduled task that starts a team by itself (same as the app's ipc/teams.js). */
  function syncTeamJob(t) {
    const job = sched.list().find((j) => j.teamId === t.id);
    if (!t.repeat) { if (job) sched.remove(job.id); return; }
    sched.save({ id: job ? job.id : undefined, name: `Team: ${t.name}`.slice(0, 80), prompt: `Start a new run of the team "${t.name}".`, teamId: t.id, repeat: t.repeat, enabled: true });
  }
  // ---- Make, and agent teams (they run here while this process owns the background jobs) ----
  const make = createMake({ getAuth: () => ({ token: getSecret('makeToken', 'makeTokenEnc'), zone: settings().makeZone }) });
  const runTeamTurn = createTeamRunner({
    runAgent, settings, userData: dataDir, stripThinkText,
    resolveModel: (m) => providersLib.resolve(pickModel(m), readProviders(), getProviderKey), fallbackModel: () => pickModel(settings().model),
    prices: () => providersLib.priceMap(readProviders()), costOf, recordUsage, limitBlocked: () => limitState().blocked || '', filesDir,
    tools: ({ caps }) => {
      const st = settings();
      const sb = caps.has('shell') ? sandbox() : null;
      return {
        webEnabled: st.webEnabled !== false, searchVia: searchVia(st),
        chats: st.chatSearchEnabled !== false ? { search: (q, n) => sessions.search(q, { limit: n, projects: readJson('projects', []) }), read: (id, last, offset) => sessions.read(id, last, offset) } : null,
        make: caps.has('make') && st.makeEnabled !== false && getSecret('makeToken', 'makeTokenEnc') ? make : null,
        browser: caps.has('browser') && browserOn && st.browserTools !== false && browserAvailable() ? browserFor() : null,
        mcp: caps.has('connectors') && mcp && st.connectorsEnabled !== false ? (sb ? hideHostShellTools(agentMcp()) : agentMcp()) : null,
        // commands: in the sandbox, or on this machine only when the gateway was started with --allow-shell
        shellEnabled: caps.has('shell') && st.shellEnabled !== false && (!!sb || allowShell), sandbox: sb,
        phone: caps.has('phone') && remote ? remote.phone() : null,
        memoryEnabled: caps.has('memory') && !!memoryApi, memoryApi: caps.has('memory') ? memoryApi : null,
        schedule: caps.has('automation') ? { list: () => sched.list(), save: (j) => sched.save(j), remove: (id) => sched.remove(id), hooks: hooksTools, heartbeat: heartbeatTools } : null
      };
    },
    approvals: { add: (id, decide) => approvals.set(id, decide), drop: (id) => handlers.approve(id, false) },
    phone: () => (remote ? remote.phone() : null),
    log: L('teams')
  });
  const teams = createTeams({
    load: () => readJson('teams', { teams: [] }), save: (d) => writeJson('teams', d), emit: () => {},
    roster: (root) => agents.list(root || null),
    project: (id) => { const p = readJson('projects', []).find((x) => x.id === id); return p ? { id: p.id, name: p.name, folder: p.folder && fs.existsSync(p.folder) ? p.folder : '', instructions: p.instructions || '' } : null; },
    runTurn: (o) => runTeamTurn(o), log: (m) => log('warn', 'teams', m),
    hire: (a) => agents.save({ name: a.name, role: a.role, description: a.role, body: a.body, tools: a.tools, model: a.model })
  });

  // ---- gateway ----
  const clients = createClients({ file: file('clients.json'), log: L('clients') });
  const uid = () => crypto.randomBytes(6).toString('hex');
  /** Attachments sent by a remote client: images as data URLs (stored as media files), text files as text. */
  // ---- connectors: sign-in through the server, secrets typed in an app, and the desktop's own list kept in step ----
  const { resolveOAuth } = require('../mcp-oauth');
  const oauthPending = new Map(); // state -> { id, verifier, config, redirectUri, at }
  const b64url = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const rawMcp = () => { const l = readJson('mcp', []); return Array.isArray(l) ? l : []; };
  const saveRawMcp = (list) => { writeJson('mcp', list, 0o600); if (mcp && settings().connectorsEnabled !== false) mcp.configure(liveMcpList()).catch((e) => log('warn', 'mcp', e.message)); };
  const secName = (cid, field) => `mcp:${cid}:${field}`.replace(/[^\w:.@-]/g, '_').slice(0, 200);
  /** A secret value kept in the encrypted store; the connector keeps only a reference to it. */
  const keepSecret = (cid, field, v) => {
    if (typeof v !== 'string' || !v || v.startsWith('sec:')) return v;
    if (!secretStore) return v;
    const n = secName(cid, field); secretStore.set(n, v); return 'sec:' + n;
  };
  const keepVals = (cid, field, o) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.fromEntries(Object.entries(o).map(([k, v]) => [String(k).slice(0, 120), keepSecret(cid, `${field}.${k}`, String(v ?? ''))])) : {});
  const macOnlyCmd = (c) => process.platform !== 'darwin' && c.type === 'stdio' && /\/Users\/|\/Applications\/|\/opt\/homebrew|\.app\//.test([c.command, ...(c.args || [])].join(' '));
  const page = (title, text, ok) => `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#121316;color:#F3EFE7;font:17px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;text-align:center;padding:24px;box-sizing:border-box}h1{font:600 26px ui-serif,Georgia,serif;color:${ok ? '#D4B06A' : '#F08A80'}}a{color:#D4B06A}</style></head><body><div><h1>${title}</h1><p>${text}</p><p><a href="artemis://connectors">Back to Artemis</a></p></div></body></html>`;
  const escHtml = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const NATIVE_REDIRECT = 'artemis://oauth';
  /** Starts a sign-in. The provider sends the browser back to the server when it can reach it over https (or localhost);
   *  otherwise (a phone on the home network, plain http) to the app itself (artemis://oauth), which hands the code over. */
  async function oauthStart(id, base, { native = false } = {}) {
    const bad = (m, st = 400) => Object.assign(new Error(m), { status: st });
    let b; try { b = new URL(String(base || '')); } catch { throw bad('The app did not say which address it uses for this server.'); }
    if (!/^https?:$/.test(b.protocol)) throw bad('Bad server address.');
    const cfg = readMcpList().find((c) => c.id === id);
    if (!cfg) throw bad('No connector with that id.', 404);
    if (cfg.type !== 'http' || !cfg.url) throw bad('Only web (http) connectors sign in. This one runs a program; give it its keys instead.');
    const serverRedirect = `${b.origin}${b.pathname.replace(/\/+$/, '')}/v1/oauth/callback`;
    const reachable = b.protocol === 'https:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(b.hostname);
    const tries = [...(reachable ? [serverRedirect] : []), ...(native ? [NATIVE_REDIRECT] : []), ...(!reachable ? [serverRedirect] : [])];
    // a client registered for the desktop's own redirect does not accept another one: register again when the server offers it
    const manual = !cfg.dcr && cfg.clientId && cfg.authorizationUrl && cfg.tokenUrl;
    let config = null, redirectUri = '', last = null;
    for (const r of tries) {
      try { config = await resolveOAuth(manual ? cfg : { ...cfg, dcr: true, clientId: '', clientSecret: '' }, r); redirectUri = r; break; } catch (e) { last = e; }
    }
    if (!config) {
      const https = /https/i.test(String(last && last.message));
      throw bad(https ? `${cfg.name || 'This service'} only signs in through an https address. Open this server in the app through its https address (your tunnel or reverse proxy) and sign in again.` : String((last && last.message) || 'Sign-in could not start.'));
    }
    const state = crypto.randomBytes(24).toString('hex');
    const verifier = b64url(crypto.randomBytes(32));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    for (const [k, v] of oauthPending) if (Date.now() - v.at > 15 * 60000) oauthPending.delete(k);
    oauthPending.set(state, { id, verifier, config, redirectUri, at: Date.now() });
    const params = new URLSearchParams({ response_type: 'code', client_id: config.clientId || '', redirect_uri: redirectUri, state, code_challenge: challenge, code_challenge_method: 'S256', ...(config.scope ? { scope: config.scope } : {}), ...(config.resource ? { resource: config.resource } : {}) });
    if (!/^https?:\/\//i.test(config.authorizationUrl)) throw bad('The sign-in address is not a web address.');
    return { url: `${config.authorizationUrl}${config.authorizationUrl.includes('?') ? '&' : '?'}${params}`, redirectUri, mode: redirectUri === NATIVE_REDIRECT ? 'native' : 'server' };
  }
  async function oauthCallback({ code, state, error }) {
    const p = oauthPending.get(state);
    if (!p) return { ok: false, message: 'The sign-in expired. Start it again.', html: page('Sign-in expired', 'Start the sign-in again from Artemis.', false) };
    oauthPending.delete(state);
    const name = escHtml((rawMcp().find((c) => c.id === p.id) || {}).name || 'the connector');
    if (error || !code) return { ok: false, message: error || 'The sign-in was cancelled.', html: page('Not signed in', escHtml(error || 'The sign-in was cancelled.'), false) };
    try {
      const { config } = p;
      const body = new URLSearchParams({ grant_type: 'authorization_code', code, client_id: config.clientId || '', redirect_uri: p.redirectUri, code_verifier: p.verifier, ...(config.clientSecret ? { client_secret: config.clientSecret } : {}), ...(config.resource ? { resource: config.resource } : {}) });
      const r = await fetch(config.tokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body, signal: AbortSignal.timeout(30000) });
      const t = await r.json().catch(() => ({}));
      if (!r.ok || !t.access_token) throw new Error(t.error_description || t.error || `Token request failed (${r.status})`);
      const oauth = { accessToken: keepSecret(p.id, 'oauth.accessToken', t.access_token), refreshToken: keepSecret(p.id, 'oauth.refreshToken', t.refresh_token || ''), expiresAt: t.expires_in ? Date.now() + Number(t.expires_in) * 1000 : 0 };
      saveRawMcp(rawMcp().map((c) => (c.id === p.id ? { ...c, enabled: true, oauth, authorizationUrl: config.authorizationUrl, tokenUrl: config.tokenUrl, clientId: config.clientId || '', clientSecret: keepSecret(p.id, 'clientSecret', config.clientSecret || ''), scope: config.scope || '', resource: config.resource || '', dcr: !!config.dcr } : c)));
      return { ok: true, message: 'Signed in.', html: page('Signed in', `${name} is connected on your Artemis server. You can close this page.`, true) };
    } catch (e) {
      log('warn', 'mcp', `sign-in failed: ${e.message}`);
      return { ok: false, message: e.message, html: page('Not signed in', escHtml(e.message), false) };
    }
  }
  /** The desktop's projects, connectors (plain values, decrypted on the Mac) and provider keys, kept in step while it is linked. */
  async function syncFromDesktop(b) {
    const out = {};
    if (Array.isArray(b.projects)) {
      // one list everywhere: the newer copy of a project wins (updatedAt); one deleted anywhere stays deleted (a tombstone)
      const mine = readJson('projects', []); const list = Array.isArray(mine) ? mine : [];
      const tomb = readJson('projects-deleted', {}) || {};
      for (const id of Array.isArray(b.removedProjects) ? b.removedProjects.map(String) : []) tomb[id] = Date.now();
      const theirs = b.projects.filter((x) => x && typeof x.id === 'string' && /^[\w-]{1,64}$/.test(x.id)).slice(0, 500);
      const byId = new Map(list.filter((x) => x && x.id).map((x) => [x.id, x]));
      for (const x of theirs) {
        if (tomb[x.id] && Number(x.updatedAt || 0) <= tomb[x.id]) continue; // deleted on another device
        const had = byId.get(x.id);
        const win = !had || Number(x.updatedAt || 0) >= Number(had.updatedAt || 0) ? { ...(had || {}), ...x } : had;
        byId.set(x.id, { ...win, ...require('./project-files').mergeFiles(had || {}, x) }); // files: everything either side has
        if (tomb[x.id]) delete tomb[x.id];
      }
      for (const id of Object.keys(tomb)) byId.delete(id);
      const merged = [...byId.values()];
      writeJson('projects', merged); writeJson('projects-deleted', tomb);
      out.projects = merged; out.deletedProjects = Object.keys(tomb);
      out.needFiles = merged.flatMap((p) => (p.files || []).filter((f) => !projectFiles.has(p.id, f.id)).map((f) => ({ pid: p.id, fid: f.id }))); // the desktop sends these
    }
    if (Array.isArray(b.connectors)) {
      const list = rawMcp();
      for (const c of b.connectors.slice(0, 200)) {
        if (!c || typeof c.id !== 'string' || !/^[\w-]{1,64}$/.test(c.id)) continue;
        const had = list.find((x) => x.id === c.id);
        const next = { ...(had || {}), ...c, env: keepVals(c.id, 'env', c.env), headers: keepVals(c.id, 'headers', c.headers), clientSecret: keepSecret(c.id, 'clientSecret', c.clientSecret || '') };
        if (c.oauth && typeof c.oauth === 'object' && c.oauth.accessToken) {
          const newer = !(had && had.oauth && Number(had.oauth.expiresAt || 0) > Number(c.oauth.expiresAt || 0) && had.oauth.accessToken);
          next.oauth = newer ? { accessToken: keepSecret(c.id, 'oauth.accessToken', c.oauth.accessToken), refreshToken: keepSecret(c.id, 'oauth.refreshToken', c.oauth.refreshToken || ''), expiresAt: Number(c.oauth.expiresAt) || 0 } : had.oauth;
        } else if (had && had.oauth) next.oauth = had.oauth;
        else delete next.oauth;
        if (macOnlyCmd(next)) next.enabled = false;
        if (had) list[list.indexOf(had)] = next; else list.push(next);
      }
      saveRawMcp(list);
    }
    if (Array.isArray(b.providers)) {
      const mine = readJson('providers', []); const list = Array.isArray(mine) ? mine : [];
      for (const p of b.providers.slice(0, 100)) { if (!p || typeof p.id !== 'string') continue; const i = list.findIndex((x) => x && x.id === p.id); if (i >= 0) list[i] = { ...list[i], ...p }; else list.push(p); }
      writeJson('providers', list);
    }
    if (b.look && typeof b.look === 'object') { const patch = {}; for (const k of ['theme', 'palette', 'appearance', 'accent', 'textSize']) if (typeof b.look[k] === 'string') patch[k] = b.look[k].slice(0, 60); saveSettings(patch); }
    const items = {};
    for (const [pid, k] of Object.entries(b.providerKeys || {})) if (/^[\w.-]{1,80}$/.test(pid) && k) items['provider:' + pid] = String(k);
    for (const n of ['braveKey', 'makeToken']) if (b.secrets && b.secrets[n]) items[n] = String(b.secrets[n]);
    if (Object.keys(items).length && secretStore) { secretStore.setMany(items); keyCache.clear(); }
    return { ok: true, ...out };
  }

  /** Files a phone or browser sends as bytes ({ kind:'file', name, data: base64 }): saved under the data folder and read
   *  the way the desktop reads an attached file (PDF, Word, Excel, CSV, text...); pictures become image attachments. */
  async function readUploads(list) {
    const out = [];
    for (const a of Array.isArray(list) ? list.slice(0, 10) : []) {
      if (a && a.kind === 'file' && typeof a.data === 'string' && typeof a.text !== 'string') {
        const r = await files.parseBuffer(String(a.name || 'file'), Buffer.from(a.data, 'base64'), path.join(dataDir, 'uploads')).catch((e) => ({ kind: 'error', error: e.message }));
        if (r.kind === 'image' && r.dataUrl) out.push({ kind: 'image', name: r.name, dataUrl: r.dataUrl });
        else if (r.kind === 'error') out.push({ kind: 'file', name: String(a.name || 'file'), text: `[could not read this file: ${r.error}]` });
        else out.push({ kind: 'file', name: r.name, text: `${r.path ? `(saved on the server at ${r.path})\n` : ''}${r.text || ''}`, ...(r.path ? { path: r.path } : {}), ...(r.truncated ? { truncated: true } : {}) });
      } else out.push(a);
    }
    return out;
  }
  function cleanAttachments(list) {
    const out = [];
    for (const a of Array.isArray(list) ? list.slice(0, 10) : []) {
      if (!a || typeof a !== 'object') continue;
      const name = String(a.name || 'file').replace(/[\u0000-\u001f/\\]/g, '_').slice(0, 120);
      if (a.kind === 'image' && typeof a.dataUrl === 'string' && /^data:image\/(png|jpeg|gif|webp);base64,/i.test(a.dataUrl) && a.dataUrl.length < 14e6) out.push({ kind: 'image', name, dataUrl: a.dataUrl });
      else if (a.kind === 'file' && typeof a.text === 'string') { const up = path.join(dataDir, 'uploads') + path.sep; out.push({ kind: 'file', name, text: a.text.slice(0, 400000), ...(typeof a.path === 'string' && path.resolve(a.path).startsWith(up) ? { path: path.resolve(a.path) } : {}), ...(a.text.length > 400000 || a.truncated ? { truncated: true } : {}) }); }
    }
    return out;
  }
  /** Server features beyond chat, for the desktop, mobile and web clients: /v1/x/<area>/... */
  async function serverApi(area, { method, parts, query, body, req, res, client }) {
    const projects = () => { const l = readJson('projects', []); return Array.isArray(l) ? l : []; };
    if (area === 'migrate') return migrateApi({ method, parts, query, body, req, client });
    if (area === 'secrets') {
      if (method === 'GET') return { names: secretStore.names(), keySource: secretStore.keySource() };
      if (method === 'POST') {
        const b = await body(); const items = {};
        for (const [pid, k] of Object.entries(b.providerKeys || {})) if (/^[\w.-]{1,80}$/.test(pid)) items['provider:' + pid] = String(k || '');
        for (const n of ['braveKey', 'makeToken', 'telegramToken']) if (b[n] !== undefined) items[n] = String(b[n] || '');
        secretStore.setMany(items); keyCache.clear();
        return { names: secretStore.names() };
      }
    }
    // ---- everything the desktop sidebar has, for the phone and web app ----
    const fail = (status, msg) => { throw Object.assign(new Error(msg), { status }); };
    if (area === 'import' && method === 'POST') { // chats the desktop has on its own (the phone and web app see them too); new messages are merged by id
      const b = await body();
      const list = (Array.isArray(b.chats) ? b.chats : []).filter((x) => x && !x.incognito).slice(0, 200).map((x) => ({ ...x, messages: (x.messages || []).map((m) => (m && m.steps ? { ...m, steps: m.steps.map((st) => ({ ...st, toolCalls: (st.toolCalls || []).map(({ image, ...t }) => t) })) } : m)) }));
      const r = sessions.importChats(list, { writer: 'desktop' });
      if (r.added || r.merged) mirror();
      return r;
    }
    if (area === 'brains' && method === 'GET') return { brains: brains.list().map((b) => ({ slug: b.slug, name: b.name, role: b.role || '', model: b.model || '' })), defaultBrain: settings().defaultBrain || '' };
    if (area === 'agents') {
      if (method === 'GET' && !parts[0]) return { agents: agents.list(null).map(({ file: _f, ...a }) => a) };
      if (method === 'POST') { const b = await body(); const r = agents.save({ name: b.name, role: b.role, description: b.description, body: b.body, tools: Array.isArray(b.tools) ? b.tools : undefined, model: b.model || '' }); if (r && r.ok === false) fail(400, r.error); return { agent: r }; }
      if (method === 'DELETE' && parts[0]) { const r = agents.remove(parts[0]); return { ok: !!(r && r.ok !== false) }; }
    }
    if (area === 'mentions' && method === 'GET') { // what "@" can pick in the composer, as on the desktop
      const st = settings();
      return { items: [
        ...readMcpList().filter((k) => k.enabled !== false).map((k) => ({ kind: 'connector', name: k.name || k.id })),
        ...(st.skillsEnabled !== false ? skills.list(null).filter((x) => x.enabled !== false).map((x) => ({ kind: 'skill', name: x.name })) : []),
        ...agents.list(null).map((a) => ({ kind: 'agent', name: a.name })),
        ...(st.makeEnabled !== false && getSecret('makeToken', 'makeTokenEnc') ? [{ kind: 'make', name: 'Make' }] : [])
      ] };
    }
    if (area === 'transcribe' && method === 'POST') { // the app's microphone: speech to text with the provider from Settings → Voice
      const b = await body();
      const r = await transcribe({ audio: Buffer.from(String(b.audio || ''), 'base64'), mime: String(b.mime || 'audio/mp4') });
      if (!r.ok) fail(400, r.error);
      return { text: r.text };
    }
    if (area === 'schedules') {
      if (method === 'GET' && !parts[0]) return { schedules: sched.list() };
      if (method === 'POST' && (!parts[0] || parts[0] === 'save')) { const b = await body(); try { return { schedule: sched.save(b) }; } catch (e) { fail(400, e.message); } }
      if (method === 'POST' && parts[0] && parts[1] === 'run') { sched.runNow(parts[0]).catch((e) => log('warn', 'schedule', e.message)); return { started: true }; }
      if (method === 'POST' && parts[0]) { const b = await body(); if (typeof b.enabled === 'boolean') sched.toggle(parts[0], b.enabled); return { schedule: sched.list().find((j) => j.id === parts[0]) || null }; }
      if (method === 'DELETE' && parts[0]) { sched.remove(parts[0]); return { ok: true }; }
    }
    if (area === 'automations' && method === 'GET') return { heartbeats: heartbeat.status(), hooks: hooks.list().map((h) => ({ ...h, urls: hookUrls(h) })) };
    if (area === 'artifacts' && method === 'GET') {
      const out = [];
      for (const r of db.all("SELECT id, title, updated_at, meta FROM sessions WHERE deleted_at IS NULL AND incognito = 0 AND meta LIKE '%\"artifacts\"%' ORDER BY updated_at DESC LIMIT 200")) {
        let meta = {}; try { meta = JSON.parse(r.meta); } catch {}
        for (const a of Object.values(meta.artifacts || {})) {
          const v = (a.versions || [])[(a.versions || []).length - 1] || '';
          out.push({ chatId: r.id, chatTitle: r.title || 'Untitled', id: a.id, title: a.title || 'Untitled', type: a.type || 'markdown', language: a.language || '', updatedAt: r.updated_at, content: parts[0] === a.id ? String(v) : String(v).slice(0, 400) });
        }
      }
      return { artifacts: parts[0] ? out.filter((a) => a.id === parts[0]) : out };
    }
    if (area === 'connectors' && method === 'GET') {
      const list = readMcpList();
      const st = mcp ? mcp.status(liveMcpList()) : [];
      return { connectors: list.map((c) => { if (isSelf(c)) return { id: c.id, name: c.name || c.id, type: c.type || '', enabled: false, state: 'off', error: 'Artemis itself (the Mac app). Not used on the server.', tools: 0 }; const x = st.find((y) => y.id === c.id || y.name === c.name) || {}; const raw = rawMcp().find((y) => y.id === c.id) || {}; const missing = (o) => Object.entries(o || {}).filter(([, v]) => !v).map(([k]) => k); return { id: c.id, name: c.name || c.id, type: c.type || '', url: c.url || '', enabled: c.enabled !== false, state: x.state || (mcp ? 'off' : 'disabled'), error: x.error || '', tools: x.tools || x.toolCount || 0, canSignIn: c.type === 'http' && !!c.url, signedIn: !!(c.oauth && c.oauth.accessToken), env: Object.keys(raw.env || {}), headers: Object.keys(raw.headers || {}), missing: [...missing(c.env), ...missing(c.headers)] }; }) };
    }
    if (area === 'sync' && method === 'POST') return syncFromDesktop(await body());
    if (area === 'connectors' && method === 'POST' && parts[0] && parts[1] === 'signin') { const b = await body(); return oauthStart(parts[0], b.base, { native: b.native === true }); }
    if (area === 'connectors' && method === 'POST' && parts[0] === 'oauth' && parts[1] === 'finish') { // the app caught artemis://oauth?code&state
      const b = await body(); const r = await oauthCallback({ code: String(b.code || ''), state: String(b.state || ''), error: String(b.error || '') });
      if (!r.ok) fail(400, r.message); return { ok: true };
    }
    if (area === 'connectors' && method === 'POST' && parts[0] && !parts[1]) { // switch on or off, or give it its keys (values are kept encrypted)
      const b = await body(); const id = parts[0];
      const list = rawMcp(); const c = list.find((x) => x.id === id);
      if (!c) fail(404, 'No connector with that id.');
      const next = { ...c };
      if (typeof b.enabled === 'boolean') next.enabled = b.enabled;
      if (b.env && typeof b.env === 'object') next.env = { ...(c.env || {}), ...keepVals(id, 'env', b.env) };
      if (b.headers && typeof b.headers === 'object') next.headers = { ...(c.headers || {}), ...keepVals(id, 'headers', b.headers) };
      if (b.signOut) delete next.oauth;
      saveRawMcp(list.map((x) => (x.id === id ? next : x)));
      return { ok: true };
    }
    if (area === 'skills') {
      if (method === 'GET') return { skills: skills.list(null).map((x) => ({ name: x.name, description: x.description || '', enabled: x.enabled !== false, source: x.source || '' })) };
      if (method === 'POST' && parts[0]) { const b = await body(); skills.setEnabled(parts[0], !!b.enabled, null); return { ok: true }; }
    }
    if (area === 'notes') {
      if (method === 'GET' && !parts[0]) return { notes: notes.list().filter((n) => !n.dir).map((n) => ({ path: n.path, name: n.name || n.path, mtime: n.mtime || 0 })).sort((a, b) => b.mtime - a.mtime) };
      if (method === 'GET' && parts[0] === 'read') { try { return notes.read(String(query.get('path') || '')); } catch (e) { fail(404, e.message); } }
      if (method === 'POST' && parts[0] === 'write') { const b = await body(); try { return notes.write(String(b.path || ''), String(b.text || '')); } catch (e) { fail(400, e.message); } }
    }
    if (area === 'files' && method === 'GET') {
      // the server's Files folder, the projects' folders and generated media; nothing else (the same places the agent writes)
      const roots = [path.resolve(filesDir()), ...projects().map((p) => p.folder).filter((f) => f && fs.existsSync(f)).map((f) => path.resolve(f)), ...['uploads', 'project-files'].map((d) => path.join(dataDir, d)).filter((d) => fs.existsSync(d)).map((d) => path.resolve(d))]; // + files sent from the phone, project files
      const raw = String(query.get('path') || '');
      const abs = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(roots[0], raw.replace(/^\/+/, ''));
      const root = roots.find((r) => abs === r || abs.startsWith(r + path.sep));
      if (!root) fail(403, 'That file is not in a folder the apps may open.');
      let real; try { real = fs.realpathSync(abs); } catch { fail(404, 'Not found'); }
      if (!roots.some((r) => real === r || real.startsWith(r + path.sep))) fail(403, 'That file is not in a folder the apps may open.');
      if (tools.isSensitive && tools.isSensitive(real)) fail(403, 'That file is protected.');
      const st0 = fs.statSync(real);
      const rel = path.relative(roots[0], real);
      if (st0.isDirectory()) return { path: root === roots[0] ? rel : real, entries: fs.readdirSync(real, { withFileTypes: true }).filter((e) => !e.name.startsWith('.')).map((e) => { let size = 0, mtime = 0; try { const x = fs.statSync(path.join(real, e.name)); size = x.size; mtime = x.mtimeMs; } catch {} return { name: e.name, dir: e.isDirectory(), size, mtime }; }).sort((a, b) => (b.dir - a.dir) || b.mtime - a.mtime) };
      if (parts[0] === 'text') return { path: raw, text: fs.readFileSync(real, 'utf8').slice(0, 2000000), size: st0.size, truncated: st0.size > 2000000 };
      if (parts[0] === 'raw') {
        const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf', mp4: 'video/mp4', mov: 'video/quicktime', mp3: 'audio/mpeg', wav: 'audio/wav', csv: 'text/csv; charset=utf-8', txt: 'text/plain; charset=utf-8', md: 'text/markdown; charset=utf-8', json: 'application/json', html: 'text/plain; charset=utf-8', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
        const ext = path.extname(real).slice(1).toLowerCase();
        res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'content-length': st0.size, 'cache-control': 'private, no-cache', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'", 'content-disposition': `inline; filename="${path.basename(real).replace(/[^\w.\- ]/g, '_')}"` });
        fs.createReadStream(real).pipe(res);
        return null;
      }
      if (parts[0] === 'docx') { // a Word document as HTML, as the desktop's document viewer shows it (mammoth: text escaped, no scripts)
        if (st0.size > 60 * 1024 * 1024) fail(413, 'This document is too large to preview (60 MB limit).');
        const mammoth = require('mammoth');
        const r = await mammoth.convertToHtml({ path: real }, { styleMap: ["p[style-name='Title'] => h1.doc-title:fresh", "p[style-name='Subtitle'] => p.doc-subtitle:fresh"] });
        return { path: raw, html: r.value };
      }
      if (parts[0] === 'sheet') { // xlsx and other spreadsheets as CSV text, so the apps can show them as a table
        const r = await files.parseAttachment(real).catch((e) => ({ error: e.message }));
        if (!r || r.error) fail(415, (r && r.error) || 'Cannot read that file');
        return { path: raw, text: String(r.text || '').slice(0, 2000000) };
      }
      return { path: raw, size: st0.size, mtime: st0.mtimeMs };
    }
    if (area === 'usage' && method === 'GET') {
      const all = allUsage(); const nowD = new Date();
      const dayStart = new Date(nowD.getFullYear(), nowD.getMonth(), nowD.getDate()).getTime();
      const monthStart = new Date(nowD.getFullYear(), nowD.getMonth(), 1).getTime();
      const prices = providersLib.priceMap(readProviders());
      const sum = (from) => all.filter((u) => u.t >= from).reduce((a, u) => { a.tokens += (u.prompt || 0) + (u.completion || 0); a.cost += costOf(u, prices) || 0; a.requests++; return a; }, { tokens: 0, cost: 0, requests: 0 });
      return { today: sum(dayStart), month: sum(monthStart), limits: limitState() };
    }
    if (area === 'providers' && method === 'GET') return { providers: readProviders().map((p) => ({ id: p.id, name: p.name || p.id, baseUrl: p.baseUrl || '', enabled: p.enabled !== false, needsKey: p.needsKey !== false, hasKey: !!getProviderKey(p.id), models: (p.models || []).map((m) => ({ id: m.id, name: m.name || m.id })) })) };
    if (area === 'themes' && method === 'GET') { // the desktop's palettes (built in, plus the user's own), for the phone and web app
      const out = new Map();
      for (const dir of [path.join(__dirname, '..', 'themes'), path.join(dataDir, 'themes')]) {
        let names = []; try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')); } catch {}
        for (const n of names) { try { const t = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')); if (t && t.id && t.vars) out.set(t.id, { id: t.id, name: t.name || t.id, family: t.family || '', about: t.about || '', dark: t.dark !== false, preview: t.preview || [], vars: t.vars }); } catch {} }
      }
      return { themes: [...out.values()] };
    }
    if (area === 'settings') { // the few settings the phone and web app change; the rest stays in the desktop's Settings
      const KEYS = ['model', 'personality', 'systemPrompt', 'profileName', 'profileAbout', 'profileLocation', 'gatewayRestrict', 'memoryEnabled', 'webEnabled', 'autoApproveEdits', 'theme', 'palette', 'appearance', 'accent', 'textSize'];
      if (method === 'POST') { const b = await body(); const patch = {}; for (const k of KEYS) if (b[k] !== undefined) patch[k] = b[k]; if (patch.model && !providersLib.parseModel(String(patch.model))) throw Object.assign(new Error('Unknown model id'), { status: 400 }); saveSettings(patch); }
      const st = settings(); return { settings: Object.fromEntries(KEYS.map((k) => [k, st[k] === undefined ? null : st[k]])), defaultModel: pickModel('') };
    }
    if (area === 'models' && method === 'GET') return { models: providersLib.modelEntries(readProviders()), default: pickModel('') };
    if (area === 'projects' && method === 'GET' && !parts[0]) return { projects: projects().map((p) => ({ id: p.id, name: p.name, instructions: p.instructions || '', folder: p.folder && fs.existsSync(p.folder) ? p.folder : '', color: p.color, icon: p.icon, pinned: !!p.pinned, sideHidden: !!p.sideHidden, files: (p.files || []).map((f) => ({ ...f, path: projectFiles.pathOf(p.id, f.id) || '' })) })) };
    if (area === 'projects' && parts[0] && parts[1] === 'files') { // the project's files (knowledge): add, remove, read
      const pid = parts[0]; const list = projects(); const p = list.find((x) => x.id === pid);
      if (!p) fail(404, 'No project with that id.');
      const save = (next) => writeJson('projects', projects().map((x) => (x.id === pid ? next : x)));
      if (method === 'POST' && !parts[2]) {
        const b = await body();
        if (typeof b.data !== 'string' || !b.data) fail(400, 'No file.');
        const meta = await projectFiles.add(pid, { id: b.id, name: b.name, buffer: Buffer.from(b.data, 'base64') });
        const cur = projects().find((x) => x.id === pid) || p;
        save({ ...cur, ...require('./project-files').mergeFiles({ files: (cur.files || []).filter((f) => f.id !== meta.id), filesGone: (cur.filesGone || []).filter((x) => x !== meta.id) }, { files: [meta] }) });
        return { file: { ...meta, path: projectFiles.pathOf(pid, meta.id) || '' } };
      }
      if (method === 'DELETE' && parts[2]) {
        projectFiles.remove(pid, parts[2]);
        save({ ...p, files: (p.files || []).filter((f) => f.id !== parts[2]), filesGone: [...(p.filesGone || []), parts[2]].slice(-500) });
        return { ok: true };
      }
      if (method === 'GET' && parts[2] && parts[3] === 'raw') {
        const f = projectFiles.pathOf(pid, parts[2]); if (!f) fail(404, 'Not found');
        const st = fs.statSync(f);
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': st.size, 'cache-control': 'private, no-cache', 'x-content-type-options': 'nosniff' });
        fs.createReadStream(f).pipe(res); return null;
      }
    }
    if (area === 'projects' && method === 'POST' && !parts[0]) { // a new project, from the phone or web app
      const b = await body();
      const name = String(b.name || '').trim().slice(0, 80);
      if (!name) fail(400, 'A project needs a name.');
      const p = { id: uid(), name, instructions: String(b.instructions || '').slice(0, 20000), createdAt: Date.now(), updatedAt: Date.now() };
      writeJson('projects', [...projects(), p]);
      return { project: { id: p.id, name: p.name, instructions: p.instructions, folder: '', pinned: false, sideHidden: false } };
    }
    if (area === 'projects' && parts[0] && (method === 'POST' || method === 'DELETE')) { // edit or delete, from the phone or web app
      const id = parts[0]; const list = projects(); const p = list.find((x) => x.id === id);
      if (!p) fail(404, 'No project with that id.');
      if (method === 'DELETE') {
        const tomb = readJson('projects-deleted', {}) || {}; tomb[id] = Date.now(); writeJson('projects-deleted', tomb);
        writeJson('projects', list.filter((x) => x.id !== id));
        try { fs.rmSync(path.join(dataDir, 'project-files', id), { recursive: true, force: true }); } catch {}
        let moved = 0; for (let k = 0; k < 20; k++) { const rows = sessions.page({ limit: 500, projectId: id }); if (!rows.length) break; for (const c of rows) { sessions.patchChat(c.id, { projectId: null }); moved++; } } // its chats stay, without a project
        return { ok: true, chats: moved };
      }
      const b = await body(); const next = { ...p, updatedAt: Date.now() };
      if (b.name !== undefined) { const n = String(b.name || '').trim().slice(0, 80); if (!n) fail(400, 'A project needs a name.'); next.name = n; }
      if (b.instructions !== undefined) next.instructions = String(b.instructions || '').slice(0, 20000);
      if (typeof b.pinned === 'boolean') next.pinned = b.pinned;
      if (typeof b.sideHidden === 'boolean') next.sideHidden = b.sideHidden;
      writeJson('projects', list.map((x) => (x.id === id ? next : x)));
      return { project: next };
    }
    if (area === 'sessions' && parts[0]) {
      if (method === 'DELETE' && parts.length === 1) { if (busyChat(parts[0])) throw Object.assign(new Error('Stop the running task first.'), { status: 409 }); return { ok: sessions.remove(parts[0]) }; }
      if (method === 'POST' && parts[1] === 'turn') { // a turn the desktop ran on its own computer, saved into the server chat
        if (busyChat(parts[0])) throw Object.assign(new Error('That chat is running a task on the server.'), { status: 409 });
        const b = await body();
        const u = b.user, a = b.assistant;
        const okId = (x) => x && /^[\w-]{1,64}$/.test(String(x.id || ''));
        if (!okId(u) || u.role !== 'user' || typeof u.content !== 'string' || !okId(a) || a.role !== 'assistant' || !Array.isArray(a.steps)) throw Object.assign(new Error('Bad turn'), { status: 400 });
        const prev = sessions.get(parts[0]);
        if (prev && prev.incognito) throw Object.assign(new Error('Incognito chat'), { status: 400 });
        const asst = { ...a, env: 'local' };
        const pid = b.projectId ? String(b.projectId) : (prev && prev.projectId) || null;
        sessions.startTurn(parts[0], { user: { ...u, attachments: cleanAttachments(u.attachments) }, assistant: asst, title: String(b.title || u.content || 'Chat'), source: client ? client.kind : 'desktop', model: b.model ? String(b.model) : '', projectId: pid });
        sessions.putMessage(parts[0], asst, { final: true });
        mirror();
        return { saved: true };
      }
      if (method === 'POST' && parts[1] === 'truncate') { // edit or regenerate: drop this message and what follows, then send again
        if (busyChat(parts[0])) throw Object.assign(new Error('Stop the running task first.'), { status: 409 });
        const b = await body(); const c = sessions.truncateFrom(parts[0], String(b.from || ''));
        if (!c) throw Object.assign(new Error('No such message'), { status: 404 });
        mirror(); return { count: c.messages.length };
      }
      if (method === 'POST' && parts[1] === 'compact') { if (busyChat(parts[0])) throw Object.assign(new Error('Stop the running task first.'), { status: 409 }); return compactChat(parts[0]); }
      if (method === 'POST' && parts.length === 1) { const b = await body(); const c = sessions.patchChat(parts[0], b); if (!c) throw Object.assign(new Error('No chat with that id'), { status: 404 }); mirror(); return { chat: { id: c.id, title: c.title, pinned: !!c.pinned, projectId: c.projectId || null } }; }
    }
    return undefined;
  }
  const busyChat = (id) => gw && gw.hub && gw.hub.busy(id);
  /** An incognito turn: nothing is saved and memory is off; the app keeps the conversation and sends it each time. */
  async function incognitoTurn({ runId, user, options, model, emit, ctx }) {
    const hist = (Array.isArray(options.history) ? options.history : []).slice(-60).filter((m) => m && (m.role === 'user' || m.role === 'assistant'));
    const modelId = pickModel(model || '');
    const tb = createTurnBuilder({ via: 'incognito', model: modelId, env: 'server' });
    if (ctx.setSnapshot) ctx.setSnapshot(() => tb.message());
    const o = pickOpts(options);
    const res = await run({ runId, messages: media.resolveMessages(toApiMessages([...hist, { ...user, attachments: cleanAttachments(user.attachments) }])), modelId, project: null, chatId: 'incognito', incognito: true, restrict: !!settings().gatewayRestrict,
      send: (ev) => { tb.apply(ev); emit(ev); }, brain: o.brain !== undefined ? o.brain : null, toolsMode: o.tools || '', agentsMode: o.agents || '', effort: o.effort || '', permMode: o.perm === 'auto' ? 'auto' : o.perm ? 'ask' : '' });
    tb.finish();
    if (res.error && !res.steps.length) throw new Error(res.error);
    return { sessionId: '', text: tb.text() || res.text };
  }
  /** Compact, as the desktop's button: the older messages become one summary card; the chat keeps every message. */
  async function compactChat(id) {
    const c = sessions.get(id);
    if (!c) throw Object.assign(new Error('No chat with that id'), { status: 404 });
    const msgs = c.messages || [];
    let at = Math.max(0, msgs.length - 4); while (at > 0 && msgs[at].role !== 'user') at--;
    let from = 0; for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i] && msgs[i].role === 'user' && msgs[i].compacted) { from = i; break; }
    if (at - (from + 1) < 2) throw Object.assign(new Error('There is not enough to compact yet.'), { status: 400 });
    const st = settings();
    const m = pickModel(st.compactModel || c.model || '');
    const r = providersLib.resolve(m, readProviders(), getProviderKey);
    if (r.error) throw Object.assign(new Error(r.error), { status: 400 });
    const summary = await summarizeAll(toApiMessages(msgs.slice(from, at)), { url: providersLib.joinUrl(r.baseUrl, 'chat/completions'), key: r.key, model: r.model, signal: AbortSignal.timeout(180000),
      onUsage: (u) => recordUsage({ t: Date.now(), model: m, chat: id, project: '', source: 'compact', prompt: u.prompt, completion: u.completion, cached: 0, estimated: false }) });
    const card = { id: uid(), role: 'user', compacted: at - from - (msgs[from] && msgs[from].compacted ? 1 : 0), createdAt: Date.now(),
      content: `[Summary of the earlier conversation — compacted to save tokens]\n${summary}\n\n[The earlier messages are still saved in this chat (id ${id}). When an exact detail is not in this summary, find it with search_chats or read it with read_chat (this id, offset to go further back) instead of asking the user.]` };
    sessions.setMessages(id, [...msgs.slice(0, at), card, ...msgs.slice(at)]);
    mirror();
    return { card };
  }
  const pickOpts = (o) => { const out = {}; for (const k of ['brain', 'tools', 'agents', 'effort', 'perm', 'mentions']) if (o[k] !== undefined && o[k] !== null) out[k] = o[k]; return out; };
  const migrations = createMigrations({
    dataDir, sessions, workspaceDir: () => (ws ? ws.dir : file('workspace')), secretStore, log: L('migrate'),
    backupDb: (f) => db.exec(`VACUUM INTO '${f.replace(/'/g, "''")}'`),
    onApplied: () => {
      keyCache.clear(); mirror();
      try { teams.reload(); } catch {}
      if (index) { try { index.reindex({ force: true }); } catch (e) { log('warn', 'memory', 'index: ' + e.message); } }
      if (mcp && settings().connectorsEnabled !== false) mcp.configure(liveMcpList()).catch((e) => log('warn', 'mcp', e.message));
    }
  });
  async function migrateApi({ method, parts, query, body, req, client }) {
    const [id, what] = parts;
    if (!id && method === 'GET') return { migrations: migrations.list() };
    if (!id && method === 'POST') return { migration: migrations.start((await body()).manifest, { client }) };
    if (id && !what && method === 'GET') return { migration: migrations.status(id, query.get('full') === '1') };
    if (id && !what && method === 'DELETE') return migrations.cancel(id);
    if (what === 'file' && method === 'PUT') return await migrations.receive(id, String(query.get('path') || ''), req);
    if (what === 'commit' && method === 'POST') { const b = await body(); return { migration: await migrations.commit(id, b.options || {}) }; }
    return undefined;
  }
  function token() {
    const t = process.env.ARTEMIS_GATEWAY_TOKEN || headlessCfg().token || secrets.decrypt(settings().gatewayTokenEnc);
    if (t) return t;
    const fresh = gatewayLib.newToken();
    writeJson('headless', { ...headlessCfg(), token: fresh }, 0o600);
    return fresh;
  }
  const handlers = {
    oauthCallback,
    info: () => ({ mode: 'headless', serverName: serverName || process.env.ARTEMIS_SERVER_NAME || os.hostname(), platform: process.platform, version: require('../../package.json').version, model: pickModel(''), sqlite: true, memory: !!ws, shell: sandbox() ? sandbox().mode : allowShell ? 'host' : false, browser: browserOn && browserAvailable(), computer: !!computer, telegram: !!(remote && remote.status().telegram.running), connectors: !!mcp }),
    async chat({ runId, sessionId, message, model, projectId, client, attachments = [], clientMessageId = '', options = {} }, emit, ctx = {}) {
      attachments = await readUploads(attachments);
      // the same turn as in the desktop window: full history (tool calls included), and the answer saved with its tool
      // cards, files and thinking, written while it streams so every client sees the run
      const sid = sessionId || 'gw-' + crypto.randomBytes(5).toString('hex');
      const prev = sessions.get(sid);
      if (prev && prev.incognito) throw new Error('That chat is incognito and cannot be continued from outside.');
      const modelId = pickModel(model || (prev && prev.model) || '');
      const pid = projectId || (prev && prev.projectId) || null;
      const via = client ? (client.kind === 'desktop' ? 'server' : client.kind) : 'gateway';
      const atts = cleanAttachments(attachments);
      const mentionsIn = Array.isArray(options && options.mentions) ? options.mentions.filter((x) => x && typeof x.name === 'string' && ['connector', 'skill', 'agent', 'make'].includes(x.kind)).slice(0, 20).map((x) => ({ kind: x.kind, name: x.name.slice(0, 80) })) : [];
      const user = { id: /^[\w-]{4,64}$/.test(clientMessageId) ? clientMessageId : uid(), role: 'user', content: message, createdAt: Date.now(), via, ...(atts.length ? { attachments: atts } : {}), ...(mentionsIn.length ? { mentions: mentionsIn } : {}) };
      if (options && options.incognito) return incognitoTurn({ runId, user, options, model, emit, ctx, client });
      const tb = createTurnBuilder({ via, model: modelId, env: 'server' });
      if (ctx.setSnapshot) ctx.setSnapshot(() => tb.message());
      const history = toApiMessages([...(prev ? prev.messages || [] : []), user]);
      sessions.startTurn(sid, { user, assistant: tb.message(), title: message || (atts[0] && atts[0].name) || 'Chat', source: client ? client.kind : 'gateway', model: modelId, projectId: pid });
      { const keep = pickOpts(options || {}); delete keep.mentions; if (Object.keys(keep).length) sessions.patchChat(sid, keep); } // the chat remembers its switches, like on the desktop
      mirror();
      let timer = null;
      const save = () => { timer = null; try { sessions.putMessage(sid, tb.message()); } catch (e) { log('warn', 'gateway', 'saving the answer so far failed: ' + e.message); } };
      const out = (ev) => { tb.apply(ev); emit(ev); if (!timer) { timer = setTimeout(save, 1500); if (timer.unref) timer.unref(); } };
      let res;
      try {
        // the chat's own switches (set in any app: brain, tools, agents, thinking, ask-first), then this message's
        const o = { ...pickOpts(prev || {}), ...pickOpts(options || {}) };
        res = await run({ runId, messages: media.resolveMessages(history), modelId, project: projectFor(pid), chatId: sid, send: out, restrict: !!settings().gatewayRestrict,
          brain: o.brain !== undefined ? o.brain : null, brainPick: (prev && prev.councilPick) || '', toolsMode: o.tools || '', agentsMode: o.agents || '', effort: o.effort || '', permMode: o.perm === 'auto' ? 'auto' : o.perm ? 'ask' : '', mentions: o.mentions || [] });
      } finally {
        if (timer) { clearTimeout(timer); timer = null; }
        const fresh = tb.artifacts();
        const old = (sessions.get(sid) || {}).artifacts || {};
        const merged = { ...old };
        for (const [k, v] of Object.entries(fresh)) merged[k] = { ...v, versions: [...((old[k] && old[k].versions) || []), ...v.versions].slice(-12) };
        const fin = tb.finish();
        const pick = fin.council && fin.council.verdict && fin.council.verdict.answerer;
        sessions.putMessage(sid, fin, { patch: { model: modelId, ...(pick ? { councilPick: pick } : {}), ...(Object.keys(fresh).length ? { artifacts: merged } : {}) }, final: true });
        mirror();
      }
      if (res.error && !res.steps.length) throw new Error(res.error);
      return { sessionId: sid, text: tb.text() || res.text };
    },
    abort: (id) => { const c = runs.get(id); if (!c) return false; c.abort(); return true; },
    phone: () => (remote ? remote.phone() : null),
    approve: (id, ok) => { const r = approvals.get(id); if (!r) return false; approvals.delete(id); r(!!ok); return true; },
    teams: {
      list: () => teams.list(), since: (ts) => teams.since(ts), save: (def) => teams.save(def || {}), remove: (id) => teams.remove(id),
      act: async (id, what, body = {}) => {
        if (what === 'say') { const t = teams.get(id); if (!t) throw Object.assign(new Error('That team no longer exists.'), { status: 404 }); teams.say(id, String(body.text || '')).catch((e) => log('warn', 'teams', e.message)); return teams.get(id); }
        if (what === 'notebook-clear') return teams.clearNotebook(id);
        if (!['start', 'pause', 'resume', 'stop'].includes(what)) throw Object.assign(new Error('Unknown action'), { status: 404 });
        return teams[what](id);
      }
    },
    sessions: { recent: (n, o = {}) => sessions.page({ limit: n, before: o.before, projectId: o.projectId, projects: readJson('projects', []) }), get: (id) => sessions.get(id), search: (q, n) => sessions.search(q, { limit: n, projects: readJson('projects', []) }) },
    media: { file: (name) => { const f = media.fileOf(name); return fs.existsSync(f) ? f : ''; } },
    extra: (area, o) => serverApi(area, o),
    memory: memoryApi ? { search: (q, n) => memoryApi.search(q, n), list: () => memoryApi.list(), add: (t) => memoryApi.add(t), note: (t) => memoryApi.note(t) } : null
  };
  // ---- Telegram (same bot code as the app) ----
  async function transcribe({ audio, mime }) {
    const st = settings();
    if (!st.voiceSttProvider) return { ok: false, error: 'Pick a speech-to-text provider in Settings → Voice (in the app).' };
    const r = providersLib.resolve(`prov:${st.voiceSttProvider}:x`, readProviders(), getProviderKey);
    if (r.error) return { ok: false, error: r.error };
    const buf = Buffer.from(audio || []);
    const ext = /mp4|m4a|aac/.test(mime || '') ? 'mp4' : /mpeg|mp3/.test(mime || '') ? 'mp3' : /wav/.test(mime || '') ? 'wav' : 'ogg';
    const form = new FormData();
    form.append('file', new Blob([buf], { type: mime || 'audio/ogg' }), `speech.${ext}`);
    form.append('model', st.voiceSttModel || 'whisper-1');
    const lang = String(st.voiceLanguage || '').toLowerCase();
    if (/^[a-z]{2,3}$/.test(lang)) form.append('language', lang);
    const url = providersLib.joinUrl(r.baseUrl, 'audio/transcriptions');
    const res = await fetch(url, { method: 'POST', headers: { ...providersLib.headersFor(url), ...(r.key ? { authorization: `Bearer ${r.key}` } : {}) }, body: form, signal: AbortSignal.timeout(90000) });
    const j = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, error: `Speech-to-text failed (HTTP ${res.status})` };
    const text = String((j && j.text) || '').trim();
    return text ? { ok: true, text } : { ok: false, error: 'No speech was recognised.' };
  }
  function makeRemote() {
    return createRemote({
      telegramApi, retryMs: 15000,
      transcribe, getSettings: settings, getSecret, setSecret, saveSettings,
      models: () => providersLib.modelEntries(readProviders()), readStore: (n) => readJson(n, []), mcpStatus: () => (mcp ? mcp.status(liveMcpList()) : []),
      memory: memoryApi || { list: () => [], add: () => ({}), remove: () => false },
      skillsList: () => skills.list(null).map((x) => ({ name: x.name, description: x.description, enabled: x.enabled })),
      chatsApi: { recent: (n) => sessions.recent(n, readJson('projects', [])), search: (q, n) => sessions.search(q, { limit: n, projects: readJson('projects', []) }), get: (id) => { const c = sessions.get(id); return c && !c.incognito ? c : null; }, turns: (c, n) => chatSearch.chatTurns(c, n) },
      appendToChat: (chatId, user, assistant) => { try { if (sessions.get(chatId)) { sessions.appendTurn(chatId, { user, assistant, via: 'telegram' }); mirror(); } } catch (e) { log('warn', 'telegram', 'could not save the turn: ' + e.message); } },
      notes: settings().notesAi !== false ? notes : null,
      teamsApi: { list: async () => teams.list(), agents: () => agents.list(null) },
      providersApi: { list: () => readProviders().map((p) => ({ key: p.id, name: p.name, on: p.enabled !== false })), set: (key, on) => { const l = readProviders(); const p = l.find((x) => x.id === key); if (p) { p.enabled = !!on; writeJson('providers', l); } } },
      liveModel: (m) => pickModel(m),
      summarize: async (messages) => {
        try {
          const st = settings(); const m = pickModel(st.remoteModel || st.model); const r = providersLib.resolve(m, readProviders(), getProviderKey);
          if (r.error) return { ok: false, error: r.error };
          const summary = await summarizeAll(messages, { url: providersLib.joinUrl(r.baseUrl, 'chat/completions'), key: r.key, model: r.model, signal: AbortSignal.timeout(120000), onUsage: (u) => recordUsage({ t: Date.now(), model: m, chat: '', project: '', source: 'compact', prompt: u.prompt, completion: u.completion, cached: 0, estimated: false }) });
          return { ok: true, summary };
        } catch (e) { return { ok: false, error: e.message }; }
      },
      desktopCompact: () => {},
      decide: (id, ok) => handlers.approve(id, ok), abort: (rid) => handlers.abort(rid),
      screenshot: async () => { if (!computer) throw new Error('Computer control is only available on macOS.'); const r = await computer.screenshot(); return r.image; },
      parseFile: files.parseAttachment,
      runChat: async ({ requestId, messages, send, session }) => {
        const st = settings();
        const linked = remote && remote.linked();
        const chatId = linked ? linked.id : 'phone-' + session;
        const prev = linked ? sessions.get(linked.id) : null;
        const modelId = pickModel(remote ? remote.control.currentModel() : st.remoteModel);
        const p = remote ? remote.control.resolveProject() : null;
        const project = p ? { name: p.name, instructions: p.instructions, knowledge: projectFiles.knowledge(p), ...(p.folder && fs.existsSync(p.folder) ? { folder: p.folder } : {}) } : (prev ? projectFor(prev.projectId) : null);
        const res = await run({ runId: requestId, messages, modelId, project, chatId, send, restrict: !st.remoteAllowDangerous });
        if (!linked) { // a phone conversation that is not continuing a saved chat: saved as its own chat, like the app does
          const last = messages[messages.length - 1]; const c = last && last.content;
          const text = typeof c === 'string' ? c : (c || []).filter((x) => x.type === 'text').map((x) => x.text).join(' ');
          try { sessions.appendTurn(chatId, { user: text, steps: res.steps.map((t) => ({ text: t, toolCalls: [] })), assistant: res.error ? `Error: ${res.error}` : '', via: 'telegram', source: 'phone', model: modelId, title: text }); mirror(); } catch {}
        }
      }
    });
  }

  let gw = null, tgTimer = null;
  async function listenWithRetry(make, tries = 12) {
    for (let i = 0; ; i++) {
      const g = make();
      try { return { g, addr: await g.start() }; } catch (e) {
        if (e.code !== 'EADDRINUSE' || i >= tries - 1 || !lockAlive('desktop')) throw e;
        log('info', 'gateway', 'the app still holds the port; waiting for it to hand over…');
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  async function start() {
    // one headless process per data folder; the app may run alongside
    const other = lockAlive('headless');
    if (other) throw Object.assign(new Error(`Another headless Artemis is already running on this data folder (process ${other.pid}). Stop it first.`), { code: 'BUSY' });
    fs.writeFileSync(file('headless.lock'), JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
    const appRunning = !!lockAlive('desktop');
    const p = port != null && port !== '' ? Number(port) : (Number(settings().gatewayPort) || 8789);
    const { g, addr } = await listenWithRetry(() => gatewayLib.createGateway({ host, port: p, token: token(), clients, publicHosts: publicHosts != null ? publicHosts : (process.env.ARTEMIS_PUBLIC_HOSTS || settings().serverPublicHosts || ''), allowedOrigins: allowedOrigins != null ? allowedOrigins : (process.env.ARTEMIS_ALLOWED_ORIGINS || settings().serverAllowedOrigins || ''), webRoot: webRoot != null ? webRoot : (process.env.ARTEMIS_WEB_ROOT || ''), log: L('gateway'), handlers }));
    gw = g;
    gatewayLib.writeDiscovery(file('gateway.json'), { mode: 'headless', host: host === '0.0.0.0' ? '127.0.0.1' : host, port: addr.port, token: token(), version: handlers.info().version });
    if (schedOn) {
      sched.start(); heartbeat.start();
      const syncHooks = () => hookService.sync().catch((e) => log('warn', 'webhooks', e.message));
      syncHooks(); hookTimer = setInterval(syncHooks, 5000); if (hookTimer.unref) hookTimer.unref(); // follows the settings the app writes
    }
    if (index) { try { index.reindex({ force: true }); } catch (e) { log('warn', 'memory', 'index: ' + e.message); } }
    if (mcp && settings().connectorsEnabled !== false) { // wait a little for the connectors, so the first message already has them
      const ready = mcp.configure(liveMcpList()).catch((e) => log('warn', 'mcp', e.message));
      await Promise.race([ready, new Promise((r) => setTimeout(r, 15000).unref())]);
      const st = mcp.status(); if (st.length) log('info', 'mcp', st.map((x) => `${x.name}: ${x.state}${x.error ? ' (' + x.error + ')' : ''}`).join(', '));
    }
    if (tgOn) {
      const go = () => { tgTimer = null; remote = makeRemote(); remote.reconfigure().then(() => { const t = remote.status().telegram; if (t.running) log('info', 'telegram', `bot ${t.botName ? '@' + t.botName : ''} connected${t.paired ? '' : ` (not paired yet: send the code ${t.pairCode} to the bot)`}`); else if (t.error) log('warn', 'telegram', t.error); }).catch((e) => log('warn', 'telegram', e.message)); };
      if (appRunning) tgTimer = setTimeout(go, 7000); else go(); // give the app time to let go of the bot
    }
    return { host, port: addr.port, appRunning };
  }
  async function stop() {
    if (tgTimer) clearTimeout(tgTimer);
    try { if (remote) remote.stop(); } catch {}
    try { sched.stop(); } catch {}
    try { heartbeat.stop(); } catch {}
    try { teams.flush(); } catch {}
    if (hookTimer) { clearInterval(hookTimer); hookTimer = null; }
    try { await hookService.stop(); } catch {}
    for (const c of runs.values()) { try { c.abort(); } catch {} }
    if (gw) await gw.stop();
    gatewayLib.removeDiscovery(file('gateway.json'));
    try { const cur = JSON.parse(fs.readFileSync(file('headless.lock'), 'utf8')); if (cur.pid === process.pid) fs.unlinkSync(file('headless.lock')); } catch {}
    if (mirrorTimer) { clearTimeout(mirrorTimer); mirrorTimer = null; try { writeJson('chats', sessions.toArray()); } catch {} }
    flushUsage();
    try { if (pw) await pw.close(); } catch {}
    try { if (mcp) mcp.close(); } catch {}
    db.close();
  }

  return { start, stop, handlers, clients, secretStore, migrations, sessions, workspace: ws, index, run, pickModel, getProviderKey, remote: () => remote, sandbox, browserAvailable, heartbeat, hooks, hookService, teams };
}

module.exports = { createHeadless };
