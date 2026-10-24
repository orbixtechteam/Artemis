// Gateway API + headless runtime, end to end against a fake OpenAI-compatible model server.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { createGateway, writeDiscovery, readDiscovery, removeDiscovery } = require('../electron/core/gateway');
const { createSecretReader, aesDecrypt } = require('../electron/core/secrets');
const { defaultDataDir } = require('../electron/core/paths');
const { parseArgs } = require('../electron/core/cli');
const crypto = require('crypto');

function call(port, method, p, { token, body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), ...(data ? { 'content-type': 'application/json' } : {}), ...headers } }, (res) => {
      let raw = ''; res.setEncoding('utf8'); res.on('data', (x) => { raw += x; });
      res.on('end', () => { let j = null; try { j = JSON.parse(raw); } catch {} resolve({ status: res.statusCode, json: j, raw, headers: res.headers }); });
    });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}
const events = (raw) => raw.split('\n\n').filter(Boolean).map((b) => { let ev = '', d = ''; for (const l of b.split('\n')) { if (l.startsWith('event: ')) ev = l.slice(7); if (l.startsWith('data: ')) d += l.slice(6); } return d ? { ev, d: JSON.parse(d) } : null; }).filter(Boolean);

/** Streams SSE events one by one and lets a callback react (used to answer approvals mid-run). */
function stream(port, p, { token, body, onEvent }) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: p, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' } }, (res) => {
      let buf = ''; const all = []; res.setEncoding('utf8');
      res.on('data', (x) => { buf += x; let i; while ((i = buf.indexOf('\n\n')) >= 0) { const e = events(buf.slice(0, i + 2)); buf = buf.slice(i + 2); for (const x2 of e) { all.push(x2); onEvent && onEvent(x2); } } });
      res.on('end', () => resolve(all));
    });
    req.on('error', reject); req.write(data); req.end();
  });
}

/** A fake /v1/chat/completions server. Each request pops the next scripted reply. */
function fakeModel(script) {
  const seen = [];
  const srv = http.createServer((req, res) => {
    let raw = ''; req.on('data', (x) => { raw += x; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      seen.push(body);
      if (!body.stream) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ choices: [{ message: { content: '{"facts":[],"notes":[]}' } }] })); }
      const step = script.shift() || { text: 'ok' };
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const send = (o) => res.write('data: ' + JSON.stringify(o) + '\n\n');
      if (step.tool) send({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: step.tool, arguments: JSON.stringify(step.args) } }] }, finish_reason: null }] });
      if (step.text) for (const w of step.text.split(/(?<= )/)) send({ choices: [{ index: 0, delta: { content: w }, finish_reason: null }] });
      send({ choices: [{ index: 0, delta: {}, finish_reason: step.tool ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
      res.write('data: [DONE]\n\n'); res.end();
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, port: srv.address().port, seen })));
}

(async () => {
  // ---- pure gateway: auth, origin, host, routing ----
  const tok = 'test-token-123';
  const gw = createGateway({ port: 0, token: tok, handlers: {
    info: () => ({ mode: 'test' }),
    chat: async ({ message }, emit) => { emit({ type: 'chunk', text: 'echo: ' }); emit({ type: 'chunk', text: message }); emit({ type: 'done' }); return { sessionId: 's1', text: 'echo: ' + message }; },
    abort: () => true, approve: () => true,
    sessions: { recent: () => [{ id: 's1' }], get: (id) => (id === 's1' ? { id: 's1', title: 'T', messages: [{ role: 'user', content: 'hi' }] } : null), search: () => [] },
    memory: null
  } });
  const { port } = await gw.start();
  assert.strictEqual((await call(port, 'GET', '/v1/health')).status, 401);
  assert.strictEqual((await call(port, 'GET', '/v1/health', { token: 'wrong' })).status, 401);
  assert.strictEqual((await call(port, 'GET', '/v1/health', { token: tok, headers: { origin: 'https://evil.example' } })).status, 403);
  assert.strictEqual((await call(port, 'GET', '/v1/health', { token: tok, headers: { host: 'evil.example' } })).status, 403);
  const h = await call(port, 'GET', '/v1/health', { token: tok });
  assert.strictEqual(h.status, 200); assert.strictEqual(h.json.mode, 'test');
  assert.strictEqual((await call(port, 'GET', '/v1/nope', { token: tok })).status, 404);
  assert.strictEqual((await call(port, 'GET', '/v1/memory?q=x', { token: tok })).status, 404, 'memory off');
  assert.strictEqual((await call(port, 'POST', '/v1/chat', { token: tok, body: {} })).status, 400);
  const st = await call(port, 'POST', '/v1/chat', { token: tok, body: { message: 'hello' } });
  const evs = events(st.raw);
  assert.deepStrictEqual(evs.map((e) => e.ev), ['run', 'chunk', 'chunk', 'done']);
  assert.strictEqual(evs[3].d.text, 'echo: hello');
  const nj = await call(port, 'POST', '/v1/chat', { token: tok, body: { message: 'x', stream: false } });
  assert.strictEqual(nj.json.text, 'echo: x'); assert.strictEqual(nj.json.session_id, 's1');
  assert.strictEqual((await call(port, 'GET', '/v1/sessions/s1', { token: tok })).json.turns[0].content, 'hi');
  assert.strictEqual((await call(port, 'GET', '/v1/sessions/zz', { token: tok })).status, 404);
  const bad = await new Promise((resolve) => { const r = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/v1/chat', headers: { authorization: 'Bearer ' + tok } }, (res) => { let raw = ''; res.on('data', (x) => { raw += x; }); res.on('end', () => resolve(res.statusCode)); }); r.end('{not json'); });
  assert.strictEqual(bad, 400);
  await gw.stop();

  // ---- discovery file ----
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'artemis-gw-'));
  const df = path.join(tmp, 'gateway.json');
  writeDiscovery(df, { mode: 'x', port: 1, token: 't' });
  assert.strictEqual(readDiscovery(df).port, 1);
  if (process.platform !== 'win32') assert.strictEqual(fs.statSync(df).mode & 0o777, 0o600);
  fs.writeFileSync(df, JSON.stringify({ pid: 999999, port: 2 }));
  assert.strictEqual(readDiscovery(df), null, 'dead pid = no gateway');
  writeDiscovery(df, { port: 3 }); removeDiscovery(df); assert.ok(!fs.existsSync(df));

  // ---- secrets: safeStorage formats ----
  const enc = (plain, pw, it) => { const key = crypto.pbkdf2Sync(pw, 'saltysalt', it, 16, 'sha1'); const ci = crypto.createCipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20)); return Buffer.concat([Buffer.from('v10'), ci.update(plain, 'utf8'), ci.final()]).toString('base64'); };
  assert.strictEqual(createSecretReader({ platform: 'linux' }).decrypt(enc('sk-linux', 'peanuts', 1)), 'sk-linux');
  const mac = createSecretReader({ platform: 'darwin', exec: (cmd, args) => { if (args.includes('Artemis Safe Storage')) return 'pw123\n'; throw new Error('not found'); } });
  assert.strictEqual(mac.decrypt(enc('sk-mac', 'pw123', 1003)), 'sk-mac');
  assert.strictEqual(mac.decrypt('plain:abc'), 'abc');
  assert.strictEqual(mac.decrypt(enc('x', 'other', 1003)), '');
  assert.strictEqual(createSecretReader({ platform: 'darwin', keychain: false }).decrypt(enc('x', 'pw', 1003)), '');
  assert.throws(() => aesDecrypt(Buffer.from('short'), 'p', 1));

  // ---- paths and args ----
  assert.strictEqual(defaultDataDir({ env: { ARTEMIS_HOME: '/x/y' } }), '/x/y');
  assert.strictEqual(defaultDataDir({ platform: 'darwin', env: {}, home: '/h', exists: (d) => d.endsWith('Zero') }), '/h/Library/Application Support/Zero');
  assert.strictEqual(defaultDataDir({ platform: 'linux', env: {}, home: '/h', exists: () => false }), '/h/.config/Artemis');
  assert.deepStrictEqual(parseArgs(['chat', 'hi', 'there', '-s', 'gw-1', '--json', '--no-keychain', '--port=9']), { _: ['chat', 'hi', 'there'], session: 'gw-1', json: true, keychain: false, port: '9' });

  // ---- headless runtime end to end ----
  const { createHeadless } = require('../electron/core/headless');
  const { available } = require('../electron/core/db');
  if (!available()) { console.log('test-gateway: node:sqlite not available, headless part skipped'); return; }
  const fm = await fakeModel([
    { text: 'Hello Ulvi, ready.' },
    { tool: 'write_file', args: { path: 'note.txt', content: 'from the gateway' } },
    { text: 'Wrote note.txt.' },
    { text: 'Second turn answer.' }
  ]);
  const data = path.join(tmp, 'data');
  fs.mkdirSync(data);
  const files = path.join(tmp, 'proj');
  fs.mkdirSync(files);
  fs.writeFileSync(path.join(data, 'providers.json'), JSON.stringify([{ id: 'fake', name: 'Fake', baseUrl: `http://127.0.0.1:${fm.port}/v1`, enabled: true, needsKey: false, models: [{ id: 'm1' }] }]));
  fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ model: 'prov:fake:m1', webEnabled: false, autoLearn: false, delegateEnabled: false, notesAi: false, profileName: 'Ulvi' }));
  fs.writeFileSync(path.join(data, 'projects.json'), JSON.stringify([{ id: 'p1', name: 'Proj', folder: files }]));
  fs.writeFileSync(path.join(data, 'chats.json'), JSON.stringify([{ id: 'old', title: 'Old chat about kamal', updatedAt: 1, messages: [{ id: 'a', role: 'user', content: 'deploy with kamal' }] }]));
  fs.writeFileSync(path.join(data, 'memory.json'), JSON.stringify([{ id: 'x', text: 'Prefers short answers.' }]));
  const logs = [];
  fs.writeFileSync(path.join(data, 'desktop.lock'), JSON.stringify({ pid: process.ppid })); // the app is "running": both may share the folder
  const hl = createHeadless({ dataDir: data, port: 0, keychain: false, scheduler: false, telegram: false, connectors: false, browser: false, computer: false, log: (lv, a, m) => logs.push(`${lv} ${a} ${m}`) });
  const addr = await hl.start();
  const disc = readDiscovery(path.join(data, 'gateway.json'));
  assert.strictEqual(disc.port, addr.port); assert.strictEqual(disc.mode, 'headless');
  const T = disc.token;
  assert.ok(T && T.length > 20);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(data, 'headless.lock'), 'utf8')).pid, process.pid);
  assert.strictEqual(addr.appRunning, true);
  // a second runtime on the same folder is refused
  const lockF = path.join(data, 'headless.lock');
  const ours = fs.readFileSync(lockF, 'utf8');
  fs.writeFileSync(lockF, JSON.stringify({ pid: process.ppid })); // another live headless process holds the folder
  const hl2 = createHeadless({ dataDir: data, port: 0, keychain: false, scheduler: false, telegram: false, connectors: false, browser: false, computer: false, log: () => {} });
  await assert.rejects(() => hl2.start(), /already running/);
  fs.writeFileSync(lockF, ours);

  // imported chats and memory
  let r = await call(addr.port, 'GET', '/v1/search?q=kamal', { token: T });
  assert.deepStrictEqual(r.json.hits.map((x) => x.id), ['old']);
  r = await call(addr.port, 'GET', '/v1/memory/list', { token: T });
  assert.deepStrictEqual(r.json.entries.map((e) => e.text), ['Prefers short answers.']);

  // chat 1: plain answer, saved as a session
  let all = await stream(addr.port, '/v1/chat', { token: T, body: { message: 'hi there' } });
  const done = all.find((e) => e.ev === 'done').d;
  assert.strictEqual(done.text, 'Hello Ulvi, ready.');
  assert.ok(/^gw-/.test(done.session_id));
  assert.ok(fm.seen[0].messages[0].content.includes('Prefers short answers.'), 'memory is in the system prompt');
  assert.ok(fm.seen[0].tools.some((t) => t.function.name === 'memory_search'), 'memory tools offered');
  assert.ok(!fm.seen[0].tools.some((t) => t.function.name === 'run_command'), 'no shell without --allow-shell');

  // chat 2: same session, project folder, a write that needs approval (approved over the API)
  let approved = false;
  all = await stream(addr.port, '/v1/chat', { token: T, body: { message: 'write a note', session_id: done.session_id, project_id: 'p1' }, onEvent: async (e) => {
    if (e.ev === 'tool:approval') { approved = true; const a = await call(addr.port, 'POST', `/v1/approvals/${e.d.id}`, { token: T, body: { approve: true } }); assert.strictEqual(a.json.ok, true); }
  } });
  assert.ok(approved, 'approval event arrived');
  assert.strictEqual(fs.readFileSync(path.join(files, 'note.txt'), 'utf8'), 'from the gateway');
  assert.strictEqual(all.find((e) => e.ev === 'done').d.text, 'Wrote note.txt.');
  const second = fm.seen.find((b, i) => i > 0 && b.messages.some((m) => m.role === 'user' && m.content === 'write a note'));
  assert.ok(second.messages.some((m) => m.role === 'assistant' && /Hello Ulvi/.test(typeof m.content === 'string' ? m.content : JSON.stringify(m.content))), 'earlier turn sent as history');

  r = await call(addr.port, 'GET', `/v1/sessions/${done.session_id}`, { token: T });
  assert.deepStrictEqual(r.json.turns.map((t) => t.role), ['user', 'assistant', 'user', 'assistant']);
  r = await call(addr.port, 'GET', '/v1/sessions?limit=5', { token: T });
  assert.strictEqual(r.json.sessions[0].id, done.session_id);

  // memory over the API
  r = await call(addr.port, 'POST', '/v1/memory', { token: T, body: { text: 'Deploys with Kamal.' } });
  assert.ok(r.json.entry.id);
  r = await call(addr.port, 'POST', '/v1/memory/note', { token: T, body: { text: 'Tested the gateway' } });
  assert.ok(/^memory\/\d{4}-\d{2}-\d{2}\.md$/.test(r.json.path));
  r = await call(addr.port, 'GET', '/v1/memory?q=gateway', { token: T });
  assert.ok(r.json.hits.some((x) => x.path.startsWith('memory/')));
  assert.ok(fs.readFileSync(path.join(data, 'workspace', 'MEMORY.md'), 'utf8').includes('- Deploys with Kamal.'));

  // non-stream call, abort of an unknown run
  r = await call(addr.port, 'POST', '/v1/chat', { token: T, body: { message: 'again', stream: false } });
  assert.strictEqual(r.json.text, 'Second turn answer.');
  r = await call(addr.port, 'POST', '/v1/runs/nope/abort', { token: T });
  assert.strictEqual(r.json.ok, false);

  await hl.stop();
  assert.ok(!fs.existsSync(path.join(data, 'gateway.json')));
  assert.ok(!fs.existsSync(path.join(data, 'headless.lock')));
  const mirror = JSON.parse(fs.readFileSync(path.join(data, 'chats.json'), 'utf8'));
  assert.ok(!mirror.some((c) => c.id === done.session_id), 'while the app runs, it owns chats.json');
  assert.ok(JSON.parse(fs.readFileSync(path.join(data, 'usage-headless.json'), 'utf8')).length >= 3, 'usage recorded in its own file');
  assert.ok(!fs.existsSync(path.join(data, 'usage.json')), 'the app\'s usage file is not touched');
  // the chats written by the gateway are visible to the app as changes from another writer
  {
    const { openDb } = require('../electron/core/db');
    const { createSessions } = require('../electron/core/sessions');
    const db2 = openDb(path.join(data, 'artemis.db'));
    const app = createSessions({ db: db2, writer: 'renderer' });
    const ch = app.changesSince(0, { exclude: 'renderer' });
    assert.ok(ch.chats.some((c) => c.id === done.session_id && c.messages.length === 4), 'gateway chat visible to the app');
    db2.close();
  }
  // ---- Telegram in the headless gateway, against a fake Telegram API ----
  {
    const sent = [];
    let queue = [{ update_id: 1, message: { message_id: 1, chat: { id: 555, type: 'private' }, from: { id: 555 }, text: 'hello from the phone' } }];
    const tg = http.createServer((req, res) => {
      let raw = ''; req.on('data', (x) => { raw += x; });
      req.on('end', () => {
        const method = req.url.split('/').pop(); const body = raw ? JSON.parse(raw) : {};
        const reply = (result) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, result })); };
        if (method === 'getMe') return reply({ id: 1, username: 'artemis_test_bot' });
        if (method === 'getUpdates') { const u = queue; queue = []; return u.length ? reply(u) : setTimeout(() => reply([]), 300); }
        if (method === 'sendMessage') sent.push(body.text);
        reply({ message_id: 9 });
      });
    });
    await new Promise((r) => tg.listen(0, '127.0.0.1', r));
    const fm2 = await fakeModel([{ text: 'Phone answer.' }]);
    fs.writeFileSync(path.join(data, 'providers.json'), JSON.stringify([{ id: 'fake', name: 'Fake', baseUrl: `http://127.0.0.1:${fm2.port}/v1`, enabled: true, needsKey: false, models: [{ id: 'm1' }] }]));
    const st = JSON.parse(fs.readFileSync(path.join(data, 'settings.json'), 'utf8'));
    fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ ...st, telegramEnabled: true, telegramChatId: '555', remoteContinueLast: false }));
    const hcfg = JSON.parse(fs.readFileSync(path.join(data, 'headless.json'), 'utf8'));
    fs.writeFileSync(path.join(data, 'headless.json'), JSON.stringify({ ...hcfg, telegramToken: '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef' }));
    fs.unlinkSync(path.join(data, 'desktop.lock')); // no app this time: the bot starts at once
    // a connector (MCP, stdio) too: its tools must reach the model
    fs.writeFileSync(path.join(data, 'mcp.json'), JSON.stringify([{ id: 'a', name: 'Echo Server', type: 'stdio', command: process.execPath, args: [path.join(__dirname, 'fixtures/mcp-echo.js')], enabled: true }]));
    fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ ...JSON.parse(fs.readFileSync(path.join(data, 'settings.json'), 'utf8')), connectorsLazy: false }));
    const h3 = createHeadless({ dataDir: data, port: 0, keychain: false, scheduler: false, browser: false, computer: false, telegramApi: `http://127.0.0.1:${tg.address().port}`, log: () => {} });
    await h3.start();
    for (let i = 0; i < 50 && !sent.some((t) => /Phone answer/.test(t)); i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(sent.some((t) => /Phone answer/.test(t)), 'answer sent to Telegram: ' + JSON.stringify(sent));
    assert.ok(fm2.seen.some((b) => (b.tools || []).some((t) => /^mcp__echo/.test(t.function.name))), 'connector tools offered: ' + JSON.stringify((fm2.seen[0].tools || []).map((t) => t.function.name)));
    assert.strictEqual(h3.remote().status().telegram.botName, 'artemis_test_bot');
    const phoneChat = h3.sessions.recent(10).find((c) => /^phone-/.test(c.id));
    assert.ok(phoneChat && phoneChat.title.includes('hello from the phone'), 'phone chat saved');
    const ph = h3.remote().phone();
    await ph.send('direct message');
    assert.ok(sent.includes('direct message'));
    await h3.stop();
    tg.close(); fm2.srv.close();
  }
  fm.srv.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('test-gateway: ok');
})().catch((e) => { console.error(e); process.exit(1); });
