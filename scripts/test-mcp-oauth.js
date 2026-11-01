const assert = require('assert');
const { resolveOAuth, authParam } = require('../electron/mcp-oauth.js');

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
const server = (routes) => {
  const seen = [];
  const f = async (url, init = {}) => { seen.push(`${init.method || 'GET'} ${url}`); const r = routes[`${init.method || 'GET'} ${url}`]; return r ? r(init) : new Response('nope', { status: 404 }); };
  f.seen = seen; return f;
};

(async () => {
  assert.strictEqual(authParam('Bearer resource_metadata="https://a/b", scope="x y"', 'scope'), 'x y');
  assert.strictEqual(authParam('Bearer scope=x', 'scope'), 'x');

  // the full path: 401 hint -> resource metadata -> auth server metadata -> registration
  const full = server({
    'POST https://mcp.test/mcp': () => json({}, 401, { 'www-authenticate': 'Bearer resource_metadata="https://mcp.test/meta", scope="read"' }),
    'GET https://mcp.test/meta': () => json({ resource: 'https://mcp.test/mcp', authorization_servers: ['https://auth.test/tenant'] }),
    'GET https://auth.test/.well-known/oauth-authorization-server/tenant': () => json({ authorization_endpoint: 'https://auth.test/a', token_endpoint: 'https://auth.test/t', registration_endpoint: 'https://auth.test/r' }),
    'POST https://auth.test/r': (init) => { assert.deepStrictEqual(JSON.parse(init.body).redirect_uris, ['http://127.0.0.1:9/callback']); return json({ client_id: 'dyn' }, 201); },
  });
  let c = await resolveOAuth({ url: 'https://mcp.test/mcp' }, 'http://127.0.0.1:9/callback', full);
  assert.deepStrictEqual(c, { authorizationUrl: 'https://auth.test/a', tokenUrl: 'https://auth.test/t', scope: 'read', resource: 'https://mcp.test/mcp', clientId: 'dyn', clientSecret: '', dcr: true });

  // a registered client is registered again, because the redirect port changes
  const before = full.seen.filter((x) => x === 'POST https://auth.test/r').length;
  await resolveOAuth({ url: 'https://mcp.test/mcp', ...c }, 'http://127.0.0.1:9/callback', full);
  assert.strictEqual(full.seen.filter((x) => x === 'POST https://auth.test/r').length, before + 1);

  // no resource metadata: the server's own origin is the auth server
  const legacy = server({ 'GET https://old.test/.well-known/oauth-authorization-server': () => json({ authorization_endpoint: 'https://old.test/a', token_endpoint: 'https://old.test/t' }) });
  c = await resolveOAuth({ url: 'https://old.test/mcp', clientId: 'mine' }, 'x', legacy);
  assert.strictEqual(c.clientId, 'mine'); assert.strictEqual(c.dcr, false); assert.strictEqual(c.resource, '');

  // hand-typed endpoints are used as they are, nothing is fetched
  const none = server({});
  c = await resolveOAuth({ url: 'https://x.test', authorizationUrl: 'https://g/a', tokenUrl: 'https://g/t', clientId: 'id', clientSecret: 's' }, 'x', none);
  assert.strictEqual(none.seen.length, 0); assert.strictEqual(c.clientSecret, 's');

  // an ordinary web page, or endpoints that are not web addresses, are refused
  await assert.rejects(resolveOAuth({ url: 'http://site.test/wp-admin' }, 'x', server({})), /does not offer OAuth/);
  await assert.rejects(resolveOAuth({ url: 'https://e.test' }, 'x', server({ 'GET https://e.test/.well-known/oauth-authorization-server': () => json({ authorization_endpoint: 'file:///etc/passwd', token_endpoint: 'https://e.test/t' }) })), /does not offer OAuth/);
  await assert.rejects(resolveOAuth({ url: 'https://n.test' }, 'x', server({ 'GET https://n.test/.well-known/oauth-authorization-server': () => json({ authorization_endpoint: 'https://n.test/a', token_endpoint: 'https://n.test/t' }) })), /no automatic registration/);
  await assert.rejects(resolveOAuth({ url: 'nope' }, 'x', server({})), /valid http/);
  console.log('mcp-oauth ok');
})().catch((e) => { console.error(e); process.exit(1); });
