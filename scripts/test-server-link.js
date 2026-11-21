// The desktop's link to a server (electron/server-link.js) against a real gateway, and the Settings → Server input cleaning.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createServerLink, normalizeUrl } = require('../electron/server-link');
const { createClients } = require('../electron/core/clients');
const { createGateway } = require('../electron/core/gateway');
const { cleanHosts, cleanOrigins } = require('../electron/ipc/server');

(async () => {
  // addresses
  assert.strictEqual(normalizeUrl('artemis.example.com'), 'https://artemis.example.com');
  assert.strictEqual(normalizeUrl('https://artemis.example.com/v1/'), 'https://artemis.example.com');
  assert.strictEqual(normalizeUrl('192.168.1.20:8789'), 'http://192.168.1.20:8789');
  assert.strictEqual(normalizeUrl('http://localhost:8789'), 'http://localhost:8789');
  assert.throws(() => normalizeUrl('http://artemis.example.com'), /https/);
  assert.throws(() => normalizeUrl('ftp://x.com'), /https/);
  assert.throws(() => normalizeUrl('https://u:p@x.com'), /user name/);
  assert.throws(() => normalizeUrl(''), /address/);
  assert.deepStrictEqual(cleanHosts('https://Artemis.Example.com/x, bad host, localhost , artemis.example.com:443'), ['artemis.example.com']);
  assert.deepStrictEqual(cleanOrigins('https://app.example.com/, http://evil.com, https://a.com/path, http://localhost:8081'), ['https://app.example.com', 'http://localhost:8081']);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'artemis-link-'));
  const clients = createClients({ file: path.join(tmp, 'clients.json') });
  const gw = createGateway({ port: 0, token: 'admin', clients, handlers: {
    info: () => ({ mode: 'headless', version: '2.0.0', model: 'prov:x:m', serverName: 'home-box' }),
    chat: async () => ({ sessionId: 's', text: '' }), abort: () => false, approve: () => false,
    sessions: { recent: () => [], get: () => null, search: () => [] }
  } });
  const { port } = await gw.start();
  const base = `http://127.0.0.1:${port}`;

  let cfg = null, token = '';
  const link = createServerLink({ getConfig: () => cfg, setConfig: (c) => { cfg = c; }, getToken: () => token, setToken: (t) => { token = t; }, deviceName: () => 'Test Mac' });
  assert.deepStrictEqual(await link.status(), { configured: false });
  await assert.rejects(link.connect({ url: base, code: 'WRNG-CODE' }), /wrong or has expired/);
  await assert.rejects(link.connect({ url: 'http://127.0.0.1:1', code: 'X' }), /Could not reach/);
  const { code } = clients.createPairing();
  const c = await link.connect({ url: base + '/v1', code });
  assert.strictEqual(c.url, base); assert.strictEqual(c.name, 'Test Mac'); assert.strictEqual(c.serverName, 'home-box');
  assert.ok(token.startsWith('art_'));
  let st = await link.status();
  assert.strictEqual(st.online, true); assert.strictEqual(st.client.kind, 'desktop'); assert.strictEqual(st.version, '2.0.0');
  assert.strictEqual((await link.request('/v1/health')).model, 'prov:x:m');
  // revoked on the server: the link says so
  clients.revoke(cfg.clientId);
  st = await link.status();
  assert.strictEqual(st.online, false); assert.strictEqual(st.revoked, true);
  // pair again, then disconnect: the server drops the token too
  const again = clients.createPairing();
  await link.connect({ url: base, code: again.code, name: 'Second' });
  const id = cfg.clientId;
  const d = await link.disconnect();
  assert.ok(d.ok && d.revoked);
  assert.strictEqual(cfg, null); assert.strictEqual(token, '');
  assert.ok(clients.list().find((x) => x.id === id).revoked);
  await assert.rejects(link.request('/v1/health'), /No server/);
  // an address that answers but is not Artemis
  const http = require('http');
  const other = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end('<html>hi</html>'); });
  await new Promise((r) => other.listen(0, '127.0.0.1', r));
  await assert.rejects(link.connect({ url: `http://127.0.0.1:${other.address().port}`, code: 'X' }), /not an Artemis server/);
  other.close();
  await gw.stop();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('test-server-link: ok');
})().catch((e) => { console.error(e); process.exit(1); });
