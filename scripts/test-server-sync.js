// The desktop keeping the server in step (projects, connectors with their secrets, provider keys), connector keys typed
// in an app, and a connector sign-in that ends on the server (OAuth with a registered client, PKCE).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { createHeadless } = require('../electron/core/headless');

const send = (h, area, method, parts, b) => h.handlers.extra(area, { method, parts, query: new URLSearchParams(), body: async () => b, client: { id: 'c1', kind: 'desktop' } });

(async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'artemis-sync-'));
  process.env.ARTEMIS_MASTER_KEY = 'k'.repeat(64);
  const h = createHeadless({ dataDir: data, port: 0, keychain: false, scheduler: false, telegram: false, connectors: false, browser: false, computer: false, log: () => {} });
  fs.writeFileSync(path.join(data, 'projects.json'), JSON.stringify([{ id: 'srv1', name: 'Made on the phone' }]));

  // desktop sync
  const r = await send(h, 'sync', 'POST', [], {
    projects: [{ id: 'p1', name: 'Research' }],
    connectors: [{ id: 'tg', name: 'telegram', type: 'stdio', command: 'npx', args: ['-y', 'x'], env: { TELEGRAM_API_ID: '123', TELEGRAM_API_HASH: 'abc' }, headers: {}, enabled: true },
      { id: 'no', name: 'Notion', type: 'http', url: 'https://mcp.example/mcp', env: {}, headers: {}, oauth: { accessToken: 'AT', refreshToken: 'RT', expiresAt: 5 }, enabled: true }],
    providers: [{ id: 'or', name: 'OpenRouter' }], providerKeys: { or: 'sk-or' },
  });
  assert.deepStrictEqual(r.projects.map((p) => p.id).sort(), ['p1', 'srv1']);
  const raw = JSON.parse(fs.readFileSync(path.join(data, 'mcp.json'), 'utf8'));
  const tg = raw.find((c) => c.id === 'tg');
  assert.ok(tg.env.TELEGRAM_API_ID.startsWith('sec:'), 'secrets are kept as references');
  assert.ok(!JSON.stringify(raw).includes('abc') && !JSON.stringify(raw).includes('"AT"'), 'no plain secret in mcp.json');
  assert.strictEqual(h.secretStore.get(tg.env.TELEGRAM_API_HASH.slice(4)), 'abc');
  assert.strictEqual(h.getProviderKey('or'), 'sk-or');
  // a project removed on the desktop goes; one made on the phone stays
  const r2 = await send(h, 'sync', 'POST', [], { projects: [], removedProjects: ['p1'] });
  assert.deepStrictEqual(r2.projects.map((p) => p.id), ['srv1']);

  // deleted on the phone: the desktop's next sync (an older copy) does not bring it back; a newer edit wins
  await send(h, 'sync', 'POST', [], { projects: [{ id: 'p2', name: 'Two', updatedAt: 1 }] });
  await send(h, 'projects', 'DELETE', ['p2'], {});
  const r3 = await send(h, 'sync', 'POST', [], { projects: [{ id: 'p2', name: 'Two', updatedAt: 1 }] });
  assert.ok(!r3.projects.some((p) => p.id === 'p2') && r3.deletedProjects.includes('p2'));
  const e1 = await send(h, 'projects', 'POST', ['srv1'], { name: 'Renamed', instructions: 'Be brief.' });
  const r4 = await send(h, 'sync', 'POST', [], { projects: [{ id: 'srv1', name: 'Old', updatedAt: 1 }] });
  assert.strictEqual(r4.projects.find((p) => p.id === 'srv1').name, 'Renamed');
  assert.strictEqual(e1.project.instructions, 'Be brief.');

  // project files: added from the phone, read once, kept through a desktop sync that does not know them yet,
  // asked from the desktop when the server lacks them, and removed for good
  const added = await send(h, 'projects', 'POST', ['srv1', 'files'], { name: 'brief.md', data: Buffer.from('# Brief\nThe client is ACME.').toString('base64') });
  assert.ok(added.file.id && added.file.path.endsWith('brief.md'));
  const r5 = await send(h, 'sync', 'POST', [], { projects: [{ id: 'srv1', name: 'Renamed', updatedAt: Date.now(), files: [{ id: 'deskf1', name: 'desk.txt', size: 3, addedAt: 1 }] }] });
  const sp = r5.projects.find((p) => p.id === 'srv1');
  assert.deepStrictEqual(sp.files.map((f) => f.id).sort(), [added.file.id, 'deskf1'].sort());
  assert.deepStrictEqual(r5.needFiles, [{ pid: 'srv1', fid: 'deskf1' }]);
  const { knowledgeText } = require('../electron/core/project-files');
  const pf = require('../electron/core/project-files').createProjectFiles({ dir: path.join(data, 'project-files'), files: require('../electron/files') });
  assert.ok(knowledgeText(pf.knowledge(sp)).includes('The client is ACME.'));
  await send(h, 'projects', 'DELETE', ['srv1', 'files', added.file.id], {});
  const r6 = await send(h, 'sync', 'POST', [], { projects: [{ id: 'srv1', name: 'Renamed', updatedAt: 1, files: [{ id: added.file.id, name: 'brief.md', addedAt: 1 }] }] });
  assert.ok(!r6.projects.find((p) => p.id === 'srv1').files.some((f) => f.id === added.file.id), 'a removed file stays removed');

  // connectors list says what is missing; a key typed in the app fills it
  fs.writeFileSync(path.join(data, 'mcp.json'), JSON.stringify([...raw, { id: 'gh', name: 'github', type: 'http', url: 'https://gh.example/mcp', headers: { Authorization: '' }, env: {}, enabled: true }]));
  let list = (await send(h, 'connectors', 'GET', [], {})).connectors;
  assert.deepStrictEqual(list.find((c) => c.id === 'gh').missing, ['Authorization']);
  assert.strictEqual(list.find((c) => c.id === 'no').signedIn, true);
  await send(h, 'connectors', 'POST', ['gh'], { headers: { Authorization: 'Bearer ghp' } });
  list = (await send(h, 'connectors', 'GET', [], {})).connectors;
  assert.deepStrictEqual(list.find((c) => c.id === 'gh').missing, []);

  // sign-in through the server: discovery, registration with the server's redirect, PKCE, token, saved encrypted
  let registered = null, tokenBody = null;
  const as = http.createServer((req, res) => {
    let b = ''; req.on('data', (x) => { b += x; }); req.on('end', () => {
      const base = `http://127.0.0.1:${as.address().port}`;
      const j = (o, s = 200) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.url.startsWith('/.well-known/oauth-protected-resource')) return j({ resource: base + '/mcp', authorization_servers: [base] });
      if (req.url.startsWith('/.well-known/oauth-authorization-server')) return j({ issuer: base, authorization_endpoint: base + '/authorize', token_endpoint: base + '/token', registration_endpoint: base + '/register' });
      if (req.url === '/register') { const reg = JSON.parse(b); const ru = reg.redirect_uris[0]; if (/^http:\/\/(?!localhost|127\.0\.0\.1)/.test(ru)) return j({ error: 'invalid_redirect_uri', error_description: 'URI must use HTTPS (http://localhost allowed for testing): ' + ru }, 400); registered = reg; return j({ client_id: 'cid-1' }); }
      if (req.url === '/token') { tokenBody = new URLSearchParams(b); return j({ access_token: 'NEW', refresh_token: 'NEWR', expires_in: 3600 }); }
      if (req.url.startsWith('/mcp')) { res.writeHead(401, { 'www-authenticate': 'Bearer' }); return res.end(); }
      j({}, 404);
    });
  });
  await new Promise((ok) => as.listen(0, '127.0.0.1', ok));
  const cur = JSON.parse(fs.readFileSync(path.join(data, 'mcp.json'), 'utf8'));
  cur.push({ id: 'zz', name: 'Zap', type: 'http', url: `http://127.0.0.1:${as.address().port}/mcp`, env: {}, headers: {}, enabled: true });
  fs.writeFileSync(path.join(data, 'mcp.json'), JSON.stringify(cur));
  const st = await send(h, 'connectors', 'POST', ['zz', 'signin'], { base: 'https://artemis.example.com' });
  const u = new URL(st.url);
  assert.strictEqual(u.searchParams.get('redirect_uri'), 'https://artemis.example.com/v1/oauth/callback');
  assert.deepStrictEqual(registered.redirect_uris, ['https://artemis.example.com/v1/oauth/callback']);
  const bad = await h.handlers.oauthCallback({ code: 'x', state: 'nope' });
  assert.strictEqual(bad.ok, false);
  const ok = await h.handlers.oauthCallback({ code: 'CODE', state: u.searchParams.get('state') });
  assert.strictEqual(ok.ok, true, ok.html);
  assert.strictEqual(tokenBody.get('code'), 'CODE'); assert.ok(tokenBody.get('code_verifier'));
  const again = await h.handlers.oauthCallback({ code: 'CODE', state: u.searchParams.get('state') });
  assert.strictEqual(again.ok, false, 'a state works once');
  const zz = JSON.parse(fs.readFileSync(path.join(data, 'mcp.json'), 'utf8')).find((c) => c.id === 'zz');
  assert.ok(zz.oauth.accessToken.startsWith('sec:') && h.secretStore.get(zz.oauth.accessToken.slice(4)) === 'NEW');
  // a phone on the home network (plain http): the provider sends the browser back to the app, which hands the code over
  const lan = await send(h, 'connectors', 'POST', ['zz', 'signin'], { base: 'http://192.168.0.187:8790', native: true });
  assert.strictEqual(lan.mode, 'native');
  const lu = new URL(lan.url);
  assert.strictEqual(lu.searchParams.get('redirect_uri'), 'artemis://oauth');
  assert.ok(await send(h, 'connectors', 'POST', ['oauth', 'finish'], { code: 'C2', state: lu.searchParams.get('state') }));
  assert.strictEqual(tokenBody.get('redirect_uri'), 'artemis://oauth');
  // the web app on plain http cannot be sent back: a clear message, not an internal error
  await assert.rejects(send(h, 'connectors', 'POST', ['zz', 'signin'], { base: 'http://192.168.0.187:8790' }), (e) => e.status === 400 && /https address/.test(e.message));
  as.close();
  console.log('test-server-sync: ok');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
