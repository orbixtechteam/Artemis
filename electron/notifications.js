// The notification list: what Artemis showed you, kept so you can read it after the banner is gone. Its unread count is the Dock number.
const fs = require('fs');

const MAX = 100;

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

module.exports = { createNotificationCenter };
