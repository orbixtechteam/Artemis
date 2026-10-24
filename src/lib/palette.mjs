// Which theme to paint: a palette (two theme files with the same "family", one light and one dark) that follows
// Appearance (Automatic / Light / Dark), plus an optional accent override; or one fixed custom theme.
// Pure (no DOM), so scripts/test-palette.js can run it in Node.

export const DEFAULT_PALETTE = 'artemis';

// [id, name, colour on dark backgrounds, colour on light backgrounds]; electron/artemis-tools.js lists the same ids.
export const ACCENTS = [
  ['gold', 'Gold', '#D4B06A', '#9C7A33'],
  ['blue', 'Blue', '#4C9BFF', '#0A6CFF'],
  ['violet', 'Violet', '#9B87F5', '#6E56CF'],
  ['rose', 'Rose', '#E57A9A', '#C2456B'],
  ['red', 'Red', '#E5645A', '#C2382D'],
  ['orange', 'Orange', '#E89A4F', '#B5622A'],
  ['green', 'Green', '#6CC28A', '#2F7A47'],
  ['graphite', 'Graphite', '#9A9AA0', '#5E5E66'],
];
// light accents on dark backgrounds need dark text on top (buttons, the selected row)
const DARK_INK = { gold: '#1A1408', orange: '#1E0F07', green: '#0D1A12' };

const LEGACY = ['system', 'light', 'dark'];

// shown first, in this order; other palettes (user, project) follow by name, Classic always last
const ORDER = ['artemis', 'midnight', 'graphite', 'forest', 'ember'];

/** Palettes: [{ id, name, about, light, dark }] (light/dark are the theme objects, either may be missing). */
export function families(themes = []) {
  const out = new Map();
  for (const t of themes) {
    if (!t || !t.family) continue;
    const f = out.get(t.family) || { id: t.family, name: t.name, about: t.about || '', light: null, dark: null };
    if (t.dark === false) f.light = t; else f.dark = t;
    out.set(t.family, f);
  }
  const rank = (f) => (f.id === 'classic' ? 1e3 : ORDER.includes(f.id) ? ORDER.indexOf(f.id) : 100);
  return [...out.values()].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** Fixed custom themes: the ones without a family. */
export const customThemes = (themes = []) => themes.filter((t) => t && t.id && !t.family && !LEGACY.includes(t.id));

/**
 * settings: { theme, palette, appearance }. A theme id that names a real theme wins (custom themes, MCP);
 * theme 'light' / 'dark' (older settings, MCP) forces the scheme; otherwise Appearance decides.
 * Returns { theme, dark, custom } where theme is null until the theme list has loaded.
 */
export function resolveTheme(settings = {}, themes = [], osDark = false) {
  const id = settings.theme || 'system';
  const named = !LEGACY.includes(id) && themes.find((t) => t && t.id === id);
  if (named) return { theme: named, dark: named.dark !== false, custom: !named.family };
  const mode = id === 'light' || id === 'dark' ? id : settings.appearance || 'system';
  const dark = mode === 'system' ? !!osDark : mode === 'dark';
  const pick = (fam) => themes.find((t) => t && t.family === fam && (t.dark !== false) === dark);
  return { theme: pick(settings.palette || DEFAULT_PALETTE) || pick(DEFAULT_PALETTE) || null, dark, custom: false };
}

/** The --theme-* overrides for an accent name ('' or unknown = none). */
export function accentVars(accent, dark) {
  const a = ACCENTS.find(([id]) => id === accent);
  if (!a) return {};
  return { '--theme-accent': dark ? a[2] : a[3], '--theme-accent-text': dark ? DARK_INK[a[0]] || '#FFFFFF' : '#FFFFFF' };
}
