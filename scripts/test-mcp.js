// MCP client tests: stdio fixture + mock Streamable HTTP server. node scripts/test-mcp.js
const assert = require('assert');
const http = require('http');
const path = require('path');
const { createMcpManager, parseImport, safeToolName, formatResult } = require('../electron/mcp');
const tools = require('../electron/tools');

(async () => {
  // HTTP mock: JSON for some methods, SSE for tools/call, requires a session id after initialize
  let sessions = 0, current = '', expire = false, slowNext = false, refreshes = 0, cancelled = [];
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c));
    req.on('end', () => {
      if (req.method === 'DELETE') { res.writeHead(200); return res.end(); }
      if (req.url === '/token') {
        const f = new URLSearchParams(b); refreshes++;
        assert.strictEqual(f.get('grant_type'), 'refresh_token'); assert.strictEqual(f.get('refresh_token'), 'r1');
        res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ access_token: 'new', refresh_token: 'r2', expires_in: 3600 }));
      }
      if (req.url === '/oauth') {
        if (req.headers.authorization !== 'Bearer new') { res.writeHead(401); return res.end('expired'); }
        const m = JSON.parse(b);
        if (m.id === undefined) { res.writeHead(202); return res.end(); }
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: m.method === 'tools/list' ? { tools: [{ name: 'who', inputSchema: { type: 'object' } }] } : m.method === 'initialize' ? { protocolVersion: '2025-03-26' } : { content: [{ type: 'text', text: 'me' }] } }));
      }
      if (req.headers['x-api'] !== 'secret') { res.writeHead(401); return res.end('no'); }
      const m = JSON.parse(b);
      if (m.method === 'initialize') {
        current = 'S' + ++sessions;
        res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': current });
        return res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-03-26', serverInfo: { name: 'h' }, capabilities: {} } }));
      }
      if (m.method === 'notifications/cancelled') cancelled.push(m.params.requestId);
      if (m.id === undefined) { res.writeHead(202); return res.end(); }
      if (expire) { expire = false; current = ''; }
      if (req.headers['mcp-session-id'] !== current) { res.writeHead(404); return res.end('unknown session'); }
      if (m.method === 'tools/call' && slowNext) return (slowNext = false), setTimeout(() => { try { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); } catch {} }, 3000);
      if (m.method === 'tools/list') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'time', description: 'Now', inputSchema: { type: 'object', properties: {} } }] } })); }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: {} })}\n\n`);
      res.write(`data: ${JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'noon' }] } })}\n\n`);
      res.end();
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));

  const tokens = [];
  const mgr = createMcpManager({ onTokens: (id, o) => tokens.push([id, o]) });
  const list = [
    { id: 'a', name: 'Echo Server', type: 'stdio', command: process.execPath, args: [path.join(__dirname, 'fixtures/mcp-echo.js')], enabled: true },
    { id: 'x', name: 'Extra', type: 'stdio', command: process.execPath, args: [path.join(__dirname, 'fixtures/mcp-echo.js')], env: { ECHO_EXTRA: '1' }, enabled: true },
    { id: 'f', name: 'OAuth', type: 'http', url: `http://127.0.0.1:${srv.address().port}/oauth`, tokenUrl: `http://127.0.0.1:${srv.address().port}/token`, oauth: { accessToken: 'old', refreshToken: 'r1', expiresAt: Date.now() + 3600000 }, enabled: true },
    { id: 'b', name: 'Clock', type: 'http', url: `http://127.0.0.1:${srv.address().port}/mcp`, headers: { 'x-api': 'secret' }, enabled: true },
    { id: 'c', name: 'Broken', type: 'stdio', command: 'definitely-not-a-command-xyz', enabled: true },
    { id: 'd', name: 'Off', type: 'stdio', command: 'x', enabled: false },
    { id: 'e', name: 'Bad HTTP', type: 'http', url: `http://127.0.0.1:${srv.address().port}/mcp`, headers: {}, enabled: true }
  ];
  await mgr.configure(list);
  const st = Object.fromEntries(mgr.status(list).map((s) => [s.id, s]));
  assert.strictEqual(st.a.state, 'connected'); assert.deepStrictEqual(st.a.tools, ['echo', 'wipe', 'boom']);
  assert.strictEqual(st.x.state, 'connected', st.x.error); assert.strictEqual(st.f.state, 'connected', st.f.error);
  assert.strictEqual(st.b.state, 'connected');
  assert.strictEqual(st.c.state, 'error'); assert(/not found/i.test(st.c.error), st.c.error);
  assert.strictEqual(st.d.state, 'off');
  assert.strictEqual(st.e.state, 'error');

  const names = mgr.definitions().map((d) => d.function.name);
  assert(names.includes('mcp__echo_server__echo') && names.includes('mcp__clock__time'), names.join());
  assert(mgr.definitions().every((d) => d.function.parameters.type === 'object'));

  let r = await mgr.call('mcp__echo_server__echo', { text: 'hi' });
  assert(r.ok && r.text === 'echo: hi');
  r = await mgr.call('mcp__echo_server__boom', {});
  assert(!r.ok && r.text === 'it broke');
  r = await mgr.call('mcp__clock__time', {});
  assert(r.ok && r.text === 'noon');

  // through tools.run: read-only tools ask once per task (mcp-read:<server>), others once per task under mcp:<server>
  let asked = 0;
  const cats = [];
  const ctx = { mcp: mgr, session: new Set(), approve: async (i) => { asked++; cats.push(i.category); assert(/^mcp(-read)?:echo_server$/.test(i.category) && i.session); return true; } };
  r = await tools.run('mcp__echo_server__echo', { text: 'x' }, ctx); assert(r.ok && asked === 1 && cats[0] === 'mcp-read:echo_server', cats.join());
  r = await tools.run('mcp__echo_server__echo', { text: 'y' }, ctx); assert(r.ok && asked === 1);
  r = await tools.run('mcp__echo_server__wipe', {}, ctx); assert(r.ok && r.text === 'wiped' && asked === 2 && cats[1] === 'mcp:echo_server');
  r = await tools.run('mcp__echo_server__wipe', {}, ctx); assert(asked === 2);
  r = await tools.run('mcp__echo_server__wipe', {}, { mcp: mgr, session: new Set(), approve: async () => false }); assert(r.denied);
  r = await tools.run('mcp__nope__x', {}, ctx); assert(!r.ok);
  assert(/Connectors: echo_server \(connected/.test(r.text) && /built-in tools/.test(r.text), r.text);
  // a mangled server name still reaches the one connected tool with that name; an ambiguous or unknown tool name does not
  r = await tools.run('mcp__echoserver__echo', { text: 'typo' }, ctx); assert(r.ok && r.text === 'echo: typo', r.text);
  assert.strictEqual(mgr.info('mcp__clokc__time').server, 'clock');
  assert.strictEqual(mgr.info('mcp__clock__nothing'), null);
  assert(tools.definitions({ hasFolder: false }).every((d) => ['create_artifact', 'lock_app'].includes(d.function.name)));

  // tool names are made valid and unique, and calls are routed by the table
  assert.strictEqual(safeToolName('mcp__a__b.c d'), 'mcp__a__b_c_d');
  assert.strictEqual(safeToolName('mcp__a__' + 'y'.repeat(80)).length, 64);
  assert.notStrictEqual(safeToolName('mcp__a__' + 'y'.repeat(80)), safeToolName('mcp__a__' + 'y'.repeat(81)));
  const xnames = mgr.definitions(['extra']).map((d) => d.function.name);
  assert(xnames.every((n) => /^[a-zA-Z0-9_-]{1,64}$/.test(n)), xnames.join());
  assert.strictEqual(new Set(xnames).size, xnames.length, 'names are unique');
  assert(xnames.includes('mcp__extra__my_tool_v2') && xnames.includes('mcp__extra__my_tool_v2_2'), xnames.join());
  const longName = xnames.find((n) => n.length === 64); assert(longName);
  r = await mgr.call(longName, {}); assert(r.ok && r.text === 'wiped');
  // multibyte UTF-8 split across chunks survives
  r = await mgr.call('mcp__extra__utf', {}); assert.strictEqual(r.text, 'é€😀'.repeat(3000));
  // every image is kept
  r = await mgr.call('mcp__extra__pics', {}); assert.deepStrictEqual(r.images, ['data:image/png;base64,AAA', 'data:image/jpeg;base64,BBB']); assert.strictEqual(r.image, r.images[0]);
  assert.strictEqual(formatResult({ content: [] }).images.length, 0);
  // a stdio server that exits is restarted on the next call
  await assert.rejects(() => mgr.call('mcp__extra__die', {}), /exited/);
  assert.strictEqual(mgr.status(list).find((x) => x.id === 'x').state, 'error');
  assert(mgr.definitions().some((d) => d.function.name === 'mcp__extra__utf'), 'a dropped server still offers its tools');
  r = await mgr.call('mcp__echo_server__echo', { text: 'still' }); assert(r.ok);
  r = await mgr.call('mcp__extra__pics', {}); assert(r.ok && r.images.length === 2, 'reconnected');
  assert.strictEqual(mgr.status(list).find((x) => x.id === 'x').state, 'connected');
  // HTTP: a lost session is re-initialized once and the call retried
  expire = true; const before = sessions;
  r = await mgr.call('mcp__clock__time', {}); assert(r.ok && r.text === 'noon' && sessions === before + 1, r.text);
  // HTTP: a 401 refreshes the OAuth token and retries; the new tokens are handed to the saver
  assert.strictEqual(mgr.status(list).find((x) => x.id === 'f').state, 'connected');
  assert(refreshes === 1 && tokens.length === 1 && tokens[0][0] === 'f' && tokens[0][1].accessToken === 'new' && tokens[0][1].refreshToken === 'r2');
  r = await mgr.call('mcp__oauth__who', {}); assert(r.ok && r.text === 'me' && refreshes === 1);
  // cancelling a call sends notifications/cancelled
  const ac = new AbortController();
  const clockSrv = mgr.info('mcp__clock__time'); assert(clockSrv);
  slowNext = true;
  const slow = mgr.call('mcp__clock__time', {}, ac.signal);
  setTimeout(() => ac.abort(), 200); await assert.rejects(() => slow, /Aborted/);
  await new Promise((res) => setTimeout(res, 100)); assert(cancelled.length >= 1, 'cancel notification sent');

  // import
  const imp = parseImport(JSON.stringify({ mcpServers: { fs: { command: 'npx', args: ['-y', 'x'], env: { A: '1' } }, remote: { url: 'https://x/mcp', headers: { Authorization: 'Bearer t' } } } }));
  assert(imp.length === 2 && imp[0].type === 'stdio' && imp[1].type === 'http' && imp[1].headers.Authorization === 'Bearer t');
  assert.throws(() => parseImport('{"mcpServers":{}}'), /No servers/);

  {
    // a connector that is Artemis itself is hidden from Artemis's own agents
    const { hideServers, isSelfConnector } = require('../electron/mcp');
    assert.ok(isSelfConnector({ url: 'http://127.0.0.1:8788/mcp' }, [8788, 8789]));
    assert.ok(isSelfConnector({ url: 'http://localhost:8789/mcp' }, [8788, 8789]));
    assert.ok(!isSelfConnector({ url: 'http://127.0.0.1:9000/mcp' }, [8788, 8789]));
    assert.ok(!isSelfConnector({ url: 'https://mcp.notion.com/mcp' }, [443]));
    assert.ok(!isSelfConnector({ command: 'npx' }, [8788]));
    const fake = {
      index: () => [{ slug: 'artemis', name: 'Artemis', tools: ['artemis_fs_read_file'] }, { slug: 'notion', name: 'Notion', tools: ['search'] }],
      definitions: (slugs) => (slugs || ['artemis', 'notion']).map((x) => ({ function: { name: `mcp__${x}__t` } })),
      resolveSlug: (q) => q, info: (n) => ({ server: n.split('__')[1] }), call: async () => 'ran'
    };
    const v = hideServers(fake, () => ['artemis']);
    assert.deepStrictEqual(v.index().map((x) => x.slug), ['notion']);
    assert.deepStrictEqual(v.definitions().map((d) => d.function.name), ['mcp__notion__t']);
    assert.deepStrictEqual(v.definitions(['artemis', 'notion']).map((d) => d.function.name), ['mcp__notion__t']);
    assert.strictEqual(v.resolveSlug('artemis'), '');
    await assert.rejects(v.call('mcp__artemis__artemis_fs_read_file', {}), /not available/);
    assert.strictEqual(await v.call('mcp__notion__search', {}), 'ran');
    console.log('mcp: self connector hidden ok');
  }

  mgr.close(); srv.close();
  console.log('mcp: all tests passed');
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
