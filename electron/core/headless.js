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
const { runAgent } = require('../agent');
const providersLib = require('../providers');
const chatSearch = require('../chatsearch');
const { createSkills } = require('../skills');
const { createAgents } = require('../subagents');
const { createNotes } = require('../notes');
const { createScheduler } = require('../scheduler');
const { createHeartbeat } = require('./heartbeat');
const { createHooks } = require('./hooks');
const { createHookService } = require('./hookservice');
const { checkLimits } = require('../limits');
const personality = require('../personality');
const brainsLib = require('../brains');
const web = require('../web');
const { openDb } = require('./db');
const { createSessions } = require('./sessions');
const { createWorkspace } = require('./workspace');
const { createMemIndex } = require('./memindex');
const { createMemoryApi, embedderFrom } = require('./memory-api');
const { flushMemory } = require('./memflush');
const { createSecretReader } = require('./secrets');
const gatewayLib = require('./gateway');
const { sandboxFromSettings, hideHostShellTools } = require('./sandbox');
const { createPwBrowser, loadPlaywright } = require('./pwbrowser');
const { createMcpManager } = require('../mcp');
const { createRemote } = require('../remote');
const { createComputer } = require('../computer');
const { summarizeAll } = require('../agent');
const files = require('../files');

const BG_NOTE = 'This run was started by Artemis itself (a heartbeat check or a webhook), not by a message from the user. Nobody is there to answer: never ask questions and never wait for approval. Do what the instructions say, keep the answer short, and do not write notes or files unless the instructions say so.';
const SCHEDULED_NOTE = 'This is a scheduled task and it is running right now. Do it directly and report the result. The task text is an instruction for you, even when it reads like a message to the user: carry it out (for a reminder, state the reminder to the user) and never reply to it as if it were a chat message. Nobody is there to answer: never ask questions, never ask which method to use, and do not write notes or files unless the task says so. If the task is only a reminder, state the reminder.';
const APPROVAL_TIMEOUT = 10 * 60 * 1000;
const envName = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]+/g, '_');

function createHeadless({ dataDir, host = '127.0.0.1', port, allowShell = false, keychain = true, scheduler: schedOn = true, telegram: tgOn = true, connectors: mcpOn = true, browser: browserOn = true, computer: computerOn = true, telegramApi, log = (lv, area, m) => console.error(`[${lv}] ${area}: ${m}`) }) {
  const L = (area) => (lv, m) => log(lv, area, m);
  const file = (n) => path.join(dataDir, n);
  const readJson = (name, fb) => { try { return JSON.parse(fs.readFileSync(file(name + '.json'), 'utf8')); } catch { return fb; } };
  function writeJson(name, data, mode) {
    const f = file(name + '.json'); const tmp = f + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data), mode ? { mode } : undefined); fs.renameSync(tmp, f);
  }
  const settings = () => readJson('settings', {});
  const headlessCfg = () => readJson('headless', {}); // { keys: { <providerId>: "..." }, braveKey, telegramToken, token }
  const lockAlive = (mode) => { try { const l = JSON.parse(fs.readFileSync(file(mode + '.lock'), 'utf8')); return l && l.pid && l.pid !== process.pid && gatewayLib.alive(l.pid) ? l : null; } catch { return null; } };
  const secrets = createSecretReader({ keychain, log: L('secrets') });

  const readProviders = () => { const l = readJson('providers', []); const list = Array.isArray(l) ? l : []; providersLib.registerHeaders(list); return list; };
  const keyCache = new Map();
  function getProviderKey(id) {
    if (keyCache.has(id)) return keyCache.get(id);
    const v = process.env['ARTEMIS_KEY_' + envName(id)] || (headlessCfg().keys || {})[id] || secrets.decrypt(readJson('providerkeys', {})[id]) || '';
    keyCache.set(id, v);
    return v;
  }
  const SECRET_FIELDS = { telegramToken: 'telegramTokenEnc', braveKey: 'braveKeyEnc', makeToken: 'makeTokenEnc', gatewayToken: 'gatewayTokenEnc', hooksTunnelToken: 'hooksTunnelTokenEnc' };
  function getSecret(name, field = SECRET_FIELDS[name]) {
    return process.env['ARTEMIS_' + envName(name.replace(/([A-Z])/g, '_$1'))] || (name === 'telegramToken' && process.env.TELEGRAM_BOT_TOKEN) || headlessCfg()[name] || secrets.decrypt(settings()[field]) || '';
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
  const sessions = createSessions({ db, log: L('db'), writer: 'headless' });
  if (db.getMeta('chatsImported') !== '1') {
    const arr = readJson('chats', []);
    if (Array.isArray(arr) && arr.length) sessions.sync(arr);
    db.setMeta('chatsImported', '1');
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
  const docs = path.join(os.homedir(), 'Documents');
  const notesRoot = () => settings().notesFolder || (fs.existsSync(path.join(docs, 'Ares Notes')) ? path.join(docs, 'Ares Notes') : path.join(docs, 'Artemis Notes'));
  const notes = createNotes({ getRoot: notesRoot });
  const filesDir = () => { const d = fs.existsSync(path.join(docs, 'Artemis')) ? path.join(docs, 'Artemis') : file('files'); try { fs.mkdirSync(d, { recursive: true }); } catch {} return d; };
  const projectFor = (id) => { const p = id ? (readJson('projects', []) || []).find((x) => x.id === id) : null; return p ? { name: p.name, instructions: p.instructions, ...(p.folder && fs.existsSync(p.folder) ? { folder: p.folder } : {}) } : null; };

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
    const key = JSON.stringify([st.sandbox, st.sandboxImage, st.sandboxNetwork, st.sandboxMemory, st.sandboxCpus, st.sandboxSshHost, st.sandboxSshDir]);
    if (key !== sbCache.key) sbCache = { key, sb: sandboxFromSettings(st, L('sandbox')) };
    return sbCache.sb;
  };
  const MCP_ENC = 'enc:';
  const mcpDec = (v) => (typeof v === 'string' && v.startsWith(MCP_ENC) ? secrets.decrypt(v.slice(MCP_ENC.length)) : v);
  const mapVals = (o, f) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, f(v)])) : o);
  const mapMcp = (c, f) => (!c || typeof c !== 'object' ? c : { ...c, env: mapVals(c.env, f), headers: mapVals(c.headers, f), ...(c.clientSecret !== undefined ? { clientSecret: f(c.clientSecret) } : {}), ...(c.oauth && typeof c.oauth === 'object' ? { oauth: { ...c.oauth, accessToken: f(c.oauth.accessToken), refreshToken: f(c.oauth.refreshToken) } } : {}) });
  const readMcpList = () => { const l = readJson('mcp', []); return Array.isArray(l) ? l.map((c) => mapMcp(c, mcpDec)) : []; };
  const mcp = mcpOn ? createMcpManager() : null;
  if (mcp) mcp.setTokenSaver((id, oauth) => { // refreshed OAuth tokens: stored as plain values; the app encrypts them again when it starts
    try { const raw = readJson('mcp', []); writeJson('mcp', raw.map((c) => (c.id === id ? { ...c, oauth: { ...(c.oauth || {}), ...oauth } } : c)), 0o600); } catch (e) { log('warn', 'mcp', 'could not save refreshed tokens: ' + e.message); }
  });
  let pw = null, pwOk = null;
  const browserAvailable = () => { if (pwOk === null) { try { loadPlaywright(); pwOk = true; } catch { pwOk = false; } } return pwOk; };
  const browserFor = () => { if (!pw) pw = createPwBrowser({ profileDir: file('headless-browser'), channel: settings().headlessBrowserChannel || '', headless: settings().headlessBrowserVisible !== true, log: L('browser') }); return pw.agent(); };
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
  async function run({ runId, messages, modelId, project, chatId, send, unattended = false, allowEdits = false, restrict = false, system = '', source = '' }) {
    const st = settings();
    const route = providersLib.resolve(modelId, readProviders(), getProviderKey);
    if (route.error) throw new Error(route.error + (/key/i.test(route.error) ? ` Set ARTEMIS_KEY_${envName(String(modelId).split(':')[1] || '')} or add it to ${file('headless.json')}.` : ''));
    const lim = limitState();
    if (lim.blocked) throw new Error(lim.blocked);
    const controller = new AbortController();
    runs.set(runId, controller);
    const mine = new Set();
    controller.signal.addEventListener('abort', () => { for (const id of mine) { const r = approvals.get(id); if (r) { approvals.delete(id); r(false); } } }, { once: true });
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
        sessionId: chatId, userData: dataDir, mentions: [],
        baseUrl: route.baseUrl, key: route.key, model: route.model, noToolCalls: !!route.noTools, messages, maxTokens: st.maxTokens || 8192, reasoningEffort: st.reasoningEffort || '',
        custom: [st.systemPrompt || '', system].filter(Boolean).join('\n\n'), personality: personality.text(st), userName: st.profileName || '', userAbout: st.profileAbout || '', userLocation: st.profileLocation || '',
        project, root, defaultRoot: !(project && project.folder),
        sandbox: sandbox(), webEnabled: st.webEnabled !== false, searchVia: searchVia(st),
        // run_command: in the sandbox when one is set; on this machine only with --allow-shell, never for restricted runs
        shellEnabled: st.shellEnabled !== false && (!!sandbox() || (allowShell && !restrict)),
        computer: computer && st.computerEnabled !== false && !restrict && !unattended ? computer : null,
        browser: browserOn && st.browserTools !== false && !restrict && !unattended && browserAvailable() ? browserFor() : null,
        mcp: mcp && st.connectorsEnabled !== false ? (sandbox() ? hideHostShellTools(mcp) : mcp) : null, mcpLazy: st.connectorsLazy !== false, lazyTools: st.toolsLazy !== false, fullFileAccess: st.fullFileAccess !== false,
        phone: remote ? remote.phone() : null,
        schedule: unattended ? null : { list: () => sched.list(), save: (j) => sched.save(j), remove: (id) => sched.remove(id), hooks: hooksTools, heartbeat: heartbeatTools },
        notes: st.notesAi !== false ? notes : null,
        skills: st.skillsEnabled !== false ? { index: () => skills.indexText(project && project.folder), get: (n) => skills.get(n, project && project.folder), save: (o) => skills.save(o, project && project.folder) } : null,
        autoLearn: st.autoLearn !== false && !unattended,
        chats: st.chatSearchEnabled !== false ? { search: (q, n) => sessions.search(q, { limit: n, projects: readJson('projects', []) }), read: (id, last) => sessions.read(id, last) } : null,
        delegateEnabled: st.delegateEnabled !== false,
        agents: { find: (n) => agents.find(n, project && project.folder), list: () => agents.list(project && project.folder), index: () => agents.indexText(project && project.folder) },
        resolveModel: (id) => providersLib.resolve(id, readProviders(), getProviderKey), usageModel: modelId,
        computerHooks: { onStart() {}, onEnd() {} },
        shouldStop: () => limitState().blocked,
        runTokenBudget: Number(st.runTokenBudget) || undefined, contextTokens: Number(st.contextTokens) || undefined,
        toolsEnabled: st.toolsEnabled !== false, memoryEnabled: st.memoryEnabled !== false && !!memoryApi, incognito: false,
        memoryApi, onCompact: memoryApi && st.memoryFlush !== false ? (t) => flushFor(t, modelId, chatId) : null,
        onUsage: (u) => recordUsage({ t: Date.now(), model: u.model || modelId, chat: chatId || '', project: (project && project.name) || '', source: source || (unattended ? 'schedule' : 'gateway'), prompt: u.prompt, completion: u.completion, cached: u.cached || 0, cacheWrite: u.cacheWrite || 0, estimated: u.estimated }),
        autoApprove: unattended ? !!allowEdits : !!st.autoApproveEdits, autoAll: false, agentAutoApprove: false,
        approve: (info) => unattended ? Promise.resolve(info.category === 'phone' || (info.name === 'run_command' && !!sandbox())) : new Promise((resolve) => {
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
      const runId = 'sch-' + crypto.randomBytes(5).toString('hex');
      const modelId = pickModel(job.model || settings().scheduleModel);
      let res;
      if (job.reminder) res = { text: String(job.prompt || '').trim(), steps: [String(job.prompt || '').trim()], error: '' };
      else res = await run({ runId, messages: [{ role: 'user', content: job.prompt }], modelId, project: projectFor(job.projectId), chatId: runId, send: () => {}, unattended: true, allowEdits: job.allowEdits, restrict: true, system: SCHEDULED_NOTE });
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
  async function backgroundRun({ prompt, model, allowEdits, projectId, source }) {
    const modelId = pickModel(model || settings().scheduleModel);
    const runId = 'bg-' + crypto.randomBytes(5).toString('hex');
    const res = await run({ runId, messages: [{ role: 'user', content: prompt }], modelId, project: projectFor(projectId), chatId: runId, send: () => {}, unattended: true, allowEdits: !!allowEdits, restrict: true, system: BG_NOTE, source });
    return { text: res.text, error: res.error, model: modelId };
  }
  async function backgroundTell({ title, user, text, model, source, phone, icon }) {
    try { sessions.appendTurn('bg-' + crypto.randomBytes(5).toString('hex'), { user, assistant: text, title, via: source, source, model: model || '' }); mirror(); } catch (e) { log('warn', source, 'could not save the chat: ' + e.message); }
    if (!phone) return;
    const ph = remote && remote.phone();
    if (ph) await ph.send(`${icon} ${title}\n\n${String(text).slice(0, 3500)}`);
    else log('warn', source, `${title}: should go to the phone, but Telegram is not connected and paired`);
  }
  const heartbeat = createHeartbeat({
    settings, checklist: () => (ws ? ws.readText('HEARTBEAT.md') || '' : null),
    run: ({ prompt, model }) => backgroundRun({ prompt, model, source: 'heartbeat' }),
    deliver: ({ text, model }) => backgroundTell({ title: 'Heartbeat', user: 'Heartbeat check (HEARTBEAT.md)', text, model, source: 'heartbeat', phone: settings().heartbeatPhone !== false, icon: '💓' }),
    readState: () => readJson('heartbeat', {}), writeState: (x) => writeJson('heartbeat', x), log: L('heartbeat')
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
    status: () => ({ ...heartbeat.status(), checklist: (ws && ws.readText('HEARTBEAT.md')) || '' }),
    set: ({ checklist, every, enabled, from, to }) => {
      if (typeof checklist === 'string') { if (!ws) throw new Error('The heartbeat needs the memory workspace.'); const f = ws.abs('HEARTBEAT.md'); fs.writeFileSync(f + '.tmp', checklist.endsWith('\n') ? checklist : checklist + '\n'); fs.renameSync(f + '.tmp', f); }
      const patch = {};
      if (every !== undefined) patch.heartbeatEvery = Math.min(1440, Math.max(5, Number(every) || 30));
      if (enabled !== undefined) patch.heartbeatEnabled = !!enabled;
      if (from !== undefined) patch.heartbeatFrom = String(from || '');
      if (to !== undefined) patch.heartbeatTo = String(to || '');
      if (Object.keys(patch).length) writeJson('settings', { ...settings(), ...patch });
      return heartbeatTools.status();
    }
  };
  let hookTimer = null;

  // ---- gateway ----
  function token() {
    const t = process.env.ARTEMIS_GATEWAY_TOKEN || headlessCfg().token || secrets.decrypt(settings().gatewayTokenEnc);
    if (t) return t;
    const fresh = gatewayLib.newToken();
    writeJson('headless', { ...headlessCfg(), token: fresh }, 0o600);
    return fresh;
  }
  const handlers = {
    info: () => ({ mode: 'headless', version: require('../../package.json').version, model: pickModel(''), sqlite: true, memory: !!ws, shell: sandbox() ? sandbox().mode : allowShell ? 'host' : false, browser: browserOn && browserAvailable(), computer: !!computer, telegram: !!(remote && remote.status().telegram.running), connectors: !!mcp }),
    async chat({ runId, sessionId, message, model, projectId }, emit) {
      const sid = sessionId || 'gw-' + crypto.randomBytes(5).toString('hex');
      const prev = sessions.get(sid);
      if (prev && prev.incognito) throw new Error('That chat is incognito and cannot be continued from outside.');
      const modelId = pickModel(model);
      const pid = projectId || (prev && prev.projectId) || null;
      const res = await run({ runId, messages: [...(prev ? chatSearch.chatTurns(prev, 30) : []), { role: 'user', content: message }], modelId, project: projectFor(pid), chatId: sid, send: emit, restrict: !!settings().gatewayRestrict });
      sessions.appendTurn(sid, { user: message, steps: res.steps.map((t) => ({ text: t, toolCalls: [] })), assistant: res.error ? `Error: ${res.error}` : '', via: 'gateway', source: 'gateway', model: modelId, projectId: pid, title: message });
      mirror();
      if (res.error && !res.steps.length) throw new Error(res.error);
      return { sessionId: sid, text: res.text };
    },
    abort: (id) => { const c = runs.get(id); if (!c) return false; c.abort(); return true; },
    phone: () => (remote ? remote.phone() : null),
    approve: (id, ok) => { const r = approvals.get(id); if (!r) return false; approvals.delete(id); r(!!ok); return true; },
    sessions: { recent: (n) => sessions.recent(n, readJson('projects', [])), get: (id) => sessions.get(id), search: (q, n) => sessions.search(q, { limit: n, projects: readJson('projects', []) }) },
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
      models: () => providersLib.modelEntries(readProviders()), readStore: (n) => readJson(n, []), mcpStatus: () => (mcp ? mcp.status(readMcpList()) : []),
      memory: memoryApi || { list: () => [], add: () => ({}), remove: () => false },
      skillsList: () => skills.list(null).map((x) => ({ name: x.name, description: x.description, enabled: x.enabled })),
      chatsApi: { recent: (n) => sessions.recent(n, readJson('projects', [])), search: (q, n) => sessions.search(q, { limit: n, projects: readJson('projects', []) }), get: (id) => { const c = sessions.get(id); return c && !c.incognito ? c : null; }, turns: (c, n) => chatSearch.chatTurns(c, n) },
      appendToChat: (chatId, user, assistant) => { try { if (sessions.get(chatId)) { sessions.appendTurn(chatId, { user, assistant, via: 'telegram' }); mirror(); } } catch (e) { log('warn', 'telegram', 'could not save the turn: ' + e.message); } },
      notes: settings().notesAi !== false ? notes : null,
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
        const project = p ? { name: p.name, instructions: p.instructions, ...(p.folder && fs.existsSync(p.folder) ? { folder: p.folder } : {}) } : (prev ? projectFor(prev.projectId) : null);
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
    const { g, addr } = await listenWithRetry(() => gatewayLib.createGateway({ host, port: p, token: token(), log: L('gateway'), handlers }));
    gw = g;
    gatewayLib.writeDiscovery(file('gateway.json'), { mode: 'headless', host: host === '0.0.0.0' ? '127.0.0.1' : host, port: addr.port, token: token(), version: handlers.info().version });
    if (schedOn) {
      sched.start(); heartbeat.start();
      const syncHooks = () => hookService.sync().catch((e) => log('warn', 'webhooks', e.message));
      syncHooks(); hookTimer = setInterval(syncHooks, 5000); if (hookTimer.unref) hookTimer.unref(); // follows the settings the app writes
    }
    if (index) { try { index.reindex({ force: true }); } catch (e) { log('warn', 'memory', 'index: ' + e.message); } }
    if (mcp && settings().connectorsEnabled !== false) { // wait a little for the connectors, so the first message already has them
      const ready = mcp.configure(readMcpList()).catch((e) => log('warn', 'mcp', e.message));
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

  return { start, stop, handlers, sessions, workspace: ws, index, run, pickModel, getProviderKey, remote: () => remote, sandbox, browserAvailable, heartbeat, hooks, hookService };
}

module.exports = { createHeadless };
