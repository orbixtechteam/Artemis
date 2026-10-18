// Image and video generation through an OpenAI-compatible provider the user added.
const fs = require('fs');
const path = require('path');
const { joinUrl, headersFor } = require('./providers');

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm' };
const MIME = Object.fromEntries(Object.entries(EXT).map(([m, e]) => [e, m]));

function sniff(buf, fallback) {
  if (buf.length > 12) {
    if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
    if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
    if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
    if (buf.slice(4, 8).toString() === 'ftyp') return 'video/mp4';
    if (buf[0] === 0x1a && buf[1] === 0x45) return 'video/webm';
  }
  return fallback;
}

async function errorOf(res) {
  let msg = `HTTP ${res.status}`;
  try {
    const raw = await res.text();
    try { const j = JSON.parse(raw); msg = j?.error?.message || (typeof j?.error === 'string' ? j.error : '') || j?.message || msg; }
    catch { if (raw) msg += `: ${raw.slice(0, 200)}`; }
  } catch {}
  return msg;
}

function save(dir, buf, kind, model, fallbackMime) {
  const mime = sniff(buf, fallbackMime);
  if (!mime || !EXT[mime]) throw new Error('The server did not return an image or video.');
  if ((kind === 'video') !== mime.startsWith('video/')) throw new Error(`Expected ${kind} but got ${mime}.`);
  fs.mkdirSync(dir, { recursive: true });
  const name = `${kind}-${Date.now().toString(36)}-${String(model).replace(/[^\w.-]+/g, '_').slice(-30)}.${EXT[mime]}`;
  const file = path.join(dir, name);
  fs.writeFileSync(file, buf);
  return { path: file, mime, kind, bytes: buf.length };
}

/** POST <baseUrl>/images/generations or /videos/generations (OpenAI-style body); the answer carries b64_json or a url. */
async function generate(kind, { baseUrl, key, model, prompt, size, duration, dir, signal }) {
  const openrouter = /^(https?:\/\/)?([\w-]+\.)*openrouter\.ai(\/|$)/i.test(String(baseUrl)); // OpenRouter has its own endpoint: POST /api/v1/images (no response_format)
  const url = joinUrl(baseUrl, kind === 'video' ? 'videos/generations' : openrouter ? 'images' : 'images/generations');
  const body = kind === 'video' ? { model, prompt, ...(duration ? { duration } : {}) } : openrouter ? { model, prompt, n: 1, ...(size ? { size } : {}) } : { model, prompt, n: 1, size: size || '1024x1024', response_format: 'b64_json' };
  const res = await fetch(url, {
    method: 'POST', signal, body: JSON.stringify(body),
    headers: { ...headersFor(url), 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) }
  });
  if (!res.ok) throw new Error(await errorOf(res));
  const j = await res.json();
  const d = j?.data?.[0];
  const fallback = kind === 'video' ? 'video/mp4' : 'image/png';
  if (d?.b64_json) return save(dir, Buffer.from(d.b64_json, 'base64'), kind, model, d.media_type || fallback);
  if (d?.url) {
    const r = await fetch(d.url, { signal });
    if (!r.ok) throw new Error(await errorOf(r));
    return save(dir, Buffer.from(await r.arrayBuffer()), kind, model, r.headers.get('content-type'));
  }
  throw new Error(`The provider returned no ${kind}. It may not support ${kind} generation.`);
}
const generateImage = (o) => generate('image', o);
const generateVideo = (o) => generate('video', o);

/** Reads a generated file for the renderer (only inside dir). */
function load(dir, file) {
  const abs = path.resolve(String(file));
  if (path.dirname(abs) !== path.resolve(dir) || !fs.existsSync(abs)) throw new Error('Not found');
  const mime = MIME[path.extname(abs).slice(1)] || 'application/octet-stream';
  return { mime, base64: fs.readFileSync(abs).toString('base64') };
}

module.exports = { generateImage, generateVideo, load, save };
