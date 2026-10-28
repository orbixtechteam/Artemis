// Chat images as files in <userData>/media, named by content hash. Chats keep only an "artemis-media://<file>" link;
// the base64 is made again just before an image is sent to a model, and never stored.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCHEME = 'artemis-media';
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
const MIME = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
const NAME_RE = /^[a-f0-9]{32}\.(png|jpg|gif|webp)$/;
const DATA_RE = /^data:(image\/[a-z0-9+.-]+);base64,([\s\S]+)$/i;
const isDataUrl = (s) => typeof s === 'string' && s.startsWith('data:image/');
const isMediaUrl = (s) => typeof s === 'string' && s.startsWith(SCHEME + '://');

/** The file name inside a media link, or '' when it is not a valid one. */
function nameOf(url) {
  if (!isMediaUrl(url)) return '';
  const n = String(url).slice(SCHEME.length + 3).replace(/^\/+|\/+$/g, '').split(/[?#]/)[0];
  return NAME_RE.test(n) ? n : '';
}

/** deps: { dir, log?(level, msg) } */
function createMediaStore({ dir, log = () => {} }) {
  const fileOf = (name) => path.join(dir, name);

  /** Saves bytes once (same picture, same file) and returns its link. */
  function put(buf, mime) {
    const ext = EXT[String(mime || '').toLowerCase()] || 'png';
    const name = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 32) + '.' + ext;
    const file = fileOf(name);
    if (!fs.existsSync(file)) {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = file + '.tmp-' + process.pid;
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, file);
    }
    return `${SCHEME}://${name}`;
  }

  /** A data URL becomes a link; anything else is returned unchanged. */
  function putDataUrl(url) {
    if (!isDataUrl(url)) return url;
    const m = DATA_RE.exec(url);
    if (!m) return url;
    if (m[1].toLowerCase() === 'image/svg+xml') return url; // svg can carry script: it stays inline
    return put(Buffer.from(m[2], 'base64'), m[1].toLowerCase().replace('image/jpg', 'image/jpeg'));
  }

  /** { buf, mime } of a link, or null when the file is missing. */
  function read(url) {
    const name = nameOf(url);
    if (!name) return null;
    try { return { buf: fs.readFileSync(fileOf(name)), mime: MIME[name.split('.').pop()] }; } catch { return null; }
  }

  /** A link turned back into a data URL (for a model); '' when the file is gone. Data URLs pass through. */
  function toDataUrl(url) {
    if (!isMediaUrl(url)) return url;
    const r = read(url);
    return r ? `data:${r.mime};base64,${r.buf.toString('base64')}` : '';
  }

  /** One chat message with its base64 images moved to files. Returns the same object when nothing changed. */
  function externalize(m) {
    if (!m || typeof m !== 'object') return m;
    let changed = false;
    const conv = (u) => { try { const v = putDataUrl(u); if (v !== u) changed = true; return v; } catch (e) { log('warn', 'An image could not be saved to the media folder: ' + e.message); return u; } };
    let attachments = m.attachments;
    if (Array.isArray(attachments) && attachments.some((a) => a && isDataUrl(a.dataUrl))) {
      attachments = attachments.map((a) => {
        if (!a || !isDataUrl(a.dataUrl)) return a;
        const url = conv(a.dataUrl);
        if (url === a.dataUrl) return a;
        const { dataUrl, ...rest } = a;
        return { ...rest, url };
      });
    }
    let steps = m.steps;
    if (Array.isArray(steps) && steps.some((s) => s && (s.toolCalls || []).some((t) => t && isDataUrl(t.image)))) {
      steps = steps.map((s) => (!s || !(s.toolCalls || []).some((t) => t && isDataUrl(t.image)) ? s
        : { ...s, toolCalls: s.toolCalls.map((t) => (t && isDataUrl(t.image) ? { ...t, image: conv(t.image) } : t)) }));
    }
    return changed ? { ...m, attachments, steps } : m;
  }

  /** OpenAI-style messages with media links swapped for data URLs, right before a model call. Missing files become a note. */
  function resolveMessages(messages) {
    if (!Array.isArray(messages)) return messages;
    return messages.map((m) => {
      if (!m || !Array.isArray(m.content) || !m.content.some((p) => p && p.type === 'image_url' && isMediaUrl(p.image_url && p.image_url.url))) return m;
      return {
        ...m,
        content: m.content.map((p) => {
          if (!p || p.type !== 'image_url' || !isMediaUrl(p.image_url && p.image_url.url)) return p;
          const d = toDataUrl(p.image_url.url);
          return d ? { ...p, image_url: { ...p.image_url, url: d } } : { type: 'text', text: '[image no longer available]' };
        })
      };
    });
  }

  /** Deletes media files no chat links to. keep: Set of file names still in use. Files newer than minAgeMs stay (a save may be pending). */
  function gc(keep, { minAgeMs = 24 * 3600e3 } = {}) {
    let removed = 0;
    let names = [];
    try { names = fs.readdirSync(dir); } catch { return 0; }
    const now = Date.now();
    for (const n of names) {
      if (!NAME_RE.test(n) || keep.has(n)) continue;
      // minAgeMs 0 means "any age": a fresh file's mtime can be ~1 ms ahead of Date.now()
      try { if (minAgeMs > 0 && now - fs.statSync(fileOf(n)).mtimeMs < minAgeMs) continue; fs.unlinkSync(fileOf(n)); removed++; } catch {}
    }
    return removed;
  }

  return { dir, put, putDataUrl, read, toDataUrl, externalize, resolveMessages, gc, fileOf };
}

/** Every media file name mentioned in a JSON string. */
function namesIn(json, out = new Set()) {
  const re = new RegExp(SCHEME + ':\\/\\/([a-f0-9]{32}\\.(?:png|jpg|gif|webp))', 'g');
  let m;
  while ((m = re.exec(String(json || '')))) out.add(m[1]);
  return out;
}

module.exports = { createMediaStore, nameOf, namesIn, isDataUrl, isMediaUrl, SCHEME, MIME };
