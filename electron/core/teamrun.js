// One turn of one agent-team member: a runAgent run with the member's tool groups plus the team's room tools.
// Shared by the app (main.js) and the background gateway (headless.js); each passes what it has (Make, the browser,
// connectors, the sandbox, the phone, memory, scheduling) through deps.tools().
//
// deps: {
//   runAgent, settings(), resolveModel(id) -> route | { error }, fallbackModel(), prices(), costOf(rec, prices),
//   recordUsage(rec), limitBlocked() -> '' | reason, filesDir(), userData,
//   tools({ caps, agent, team, runId }) -> { webEnabled, searchVia, chats, make, browser, mcp, sandbox, shellEnabled, phone, memoryEnabled, memoryApi, schedule },
//   approvals: { add(id, decide(ok)), drop(id) },   // where Allow/Deny from the window (or the gateway API) land
//   phone() -> { askApproval(id, text) } | null,        // Telegram buttons for approvals
//   notify?(title, body), stripThinkText(t), log(level, message),
//   cli?: createCliTeamTurn(...)                        // Claude Code / Codex members (the app only)
// }
const fs = require('fs');
const { toolNames } = require('../subagents');
const { kindOf: cliKind, KINDS: CLI_KINDS } = require('../cli-agents');

function createTeamRunner(deps) {
  const log = deps.log || (() => {});
  /** o: { agent, prompt, extraTools, signal, askWrites, onUsage, onApproval, onStep, team, folder } -> final text */
  return async function runTeamTurn({ agent, prompt, extraTools, signal, askWrites, onUsage, onApproval, onStep = () => {}, team = '', folder = '' }) {
    const st = deps.settings();
    const blocked = deps.limitBlocked();
    if (blocked) throw new Error(blocked);
    const root = folder && fs.existsSync(folder) ? folder : deps.filesDir(); // the team's folder, else the Files folder
    const mine = new Set();
    const onAbort = () => { for (const id of mine) deps.approvals.drop(id); };
    // an approval card in the room (and a notification, and Telegram buttons when paired); Stop declines what is open
    const approve = (info) => new Promise((resolve) => {
      const id = 'team-' + Math.random().toString(36).slice(2, 10);
      mine.add(id);
      deps.approvals.add(id, (ok) => { mine.delete(id); onApproval.done(id, ok); resolve(!!ok); });
      const summary = info.summary || info.name;
      onApproval.asked({ id, summary });
      try { if (deps.notify) deps.notify(`${agent.name} needs your OK`, String(summary).slice(0, 180)); } catch {}
      try { const ph = st.teamPhoneApprovals !== false && deps.phone && deps.phone(); if (ph && ph.askApproval) ph.askApproval(id, `${team ? `Team "${team}" · ` : ''}${agent.name} wants to:\n${summary}`).catch(() => {}); } catch {}
    });
    const cli = cliKind(agent.model);
    if (cli) { // Claude Code / Codex on the user's own login: no provider route, no per-token price
      if (!deps.cli) throw new Error(`${CLI_KINDS[cli].label} members run in the Artemis app, not in the background gateway.`);
      signal.addEventListener('abort', onAbort, { once: true });
      log('info', `${agent.name} started (${CLI_KINDS[cli].label})`);
      try {
        return await deps.cli.turn({
          kind: cli, agent, prompt, extraTools, signal, askWrites, folder: root, onStep, ask: approve,
          onUsage: (u) => {
            deps.recordUsage({ t: Date.now(), model: CLI_KINDS[cli].label, chat: '', project: '', source: 'team', prompt: u.prompt || 0, completion: u.completion || 0, cached: u.cached || 0, cacheWrite: 0, estimated: false });
            onUsage({ prompt: u.prompt || 0, completion: u.completion || 0, usd: 0, priced: false });
          }
        });
      } finally { signal.removeEventListener('abort', onAbort); }
    }
    const fallback = deps.fallbackModel();
    let model = agent.model && agent.model !== 'inherit' ? agent.model : fallback;
    let route = deps.resolveModel(model);
    if (route.error && model !== fallback) { log('warn', `${agent.name}: ${route.error} Using the chat model.`); model = fallback; route = deps.resolveModel(model); }
    if (route.error) throw new Error(route.error);
    const prices = deps.prices();
    const caps = new Set(agent.tools || []);
    const runId = 'team-' + Math.random().toString(36).slice(2, 10);
    const t = deps.tools({ caps, agent, team, runId }) || {};
    const steps = [''];
    signal.addEventListener('abort', onAbort, { once: true });
    log('info', `${agent.name} started (${model})`);
    try {
      await deps.runAgent({
        baseUrl: route.baseUrl, key: route.key, model: route.model, usageModel: model, noToolCalls: !!route.noTools, maxTokens: st.maxTokens, isSub: true, toolsEnabled: true, userData: deps.userData,
        memberCaps: caps, maxSteps: 40,
        messages: [{ role: 'user', content: prompt }], custom: '', project: null, root, defaultRoot: root === deps.filesDir(),
        webEnabled: t.webEnabled !== false && st.webEnabled !== false, searchVia: t.searchVia || null,
        shellEnabled: !!t.shellEnabled, sandbox: t.sandbox || null, computer: null, media: null,
        phone: t.phone || null, make: t.make || null, browser: t.browser || null, mcp: t.mcp || null, mcpLazy: false,
        memoryEnabled: !!t.memoryEnabled, memoryApi: t.memoryApi || null, schedule: t.schedule || null,
        skills: null, chats: t.chats || null, autoLearn: false, delegateEnabled: false,
        allowTools: toolNames(agent.tools || []), agentRole: agent.body || '', extraTools,
        // "ask me first" off: the members act on their own, like the user approving everything
        autoApprove: !askWrites, autoAll: !askWrites, shouldStop: () => deps.limitBlocked(),
        runTokenBudget: 600000, contextTokens: Number(st.contextTokens) || undefined,
        onUsage: (u) => {
          const rec = { t: Date.now(), model: u.model || model, chat: '', project: '', source: 'team', prompt: u.prompt || 0, completion: u.completion || 0, cached: u.cached || 0, cacheWrite: u.cacheWrite || 0, estimated: u.estimated };
          deps.recordUsage(rec);
          onUsage({ prompt: rec.prompt, completion: rec.completion, usd: deps.costOf(rec, prices), priced: !!(prices && prices[rec.model]) });
        },
        approve,
        send: (ev) => {
          if (ev.type === 'chunk' && !ev.agent) { steps[steps.length - 1] += ev.text; onStep({ type: 'text', text: ev.text }); }
          else if (ev.type === 'step:new') { steps.push(''); onStep({ type: 'step' }); }
          else if (ev.type === 'thinking') onStep({ type: 'thinking' });
          else if (ev.type === 'tool:call') onStep({ type: 'tool', id: ev.id, name: ev.name, args: ev.args });
          else if (ev.type === 'tool:result') onStep({ type: 'tool:done', id: ev.id, ok: !!ev.ok, denied: !!ev.denied });
          else if (ev.type === 'notice') { log('warn', `${agent.name}: ${ev.text}`); onStep({ type: 'notice', text: ev.text }); }
          else if (ev.type === 'error') log('warn', `${agent.name}: ${ev.message}`);
        },
        signal
      });
    } finally { signal.removeEventListener('abort', onAbort); }
    const strip = deps.stripThinkText || ((x) => x);
    return steps.map(strip).filter((x) => x.trim()).pop() || '';
  };
}

module.exports = { createTeamRunner };
