// Turns a link the assistant wrote (a path, ~/path, file:// URL, or a path relative to the project / Files folder)
// into one absolute file path, so chat links and images open in the app instead of doing nothing.
const fs = require('fs');
const os = require('os');
const path = require('path');

const IMAGE_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp' };
const VIDEO_MIME = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/mp4' };
const AUDIO_MIME = { mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg' };
const MEDIA_MIME = { ...IMAGE_MIME, ...VIDEO_MIME, ...AUDIO_MIME, pdf: 'application/pdf' };

const extOf = (p) => path.extname(String(p || '')).slice(1).toLowerCase();
const mimeOf = (p) => MEDIA_MIME[extOf(p)] || '';

/** "src/a.js#L24-L30", "src/a.js:24" and "a.png?x" become the bare path. Exported for tests. */
function stripSuffix(href) {
  let s = String(href || '').trim().replace(/^<|>$/g, '');
  s = s.replace(/#L\d+(-L?\d+)?$/i, '').replace(/[?#].*$/, '');
  if (!/^[a-z]:\\/i.test(s)) s = s.replace(/:\d+([-–]\d+)?$/, ''); // keep Windows drive letters
  return s;
}

/** Candidate absolute paths for a link, most specific first. roots: folders a relative link may live in. */
function candidates(href, { roots = [], home = os.homedir() } = {}) {
  let s = stripSuffix(href);
  if (!s || /^(https?|mailto|tel|javascript|data|blob):/i.test(s)) return [];
  if (/^file:/i.test(s)) { try { s = decodeURIComponent(new URL(s).pathname); } catch { return []; } }
  else { try { s = decodeURIComponent(s); } catch {} }
  if (s === '~' || s.startsWith('~/')) return [path.join(home, s.slice(1))];
  if (path.isAbsolute(s)) return [path.normalize(s)];
  return roots.filter(Boolean).map((r) => path.resolve(r, s));
}

/**
 * The first existing regular file for a link, or { error }.
 * deps.isSensitive(realPath): credentials, browser profiles and the app's own data are never opened from a link.
 */
function resolveLink(href, { roots = [], home, isSensitive = () => false } = {}) {
  const list = candidates(href, { roots, home });
  if (!list.length) return { error: 'Not a file link.' };
  for (const abs of list) {
    let real;
    try { real = fs.realpathSync(abs); } catch { continue; }
    let st; try { st = fs.statSync(real); } catch { continue; }
    if (isSensitive(real)) return { error: 'This file is in a protected location and cannot be opened from a link.' };
    if (st.isDirectory()) return { abs: real, dir: true };
    if (st.isFile()) return { abs: real, size: st.size, mime: mimeOf(real) };
  }
  return { error: `File not found: ${stripSuffix(href)}` };
}

// ---- the artemis-file:// protocol: media files (images, video, audio, PDF) by absolute path, for the app window only
const SCHEME = 'artemis-file';
const MAX_SERVE = 512 * 1024 * 1024;
const urlFor = (abs) => `${SCHEME}://f/${encodeURIComponent(abs)}`;
function pathFromUrl(url) {
  try { const u = new URL(url); return u.host === 'f' ? decodeURIComponent(u.pathname.slice(1)) : ''; } catch { return ''; }
}

/** A Response for one protocol request; only media types are served, never sensitive paths. Supports Range for video. */
function serve(req, { isSensitive = () => false } = {}) {
  const abs = pathFromUrl(req.url);
  const mime = mimeOf(abs);
  if (!abs || !path.isAbsolute(abs) || !mime) return new Response('Not found', { status: 404 });
  let real, st;
  try { real = fs.realpathSync(abs); st = fs.statSync(real); } catch { return new Response('Not found', { status: 404 }); }
  if (!st.isFile() || st.size > MAX_SERVE || isSensitive(real) || mimeOf(real) !== mime) return new Response('Not found', { status: 404 });
  const headers = { 'content-type': mime, 'x-content-type-options': 'nosniff', 'accept-ranges': 'bytes', 'cache-control': 'no-cache' };
  if (mime === 'image/svg+xml') headers['content-security-policy'] = "default-src 'none'; style-src 'unsafe-inline'"; // svg may carry script
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.get('range') || ''));
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, st.size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
    if (start > end || start >= st.size) return new Response('', { status: 416, headers: { 'content-range': `bytes */${st.size}` } });
    const buf = Buffer.alloc(end - start + 1);
    const fd = fs.openSync(real, 'r'); try { fs.readSync(fd, buf, 0, buf.length, start); } finally { fs.closeSync(fd); }
    return new Response(buf, { status: 206, headers: { ...headers, 'content-range': `bytes ${start}-${end}/${st.size}`, 'content-length': String(buf.length) } });
  }
  return new Response(fs.readFileSync(real), { headers: { ...headers, 'content-length': String(st.size) } });
}

module.exports = { resolveLink, candidates, stripSuffix, mimeOf, extOf, urlFor, pathFromUrl, serve, SCHEME, IMAGE_MIME, VIDEO_MIME };
