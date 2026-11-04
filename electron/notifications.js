// The notification list: what Artemis showed you, kept so you can read it after the banner is gone. Its unread count is the Dock number.
const fs = require('fs');

const MAX = 100;

/** Markdown to plain text for system banners, which show it raw (`code`, **bold**, ```fences```, [links](url), # headings, lists). */
function plainText(md) {
  return String(md || '')
    .replace(/```[^\n]*\n?([\s\S]*?)(```|$)/g, (_m, code) => code.trim().replace(/\s+/g, ' ') + ' ') // fenced code: keep the code on one line
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')       // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')        // links
    .replace(/`([^`]+)`/g, '$1')                     // inline code
    .replace(/(\*\*|__)(.+?)\1/g, '$2')              // bold
    .replace(/(^|[\s(])([*_])(\S(?:.*?\S)?)\2(?=[\s).,!?:;]|$)/gm, '$1$3') // italic
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')               // headings
    .replace(/^\s{0,3}>\s?/gm, '')                    // quotes
    .replace(/^\s*[-*+]\s+/gm, '')                    // bullets
    .replace(/^\s*\|?(\s*:?-{3,}:?\s*\|)+\s*:?-*:?\s*\|?\s*$/gm, '') // table separator rows
    .replace(/\s*\|\s*/g, ' ')                       // table cells
    .replace(/\s+/g, ' ')
    .trim();
}

function createNotificationCenter({ file, onChange = () => {} }) {
  let items = [];
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); if (Array.isArray(j)) items = j.slice(0, MAX); } catch {}
  const state = () => ({ items, unread: items.filter((n) => !n.read).length });
  const save = () => { try { fs.writeFileSync(file, JSON.stringify(items)); } catch {} };
  const changed = () => { save(); onChange(state()); };
  return {
    state,
    sync: () => onChange(state()),
    add({ title, body } = {}) {
      items = [{ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), title: String(title || 'Artemis').slice(0, 120), body: String(body || '').slice(0, 300), t: Date.now(), read: false }, ...items].slice(0, MAX);
      changed();
    },
    readAll() { items = items.map((n) => ({ ...n, read: true })); changed(); return state(); },
    clear() { items = []; changed(); return state(); }
  };
}

module.exports = { createNotificationCenter, plainText };
