const assert = require('assert');
const fs = require('fs');
const http = require('http');
const { createMcpServer } = require('../electron/mcp-server');
const { buildArtemisTools, THEME_IDS, SAFE_SETTINGS } = require('../electron/artemis-tools');

const post = (port, body, { token = 'tok', host, origin, method = 'POST', path = '/mcp' } = {}) => new Promise((resolve, reject) => {
  const data = body === undefined ? '' : JSON.stringify(body);
  const req = http.request({ host: '127.0.0.1', port, path, method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}), ...(host ? { host } : {}), ...(origin ? { origin } : {}) } }, (res) => {
    let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null }));
  });
  req.on('error', reject); req.end(data);
});

(async () => {
  // the fallback theme list still matches what the app shipped
  const src = fs.readFileSync(__dirname + '/../src/lib/themes.js', 'utf8');
  const ids = [...src.matchAll(/\{ id: '([\w-]+)', name: '[^']+', group:/g)].map((m) => m[1]);
  assert.ok(THEME_IDS.includes('system') && THEME_IDS.length >= 3, 'THEME_IDS fallback must list the shipped themes');
  assert.ok(ids.length === 0 || ids.every((id) => THEME_IDS.includes(id)), 'every shipped theme id must be in THEME_IDS');

  const saved = []; const asks = []; const termRuns = []; let memory = [{ id: 'a1', text: 'likes short answers' }]; let answer = true;
  const settings = { theme: 'system', textSize: 'medium', model: 'x', notesAi: true, shellEnabled: false, apiKeyEnc: 'SECRET' };
  const control = {
    info: () => ({ tools: [{ key: 'web', on: true }], connectors: [], memoryCount: memory.length, busy: false }),
    providers: () => [{ key: 'abc', name: 'Groq', on: true }],
    toggleProvider: (k, on) => (k === 'nope' ? { ok: false, error: 'No provider' } : { ok: true, name: k, on }),
    models: () => [{ id: 'm1', name: 'M1' }], memoryList: () => memory,
    memoryAdd: (t) => { const it = { id: 'n' + memory.length, text: t }; memory.push(it); return it; }, memoryRemove: (id) => { const n = memory.length; memory = memory.filter((m) => m.id !== id); return memory.length < n; }
  };
  const notes = { search: (q) => [{ path: 'a.md', q }], list: () => ({ items: [] }), read: (p) => ({ text: 'hello ' + p }), write: (p, t) => ({ written: p }), create: (n) => ({ created: n }) };
  const term = { run: async (c) => { termRuns.push(c); return 'out'; }, read: async () => 'tail' };
  const tools = buildArtemisTools({ control, getSettings: () => settings, applySettings: (p) => { saved.push(p); Object.assign(settings, p); }, notes, term, skills: () => [{ name: 's' }], confirm: async (a) => { asks.push(a); return answer ? 'once' : false; } });
  const call = (name, args) => tools.find((x) => x.name === 'artemis_' + name).run(args || {});

  assert.ok(tools.every((x) => x.name.startsWith('artemis_') && x.inputSchema && x.description));
  // lock: an outside app can lock Artemis (never unlock it); a missing password is an error, not a silent success
  { const mk = (lockNow) => buildArtemisTools({ control, getSettings: () => settings, applySettings: () => {}, notes, term, skills: () => [], confirm: async () => true, lockNow }).find((x) => x.name === 'artemis_lock');
    assert.deepStrictEqual(await mk(() => ({ ok: true })).run({}), { locked: true });
    await assert.rejects(() => mk(() => ({ ok: false, error: 'Set a password first.' })).run({}), /Set a password first/);
    assert.ok(!tools.some((x) => x.name === 'artemis_unlock'), 'there is no unlock tool'); }
  // settings: allowed, validated, and nothing dangerous
  await call('set_theme', { theme: 'light' }); assert.deepStrictEqual(saved.pop(), { theme: 'light' });
  await assert.rejects(() => call('set_theme', { theme: 'neon' }));
  await call('set_setting', { key: 'webEnabled', value: false }); assert.deepStrictEqual(saved.pop(), { webEnabled: false });
  await call('set_setting', { key: 'textSize', value: 'large' }); assert.deepStrictEqual(saved.pop(), { textSize: 'large' });
  for (const bad of ['shellEnabled', 'computerEnabled', 'autoApproveEdits', 'remoteAllowDangerous', 'baseUrl', 'apiKeyEnc', 'telegramEnabled', 'mcpServerEnabled']) {
    assert.ok(!SAFE_SETTINGS[bad], bad + ' must not be settable');
    await assert.rejects(() => call('set_setting', { key: bad, value: true }), /cannot be changed/);
  }
  await assert.rejects(() => call('set_setting', { key: 'ttsUrl', value: 'https://evil.example.com' }), /local address/);
  assert.strictEqual((await call('set_setting', { key: 'ttsUrl', value: 'http://localhost:8880/' })).value, 'http://localhost:8880');
  const got = await call('get_settings'); assert.ok(!('apiKeyEnc' in got)); assert.strictEqual(got.theme, 'light');
  assert.strictEqual((await call('set_provider_enabled', { provider: 'groq', enabled: false })).on, false);
  await assert.rejects(() => call('set_provider_enabled', { provider: 'nope', enabled: true }), /No provider/);
  assert.strictEqual((await call('memory_add', { text: 'x' })).text, 'x'); assert.strictEqual((await call('memory_remove', { id: 'a1' })).ok, true);
  assert.deepStrictEqual(await call('notes_search', { query: 'q' }), [{ path: 'a.md', q: 'q' }]);
  // risky tools ask, and obey a refusal
  answer = false;
  await assert.rejects(() => call('terminal_run', { command: 'ls' }), /declined/); assert.strictEqual(termRuns.length, 0); assert.strictEqual(asks.length, 1);
  await assert.rejects(() => call('notes_write', { path: 'a.md', text: 'z' }), /declined/);
  answer = true;
  assert.strictEqual(await call('terminal_run', { command: 'ls' }), 'out'); assert.strictEqual(termRuns[0], 'ls\n');
  // notes off
  settings.notesAi = false; await assert.rejects(() => call('notes_read', { path: 'a.md' }), /switched off/); settings.notesAi = true;
  // a "grant for 10 minutes" answer is remembered
  const asks2 = []; const t2 = buildArtemisTools({ control, getSettings: () => settings, applySettings() {}, notes, term, skills: () => [], confirm: async (a) => { asks2.push(a); return 'grant'; } });
  const run2 = (n, a) => t2.find((x) => x.name === 'artemis_' + n).run(a);
  await run2('terminal_run', { command: 'a' }); await run2('terminal_run', { command: 'b' }); assert.strictEqual(asks2.length, 1);
  // the grant survives a rebuild of the tool list (main rebuilds it per request)
  const t3 = buildArtemisTools({ control, getSettings: () => settings, applySettings() {}, notes, term, skills: () => [], confirm: async (a) => { asks2.push(a); return 'once'; } });
  await t3.find((x) => x.name === 'artemis_terminal_run').run({ command: 'c' }); assert.strictEqual(asks2.length, 1, 'grant persists across rebuilds');
  // injected grants stay separate
  const t4 = buildArtemisTools({ grants: new Map(), control, getSettings: () => settings, applySettings() {}, notes, term, skills: () => [], confirm: async (a) => { asks2.push(a); return 'once'; } });
  await t4.find((x) => x.name === 'artemis_terminal_run').run({ command: 'd' }); assert.strictEqual(asks2.length, 2);

  // the HTTP server
  const srv = createMcpServer({ getToken: () => 'tok', tools });
  const port = await srv.start(0);
  assert.ok(srv.running() && port > 0);
  let r = await post(port, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
  assert.strictEqual(r.status, 200); assert.strictEqual(r.body.result.protocolVersion, '2025-03-26'); assert.strictEqual(r.body.result.serverInfo.name, 'artemis');
  r = await post(port, { jsonrpc: '2.0', method: 'notifications/initialized' }); assert.strictEqual(r.status, 202);
  r = await post(port, { jsonrpc: '2.0', id: 2, method: 'tools/list' }); assert.strictEqual(r.body.result.tools.length, tools.length);
  r = await post(port, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'artemis_set_theme', arguments: { theme: 'light' } } });
  assert.ok(!r.body.result.isError); assert.strictEqual(settings.theme, 'light');
  r = await post(port, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'artemis_set_theme', arguments: { theme: 'bad' } } }); assert.strictEqual(r.body.result.isError, true);
  r = await post(port, { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nope' } }); assert.ok(r.body.error);
  r = await post(port, [{ jsonrpc: '2.0', id: 6, method: 'ping' }, { jsonrpc: '2.0', id: 7, method: 'ping' }]); assert.strictEqual(r.body.length, 2);
  r = await post(port, { jsonrpc: '2.0', id: 8, method: 'unknown' }); assert.strictEqual(r.body.error.code, -32601);
  // security: token, host, origin, method, path
  assert.strictEqual((await post(port, { jsonrpc: '2.0', id: 1, method: 'ping' }, { token: '' })).status, 401);
  assert.strictEqual((await post(port, { jsonrpc: '2.0', id: 1, method: 'ping' }, { token: 'wrong' })).status, 401);
  assert.strictEqual((await post(port, { jsonrpc: '2.0', id: 1, method: 'ping' }, { host: 'evil.com' })).status, 403);
  assert.strictEqual((await post(port, { jsonrpc: '2.0', id: 1, method: 'ping' }, { origin: 'https://evil.com' })).status, 403);
  assert.strictEqual((await post(port, undefined, { method: 'GET' })).status, 405);
  assert.strictEqual((await post(port, { jsonrpc: '2.0', id: 1, method: 'ping' }, { path: '/other' })).status, 404);
  const noTok = createMcpServer({ getToken: () => '', tools }); const p2 = await noTok.start(0);
  assert.strictEqual((await post(p2, { jsonrpc: '2.0', id: 1, method: 'ping' }, { token: 'x' })).status, 401); await noTok.stop();
  await srv.stop(); assert.ok(!srv.running());
  console.log('artemis-tools + mcp-server: all tests passed');
})().catch((e) => { console.error(e); process.exit(1); });

// ---- file tools through MCP (real tools.js, a temp project folder) ----
(async () => {
  const fs = require('fs'), os = require('os'), path = require('path');
  const tools = require('../electron/tools');
  const { buildArtemisTools } = require('../electron/artemis-tools');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artemis-fs-'));
  const asked = []; const keys = [];
  const t = buildArtemisTools({
    getSettings: () => ({ shellEnabled: true }), control: {}, applySettings() {}, notes: {}, term: {}, skills: () => [],
    confirm: async (a) => { asked.push(a.title); keys.push(a.key); return 'once'; },
    files: {
      defs: () => tools.definitions({ hasFolder: true, shellEnabled: true }).filter((x) => ['list_dir', 'read_file', 'write_file', 'edit_file', 'delete_file'].includes(x.function.name)),
      projects: () => [{ name: 'Demo', folder: dir }],
      rootOf: (ref) => { if (ref && ref !== 'Demo') throw new Error('unknown project'); return dir; },
      run: (n, a, o) => tools.run(n, a, { root: o.root, approve: o.approve, session: new Set(), autoApprove: false })
    }
  });
  const by = (n) => t.find((x) => x.name === 'artemis_' + n);
  assert.ok(by('fs_write_file') && by('fs_edit_file') && by('projects'), 'file tools are listed');
  await by('fs_write_file').run({ project: 'Demo', path: 'a.txt', content: 'hello world' });
  assert.strictEqual(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'hello world');
  assert.ok(asked.length >= 1, 'a write asks the user');
  const rd = await by('fs_read_file').run({ path: 'a.txt' });
  assert.ok(String(rd).includes('hello'), 'read works without naming the only project');
  await assert.rejects(() => by('fs_read_file').run({ project: 'Nope', path: 'a.txt' }), /unknown project/);
  await assert.rejects(() => by('fs_write_file').run({ project: 'Demo', path: '../escape.txt', content: 'x' }), /./, 'cannot write outside the project folder');
  assert.ok(!fs.existsSync(path.join(dir, '..', 'escape.txt')), 'nothing written outside');
  assert.ok(keys.includes('fs:write') && asked.includes('Let an outside app change your files?'), 'a write uses the write prompt');
  // reading outside the project: allowed after approval, with its own read prompt and key
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'artemis-out-'));
  fs.writeFileSync(path.join(other, 'b.txt'), 'outside text');
  asked.length = 0; keys.length = 0;
  const out = await by('fs_read_file').run({ path: path.join(other, 'b.txt') });
  assert.ok(String(out).includes('outside text'), 'reads any file after approval');
  assert.deepStrictEqual(keys, ['fs:read']); assert.deepStrictEqual(asked, ['Let an outside app read files on your computer?']);
  console.log('artemis fs tools ok');
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
