// Agent teams: one goal, a few role agents that plan, talk to each other in a shared room and check each other's work.
// This file keeps the state and decides who runs next. One agent turn is deps.runTurn (main.js wires it to runAgent),
// so the engine runs in tests without Electron or a model.
//
// A run: the lead (Artemis) splits the goal into tasks (team_plan) -> members work on the ready tasks, up to 3 at once,
// and can post to the room (team_post), ask a teammate (team_ask, answered right away) and finish (team_done) ->
// the reviewer, if the team has one, approves or sends the work back (team_review) -> the lead writes the final answer.
// The user can post at any time; after the end a message starts a follow-up round.

const prompts = require('./prompts');
const MAX_TEAMS = 50, MAX_MSGS = 400, MAX_TASKS = 24, MAX_PARALLEL = 3, MAX_REVIEW_ROUNDS = 2, MAX_ASKS = 3, MAX_FAILS = 2;
const MODES = ['lead', 'pipeline', 'open'];
const MAX_STEPS = 40, MAX_LOG = 80, PLAN_NOTE = 400;
const QUIET_TOOLS = new Set(['team_plan', 'team_post', 'team_done', 'team_review']); // already visible in the room
const LEAD = 'Artemis';
const rid = () => Math.random().toString(36).slice(2, 10);
/** Models do not know the date; without it they search for last year's news. */
const today = () => `Today is ${new Date().toDateString()}.`;
const clip = (s, n) => { const t = String(s == null ? '' : s).trim(); return t.length > n ? t.slice(0, n) + '…' : t; };
const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const abortErr = () => { const e = new Error('Stopped.'); e.name = 'AbortError'; return e; };
/** Some models write the team tools as text ("team_done(result=\"…\")") instead of calling them: read those, and the text without them. */
const textCalls = (text) => {
  const calls = [];
  const rest = String(text || '').replace(/`{0,3}\s*\b(team_(?:done|post|review|ask))\s*\(((?:[^()"]|"(?:[^"\\]|\\.)*")*)\)\s*`{0,3}/g, (_, name, body) => {
    const args = {};
    body.replace(/(\w+)\s*=\s*"((?:[^"\\]|\\.)*)"/g, (__, k, v) => { args[k] = v.replace(/\\n/g, '\n').replace(/\\(.)/g, '$1'); return ''; });
    calls.push({ name, args });
    return '';
  });
  return { calls, rest: rest.replace(/\n{3,}/g, '\n\n').trim() };
};
/** The few arguments worth showing for a step (path, query, url…), short. */
const brief = (args) => {
  const a = args && typeof args === 'object' ? args : {};
  const out = {};
  for (const k of ['path', 'from', 'to', 'query', 'url', 'command', 'name', 'pattern', 'question', 'title']) if (typeof a[k] === 'string' && a[k]) out[k] = clip(a[k], 160);
  if (Array.isArray(a.cells)) out.cells = a.cells.length;
  return out;
};

const LEAD_BODY = 'You lead a small team of AI agents. You never do the work yourself and never answer the goal from your own knowledge: you split the goal into clear tasks, give each to the member whose role fits, and at the end report what the team found. You have no web or file tools; your members do. Be brief and concrete.';
prompts.register('team.lead', { title: 'Team lead', description: 'Instructions of the lead (Artemis) in agent teams.', text: LEAD_BODY });

const TOOL_PLAN = {
  name: 'team_plan',
  description: 'Saves the team plan: the tasks, who does each and what each needs first. Call it once.',
  parameters: { type: 'object', properties: { tasks: { type: 'array', description: 'Tasks in the order they should happen (2 to 8 is usual)', items: { type: 'object', properties: {
    title: { type: 'string', description: 'What to do, as one self-contained instruction' },
    assignee: { type: 'string', description: 'Name of the member who does it' },
    after: { type: 'array', items: { type: 'integer' }, description: 'Numbers (1-based, in this list) of tasks that must be finished first' }
  }, required: ['title', 'assignee'] } } }, required: ['tasks'] }
};
const TOOL_POST = { name: 'team_post', description: 'Posts a short message to the team room (everyone sees it). Use to share something the others need, not for your final result.', parameters: { type: 'object', properties: { text: { type: 'string' }, to: { type: 'string', description: 'A member name, or empty for everyone' } }, required: ['text'] } };
const TOOL_ASK = { name: 'team_ask', description: 'Asks one teammate a question and returns their answer. Use when you need something only they know or can do.', parameters: { type: 'object', properties: { to: { type: 'string', description: 'Member name' }, question: { type: 'string' } }, required: ['to', 'question'] } };
const TOOL_DONE = { name: 'team_done', description: 'Finishes your task. The result is what your teammates and the user see: the deliverable itself, or which files you wrote and what is in them.', parameters: { type: 'object', properties: { result: { type: 'string' } }, required: ['result'] } };
const TOOL_REVIEW = { name: 'team_review', description: 'Gives your verdict on the work you are reviewing.', parameters: { type: 'object', properties: { verdict: { type: 'string', enum: ['approve', 'changes'] }, note: { type: 'string', description: 'What is wrong and how to fix it, or in one line why it is good' } }, required: ['verdict', 'note'] } };

/** When the team starts by itself: null (only by hand), or a scheduler repeat (daily, weekdays, interval, custom). */
function cleanRepeat(r) {
  if (!r || typeof r !== 'object' || !['daily', 'weekdays', 'weekly', 'interval', 'custom'].includes(r.type)) return null;
  const out = { type: r.type };
  if (/^\d{1,2}:\d{2}$/.test(r.at || '')) out.at = r.at;
  if (r.every) out.every = Math.max(5, Math.min(1440, Number(r.every) || 60));
  if (Array.isArray(r.days)) out.days = r.days.map(Number).filter((x) => x >= 0 && x <= 6);
  if (/^\d{1,2}:\d{2}$/.test(r.from || '') && /^\d{1,2}:\d{2}$/.test(r.to || '')) { out.from = r.from; out.to = r.to; }
  return out;
}
const NOTEBOOK_MAX = 12000;
// the member whose role checks the others' work (Reviewer, Editor, QA, Fact-checker …) reviews every finished task
const REVIEWER_ROLE = /review|editor|\bqa\b|quality|fact.?check|critic|proofread/i;
const MAX_HIRES = 3;
const TOOL_HIRE = { name: 'team_hire', description: 'Adds a new agent to the team when none of the members fits a task: give it a name, a role, instructions and the tool groups it needs. It is saved as one of the user\'s agents.', parameters: { type: 'object', properties: {
  name: { type: 'string', description: 'Short first name, unique' }, role: { type: 'string', description: 'Job title, e.g. Copywriter' },
  instructions: { type: 'string', description: 'How it works: what it does, how, and what it hands back' },
  tools: { type: 'array', items: { type: 'string' }, description: 'Tool groups: read, write, web, chats, make, browser, connectors, shell, phone, memory, automation' },
  model: { type: 'string', description: 'Model id, empty for the default' }
}, required: ['name', 'role', 'instructions'] } };

/** Checks and normalizes a team definition from the UI. Throws a readable error. */
function cleanDef(d, roster) {
  const name = clip(d && d.name, 60);
  if (!name) throw new Error('Give the team a name.');
  const goal = clip(d.goal, 4000);
  if (!goal) throw new Error('Write the goal for the team.');
  const members = [];
  for (const m of Array.isArray(d.members) ? d.members : []) {
    const a = roster.find((x) => same(x.name, m && m.name));
    if (!a || members.some((x) => same(x.name, a.name))) continue;
    members.push({ name: a.name, model: typeof m.model === 'string' ? m.model.slice(0, 200) : '' });
  }
  if (!members.length) throw new Error('Add at least one agent to the team.');
  const num = (v, max) => Math.max(0, Math.min(max, Number(v) || 0));
  return {
    name, goal, members, mode: MODES.includes(d.mode) ? d.mode : 'lead', leadModel: typeof d.leadModel === 'string' && !/^cli:/.test(d.leadModel) ? d.leadModel.slice(0, 200) : '',
    folder: typeof d.folder === 'string' ? d.folder.trim().slice(0, 1000) : '', // '' = the project's folder, else the Files folder
    projectId: typeof d.projectId === 'string' ? d.projectId.trim().slice(0, 100) : '', // the project the team works for: its folder, instructions and agents
    budgetUsd: num(d.budgetUsd, 1000), budgetTokens: Math.round(num(d.budgetTokens, 1e9)), minutes: num(d.minutes, 600), askWrites: d.askWrites !== false,
    canHire: !!d.canHire, rules: clip(d.rules, 4000), repeat: cleanRepeat(d.repeat)
  };
}

const freshRun = () => ({ status: 'idle', reason: '', tasks: [], messages: [], live: {}, spent: { usd: 0, tokens: 0 }, extraUsd: 0, extraMin: 0, workMs: 0, resumedAt: 0, startedAt: 0, endedAt: 0, rounds: 0 });

/**
 * deps: { load() -> {teams}, save(data), emit(team), roster(projectFolder?) -> [agent], runTurn(o) -> Promise<string>, project?(id) -> { id, name, folder, instructions } | null, now?, uid?, log? }
 * runTurn o: { agent: {name, role, body, tools, model}, prompt, extraTools, signal, askWrites, onUsage({prompt, completion, usd}), onApproval: {asked(info), done(id, ok)} }
 */
function createTeams(deps) {
  const now = deps.now || Date.now, uid = deps.uid || rid, log = deps.log || (() => {});
  let data = null;
  const live = new Map(); // team id -> { controller, driving, running: Map(task id -> promise) }
  let saveTimer = null;

  const store = () => {
    if (data) return data;
    const raw = deps.load() || {};
    data = { teams: Array.isArray(raw.teams) ? raw.teams : [] };
    for (const t of data.teams) { // the app was closed mid-run: nothing is running any more
      if (!t.run) t.run = freshRun();
      const r = t.run;
      r.live = {}; delete r.active;
      for (const k of r.tasks || []) if (k.status === 'doing') k.status = 'todo';
      for (const m of r.messages || []) if (m.kind === 'approval' && m.decided == null) m.decided = false;
      if (r.status === 'working' || r.status === 'planning') { r.status = 'paused'; r.reason = 'restart'; r.resumedAt = 0; }
    }
    return data;
  };
  const persist = () => { if (saveTimer) return; saveTimer = setTimeout(flush, 400); };
  const flush = () => { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; } if (data) { try { deps.save(data); } catch (e) { log('Could not save teams: ' + e.message); } } };
  const changed = (t) => { t.updatedAt = now(); persist(); try { deps.emit(t); } catch {} };
  const find = (id) => store().teams.find((t) => t.id === id);
  const need = (id) => { const t = find(id); if (!t) throw new Error('That team no longer exists.'); return t; };
  const L = (t) => { let l = live.get(t.id); if (!l) { l = { controller: null, driving: false, running: new Map() }; live.set(t.id, l); } return l; };

  /** The project a team works for, or null (no project, or it was deleted). */
  const projectOf = (t) => { if (!t || !t.projectId || !deps.project) return null; try { return deps.project(t.projectId) || null; } catch { return null; } };
  const rootOf = (t) => { const p = projectOf(t); return p && p.folder ? p.folder : ''; };
  /** Where the team's files go: its own folder, else its project's folder, else '' (the Files folder). */
  const folderOf = (t) => (t && t.folder) || rootOf(t);
  // the user's agents, plus the project's own agents when the team works for a project
  const roster = (t) => { try { return deps.roster(t ? rootOf(t) || null : null) || []; } catch { return []; } };
  const agentOf = (t, name) => {
    if (same(name, LEAD)) return { name: LEAD, role: 'Lead', body: prompts.text('team.lead', LEAD_BODY), tools: [], model: t.leadModel || '' };
    const m = t.members.find((x) => same(x.name, name));
    const a = m && roster(t).find((x) => same(x.name, m.name));
    return a ? { name: a.name, role: a.role || '', body: a.body || '', tools: a.tools || ['read'], model: m.model || a.model || '' } : null;
  };
  const reviewerOf = (t) => {
    if (t.members.length < 2) return null; // a one-agent team has nobody else to check it
    const r = roster(t);
    const m = t.members.find((x) => { const a = r.find((y) => same(y.name, x.name)); return a && REVIEWER_ROLE.test(a.role || ''); });
    return m ? m.name : null;
  };

  const post = (t, m) => {
    const msg = { id: uid(), t: now(), from: m.from || LEAD, to: m.to || '', text: clip(m.text, 8000), kind: m.kind || 'msg', ...(m.task ? { task: m.task } : {}), ...(m.extra || {}) };
    const list = t.run.messages;
    list.push(msg);
    if (list.length > MAX_MSGS) list.splice(0, list.length - MAX_MSGS);
    changed(t);
    return msg;
  };
  // Live activity: emitted at most every 250 ms while agents stream, never written to disk on its own.
  const pulses = new Map();
  const pulse = (t) => {
    if (pulses.has(t.id)) return;
    pulses.set(t.id, setTimeout(() => { pulses.delete(t.id); try { deps.emit(t); } catch {} }, 250));
  };

  // ---------- money and time ----------
  const budgetOf = (t) => (t.budgetUsd ? t.budgetUsd + (t.run.extraUsd || 0) : 0);
  const minutesOf = (t) => (t.minutes ? t.minutes + (t.run.extraMin || 0) : 0);
  const workMs = (t) => (t.run.workMs || 0) + (t.run.resumedAt ? now() - t.run.resumedAt : 0);
  const overLimit = (t) => {
    const b = budgetOf(t), m = minutesOf(t);
    if (b && t.run.spent.usd >= b) return 'budget';
    if (t.budgetTokens && t.run.spent.tokens >= t.budgetTokens + (t.run.extraTokens || 0)) return 'tokens';
    if (m && workMs(t) >= m * 60000) return 'time';
    return '';
  };
  const usage = (t) => (u) => {
    t.run.spent.tokens += (u.prompt || 0) + (u.completion || 0);
    t.run.spent.usd += Number(u.usd) || 0;
    if (u.priced === false && t.budgetUsd && !t.run.noPriceWarned) { // the $ budget cannot stop a run on a model without a price
      t.run.noPriceWarned = true;
      post(t, { kind: 'status', text: `No price is set for one of the models, so its cost counts as $0 and the $${t.budgetUsd} budget cannot stop it. Set prices in Settings → Models & providers, or give the team a token budget.` });
    }
    const why = t.run.status === 'working' && overLimit(t);
    if (why) halt(t, 'paused', why); else changed(t);
  };

  // ---------- prompts ----------
  const memberLine = (t, name) => { const a = agentOf(t, name); return a ? `- ${a.name}${a.role ? ` (${a.role})` : ''}: ${clip((roster(t).find((x) => same(x.name, a.name)) || {}).description, 200)} Tools: ${(a.tools || []).join(', ') || 'none'}.` : ''; };
  const taskLine = (t, k) => `#${t.run.tasks.indexOf(k) + 1} ${k.title} (${k.assignee}, ${k.status})`;
  const roomFor = (t, name, n = 14) => t.run.messages
    .filter((m) => (m.kind === 'msg' || m.kind === 'review' || m.kind === 'result') && (!name || !m.to || same(m.to, name) || same(m.from, name)))
    .slice(-n).map((m) => `${m.from === 'you' ? 'User' : m.from}${m.to ? ' → ' + m.to : ''}: ${clip(m.text, 600)}`).join('\n');

  const notebookFor = (t, n) => (t.notebook ? `Team notebook (what earlier runs did and learned, newest last):\n${t.notebook.length > n ? '…' + t.notebook.slice(-n) : t.notebook}` : '');
  const rulesFor = (t) => {
    const p = projectOf(t);
    const proj = p ? `The team works for the project "${p.name}"${p.folder ? ` (its folder is the team folder)` : ''}.${p.instructions ? `\nProject instructions from the user:\n${clip(p.instructions, 4000)}` : ''}` : '';
    return [proj, t.rules ? `Team rules from the user:\n${t.rules}` : ''].filter(Boolean).join('\n\n');
  };
  const planPrompt = (t, followUp) => [
    today(),
    `Team goal:\n${t.goal}`,
    rulesFor(t), notebookFor(t, 6000),
    t.canHire && (t.hires || 0) < MAX_HIRES ? 'If no member fits a task, team_hire adds a new agent first (only when really needed).' : '',
    `Members (assign tasks only to these names):\n${t.members.map((m) => memberLine(t, m.name)).join('\n')}`,
    reviewerOf(t) ? `${reviewerOf(t)} reviews every finished task automatically, so do not plan review tasks.` : '',
    t.mode === 'pipeline' ? 'Working style: pipeline. The tasks run one after another, each building on the one before.' : '',
    followUp ? `Tasks so far:\n${t.run.tasks.map((k) => taskLine(t, k)).join('\n')}\n\nThe user wrote after the team finished. Read the room below. If it asks for more work, call team_plan with only the NEW tasks. If it is just a question, answer it without calling team_plan.` : 'Call team_plan once. Keep tasks few, each a self-contained piece one member can finish alone. Use "after" when a task needs another one\'s result. Do not answer the goal yourself. After team_plan, reply with one or two sentences telling the team the plan, nothing else.',
    roomFor(t, '') ? `Team room:\n${roomFor(t, '')}` : ''
  ].filter(Boolean).join('\n\n');

  const depResults = (t, k) => (k.after || []).map((id) => t.run.tasks.find((x) => x.id === id)).filter((x) => x && x.result)
    .map((x) => `${taskLine(t, x)}\n${clip(x.result, 3000)}`).join('\n\n');

  const workPrompt = (t, k) => {
    const others = t.members.filter((m) => !same(m.name, k.assignee)).map((m) => m.name);
    return [
      `You are ${k.assignee}, working in a team${others.length ? ' with ' + others.join(', ') : ''}. ${LEAD} leads it. ${today()}`,
      `Team goal:\n${t.goal}`,
      rulesFor(t), notebookFor(t, 3000),
      `Your task (#${t.run.tasks.indexOf(k) + 1}): ${k.title}`,
      'A file the task mentions that does not exist yet is not an error: this may be the first run. Go on without it, and create it when the task needs it.',
      k.feedback ? `The reviewer sent it back. Fix this:\n${k.feedback}\n\nYour previous result:\n${clip(k.result, 3000)}` : '',
      depResults(t, k) ? `Results you build on:\n${depResults(t, k)}` : '',
      roomFor(t, k.assignee) ? `Team room (newest last):\n${roomFor(t, k.assignee)}` : '',
      `Do the task with your tools and stop as soon as you have enough: a few good sources beat many. If a page fails to load, do not retry similar addresses. ${others.length ? 'team_ask asks a teammate something only they know or can do (it is answered right away). ' : ''}team_post shares something the others need. When you are finished, call team_done with your result: the deliverable itself, or which files you wrote and what is in them. Call these as tools; writing them out as text does nothing. If you could not do the task, say so in team_done and why; never report something as done that you did not do.`
    ].filter(Boolean).join('\n\n');
  };

  const reviewPrompt = (t, k, reviewer) => [
    `You are ${reviewer}, reviewing ${k.assignee}'s work for the team. ${LEAD} leads it. ${today()}`,
    `Team goal:\n${t.goal}`, rulesFor(t), `Task: ${k.title}`, `Work submitted by ${k.assignee}:\n${clip(k.result, 6000)}`,
    'Check it: facts against sources you can reach, files it says it wrote, and whether it does what the task asked. Files the team wrote are in the team folder: open them with read_file or list_dir and the same paths (not with a connector, whose paths start somewhere else). Something the work says it posted, sent or published counts only with proof (a link, or a page you checked). Then call team_review (as a tool, not as text): "approve", or "changes" with what is wrong and how to fix it. Do not ask for polish that the goal does not need.'
  ].join('\n\n');

  // ---------- one agent turn ----------
  // run.live[turn id] = { name, what, task, steps: [{ id, name, args, status }], text, thinking } while the turn runs;
  // its steps are then kept on the task (task.log) so finished work can show what was done.
  // A turn cut off by Pause, Stop or a limit throws AbortError, so half-done work is never taken as finished;
  // out.keep() says the turn already handed in what counts (team_done, team_review) and its result stays.
  async function turn(t, name, prompt, extraTools, activity, taskId, out) {
    const agent = agentOf(t, name);
    if (!agent) throw new Error(`${name} is no longer one of your agents.`);
    const l = L(t);
    const signal = l.controller.signal;
    const id = uid();
    const live = { name: agent.name, what: activity || '', task: taskId || '', steps: [], text: '', thinking: false, since: now() };
    t.run.live = t.run.live || {};
    t.run.live[id] = live;
    changed(t);
    const onStep = (ev) => {
      if (!ev) return;
      if (ev.type === 'tool') {
        if (QUIET_TOOLS.has(ev.name)) return;
        live.steps.push({ id: String(ev.id || uid()), name: String(ev.name || ''), args: brief(ev.args), status: 'running' });
        if (live.steps.length > MAX_STEPS) live.steps.shift();
        live.thinking = false; live.text = '';
      } else if (ev.type === 'tool:done') {
        const st = live.steps.find((x) => x.id === String(ev.id));
        if (st) st.status = ev.denied ? 'denied' : ev.ok ? 'done' : 'error'; // a declined tool reports ok with denied
      } else if (ev.type === 'text') { live.text = (live.text + String(ev.text || '')).slice(-1500); live.thinking = false; }
      else if (ev.type === 'thinking') live.thinking = true;
      else if (ev.type === 'step') live.text = '';
      else if (ev.type === 'notice') { // the agent loop's own warnings (tools rejected, context compacted…): each one once per run
        const text = clip(ev.text, 400);
        if (out) out.notice = text;
        if (text && !t.run.messages.some((m) => m.kind === 'status' && m.notice === text)) post(t, { from: agent.name, kind: 'status', text, extra: { notice: text } });
        return;
      } else return;
      pulse(t);
    };
    try {
      const text = String(await deps.runTurn({
        agent, prompt, extraTools, signal, askWrites: t.askWrites, folder: folderOf(t), onUsage: usage(t), onStep, team: t.name,
        onApproval: {
          asked: (info) => { post(t, { from: agent.name, kind: 'approval', text: info.summary || 'Wants to use a tool', extra: { approvalId: info.id, decided: null } }); },
          done: (id, ok) => { const m = t.run.messages.find((x) => x.approvalId === id); if (m) { m.decided = !!ok; changed(t); } }
        }
      }) || '').trim();
      if (signal.aborted && !(out && out.keep && out.keep())) throw abortErr();
      return text;
    } finally {
      const done = live.steps.map((x) => ({ ...x, status: x.status === 'running' ? 'stopped' : x.status, by: agent.name }));
      if (out) out.steps = done;
      const k = taskId && t.run.tasks.find((x) => x.id === taskId);
      if (k && done.length) k.log = [...(k.log || []), ...done].slice(-MAX_LOG);
      if (t.run.live) delete t.run.live[id];
      changed(t);
    }
  }

  // ---------- planning ----------
  function addTasks(t, list, base) {
    const added = [], byNum = []; // byNum[i]: the task made from item i of the model's list ("after" counts in that list)
    for (const [i, raw] of (Array.isArray(list) ? list : []).entries()) {
      if (t.run.tasks.length >= MAX_TASKS) break;
      const title = clip(raw && raw.title, 500);
      if (!title) continue;
      let who = t.members.find((m) => same(m.name, raw.assignee));
      if (who && reviewerOf(t) && same(who.name, reviewerOf(t))) continue; // the reviewer checks every finished task anyway
      if (!who) who = t.members.find((m) => !same(m.name, reviewerOf(t))) || t.members[0];
      const after = t.mode === 'pipeline' ? (added.length ? [added[added.length - 1].id] : base ? [base] : [])
        : (Array.isArray(raw.after) ? raw.after : []).map((n) => byNum[Number(n) - 1]).filter(Boolean).map((x) => x.id);
      const k = { id: uid(), title, assignee: who.name, status: 'todo', after, result: '', feedback: '', rounds: 0, fails: 0 };
      t.run.tasks.push(k); added.push(k); byNum[i] = k;
    }
    return added;
  }

  async function plan(t, followUp) {
    if (t.mode === 'open' && !followUp) { // everyone takes the goal from their own angle, then the lead merges
      const workers = t.members.filter((m) => !same(m.name, reviewerOf(t)));
      addTasks(t, workers.map((m) => ({ title: `Your part of the goal, from your role as ${agentOf(t, m.name)?.role || 'a member'}. Coordinate with the others in the room.`, assignee: m.name })));
      post(t, { kind: 'plan', text: `Open floor: ${workers.map((m) => m.name).join(', ')} each take the goal from their side and coordinate in the room.`, extra: { tasks: t.run.tasks.map((k) => k.id) } });
      return;
    }
    let planned = null;
    const last = t.run.tasks[t.run.tasks.length - 1];
    const tool = { ...TOOL_PLAN, run: (a) => {
      if (planned) return 'The plan is already saved.';
      planned = addTasks(t, a.tasks, followUp && last ? last.id : '');
      return planned.length ? `Plan saved: ${planned.length} task${planned.length === 1 ? '' : 's'}.` : 'No valid tasks: give each a title and an assignee from the member list.';
    } };
    const tools = [tool];
    if (t.canHire && deps.hire) tools.push({ ...TOOL_HIRE, run: async (a) => {
      if ((t.hires || 0) >= MAX_HIRES) return `This team already hired ${MAX_HIRES} agents. Use the members you have.`;
      const r = await deps.hire({ name: a.name, role: a.role, body: a.instructions, tools: Array.isArray(a.tools) ? a.tools : ['read', 'web'], model: a.model || '' });
      if (!r || !r.ok) return 'Could not add the agent: ' + ((r && r.error) || 'unknown error');
      if (!t.members.some((m) => same(m.name, r.name))) t.members.push({ name: r.name, model: '' });
      t.hires = (t.hires || 0) + 1;
      post(t, { kind: 'status', text: `${LEAD} added ${r.name} (${clip(a.role, 40)}) to the team.` });
      return `${r.name} is now a member. Assign tasks to "${r.name}".`;
    } });
    const text = await turn(t, LEAD, planPrompt(t, followUp), tools, 'Planning', '', { keep: () => !!(planned && planned.length) });
    if (planned && planned.length) post(t, { kind: 'plan', text: clip(text, PLAN_NOTE) || `Split into ${planned.length} tasks.`, extra: { tasks: planned.map((k) => k.id) } });
    else if (followUp) { if (text) post(t, { text }); }
    else { // no plan: give the whole goal to the first worker so the run still does something
      addTasks(t, [{ title: t.goal, assignee: (t.members.find((m) => !same(m.name, reviewerOf(t))) || t.members[0]).name }]);
      post(t, { kind: 'plan', text: text || 'One task for now.', extra: { tasks: t.run.tasks.map((k) => k.id) } });
    }
  }

  // ---------- doing and reviewing a task ----------
  async function work(t, k) {
    let result = '', asks = 0;
    const tools = [
      { ...TOOL_POST, run: (a) => { post(t, { from: k.assignee, to: a.to && agentOf(t, a.to) ? agentOf(t, a.to).name : '', text: a.text, task: k.id }); return 'Posted.'; } },
      { ...TOOL_DONE, run: (a) => { result = clip(a.result, 20000); return 'Saved. You can stop now.'; } }
    ];
    if (t.members.length > 1) tools.push({ ...TOOL_ASK, run: async (a) => {
      const to = t.members.find((m) => same(m.name, a.to) && !same(m.name, k.assignee));
      if (!to) return `No teammate called "${a.to}". Ask one of: ${t.members.filter((m) => !same(m.name, k.assignee)).map((m) => m.name).join(', ')}.`;
      if (++asks > MAX_ASKS) return 'You have asked enough questions for this task. Finish it with what you have.';
      post(t, { from: k.assignee, to: to.name, text: a.question, task: k.id });
      const done = t.run.tasks.filter((x) => same(x.assignee, to.name) && x.result).map((x) => `${x.title}:\n${clip(x.result, 1500)}`).join('\n\n');
      const answer = await turn(t, to.name, [`You are ${to.name}, in a team working on:\n${t.goal}\n${today()}`, done ? `What you have done so far:\n${done}` : '', `Your teammate ${k.assignee} asks:\n${a.question}`, 'Answer briefly and concretely. Use your tools only if you have to.'].filter(Boolean).join('\n\n'), [], `Answering ${k.assignee}`, k.id);
      post(t, { from: to.name, to: k.assignee, text: answer || '(no answer)', task: k.id });
      return answer || `${to.name} had no answer.`;
    } });
    const out = { keep: () => !!result };
    const raw = await turn(t, k.assignee, workPrompt(t, k), tools, clip(k.title, 80), k.id, out);
    const { calls, rest: text } = textCalls(raw);
    const said = calls.filter((c) => c.name === 'team_done' && c.args.result).map((c) => c.args.result).pop() || '';
    for (const c of calls) if (c.name === 'team_post' && c.args.text) post(t, { from: k.assignee, to: c.args.to && agentOf(t, c.args.to) ? agentOf(t, c.args.to).name : '', text: c.args.text, task: k.id });
    if (!result && !text && !said) throw new Error(`${k.assignee} stopped without a result${out.notice ? ` (${out.notice.replace(/\.$/, '')})` : ''}.`);
    // the agent loop stopped the member (a tool kept failing, it kept repeating itself): its last words are the stop message, not the work
    if (!result && !said && out.notice && /^Stopped:/.test(out.notice)) throw new Error(`${k.assignee} did not finish: ${out.notice.replace(/^Stopped:\s*/, '').replace(/\.$/, '')}.`);
    k.result = result || text || clip(said, 20000);
    k.feedback = '';
    post(t, { from: k.assignee, text: clip(k.result, 1200), task: k.id, kind: 'result', extra: out.steps && out.steps.length ? { steps: out.steps } : {} });
  }

  async function review(t, k, reviewer) {
    let verdict = '', note = '';
    const tool = { ...TOOL_REVIEW, run: (a) => { verdict = a.verdict === 'changes' ? 'changes' : 'approve'; note = clip(a.note, 4000); return 'Verdict saved.'; } };
    const raw = await turn(t, reviewer, reviewPrompt(t, k, reviewer), [tool], `Reviewing ${k.assignee}'s work`, k.id, { keep: () => !!verdict });
    const { calls, rest: text } = textCalls(raw);
    const said = calls.filter((c) => c.name === 'team_review' && c.args.verdict).pop();
    if (!verdict && said) { verdict = said.args.verdict === 'changes' ? 'changes' : 'approve'; note = clip(said.args.note || text, 4000); }
    if (!verdict && !text) throw new Error(`${reviewer} stopped without a verdict.`);
    if (!verdict) { verdict = /\b(needs? fix|changes?|not ok|wrong)\b/i.test(text) ? 'changes' : 'approve'; note = clip(text, 4000); }
    k.rounds = (k.rounds || 0) + 1;
    if (verdict === 'changes' && k.rounds <= MAX_REVIEW_ROUNDS) {
      k.feedback = note; k.status = 'todo';
      post(t, { from: reviewer, to: k.assignee, kind: 'review', text: note, task: k.id, extra: { verdict: 'changes' } });
    } else {
      k.status = 'done';
      post(t, { from: reviewer, to: k.assignee, kind: 'review', text: verdict === 'changes' ? `${note}\n(Accepted after ${MAX_REVIEW_ROUNDS} rounds.)` : note, task: k.id, extra: { verdict: 'approve' } });
    }
  }

  async function step(t, k) {
    const reviewer = reviewerOf(t);
    if (k.status === 'review') return review(t, k, reviewer);
    k.status = 'doing'; changed(t);
    await work(t, k);
    k.status = reviewer && !same(reviewer, k.assignee) && !k.direct ? 'review' : 'done'; // an answer to the user is not reviewed
  }

  // ---------- the loop ----------
  const depsDone = (t, k) => (k.after || []).every((id) => { const d = t.run.tasks.find((x) => x.id === id); return !d || d.status === 'done'; });
  const whoRuns = (t, k) => (k.status === 'review' ? reviewerOf(t) : k.assignee);

  async function drive(t) {
    const l = L(t);
    if (l.driving) return;
    l.driving = true;
    try {
      while (t.run.status === 'working') {
        const why = overLimit(t);
        if (why) { halt(t, 'paused', why); break; }
        if (!t.run.tasks.length) { await plan(t, false); continue; }
        if (t.run.tasks.every((k) => k.status === 'done')) {
          if (l.running.size) { await Promise.race(l.running.values()); continue; }
          if (t.run.directOnly) { t.run.directOnly = false; finish(t, 'done'); break; } // only answered the user after the run: no new summary
          const summary = await turn(t, LEAD, [today(), `Team goal:\n${t.goal}`, `Finished tasks:\n${t.run.tasks.map((k) => `${taskLine(t, k)}\n${clip(k.result, 2500)}`).join('\n\n')}`, `Team room:\n${roomFor(t, '', 20)}`, 'All tasks are done. Write the final answer for the user from the results above only (do not add facts of your own): what the team delivered, files that were written, and anything left open or uncertain. Do not describe the process.'].join('\n\n'), [], 'Writing the summary');
          post(t, { kind: 'summary', text: summary || 'The team finished.' });
          if (summary) { const d = new Date(now()); const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; t.notebook = `${t.notebook ? t.notebook + '\n\n' : ''}## ${day}\n${clip(summary, 3000)}`.slice(-NOTEBOOK_MAX); }
          finish(t, 'done');
          break;
        }
        const busy = new Set([...l.running.keys()].map((id) => { const k = t.run.tasks.find((x) => x.id === id); return k && whoRuns(t, k); }).filter(Boolean).map((n) => n.toLowerCase()));
        const ready = t.run.tasks.filter((k) => (k.status === 'todo' || k.status === 'review') && !l.running.has(k.id) && depsDone(t, k));
        for (const k of ready) {
          if (l.running.size >= MAX_PARALLEL) break;
          const who = String(whoRuns(t, k) || '').toLowerCase();
          if (busy.has(who)) continue;
          busy.add(who);
          const p = step(t, k).then(() => { k.fails = 0; }, (e) => {
            if (k.status === 'doing') k.status = 'todo';
            if (l.controller.signal.aborted || (e && e.name === 'AbortError')) return;
            k.fails = (k.fails || 0) + 1;
            post(t, { kind: 'error', from: whoRuns(t, k) || LEAD, text: `${e && e.message ? e.message : e}`, task: k.id });
            if (k.fails >= MAX_FAILS) halt(t, 'failed', 'error');
          }).finally(() => { l.running.delete(k.id); changed(t); });
          l.running.set(k.id, p);
        }
        if (!l.running.size) { // nothing can start: a task waits on one that cannot finish; let the first waiting task go
          const stuck = t.run.tasks.find((k) => k.status === 'todo');
          if (!stuck) break;
          stuck.after = [];
          continue;
        }
        await Promise.race(l.running.values());
      }
    } catch (e) {
      if (!(l.controller && l.controller.signal.aborted)) { post(t, { kind: 'error', text: e && e.message ? e.message : String(e) }); halt(t, 'failed', 'error'); }
    } finally {
      l.driving = false;
      if (t.run.status === 'working' && !l.running.size) setTimeout(() => drive(t), 0); // something changed while finishing
    }
  }

  function begin(t) {
    const l = L(t);
    l.controller = new AbortController();
    t.run.status = 'working'; t.run.reason = ''; t.run.resumedAt = now();
    changed(t);
    drive(t);
  }
  function halt(t, status, reason) {
    const l = L(t);
    if (t.run.resumedAt) { t.run.workMs = (t.run.workMs || 0) + (now() - t.run.resumedAt); t.run.resumedAt = 0; }
    t.run.status = status; t.run.reason = reason || '';
    if (status !== 'working' && l.controller && !l.controller.signal.aborted) l.controller.abort();
    for (const k of t.run.tasks) if (k.status === 'doing') k.status = 'todo';
    t.run.live = {};
    if (status === 'paused' && (reason === 'budget' || reason === 'time' || reason === 'tokens')) {
      post(t, { kind: 'status', text: reason === 'budget' ? `Budget reached ($${t.run.spent.usd.toFixed(2)} of $${budgetOf(t)}). Resume to give the team another $${t.budgetUsd}.`
        : reason === 'tokens' ? `Token budget reached (${Math.round(t.run.spent.tokens / 1000)}k tokens). Resume to give the team another ${Math.round(t.budgetTokens / 1000)}k.`
        : `Time limit reached (${minutesOf(t)} min). Resume to give the team another ${t.minutes} min.` });
    }
    if (status === 'stopped' || status === 'failed') t.run.endedAt = now();
    changed(t);
  }
  function finish(t, status) { halt(t, status, ''); t.run.endedAt = now(); changed(t); }

  // ---------- public ----------
  return {
    list: () => store().teams,
    get: (id) => find(id) || null,
    save(def) {
      const s = store();
      const clean = cleanDef(def, roster(def && def.projectId ? { projectId: def.projectId } : null));
      if (def.id) {
        const t = need(def.id);
        Object.assign(t, clean);
        changed(t);
        return t;
      }
      if (s.teams.length >= MAX_TEAMS) throw new Error(`You can keep up to ${MAX_TEAMS} teams. Delete one first.`);
      const t = { id: uid(), createdAt: now(), ...clean, run: freshRun() };
      s.teams.unshift(t);
      changed(t);
      return t;
    },
    remove(id) {
      const s = store(); const t = find(id);
      if (!t) return false;
      if (t.run.status === 'working') halt(t, 'stopped', 'user');
      s.teams = s.teams.filter((x) => x.id !== id); live.delete(id);
      persist();
      return true;
    },
    /** Starts a new run (the old room and tasks are cleared). */
    start(id) {
      const t = need(id);
      if (t.run.status === 'working') return t;
      if (!t.members.length) throw new Error('Add at least one agent to the team.');
      t.run = { ...freshRun(), startedAt: now() };
      post(t, { from: 'you', text: t.goal, kind: 'msg' });
      begin(t);
      return t;
    },
    /** Teams changed after this time (the app follows a run in the background gateway with this). */
    since: (ts) => store().teams.filter((t) => (t.updatedAt || 0) > (Number(ts) || 0)),
    /** Forgets what is in memory so the next call reads teams.json again (another process ran the teams meanwhile). Only when nothing runs here. */
    reload() { if ([...live.values()].some((l) => l.driving || l.running.size)) return false; flush(); data = null; live.clear(); return true; },
    clearNotebook(id) { const t = need(id); t.notebook = ''; changed(t); return t; },
    isWorking: (id) => { const t = find(id); return !!(t && t.run.status === 'working'); },
    pause(id) { const t = need(id); if (t.run.status === 'working') halt(t, 'paused', 'user'); return t; },
    resume(id) {
      const t = need(id);
      if (t.run.status !== 'paused' && t.run.status !== 'failed') return t;
      if (t.run.reason === 'budget') t.run.extraUsd = (t.run.extraUsd || 0) + (t.budgetUsd || 0);
      if (t.run.reason === 'tokens') t.run.extraTokens = (t.run.extraTokens || 0) + (t.budgetTokens || 0);
      if (t.run.reason === 'time') t.run.extraMin = (t.run.extraMin || 0) + (t.minutes || 0);
      for (const k of t.run.tasks) k.fails = 0;
      begin(t);
      return t;
    },
    stop(id) { const t = need(id); if (t.run.status === 'working' || t.run.status === 'paused') halt(t, 'stopped', 'user'); return t; },
    /**
     * A message from the user. "@Name" makes that member answer and act on it next (its own task, ahead of the queue).
     * A paused or failed run picks up again (with another budget slice when a limit stopped it); after the end the lead
     * plans a follow-up round. Without a tag during a run, the members read it in their next turn.
     */
    async say(id, text) {
      const t = need(id);
      const body = clip(text, 4000);
      if (!body) return t;
      const mention = t.members.find((m) => new RegExp('@' + m.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(body));
      post(t, { from: 'you', to: mention ? mention.name : '', text: body });
      const direct = () => {
        const k = { id: uid(), title: clip(`The user wrote to you in the team room: "${body}". Answer them and do what they ask.`, 500), assignee: mention.name, status: 'todo', after: [], result: '', feedback: '', rounds: 0, fails: 0, direct: true };
        t.run.tasks.unshift(k); // first in line
        return k;
      };
      const st = t.run.status;
      if (st === 'working') {
        if (mention) { direct(); changed(t); drive(t); }
        else post(t, { kind: 'status', text: 'The members read this in their next step. Tag one with @ to have them answer right away.' });
        return t;
      }
      if (st === 'paused' || st === 'failed') {
        t.run.directOnly = false;
        if (mention) direct();
        if (t.run.reason === 'budget') t.run.extraUsd = (t.run.extraUsd || 0) + (t.budgetUsd || 0);
        if (t.run.reason === 'tokens') t.run.extraTokens = (t.run.extraTokens || 0) + (t.budgetTokens || 0);
        if (t.run.reason === 'time') t.run.extraMin = (t.run.extraMin || 0) + (t.minutes || 0);
        for (const k of t.run.tasks) k.fails = 0;
        begin(t);
        return t;
      }
      // done, stopped or not started yet
      if (!t.run.startedAt) t.run.startedAt = now();
      const l = L(t);
      l.controller = new AbortController();
      t.run.status = 'working'; t.run.reason = ''; t.run.resumedAt = now(); t.run.endedAt = 0; changed(t);
      if (mention) { direct(); t.run.directOnly = true; changed(t); drive(t); return t; }
      t.run.directOnly = false;
      try {
        const before = t.run.tasks.length;
        await plan(t, true);
        if (t.run.tasks.length > before) { drive(t); return t; }
        finish(t, 'done');
      } catch (e) {
        if (!l.controller.signal.aborted) { post(t, { kind: 'error', text: e.message }); halt(t, 'failed', 'error'); }
      }
      return t;
    },
    flush,
    /** For tests: resolves when the team is no longer working. */
    idle: (id) => new Promise((resolve) => { const tick = () => { const t = find(id); if (!t || (t.run.status !== 'working' && !L(t).running.size && !L(t).driving)) resolve(t); else setTimeout(tick, 5); }; tick(); })
  };
}

module.exports = { createTeams, cleanDef, MODES, LEAD, REVIEWER_ROLE };
