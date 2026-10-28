// Claude Code and Codex as team members: Artemis starts the CLI on this computer for one turn, and the CLI works with its
// own tools and on the user's own subscription login (Claude plan / ChatGPT plan): API-key variables are not passed on.
// The team tools reach it over a local MCP server with a token for this turn only; its JSON output becomes live steps.
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');

const KINDS = {
  claude: { bin: 'claude', label: 'Claude Code' },
  codex: { bin: 'codex', label: 'Codex' }
};
const PREFIX = 'cli:';
const kindOf = (model) => { const k = String(model || '').startsWith(PREFIX) ? String(model).slice(PREFIX.length).split(':')[0] : ''; return KINDS[k] ? k : ''; };
const modelOf = (model) => String(model || '').slice(PREFIX.length).split(':').slice(1).join(':'); // "cli:claude:haiku" -> "haiku"

// Claude Code's tool names, as Artemis's, so the room labels them the same way ("Read file", "Searched the web" …).
const CLAUDE_TOOLS = { Read: 'read_file', Write: 'write_file', Edit: 'edit_file', MultiEdit: 'edit_file', NotebookEdit: 'edit_file', Bash: 'run_command', Glob: 'search_files', Grep: 'search_files', LS: 'list_dir', WebSearch: 'web_search', WebFetch: 'web_fetch' };
const HIDDEN_CLAUDE = new Set(['ToolSearch', 'TodoWrite']); // Claude Code's own bookkeeping (loading MCP tools, its to-do list), not work
const claudeStep = (name, input) => {
  const n = String(name || '');
  const team = /^mcp__(team|artemis)__(.+)$/.exec(n); // our own MCP server: the team tools, or Artemis's tools in a chat
  if (team) return { name: team[2], args: input || {}, bridged: true };
  const a = input || {};
  const mapped = CLAUDE_TOOLS[n] || n;
  return { name: mapped, args: { path: a.file_path || a.notebook_path || a.path, query: a.query || a.pattern, pattern: a.pattern, url: a.url, command: a.command } };
};
/** What Claude Code wants to do, as one line for the approval card. */
const claudeAsk = (name, input) => {
  const a = input || {};
  if (name === 'Bash') return `Run: ${String(a.command || '').slice(0, 300)}`;
  if (/^(Write|Edit|MultiEdit|NotebookEdit)$/.test(name)) return `${name === 'Write' ? 'Write' : 'Edit'} ${a.file_path || a.notebook_path || 'a file'}`;
  if (name === 'WebFetch') return `Open ${a.url || 'a web page'}`;
  return `${name}${Object.keys(a).length ? ' ' + JSON.stringify(a).slice(0, 200) : ''}`;
};
// Variables that make the CLI bill an API key, a cloud provider or a gateway instead of the plan login (Claude Code's
// auth precedence puts all of these above /login). Stripped on purpose; CLAUDE_CODE_OAUTH_TOKEN is a plan token and stays.
const KEY_VARS = {
  claude: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY', 'ANTHROPIC_PROFILE', 'ANTHROPIC_FEDERATION_RULE_ID'],
  codex: ['OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL']
};
const SIGN_IN = {
  claude: 'Claude Code is not signed in: run `claude` once in a terminal and sign in with your Claude plan, then try again.',
  codex: 'Codex is not signed in: run `codex login` once in a terminal and sign in with ChatGPT, then try again.'
};
const NOT_SIGNED_IN = /not (logged|signed) in|run \/login|login expired|no codex credentials|codex login|refresh token|invalid (x-)?api key|authentication_error|unauthorized/i;
/** A CLI error as the room shows it: a sign-in hint when the CLI has no login, else the CLI's own words. */
const cliError = (kind, text) => new Error(NOT_SIGNED_IN.test(text) ? `${SIGN_IN[kind]} (${KINDS[kind].label} said: ${String(text).trim().slice(0, 200)})` : `${KINDS[kind].label}: ${text}`);
const unwrapShell = (cmd) => { const m = /^\/bin\/(?:zsh|bash|sh) -l?c '([\s\S]*)'$/.exec(String(cmd || '')); return m ? m[1] : String(cmd || ''); };

const resultText = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (x && x.type === 'text' ? x.text : '')).filter(Boolean).join('\n') : '').slice(0, 4000);

/** Reads Claude Code's stream-json, one parsed line at a time. Returns the final text when the run ends. */
function claudeReader(onStep, onUsage) {
  let final = null, error = '';
  return {
    line(j) {
      if (j.type === 'assistant' && j.message && Array.isArray(j.message.content)) {
        onStep({ type: 'step' });
        for (const c of j.message.content) {
          if (c.type === 'thinking' || c.type === 'redacted_thinking') onStep({ type: 'thinking', ...(c.thinking ? { text: c.thinking } : {}) });
          else if (c.type === 'text' && c.text) onStep({ type: 'text', text: c.text });
          else if (c.type === 'tool_use' && !HIDDEN_CLAUDE.has(c.name)) { const st = claudeStep(c.name, c.input); onStep({ type: 'tool', id: c.id, name: st.name, args: st.args, ...(st.bridged ? { bridged: true } : {}) }); }
        }
      } else if (j.type === 'user' && j.message && Array.isArray(j.message.content)) {
        for (const c of j.message.content) if (c.type === 'tool_result') { const t = resultText(c.content); onStep({ type: 'tool:done', id: c.tool_use_id, ok: !c.is_error, ...(t ? { text: t } : {}) }); }
      } else if (j.type === 'result') {
        const u = j.usage || {};
        onUsage({ prompt: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0), completion: u.output_tokens || 0, cached: u.cache_read_input_tokens || 0 });
        if (j.is_error || (j.subtype && j.subtype !== 'success')) error = String(j.result || j.error || j.subtype || 'Claude Code stopped');
        else final = String(j.result || '');
      }
    },
    end: () => ({ final, error })
  };
}

/** Reads Codex's --json events. */
function codexReader(onStep, onUsage) {
  let last = '', error = '', ended = false;
  const tool = (it, phase) => {
    if (it.type === 'command_execution') {
      if (phase === 'started') onStep({ type: 'tool', id: it.id, name: 'run_command', args: { command: unwrapShell(it.command) } });
      else onStep({ type: 'tool:done', id: it.id, ok: it.exit_code === 0 || it.status === 'completed' && it.exit_code == null });
    } else if (it.type === 'mcp_tool_call') {
      if (phase === 'started') onStep({ type: 'tool', id: it.id, name: String(it.tool || ''), args: it.arguments || {}, ...(it.server === 'artemis' || it.server === 'team' ? { bridged: true } : {}) });
      else onStep({ type: 'tool:done', id: it.id, ok: it.status !== 'failed' && !it.error });
    } else if (it.type === 'web_search') {
      if (phase === 'started') onStep({ type: 'tool', id: it.id, name: 'web_search', args: { query: it.query || '' } });
      else onStep({ type: 'tool:done', id: it.id, ok: true });
    } else if (it.type === 'file_change' && phase === 'completed') {
      for (const [i, ch] of (it.changes || []).entries()) {
        const id = `${it.id}:${i}`;
        onStep({ type: 'tool', id, name: ch.kind === 'add' ? 'write_file' : 'edit_file', args: { path: ch.path } });
        onStep({ type: 'tool:done', id, ok: it.status !== 'failed' });
      }
    }
  };
  return {
    line(j) {
      const it = j.item || {};
      if (j.type === 'item.started') tool(it, 'started');
      else if (j.type === 'item.completed') {
        if (it.type === 'agent_message' && it.text) { onStep({ type: 'step' }); onStep({ type: 'text', text: it.text }); last = it.text; }
        else if (it.type === 'reasoning') onStep({ type: 'thinking', ...(it.text ? { text: it.text } : {}) });
        else tool(it, 'completed');
      } else if (j.type === 'turn.completed') {
        ended = true;
        const u = j.usage || {};
        onUsage({ prompt: u.input_tokens || 0, completion: (u.output_tokens || 0) + (u.reasoning_output_tokens || 0), cached: u.cached_input_tokens || 0 });
      } else if (j.type === 'turn.failed') error = String((j.error && j.error.message) || 'Codex stopped');
      else if (j.type === 'error') error = String(j.message || 'Codex error');
    },
    end: () => ({ final: ended || last ? last : null, error })
  };
}

/** The command line for one turn. The prompt goes on stdin (Claude Code) or as the last argument (Codex). */
function argsFor(kind, { mcp, askWrites, system, folder, model, server = 'team', permissionMode }) {
  if (!mcp) { // a plain text answer for a background job (title, summary, memory): no tools, no MCP server
    if (kind === 'claude') return ['-p', '--output-format', 'stream-json', '--verbose', '--no-session-persistence', '--strict-mcp-config', '--tools', '', ...(system ? ['--system-prompt', system] : []), ...(model ? ['--model', model] : [])];
    return ['exec', '--json', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only', '-C', folder, ...(model ? ['-m', model] : [])];
  }
  if (kind === 'claude') {
    return [
      '-p', '--output-format', 'stream-json', '--verbose', '--no-session-persistence',
      '--strict-mcp-config', '--mcp-config', JSON.stringify({ mcpServers: { [server]: { type: 'http', url: mcp.url, headers: { Authorization: `Bearer ${mcp.token}` } } } }),
      '--allowedTools', `mcp__${server}`, // our tools never ask here (Artemis asks itself when a tool needs it); Claude Code's own tools follow the permission mode
      '--permission-prompt-tool', `mcp__${server}__${server}_permission`,
      '--permission-mode', permissionMode || (askWrites ? 'manual' : 'acceptEdits'),
      ...(system ? ['--append-system-prompt', system] : []),
      ...(model ? ['--model', model] : [])
    ];
  }
  return [
    'exec', '--json', '--ephemeral', '--skip-git-repo-check',
    '--sandbox', askWrites ? 'read-only' : 'workspace-write', // Codex cannot ask in the middle of a run: "ask before writing" keeps it read-only
    '-C', folder,
    '-c', `mcp_servers.${server}.url=${JSON.stringify(mcp.url)}`,
    '-c', `mcp_servers.${server}.bearer_token_env_var="ARTEMIS_TEAM_TOKEN"`,
    '-c', `mcp_servers.${server}.default_tools_approval_mode="approve"`, // exec never asks, so our tools must be allowed up front
    ...(model ? ['-m', model] : [])
  ];
}

/**
 * deps: { spawn, execFile, env, home, log }
 * run({ kind, model, prompt, system, folder, askWrites, signal, mcp: { url, token }, onStep, onUsage }) -> final text
 */
function createCliAgents(deps) {
  const env0 = deps.env || process.env, home = deps.home || os.homedir(), log = deps.log || (() => {});
  const found = new Map();
  const DIRS = [path.join(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', path.join(home, '.npm-global', 'bin'), path.join(home, '.bun', 'bin'), path.join(home, '.volta', 'bin')];

  /** Absolute path of a CLI, or ''. An app opened from the Finder does not get the shell's PATH, so: the native install
   *  (~/.local/bin, it brings its own runtime), then the one your terminal runs (an interactive shell, which loads nvm
   *  from .zshrc), then the usual folders. A Homebrew copy can run on a newer Node than the one you use in the terminal. */
  async function find(kind) {
    if (found.has(kind)) return found.get(kind);
    const bin = KINDS[kind].bin;
    const ok = (f) => { try { fs.accessSync(f, fs.constants.X_OK); return true; } catch { return false; } };
    let p = ok(path.join(DIRS[0], bin)) ? path.join(DIRS[0], bin) : '';
    if (!p && deps.execFile && process.platform !== 'win32') {
      const ask = (flags) => new Promise((resolve) => deps.execFile(env0.SHELL || '/bin/zsh', [flags, `command -v ${bin}`], { timeout: 8000 }, (err, out) => {
        const last = err ? '' : String(out || '').trim().split('\n').pop().trim();
        resolve(last && path.isAbsolute(last) && ok(last) ? last : '');
      }));
      p = (await ask('-ilc')) || (await ask('-lc'));
    }
    if (!p) p = DIRS.slice(1).map((d) => path.join(d, bin)).find(ok) || '';
    if (p) log(`${kind}: using ${p}`);
    found.set(kind, p);
    return p;
  }

  async function run(o) {
    const kind = o.kind;
    const bin = await find(kind);
    if (!bin) throw new Error(`${KINDS[kind].label} is not installed on this computer. Install it and sign in, then try again.`);
    if (!o.folder || !fs.existsSync(o.folder)) throw new Error(`The working folder does not exist: ${o.folder || '(none)'}`);
    const args = argsFor(kind, o);
    if (kind === 'codex') args.push([o.system, o.prompt].filter(Boolean).join('\n\n'));
    const env = { ...env0, PATH: [path.dirname(bin), ...DIRS, env0.PATH || ''].join(path.delimiter), ...(o.mcp ? { ARTEMIS_TEAM_TOKEN: o.mcp.token } : {}) };
    delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_NO_ATTACH_CONSOLE;
    const stripped = KEY_VARS[kind].filter((k) => k in env);
    for (const k of stripped) delete env[k];
    if (stripped.length) log(`${kind}: not passing ${stripped.join(', ')}, so it runs on the plan login`);
    const reader = (kind === 'claude' ? claudeReader : codexReader)(o.onStep || (() => {}), o.onUsage || (() => {}));
    return new Promise((resolve, reject) => {
      let child;
      try { child = deps.spawn(bin, args, { cwd: o.folder, env, stdio: ['pipe', 'pipe', 'pipe'] }); } catch (e) { return reject(e); }
      let buf = '', errTail = '', done = false;
      const finish = (fn) => { if (done) return; done = true; o.signal && o.signal.removeEventListener('abort', onAbort); fn(); };
      const onAbort = () => {
        try { child.kill('SIGTERM'); } catch {}
        setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 3000).unref?.();
        const e = new Error('Stopped'); e.name = 'AbortError';
        finish(() => reject(e));
      };
      if (o.signal) { if (o.signal.aborted) return onAbort(); o.signal.addEventListener('abort', onAbort, { once: true }); }
      child.stdout.on('data', (d) => {
        buf += d.toString('utf8');
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!line) continue;
          let j; try { j = JSON.parse(line); } catch { continue; }
          try { reader.line(j); } catch (e) { log(`${kind}: could not read an event: ${e.message}`); }
        }
      });
      child.stderr.on('data', (d) => { errTail = (errTail + d.toString('utf8')).slice(-2000); });
      child.on('error', (e) => finish(() => reject(e)));
      child.on('close', (code) => finish(() => {
        if (buf.trim()) { try { reader.line(JSON.parse(buf.trim())); } catch {} }
        const r = reader.end();
        if (errTail.trim()) log(`${kind} exited (${code}). Its error output:\n${errTail.trim()}`);
        // a Node crash ends with a stack and "Node.js vX": the line that says what went wrong is the "...Error: ..." one
        const lines = errTail.trim().split('\n').map((x) => x.trim()).filter(Boolean);
        const why = lines.find((x) => /^(\w*Error|Error)\b.*:|^error:/i.test(x)) || lines.filter((x) => !/^at |^Node\.js v/.test(x)).slice(-2).join(' ');
        const tail = String(why || '').slice(0, 400);
        if (r.error) return reject(cliError(kind, r.error));
        if (r.final === null) return reject(NOT_SIGNED_IN.test(tail) ? cliError(kind, tail) : new Error(`${KINDS[kind].label} exited (${code}) without an answer.${tail ? ' ' + tail : ''}`));
        resolve(r.final);
      }));
      if (kind === 'claude') child.stdin.end([o.prompt].join('')); else child.stdin.end();
    });
  }

  /** One text answer without tools, for background jobs: ask({ kind, model, system, prompt, signal, onUsage }) -> text */
  const ask = (o) => run({ kind: o.kind, model: o.model || '', system: o.system, prompt: o.prompt, folder: o.folder || os.tmpdir(), signal: o.signal, onUsage: o.onUsage });

  return { run, ask, find, available: async () => ({ claude: !!(await find('claude')), codex: !!(await find('codex')) }) };
}

/**
 * A Claude Code / Codex turn of an agent-team member. The team tools reach the CLI over a local MCP server of its own:
 * each turn gets a token that sees only that turn's tools (never Artemis's own MCP tools), dropped when the turn ends.
 * Claude Code's permission prompts come back through team_permission and go to ask() (the approval cards in the room).
 * deps: { cli (createCliAgents), createMcpServer, isLocked?, log?(level, message) }
 */
function createCliTeamTurn({ cli, createMcpServer, isLocked = () => false, log = () => {} }) {
  const sessions = new Map(); // token -> tools of one turn
  let server = null;
  async function url() {
    if (!server) server = createMcpServer({
      sessions: (token) => sessions.get(token) || null, isLocked,
      info: { name: 'artemis-team', version: '1.0.0' },
      instructions: 'Tools of the Artemis agent team you work in: post to the team room, ask a teammate, finish your task, review a teammate\'s work.',
      log: (lvl, msg) => log(lvl === 'warn' ? 'warn' : 'debug', msg)
    });
    if (!server.running()) await server.start(0);
    return `http://127.0.0.1:${server.port()}/mcp`;
  }
  /** o: { kind, agent, prompt, extraTools, signal, askWrites, folder, onStep, onUsage(u), ask(info) -> Promise<boolean> } -> final text */
  async function turn(o) {
    const token = crypto.randomBytes(24).toString('hex');
    const tools = (o.extraTools || []).map((t) => ({ name: t.name, description: t.description, inputSchema: t.parameters, run: t.run }));
    if (o.kind === 'claude') tools.push({
      name: 'team_permission', description: 'Asks the user whether a tool call may run.',
      inputSchema: { type: 'object', properties: { tool_name: { type: 'string' }, input: { type: 'object' }, tool_use_id: { type: 'string' } }, required: ['tool_name'] },
      run: async (a) => {
        const ok = await o.ask({ name: a.tool_name, category: 'team', summary: claudeAsk(a.tool_name, a.input) });
        return JSON.stringify(ok ? { behavior: 'allow', updatedInput: a.input || {} } : { behavior: 'deny', message: 'The user declined this. Carry on without it, or ask in the team room.' });
      }
    });
    sessions.set(token, tools);
    const a = o.agent || {};
    const system = [a.body, `You are ${a.name}${a.role ? `, the team's ${a.role}` : ''}, in an Artemis agent team. Your team tools are in the "team" MCP server (team_post, team_ask, team_done, team_review or team_plan when offered). Finish by calling the team tool your task asks for.`].filter(Boolean).join('\n\n');
    try {
      return await cli.run({ kind: o.kind, model: modelOf(a.model), prompt: o.prompt, system, folder: o.folder, askWrites: o.askWrites, signal: o.signal, mcp: { url: await url(), token }, onStep: o.onStep, onUsage: o.onUsage });
    } finally { sessions.delete(token); }
  }
  return { turn, available: () => cli.available(), stop: () => (server ? server.stop() : Promise.resolve()) };
}

/** A chat as one prompt: the CLI keeps no session here, so earlier turns go in as a transcript (newest kept when long). */
function transcript(messages, maxChars = 60000) {
  const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => (p && p.type === 'text' ? p.text : p && p.type === 'image_url' ? '[image]' : '')).filter(Boolean).join('\n') : '');
  const msgs = (messages || []).filter((m) => m && (m.role === 'user' || m.role === 'assistant'));
  if (!msgs.length) return '';
  const last = msgs[msgs.length - 1];
  const now = textOf(last.content).trim();
  const before = [];
  let size = 0;
  for (let i = msgs.length - 2; i >= 0; i--) {
    const t = textOf(msgs[i].content).trim();
    if (!t) continue;
    const line = `${msgs[i].role === 'user' ? 'User' : 'Assistant'}: ${t}`;
    if (size + line.length > maxChars) { before.unshift('[earlier messages left out]'); break; }
    before.unshift(line); size += line.length;
  }
  if (last.role !== 'user') return [...before, `Assistant: ${now}`].join('\n\n') + '\n\nContinue.';
  return before.length ? `The conversation so far:\n\n${before.join('\n\n')}\n\n---\nThe user's new message:\n${now}` : now;
}

/**
 * Claude Code / Codex as the model of a normal chat, on the user's own plan login. Artemis's tools (browser, Make,
 * connectors, memory, scheduling …) reach the CLI over a local MCP server named "artemis", with a token for this turn.
 * Claude Code's permission prompts come back through artemis_permission.
 * deps: { cli (createCliAgents), createMcpServer, isLocked?, log? }
 */
function createCliChat({ cli, createMcpServer, isLocked = () => false, log = () => {} }) {
  const sessions = new Map();
  let server = null;
  async function url() {
    if (!server) server = createMcpServer({
      sessions: (token) => sessions.get(token) || null, isLocked,
      info: { name: 'artemis', version: '1.0.0' },
      instructions: 'Artemis desktop app tools: its integrated browser, Make.com, the user\'s connectors, memory, notes, scheduled tasks, the phone and more.',
      log: (lvl, msg) => log(lvl === 'warn' ? 'warn' : 'debug', msg)
    });
    if (!server.running()) await server.start(0);
    return `http://127.0.0.1:${server.port()}/mcp`;
  }
  /** o: { kind, model, system, prompt, tools: [{ name, description, inputSchema, run }], folder, perm: 'ask'|'edits'|'auto', ask(info) -> Promise<bool>, signal, onStep, onUsage } */
  async function turn(o) {
    const token = crypto.randomBytes(24).toString('hex');
    const tools = [...(o.tools || [])];
    if (o.kind === 'claude') tools.push({
      name: 'artemis_permission', description: 'Asks the user whether a tool call may run.',
      inputSchema: { type: 'object', properties: { tool_name: { type: 'string' }, input: { type: 'object' }, tool_use_id: { type: 'string' } }, required: ['tool_name'] },
      run: async (a) => {
        const ok = o.perm === 'auto' ? true : await o.ask({ name: a.tool_name, category: /^(Bash)$/.test(a.tool_name) ? 'shell' : 'write', summary: claudeAsk(a.tool_name, a.input) });
        return JSON.stringify(ok ? { behavior: 'allow', updatedInput: a.input || {} } : { behavior: 'deny', message: 'The user declined this.' });
      }
    });
    sessions.set(token, tools);
    try {
      return await cli.run({
        kind: o.kind, model: o.model || '', prompt: o.prompt, system: o.system, folder: o.folder, signal: o.signal, server: 'artemis',
        askWrites: o.perm === 'ask', permissionMode: o.kind === 'claude' ? (o.perm === 'ask' ? 'default' : 'acceptEdits') : undefined,
        mcp: { url: await url(), token }, onStep: o.onStep, onUsage: o.onUsage
      });
    } finally { sessions.delete(token); }
  }
  return { turn, available: () => cli.available(), stop: () => (server ? server.stop() : Promise.resolve()) };
}

module.exports = { createCliAgents, createCliTeamTurn, createCliChat, transcript, kindOf, modelOf, argsFor, claudeReader, codexReader, claudeAsk, claudeStep, unwrapShell, cliError, KEY_VARS, KINDS, PREFIX };
