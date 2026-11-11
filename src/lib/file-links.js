// Links the assistant writes to files: "[report](<out/report.csv>)", "![chart](<chart.png>)", file:// URLs, ~/paths.
// Relative links resolve against the open chat's project folder, then the Files folder (electron/links.js).
import { openPreview } from './preview.js';

const api = window.api;
let root = ''; // the open chat's project folder
export const setLinkRoot = (folder) => { root = folder || ''; };

// Files the assistant made in this session (file cards): a bare "report.pdf" link finds them wherever they were written.
const known = new Map(); // lower-case base name -> absolute path (latest wins)
const baseName = (p) => String(p || '').split(/[\\/]/).pop().toLowerCase();
export const rememberFile = (abs) => { if (abs) known.set(baseName(abs), abs); };
const knownFor = (href) => { const h = String(href || '').replace(/^\.\//, ''); return /[\\/]/.test(h) ? '' : known.get(h.toLowerCase()) || ''; };

/** Links handled by the browser or the in-app browser, not as files. */
export const isWebLink = (href) => /^(https?:|mailto:|tel:)/i.test(String(href || ''));
export const isAnchor = (href) => String(href || '').startsWith('#');

/** Opens a file link in the side viewer (folders open in Finder). reveal: show it in Finder instead. */
export async function openFileLink(href, { reveal = false } = {}) {
  if (!api || !api.openLink) return;
  if (reveal) { let r = await api.resolveLink(root, href); if ((!r || !r.ok) && knownFor(href)) r = await api.resolveLink(root, knownFor(href)); if (r && r.ok) api.revealPath(r.path); else if (r) openPreview({ name: String(href), kind: 'error', error: r.error }); return; }
  let file = await api.openLink(root, href);
  const k = knownFor(href);
  if ((!file || file.kind === 'error') && k) file = await api.openLink(root, k);
  if (file) openPreview(file);
}

const cache = new Map(); // href|root -> Promise<{ url, path } | null>
/** An artemis-file:// URL for a local image link, or null. Cached per project folder. */
export function localMediaUrl(href) {
  const key = root + '|' + href;
  if (!cache.has(key)) {
    cache.set(key, (api && api.resolveLink ? api.resolveLink(root, href) : Promise.resolve(null))
      .then((r) => (r && r.ok && r.url ? { url: r.url, path: r.path, mime: r.mime } : null)).catch(() => null));
    if (cache.size > 300) cache.delete(cache.keys().next().value);
  }
  return cache.get(key);
}
