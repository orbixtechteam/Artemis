// Connector sign-ins are refreshed in one place: the server, one refresh at a time, and a linked desktop takes the server's
// copy instead of refreshing its own. With single-use refresh tokens, two copies refreshing on their own broke sign-ins.
const assert = require('assert');
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
const { createHeadless } = require('../electron/core/headless');
const { createMcpManager } = require('../electron/mcp');
(async () => {
  // an OAuth server whose refresh tokens work once (like many MCP sign-ins)
  let calls = 0; const used = new Set(); let n = 1;
  const auth = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => {
      calls++;
      const rt = new URLSearchParams(b).get('refresh_token');
      setTimeout(() => {
        if (used.has(rt)) { res.writeHead(400, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'invalid_grant' })); }
        used.add(rt); n++;
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ access_token: 'a' + n, refresh_token: 'r' + n, expires_in: 3600 }));
      }, 100);
    });
  });
  await new Promise((ok) => auth.listen(0, '127.0.0.1', ok));
  const tokenUrl = `http://127.0.0.1:${auth.address().port}/token`;
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'artemis-refresh-'));
  fs.writeFileSync(path.join(data, 'mcp.json'), JSON.stringify([{ id: 'c1', name: 'Todo', type: 'http', url: 'http://127.0.0.1:9/mcp', enabled: false, tokenUrl, clientId: 'x', oauth: { accessToken: 'a1', refreshToken: 'r1', expiresAt: Date.now() - 1000 } }]));
  const hl = createHeadless({ dataDir: data, port: 0, keychain: false, scheduler: false, telegram: false, connectors: false, browser: false, computer: false, log: () => {} });
  const addr = await hl.start();
  const T = JSON.parse(fs.readFileSync(path.join(data, 'gateway.json'), 'utf8')).token;
  const call = (u, body) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: addr.port, path: u, method: 'POST', headers: { authorization: 'Bearer ' + T, 'content-type': 'application/json' } }, (res) => {
      let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => { try { resolve({ status: res.statusCode, ...JSON.parse(b) }); } catch { reject(new Error(b)); } });
    });
    req.on('error', reject); req.end(JSON.stringify(body || {}));
  });
  // two copies asking at once: one refresh, both get the same new sign-in
  const [x, y] = await Promise.all([call('/v1/x/connectors/c1/token', { stale: 'a1' }), call('/v1/x/connectors/c1/token', { stale: 'a1' })]);
  assert.strictEqual(x.oauth.accessToken, 'a2'); assert.strictEqual(y.oauth.accessToken, 'a2');
  assert.strictEqual(calls, 1, 'refreshed once');
  // a copy that is behind gets the current one, with no new refresh
  const z = await call('/v1/x/connectors/c1/token', { stale: 'a1' });
  assert.strictEqual(z.oauth.accessToken, 'a2'); assert.strictEqual(calls, 1);
  const saved = JSON.parse(fs.readFileSync(path.join(data, 'mcp.json'), 'utf8'))[0].oauth;
  assert.strictEqual(saved.refreshToken, 'r2', 'the new refresh token is saved');
  // the desktop syncs its older copy: the server keeps its own and hands it back
  const s = await call('/v1/x/sync', { connectors: [{ id: 'c1', name: 'Todo', type: 'http', url: 'http://127.0.0.1:9/mcp', enabled: false, tokenUrl, clientId: 'x', oauth: { accessToken: 'a1', refreshToken: 'r1', expiresAt: Date.now() - 1000 } }] });
  assert.deepStrictEqual(s.tokens.map((t) => [t.id, t.oauth.accessToken, t.oauth.refreshToken]), [['c1', 'a2', 'r2']]);
  assert.strictEqual((await call('/v1/x/connectors/nope/token', {})).status, 404);
  await hl.stop();

  // the manager asks the refresher first and refreshes on its own only when it answers null
  // a connector whose token is no longer accepted takes the refresher's (the server's) sign-in, without its own refresh
  const mcpSrv = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => {
      if (req.headers.authorization !== 'Bearer s9') { res.writeHead(401); return res.end(); }
      const msg = JSON.parse(b || '{}');
      if (msg.id === undefined) { res.writeHead(202); return res.end(); }
      const result = msg.method === 'initialize' ? { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1' } } : msg.method === 'tools/list' ? { tools: [{ name: 'ping', inputSchema: { type: 'object' } }] } : {};
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
    });
  });
  await new Promise((ok) => mcpSrv.listen(0, '127.0.0.1', ok));
  const before = calls;
  const m = createMcpManager();
  const asked = []; const saved2 = [];
  m.setTokenRefresher(async (cfg) => { asked.push(cfg.oauth.accessToken); return { accessToken: 's9', refreshToken: 'rs9', expiresAt: Date.now() + 3600000 }; });
  m.setTokenSaver((id, o) => saved2.push([id, o.accessToken]));
  await m.configure([{ id: 'c2', name: 'Fake', type: 'http', url: `http://127.0.0.1:${mcpSrv.address().port}/mcp`, tokenUrl, oauth: { accessToken: 'old', refreshToken: 'r-old', expiresAt: Date.now() + 3600000 } }]);
  const st = m.status()[0];
  assert.strictEqual(st.state, 'connected', st.error);
  assert.deepStrictEqual(asked, ['old']); assert.deepStrictEqual(saved2, [['c2', 's9']]);
  assert.strictEqual(calls, before, 'the token endpoint was not called by this copy');
  m.close(); mcpSrv.close(); auth.close();
  console.log('test-connector-refresh: ok');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
