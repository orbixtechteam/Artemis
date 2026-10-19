// Web search and page fetching. Results are untrusted content.
const dns = require('dns');
const net = require('net');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const MAX_BODY = 3 * 1024 * 1024;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”' };
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(code); } catch { return m; }
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

// HTML clean-up uses indexOf scans instead of lazy regexes, so a page full of unclosed tags stays linear.
const BLOCK_TAGS = /<(script|style|noscript|svg|head|template)\b/g;
function stripBlocks(html) {
  const low = html.toLowerCase();
  let out = '', i = 0;
  // comments: an unclosed one runs to the end, as in browsers
  for (;;) {
    const a = low.indexOf('<!--', i);
    if (a < 0) { out += html.slice(i); break; }
    out += html.slice(i, a);
    const b = low.indexOf('-->', a + 4);
    if (b < 0) { i = html.length; break; }
    i = b + 3;
  }
  const src = out, lsrc = src.toLowerCase();
  const noClose = new Set();
  out = ''; i = 0; BLOCK_TAGS.lastIndex = 0;
  let m;
  while ((m = BLOCK_TAGS.exec(lsrc))) {
    if (m.index < i) continue;
    out += src.slice(i, m.index);
    const tag = m[1];
    const close = noClose.has(tag) ? -1 : lsrc.indexOf('</' + tag, m.index + m[0].length);
    if (close < 0) { // unclosed: drop just the opening tag
      noClose.add(tag);
      const gt = lsrc.indexOf('>', m.index);
      i = gt < 0 ? src.length : gt + 1;
    } else {
      const gt = lsrc.indexOf('>', close);
      i = gt < 0 ? src.length : gt + 1;
    }
    BLOCK_TAGS.lastIndex = i;
  }
  return out + src.slice(i);
}

function linkify(html) {
  const low = html.toLowerCase();
  let out = '', i = 0, noClose = false;
  for (;;) {
    const a = low.indexOf('<a', i);
    if (a < 0 || noClose) { out += html.slice(i); break; }
    if (!/\s/.test(low[a + 2] || '')) { out += html.slice(i, a + 2); i = a + 2; continue; }
    const gt = low.indexOf('>', a);
    if (gt < 0) { out += html.slice(i); break; }
    const close = low.indexOf('</a>', gt);
    if (close < 0) { noClose = true; out += html.slice(i); break; }
    const href = /href="(https?:[^"]{1,2000})"/i.exec(html.slice(a, Math.min(gt, a + 4000)));
    out += html.slice(i, a);
    const text = html.slice(gt + 1, close).replace(/<[^<>]*>/g, '').trim();
    out += href ? (text ? `${text} (${href[1]})` : '') : text;
    i = close + 4;
  }
  return out;
}

function titleOf(html) {
  const low = html.toLowerCase();
  const a = low.indexOf('<title');
  if (a < 0) return '';
  const gt = low.indexOf('>', a);
  const b = gt < 0 ? -1 : low.indexOf('</title>', gt);
  return b < 0 ? '' : html.slice(gt + 1, b);
}

function htmlToText(html) {
  const title = decodeEntities(titleOf(html)).trim();
  let s = linkify(stripBlocks(html))
    .replace(/<li\b[^<>]*>/gi, '\n- ')
    .replace(/<\/(p|div|section|article|h[1-6]|tr|ul|ol|table|blockquote|pre)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^<>]*>/g, '');
  s = decodeEntities(s).replace(/[ \t\f\v]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { title, text: s };
}

function isPrivateIPv4(ip) {
  const [a, b, c] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0 && c === 0) || (a === 198 && (b === 18 || b === 19));
}

/** IPv6 text -> 8 groups (numbers), or null. Handles :: and an embedded IPv4 tail. */
function ipv6Groups(ip) {
  let s = ip.toLowerCase().replace(/%.*$/, '');
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4) { const p = v4[1].split('.').map(Number); s = s.slice(0, -v4[1].length) + ((p[0] << 8) | p[1]).toString(16) + ':' + ((p[2] << 8) | p[3]).toString(16); }
  const [l, r] = s.split('::');
  const left = l ? l.split(':') : [], right = r ? r.split(':') : [];
  const fill = s.includes('::') ? 8 - left.length - right.length : 0;
  const g = [...left, ...Array(fill).fill('0'), ...right].map((x) => parseInt(x || '0', 16));
  return g.length === 8 && g.every((n) => n >= 0 && n <= 0xffff) ? g : null;
}

function isPrivateIPv6(ip) {
  const g = ipv6Groups(ip);
  if (!g) return true;
  if (g.every((n) => n === 0)) return true; // ::
  if (g.slice(0, 7).every((n) => n === 0) && g[7] === 1) return true; // ::1
  const v4of = (hi, lo) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  if (g.slice(0, 5).every((n) => n === 0) && (g[5] === 0xffff || g[5] === 0)) return isPrivateIPv4(v4of(g[6], g[7])); // IPv4-mapped / compatible
  if (g[0] === 0x64 && g[1] === 0xff9b) return isPrivateIPv4(v4of(g[6], g[7])); // NAT64
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  return false;
}

/** True for an address or name that is not on the public internet. Hostnames are only judged by name here; webFetch also checks their DNS answers. */
function isPrivateHost(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!h) return true;
  const v = net.isIP(h);
  if (v === 4) return isPrivateIPv4(h);
  if (v === 6) return isPrivateIPv6(h);
  if (h === 'localhost' || /\.(localhost|local|internal|home\.arpa|lan)$/.test(h)) return true;
  return !h.includes('.'); // single-label names resolve inside the local network
}

/** Throws if host is private or any address it resolves to is. */
async function assertPublic(host, lookup = dns.promises.lookup) {
  if (isPrivateHost(host)) throw new Error('Local and private network addresses are blocked.');
  const h = host.replace(/^\[|\]$/g, '');
  if (net.isIP(h)) return;
  let addrs;
  try { addrs = await lookup(h, { all: true }); } catch (e) { throw new Error(`Could not resolve ${h}: ${e.code || e.message}`); }
  if (!addrs.length || addrs.some((a) => isPrivateHost(a.address))) throw new Error(`${h} resolves to a private network address; blocked.`);
}

/** Charset from the Content-Type header or a <meta> in the first bytes; falls back to UTF-8, then windows-1254. */
function decodeBody(buf, type) {
  let cs = (/charset=["']?([\w.:-]+)/i.exec(type) || [])[1];
  if (!cs && /html|xml/.test(type)) {
    const head = buf.subarray(0, 4096).toString('latin1');
    cs = (/<meta[^>]{0,200}?charset=["']?([\w.:-]+)/i.exec(head) || [])[1];
  }
  if (cs) { try { return new TextDecoder(cs.toLowerCase()).decode(buf); } catch {} }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return new TextDecoder('windows-1254').decode(buf); }
}

function withTimeout(signal, ms) {
  const t = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, t]) : t;
}

const MAX_REDIRECTS = 5;

// Redirects are followed by hand so every hop is checked. DNS is checked before the request; a rebinding race remains possible.
async function webFetch(url, { signal, maxChars = 40000, allowPrivate = false, lookup } = {}) {
  let u;
  try { u = new URL(url); } catch { throw new Error(`Invalid URL: ${url}`); }
  const sig = withTimeout(signal, 20000);
  let res;
  for (let hop = 0; ; hop++) {
    if (!/^https?:$/.test(u.protocol)) throw new Error('Only http(s) URLs are allowed.');
    if (!allowPrivate) await assertPublic(u.hostname, lookup);
    res = await fetch(u, {
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.5' },
      redirect: 'manual', signal: sig
    });
    const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!loc) break;
    try { await res.body?.cancel(); } catch {}
    if (hop >= MAX_REDIRECTS) throw new Error(`Too many redirects (more than ${MAX_REDIRECTS}).`);
    try { u = new URL(loc, u); } catch { throw new Error(`Bad redirect target: ${loc}`); }
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const type = (res.headers.get('content-type') || '').toLowerCase();
  if (!/(text\/|json|xml|javascript)/.test(type)) throw new Error(`Unsupported content type: ${type || 'unknown'}`);

  const reader = res.body.getReader();
  const chunks = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length; chunks.push(value);
    if (size > MAX_BODY) { await reader.cancel(); break; }
  }
  const body = decodeBody(Buffer.concat(chunks), type);
  let out;
  if (type.includes('html')) {
    const { title, text } = htmlToText(body);
    out = (title ? `Title: ${title}\n\n` : '') + text;
  } else out = body;
  const clipped = out.length > maxChars ? out.slice(0, maxChars) + `\n…[truncated, ${out.length} characters total]` : out;
  return `URL: ${u.href}\n\n${clipped}`;
}

function parseDdg(html) {
  const results = [];
  const linkRe = /<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snipRe = /<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippets = [];
  let m;
  while ((m = snipRe.exec(html))) snippets.push(decodeEntities(m[1].replace(/<[^>]+>/g, '')).trim());
  let i = 0;
  while ((m = linkRe.exec(html))) {
    let href = decodeEntities(m[1]);
    if (href.startsWith('//')) href = 'https:' + href;
    try {
      const u = new URL(href);
      if ((u.hostname === 'duckduckgo.com' || u.hostname.endsWith('.duckduckgo.com')) && u.searchParams.get('uddg')) href = u.searchParams.get('uddg');
    } catch {}
    if (!/^https?:/.test(href)) { i++; continue; }
    results.push({ title: decodeEntities(m[2].replace(/<[^>]+>/g, '')).trim(), url: href, snippet: snippets[i] || '' });
    i++;
  }
  return results;
}

/** Bing wraps result links as bing.com/ck/a?...&u=a1<base64url of the real URL>; give back the real URL. */
function bingTarget(href) {
  try {
    const u = new URL(href);
    if (/(^|\.)bing\.com$/.test(u.hostname) && u.pathname.startsWith('/ck/')) {
      const v = u.searchParams.get('u') || '';
      if (/^a1/.test(v)) { const d = Buffer.from(v.slice(2).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); if (/^https?:\/\//.test(d)) return d; }
    }
  } catch {}
  return href;
}
function parseBing(html) {
  const results = [];
  const blocks = String(html).split(/<li[^>]+class="[^"]*\bb_algo\b[^"]*"[^>]*>/i).slice(1);
  for (const b of blocks) {
    const m = /<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(b);
    if (!m) continue;
    const url = bingTarget(decodeEntities(m[1]));
    if (!/^https?:/.test(url)) continue;
    const sn = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(b);
    results.push({ title: decodeEntities(m[2].replace(/<[^>]+>/g, '')).trim(), url, snippet: sn ? decodeEntities(sn[1].replace(/<[^>]+>/g, '')).trim() : '' });
  }
  return results;
}

async function webSearch(query, { signal, max = 8, fallback, via, ddgUrl = 'https://html.duckduckgo.com/html/', bingUrl = 'https://www.bing.com/search' } = {}) {
  let results = [], failure = null;
  if (via) { // a search provider chosen in Settings (for example perplexity/sonar through OpenRouter) goes first; the scraped engines are only the backup
    try { const text = await via(query, signal); if (text && String(text).trim()) return text; failure = 'the search provider returned nothing'; }
    catch (e) { if (e.name === 'AbortError' && signal?.aborted) throw e; failure = `the search provider failed (${e.message})`; }
  }
  try {
    const res = await fetch(ddgUrl, {
      method: 'POST',
      headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ q: query }).toString(),
      signal: withTimeout(signal, 15000)
    });
    const html = await res.text();
    if (!res.ok) failure = (failure ? failure + '; ' : '') + `HTTP ${res.status}`;
    else if (/anomaly|bots use duckduckgo/i.test(html) && !/result__a/.test(html)) failure = (failure ? failure + '; ' : '') + 'DuckDuckGo blocked the request';
    else results = parseDdg(html);
  } catch (e) {
    if (e.name === 'AbortError' && signal?.aborted) throw e;
    failure = (failure ? failure + '; ' : '') + e.message;
  }
  if (!results.length) { // DuckDuckGo refuses scripts now and then: Bing's plain result page is the second try
    try {
      const res = await fetch(bingUrl + '?setlang=en&q=' + encodeURIComponent(query), { headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9' }, signal: withTimeout(signal, 15000) });
      if (res.ok) results = parseBing(await res.text());
    } catch (e) { if (e.name === 'AbortError' && signal?.aborted) throw e; }
  }
  if (results.length) {
    return results.slice(0, max).map((r, n) => `${n + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join('\n\n');
  }
  if (fallback) {
    const text = await fallback(query, signal);
    if (text) return `(fallback search)\n${text}`;
  }
  return failure ? `Web search is not working right now (${failure}). Do not repeat the search with other words. Tell the user, and ask for a link or the exact page if you need one. In Settings → Tools the user can pick a search provider.` : 'No results.';
}

/** Brave Search API (https://api.search.brave.com): the key goes in the X-Subscription-Token header. Returns the same numbered list as the scraped engines. */
async function braveSearch({ key, query, signal, max = 8, url = 'https://api.search.brave.com/res/v1/web/search' }) {
  const res = await fetch(`${url}?q=${encodeURIComponent(query)}&count=${Math.min(20, Math.max(1, max))}`, {
    headers: { accept: 'application/json', 'x-subscription-token': String(key || '').trim() },
    signal: withTimeout(signal, 15000)
  });
  if (!res.ok) {
    const why = res.status === 401 || res.status === 403 ? 'the key was refused' : res.status === 429 ? 'the rate or monthly limit is used up' : res.status === 402 ? 'the plan has no credit left' : '';
    throw new Error(`Brave Search HTTP ${res.status}${why ? ': ' + why : ''}`);
  }
  const j = await res.json();
  const list = ((j && j.web && j.web.results) || []).slice(0, max);
  const clean = (t) => String(t || '').replace(/<[^<>]*>/g, '').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  return list.map((r, n) => `${n + 1}. ${clean(r.title)}\n   ${r.url}\n   ${clean(r.description)}`).join('\n\n');
}

/** Search-grounded answer through the configured OpenAI-compatible endpoint (e.g. perplexity/sonar). */
async function endpointSearch({ baseUrl, key, query, signal, model = 'perplexity/sonar' }) {
  const base = baseUrl.replace(/\/+$/, '');
  const res = await fetch(/\/v\d+$/.test(base) ? `${base}/chat/completions` : `${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: query }] }),
    signal: withTimeout(signal, 30000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  const text = j?.choices?.[0]?.message?.content || '';
  const cites = Array.isArray(j.citations) ? '\n\nSources:\n' + j.citations.map((c, i) => `${i + 1}. ${typeof c === 'string' ? c : c.url}`).join('\n') : '';
  return text + cites;
}

module.exports = { webFetch, webSearch, endpointSearch, braveSearch, htmlToText, parseDdg, parseBing, isPrivateHost, assertPublic, decodeBody };
