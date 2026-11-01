// OAuth for remote MCP servers: finds the sign-in endpoints from the server URL and registers Artemis as a client,
// so the user only needs the URL (protected resource metadata, authorization server metadata, dynamic client registration).
const TIMEOUT = 15000;

const isWeb = (u) => { try { return /^https?:$/.test(new URL(u).protocol); } catch { return false; } };

/** Reads one parameter of a WWW-Authenticate header, quoted or not. */
function authParam(header, name) {
  const m = new RegExp(`(?:^|[\\s,])${name}=(?:"([^"]*)"|([^\\s,]+))`, 'i').exec(header || '');
  return m ? m[1] ?? m[2] : '';
}

async function getJson(url, fetchFn) {
  try {
    const res = await fetchFn(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT) });
    if (!res.ok) return null;
    const j = await res.json();
    return j && typeof j === 'object' ? j : null;
  } catch { return null; }
}

const firstJson = async (urls, fetchFn, ok) => {
  for (const url of urls) { const j = await getJson(url, fetchFn); if (j && ok(j)) return j; }
  return null;
};

/** The unauthenticated request a server answers with 401 and the WWW-Authenticate hints. */
async function probe(url, fetchFn) {
  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    const header = res.headers.get('www-authenticate') || '';
    res.body?.cancel?.().catch?.(() => {});
    return { metadataUrl: authParam(header, 'resource_metadata'), scope: authParam(header, 'scope') };
  } catch { return { metadataUrl: '', scope: '' }; }
}

function authServerUrls(issuer) {
  const u = new URL(issuer);
  const path = u.pathname.replace(/\/+$/, '');
  if (!path) return [`${u.origin}/.well-known/oauth-authorization-server`, `${u.origin}/.well-known/openid-configuration`];
  return [`${u.origin}/.well-known/oauth-authorization-server${path}`, `${u.origin}/.well-known/openid-configuration${path}`, `${u.origin}${path}/.well-known/openid-configuration`];
}

async function register(endpoint, redirectUri, fetchFn) {
  const res = await fetchFn(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ client_name: 'Artemis', redirect_uris: [redirectUri], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.client_id) throw new Error(`Could not register with the sign-in server: ${j.error_description || j.error || 'HTTP ' + res.status}.`);
  return { clientId: j.client_id, clientSecret: j.client_secret || '' };
}

/**
 * Returns the settings needed to sign in to cfg.url. Endpoints typed by hand win. A registered client is tied to
 * redirectUri, whose port changes between launches, so it is registered again on every sign-in (dcr: true).
 * -> { authorizationUrl, tokenUrl, clientId, clientSecret, scope, resource, dcr }
 */
async function resolveOAuth(cfg, redirectUri, fetchFn = fetch) {
  const manual = !cfg.dcr && cfg.authorizationUrl && cfg.tokenUrl;
  if (manual && cfg.clientId) return { authorizationUrl: cfg.authorizationUrl, tokenUrl: cfg.tokenUrl, clientId: cfg.clientId, clientSecret: cfg.clientSecret || '', scope: cfg.scope || '', resource: cfg.resource || '', dcr: false };
  if (!isWeb(cfg.url)) throw new Error('Enter a valid http(s) server URL first.');
  const url = new URL(cfg.url);
  const path = url.pathname.replace(/\/+$/, '');
  const hint = await probe(cfg.url, fetchFn);
  const resourceUrls = [
    ...(isWeb(hint.metadataUrl) ? [hint.metadataUrl] : []),
    ...(path ? [`${url.origin}/.well-known/oauth-protected-resource${path}`] : []),
    `${url.origin}/.well-known/oauth-protected-resource`,
  ];
  const resource = await firstJson(resourceUrls, fetchFn, (j) => Array.isArray(j.authorization_servers) && j.authorization_servers.length > 0);
  const issuer = resource?.authorization_servers.find(isWeb) || url.origin;
  const meta = await firstJson(authServerUrls(issuer), fetchFn, (j) => isWeb(j.authorization_endpoint) && isWeb(j.token_endpoint));
  if (!meta) throw new Error('This server does not offer OAuth sign-in. Check that the URL is its MCP endpoint, or use a token if it gives you one.');
  const scope = cfg.scope || hint.scope || resource?.scopes_supported?.join(' ') || '';
  const out = { authorizationUrl: meta.authorization_endpoint, tokenUrl: meta.token_endpoint, scope, resource: resource?.resource || '' };
  if (cfg.clientId && !cfg.dcr) return { ...out, clientId: cfg.clientId, clientSecret: cfg.clientSecret || '', dcr: false };
  if (!isWeb(meta.registration_endpoint)) throw new Error('This server has no automatic registration. Enter a Client ID under Advanced OAuth settings.');
  return { ...out, ...(await register(meta.registration_endpoint, redirectUri, fetchFn)), dcr: true };
}

module.exports = { resolveOAuth, authParam };
