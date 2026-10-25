// Claude Code / Codex team members (electron/cli-agents.js) and per-token tool sets on the MCP server.
// The event fixtures are trimmed from real runs of Claude Code 2.1 (stream-json) and Codex 0.163 (exec --json).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const { createCliAgents, createCliTeamTurn, kindOf, modelOf, argsFor, claudeReader, codexReader, claudeAsk, unwrapShell } = require('../electron/cli-agents');
const { createMcpServer } = require('../electron/mcp-server');

const CLAUDE = [
  { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/work/note.txt' } }] } },
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', is_error: false }] } },
  { type: 'assistant', message: { content: [{ type: 'text', text: 'hello from a file' }] } },
  { type: 'result', subtype: 'success', is_error: false, result: 'hello from a file', total_cost_usd: 0.0038, usage: { input_tokens: 4, output_tokens: 149, cache_read_input_tokens: 63191, cache_creation_input_tokens: 15380 } }
];
const CODEX = [
  { type: 'thread.started', thread_id: 't' }, { type: 'turn.started' },
  { type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: 'I’ll read note.txt.' } },
  { type: 'item.started', item: { id: 'item_1', type: 'command_execution', command: "/bin/zsh -lc 'cat note.txt'", exit_code: null, status: 'in_progress' } },
  { type: 'item.completed', item: { id: 'item_1', type: 'command_execution', command: "/bin/zsh -lc 'cat note.txt'", exit_code: 0, status: 'completed' } },
  { type: 'item.completed', item: { id: 'item_2', type: 'agent_message', text: 'hello from a file' } },
  { type: 'turn.completed', usage: { input_tokens: 34050, cached_input_tokens: 30080, output_tokens: 56, reasoning_output_tokens: 0 } }
];

function feed(reader, lines) { for (const l of lines) reader.line(l); return reader.end(); }

/** A fake child process that prints the given JSON lines, then exits. */
function fakeSpawn(lines, { code = 0, hang = false, stderr = '' } = {}) {
  const calls = [];
  const spawn = (bin, args, opts) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    let input = ''; child.stdin.on('data', (d) => (input += d));
    child.killed = []; child.kill = (sig) => { child.killed.push(sig); if (!child.exited) { child.exited = true; setImmediate(() => child.emit('close', null)); } };
    calls.push({ bin, args, opts, child, input: () => input });
    setImmediate(() => {
      if (stderr) child.stderr.write(stderr);
      for (const l of lines) child.stdout.write(JSON.stringify(l) + '\n');
      if (!hang) { child.exited = true; setImmediate(() => child.emit('close', code)); }
    });
    return child;
  };
  return { spawn, calls };
}

(async () => {
  // model ids: "cli:claude", "cli:codex:gpt-6-luna"
  assert.strictEqual(kindOf('cli:claude'), 'claude'); assert.strictEqual(kindOf('cli:codex:o4'), 'codex');
  assert.strictEqual(kindOf('prov:x:claude'), ''); assert.strictEqual(kindOf('cli:other'), '');
  assert.strictEqual(modelOf('cli:claude:haiku'), 'haiku'); assert.strictEqual(modelOf('cli:claude'), '');

  // command lines: the team server only, approvals through the permission tool, Codex read-only when it must ask
  const mcp = { url: 'http://127.0.0.1:5000/mcp', token: 'SECRET123' };
  let a = argsFor('claude', { mcp, askWrites: true, system: 'role', folder: '/w', model: '' });
  assert.ok(a.includes('--strict-mcp-config') && a.includes('stream-json'));
  assert.deepStrictEqual(JSON.parse(a[a.indexOf('--mcp-config') + 1]), { mcpServers: { team: { type: 'http', url: mcp.url, headers: { Authorization: 'Bearer SECRET123' } } } });
  assert.strictEqual(a[a.indexOf('--permission-mode') + 1], 'manual');
  assert.strictEqual(a[a.indexOf('--permission-prompt-tool') + 1], 'mcp__team__team_permission');
  assert.strictEqual(a[a.indexOf('--append-system-prompt') + 1], 'role');
  assert.ok(!a.includes('--model'));
  a = argsFor('claude', { mcp, askWrites: false, model: 'haiku' });
  assert.strictEqual(a[a.indexOf('--permission-mode') + 1], 'acceptEdits'); assert.strictEqual(a[a.indexOf('--model') + 1], 'haiku');
  a = argsFor('codex', { mcp, askWrites: true, folder: '/w' });
  assert.strictEqual(a[0], 'exec'); assert.strictEqual(a[a.indexOf('--sandbox') + 1], 'read-only'); assert.strictEqual(a[a.indexOf('-C') + 1], '/w');
  assert.ok(a.includes('mcp_servers.team.url="http://127.0.0.1:5000/mcp"'));
  assert.ok(a.includes('mcp_servers.team.default_tools_approval_mode="approve"'), 'Codex may call the team tools without asking');
  assert.ok(!a.join(' ').includes('SECRET123'), 'the Codex token goes in the environment, not the command line');
  assert.strictEqual(argsFor('codex', { mcp, askWrites: false, folder: '/w' })[argsFor('codex', { mcp, askWrites: false, folder: '/w' }).indexOf('--sandbox') + 1], 'workspace-write');
  console.log('cli-agents: command lines ok');

  // reading Claude Code's stream-json
  let steps = [], usage = [];
  let r = feed(claudeReader((e) => steps.push(e), (u) => usage.push(u)), CLAUDE);
  assert.strictEqual(r.final, 'hello from a file'); assert.strictEqual(r.error, '');
  const tool = steps.find((e) => e.type === 'tool');
  assert.deepStrictEqual([tool.name, tool.args.path], ['read_file', '/work/note.txt'], 'Claude Code tools get Artemis names');
  assert.deepStrictEqual(steps.find((e) => e.type === 'tool:done'), { type: 'tool:done', id: 'toolu_1', ok: true });
  assert.ok(steps.some((e) => e.type === 'text' && e.text === 'hello from a file'));
  assert.deepStrictEqual(usage, [{ prompt: 4 + 63191 + 15380, completion: 149, cached: 63191 }]);
  steps = [];
  feed(claudeReader((e) => steps.push(e), () => {}), [{ type: 'assistant', message: { content: [{ type: 'tool_use', id: 's', name: 'ToolSearch', input: { query: 'select:mcp__team__team_done' } }, { type: 'tool_use', id: 'x', name: 'mcp__team__team_done', input: { result: 'r' } }, { type: 'tool_use', id: 'y', name: 'Bash', input: { command: 'ls' } }] } }]);
  assert.deepStrictEqual(steps.filter((e) => e.type === 'tool').map((e) => [e.name, e.args.command || e.args.result]), [['team_done', 'r'], ['run_command', 'ls']]);
  r = feed(claudeReader(() => {}, () => {}), [{ type: 'result', subtype: 'error_max_turns', is_error: true, result: 'Reached max turns' }]);
  assert.strictEqual(r.final, null); assert.match(r.error, /max turns/);
  assert.strictEqual(claudeAsk('Bash', { command: 'npm test' }), 'Run: npm test');
  assert.strictEqual(claudeAsk('Edit', { file_path: '/w/a.js' }), 'Edit /w/a.js');
  assert.strictEqual(claudeAsk('Write', { file_path: '/w/b.md' }), 'Write /w/b.md');
  console.log('cli-agents: Claude Code events ok');

  // reading Codex's events
  steps = []; usage = [];
  r = feed(codexReader((e) => steps.push(e), (u) => usage.push(u)), CODEX);
  assert.strictEqual(r.final, 'hello from a file');
  assert.deepStrictEqual(steps.filter((e) => e.type === 'tool').map((e) => [e.name, e.args.command]), [['run_command', 'cat note.txt']]);
  assert.deepStrictEqual(steps.find((e) => e.type === 'tool:done'), { type: 'tool:done', id: 'item_1', ok: true });
  assert.deepStrictEqual(usage, [{ prompt: 34050, completion: 56, cached: 30080 }]);
  steps = [];
  feed(codexReader((e) => steps.push(e), () => {}), [
    { type: 'item.started', item: { id: 'm', type: 'mcp_tool_call', server: 'team', tool: 'team_post', arguments: { text: 'hi' }, status: 'in_progress' } },
    { type: 'item.completed', item: { id: 'm', type: 'mcp_tool_call', server: 'team', tool: 'team_post', status: 'completed' } },
    { type: 'item.completed', item: { id: 'f', type: 'file_change', status: 'completed', changes: [{ path: '/w/a.md', kind: 'add' }, { path: '/w/b.md', kind: 'update' }] } }
  ]);
  assert.deepStrictEqual(steps.filter((e) => e.type === 'tool').map((e) => [e.name, e.args.path || e.args.text]), [['team_post', 'hi'], ['write_file', '/w/a.md'], ['edit_file', '/w/b.md']]);
  r = feed(codexReader(() => {}, () => {}), [{ type: 'turn.failed', error: { message: 'usage limit reached' } }]);
  assert.match(r.error, /usage limit/);
  assert.strictEqual(unwrapShell("/bin/bash -lc 'echo hi'"), 'echo hi'); assert.strictEqual(unwrapShell('ls'), 'ls');
  console.log('cli-agents: Codex events ok');

  // finding the CLI without the shell's PATH, then running it (fake process)
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-home-'));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-work-'));
  fs.mkdirSync(path.join(home, '.local', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(home, '.local', 'bin', 'claude'), '#!/bin/sh\n', { mode: 0o755 });
  let fk = fakeSpawn(CLAUDE);
  const noShell = (cmd, args, opts, cb) => cb(new Error('no'), '');
  let cli = createCliAgents({ spawn: fk.spawn, execFile: noShell, home, env: { PATH: '/usr/bin', ELECTRON_RUN_AS_NODE: '1' } });
  assert.deepStrictEqual(await cli.available(), { claude: true, codex: false });
  steps = [];
  const out = await cli.run({ kind: 'claude', prompt: 'Read note.txt', system: 'role', folder: work, askWrites: true, mcp, onStep: (e) => steps.push(e), onUsage: () => {} });
  assert.strictEqual(out, 'hello from a file');
  const call = fk.calls[0];
  assert.strictEqual(call.bin, path.join(home, '.local', 'bin', 'claude'));
  assert.strictEqual(call.opts.cwd, work);
  assert.strictEqual(call.input(), 'Read note.txt', 'the prompt goes on stdin');
  assert.ok(call.opts.env.PATH.startsWith(path.join(home, '.local', 'bin')));
  assert.strictEqual(call.opts.env.ELECTRON_RUN_AS_NODE, undefined, 'Electron variables do not leak into the CLI');
  assert.strictEqual(call.opts.env.ARTEMIS_TEAM_TOKEN, 'SECRET123');
  assert.ok(steps.some((e) => e.type === 'tool'));
  await assert.rejects(cli.run({ kind: 'codex', prompt: 'x', folder: work, mcp }), /Codex is not installed/);
  await assert.rejects(cli.run({ kind: 'claude', prompt: 'x', folder: path.join(work, 'nope'), mcp }), /folder does not exist/);

  // exits without an answer: the end of stderr explains it
  fk = fakeSpawn([], { code: 1, stderr: 'Error: not logged in\nRun claude login\n' });
  cli = createCliAgents({ spawn: fk.spawn, execFile: noShell, home, env: {} });
  await assert.rejects(cli.run({ kind: 'claude', prompt: 'x', folder: work, mcp }), /without an answer.*not logged in/);

  // Stop: the process is killed and the run rejects as aborted
  fk = fakeSpawn([CLAUDE[0]], { hang: true });
  cli = createCliAgents({ spawn: fk.spawn, execFile: noShell, home, env: {} });
  const ac = new AbortController();
  const p = cli.run({ kind: 'claude', prompt: 'x', folder: work, mcp, signal: ac.signal });
  await new Promise((res) => setTimeout(res, 20));
  ac.abort();
  await assert.rejects(p, (e) => e.name === 'AbortError');
  assert.deepStrictEqual(fk.calls[0].child.killed, ['SIGTERM']);
  fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(work, { recursive: true, force: true });
  console.log('cli-agents: finding and running ok');

  // the team MCP server: each token sees only its own tools; no token, a wrong one or a browser gets nothing
  const sessions = new Map([['A'.repeat(48), [{ name: 'team_done', description: 'd', inputSchema: { type: 'object', properties: {} }, run: () => 'done A' }]], ['B'.repeat(48), [{ name: 'team_review', description: 'r', run: () => 'B' }]]]);
  const srv = createMcpServer({ sessions: (t) => sessions.get(t) || null, instructions: 'team' });
  const port = await srv.start(0);
  const rpc = (token, body, headers = {}) => fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: JSON.stringify(body) });
  let res = await (await rpc('A'.repeat(48), { jsonrpc: '2.0', id: 1, method: 'tools/list' })).json();
  assert.deepStrictEqual(res.result.tools.map((t) => t.name), ['team_done']);
  res = await (await rpc('B'.repeat(48), { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'team_done', arguments: {} } })).json();
  assert.match(res.error.message, /Unknown tool/, "a token cannot call another turn's tools");
  res = await (await rpc('A'.repeat(48), { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'team_done', arguments: {} } })).json();
  assert.strictEqual(res.result.content[0].text, 'done A');
  res = await (await rpc('A'.repeat(48), { jsonrpc: '2.0', id: 4, method: 'initialize', params: {} })).json();
  assert.strictEqual(res.result.instructions, 'team');
  assert.strictEqual((await rpc('', { jsonrpc: '2.0', id: 5, method: 'tools/list' })).status, 401);
  assert.strictEqual((await rpc('C'.repeat(48), { jsonrpc: '2.0', id: 6, method: 'tools/list' })).status, 401);
  assert.strictEqual((await rpc('A'.repeat(48), { jsonrpc: '2.0', id: 7, method: 'tools/list' }, { origin: 'https://evil.example' })).status, 403);
  sessions.delete('A'.repeat(48));
  assert.strictEqual((await rpc('A'.repeat(48), { jsonrpc: '2.0', id: 8, method: 'tools/list' })).status, 401, 'a finished turn\'s token stops working');
  await srv.stop();
  console.log('cli-agents: team MCP sessions ok');
  // createCliTeamTurn: the turn's token sees its tools over MCP while it runs; Claude Code's permission prompts go to ask()
  {
    let seen = null;
    const fakeCli = { available: async () => ({ claude: true, codex: true }), run: async (o) => {
      const call = (name, args) => fetch(o.mcp.url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${o.mcp.token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }).then((r) => r.json());
      const list = await fetch(o.mcp.url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${o.mcp.token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }).then((r) => r.json());
      const allow = JSON.parse((await call('team_permission', { tool_name: 'Bash', input: { command: 'npm test' } })).result.content[0].text);
      const deny = JSON.parse((await call('team_permission', { tool_name: 'Write', input: { file_path: '/w/x' } })).result.content[0].text);
      const done = (await call('team_done', { result: 'r' })).result.content[0].text;
      seen = { o, tools: list.result.tools.map((t) => t.name), allow, deny, done };
      return 'final';
    } };
    const asked = [];
    const ct = createCliTeamTurn({ cli: fakeCli, createMcpServer });
    const out = await ct.turn({ kind: 'claude', agent: { name: 'Hephaestus', role: 'Coder', body: 'role body', model: 'cli:claude:haiku' }, prompt: 'p', folder: '/w', askWrites: true,
      extraTools: [{ name: 'team_done', description: 'd', parameters: { type: 'object', properties: {} }, run: (a) => 'done:' + a.result }],
      ask: async (info) => { asked.push(info.summary); return asked.length === 1; } });
    assert.strictEqual(out, 'final');
    assert.deepStrictEqual(seen.tools, ['team_done', 'team_permission']);
    assert.deepStrictEqual(asked, ['Run: npm test', 'Write /w/x']);
    assert.deepStrictEqual(seen.allow, { behavior: 'allow', updatedInput: { command: 'npm test' } });
    assert.strictEqual(seen.deny.behavior, 'deny');
    assert.strictEqual(seen.done, 'done:r');
    assert.strictEqual(seen.o.model, 'haiku'); assert.match(seen.o.system, /role body[\s\S]*Hephaestus, the team's Coder/);
    const after = await fetch(seen.o.mcp.url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${seen.o.mcp.token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    assert.strictEqual(after.status, 401, 'the token stops working when the turn ends');
    await ct.stop();
    console.log('cli-agents: team turn ok');
  }

  // core/teamrun.js hands Claude Code / Codex members to deps.cli with the team folder; usage is recorded unpriced
  {
    const { createTeamRunner } = require('../electron/core/teamrun');
    const recs = [], usage = [], handed = [], cards = [];
    const decide = new Map();
    const base = { settings: () => ({}), limitBlocked: () => '', filesDir: () => os.tmpdir(), fallbackModel: () => 'prov:x:m', resolveModel: () => ({ error: 'should not be asked' }),
      prices: () => ({}), costOf: () => 0, recordUsage: (r) => recs.push(r), tools: () => ({}), approvals: { add: (id, fn) => decide.set(id, fn), drop: (id) => decide.get(id) && decide.get(id)(false) } };
    const run = createTeamRunner({ ...base, cli: { turn: async (o) => {
      handed.push(o);
      o.onUsage({ prompt: 100, completion: 20, cached: 50 });
      const p = o.ask({ name: 'Bash', summary: 'Run: ls' });
      [...decide.values()].pop()(true);
      assert.strictEqual(await p, true);
      return 'cli answer';
    } } });
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-team-'));
    const onApproval = { asked: (i) => cards.push(i.summary), done: () => {} };
    const out = await run({ agent: { name: 'Hephaestus', model: 'cli:codex' }, prompt: 'p', extraTools: [], signal: new AbortController().signal, askWrites: false, onUsage: (u) => usage.push(u), onApproval, folder: work });
    assert.strictEqual(out, 'cli answer');
    assert.strictEqual(handed[0].kind, 'codex'); assert.strictEqual(handed[0].folder, work);
    assert.deepStrictEqual(cards, ['Run: ls'], 'CLI approvals use the same cards as model members');
    assert.strictEqual(recs[0].model, 'Codex'); assert.deepStrictEqual(usage[0], { prompt: 100, completion: 20, usd: 0, priced: false });
    await run({ agent: { name: 'H', model: 'cli:claude' }, prompt: 'p', extraTools: [], signal: new AbortController().signal, onUsage: () => {}, onApproval, folder: path.join(work, 'gone') });
    assert.strictEqual(handed[1].folder, os.tmpdir(), 'a missing team folder falls back to the Files folder');
    const noCli = createTeamRunner(base);
    await assert.rejects(noCli({ agent: { name: 'H', model: 'cli:claude' }, prompt: 'p', extraTools: [], signal: new AbortController().signal, onUsage: () => {}, onApproval }), /run in the Artemis app, not in the background gateway/);
    fs.rmSync(work, { recursive: true, force: true });
    console.log('cli-agents: team runner hand-off ok');
  }
  console.log('cli-agents: all tests passed');
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
