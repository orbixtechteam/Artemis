// Appearance themes. The palettes live in JSON files (electron/themes built in, plus <userData>/themes
// and <project>/.artemis/themes), so a new theme never needs a rebuild: main reads them and hands the list
// to the renderer, drop a .json in the folder and press Refresh in Settings.
// Light/Dark stay in styles.css (they carry the @media (prefers-color-scheme: dark) fallback).
import { resolveTheme, accentVars } from './palette.mjs';

export const SYSTEM_THEME = { id: 'system', name: 'System', group: 'Basic', preview: ['#faf9f5', '#c96442', '#262624'] };

export const TEXT_SIZES = [['small', 'Small', 13], ['medium', 'Medium', 14], ['large', 'Large', 16]];

/** Theme ids seen so far (from main); a check against something unknown falls back to System. */
let known = new Set([SYSTEM_THEME.id]);

export function setKnownThemes(list) {
  known = new Set((list || []).map((t) => t && t.id).filter(Boolean));
  known.add(SYSTEM_THEME.id);
}

export const isKnownTheme = (id) => !!id && known.has(id);

const clearVars = (el) => {
  for (let i = el.style.length - 1; i >= 0; i--) {
    const prop = el.style[i];
    if (prop.startsWith('--theme-')) el.style.removeProperty(prop);
  }
};

/** Switches on the var() mapping in styles.css; the active palette's values are set in applyTheme. */
export function applyThemeVars() {
  document.documentElement.dataset.vars = '1';
}

/** Paints the active theme (its --theme-* values go on the root); System follows the OS. */
const CACHE = 'artemis.themeCache';

function paint(t, extra = {}) {
  const el = document.documentElement;
  clearVars(el);
  if (!t) {
    delete el.dataset.theme;
    delete el.dataset.scheme;
    el.style.colorScheme = '';
    saveCache({ id: SYSTEM_THEME.id });
    return;
  }
  el.dataset.vars = '1';
  el.dataset.theme = t.id;
  const vars = {};
  for (const [k, v] of Object.entries({ ...(t.vars || {}), ...extra })) {
    if (typeof k === 'string' && k.startsWith('--theme-') && typeof v === 'string' && v) { el.style.setProperty(k, v); vars[k] = v; }
  }
  const scheme = t.dark === undefined ? '' : t.dark === false ? 'light' : 'dark';
  el.style.colorScheme = scheme;
  if (scheme) el.dataset.scheme = scheme; else delete el.dataset.scheme; // lets CSS pick light or dark code colours for JSON themes
  saveCache({ id: t.id, vars, scheme });
}

/** One theme by id, nothing else (System = the CSS defaults). */
export function applyTheme(id, themes = []) {
  if (!id || id === SYSTEM_THEME.id || !isKnownTheme(id)) return paint(null);
  paint((themes || []).find((x) => x && x.id === id) || { id });
}

/** What every window calls: the palette for the current Appearance plus the accent, or the chosen custom theme. */
let last = null;
let watching = false;
export function applySettingsTheme(settings, themes = []) {
  last = { settings: settings || {}, themes: themes || [] };
  const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  if (mq && !watching) { watching = true; mq.addEventListener('change', () => { if (last) applySettingsTheme(last.settings, last.themes); }); }
  const { theme, dark, custom } = resolveTheme(last.settings, last.themes, mq ? mq.matches : false);
  paint(theme, custom ? {} : accentVars(last.settings.accent, dark));
}

function saveCache(c) { try { localStorage.setItem(CACHE, JSON.stringify(c)); } catch {} }

/** At boot, before React renders: paint the theme used last time, so the window does not flash the default palette while the themes load. */
export function applyCachedTheme() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE) || 'null');
    const size = localStorage.getItem('artemis.textSize');
    if (size) applyTextSize(size, false);
    if (!c || !c.id || c.id === SYSTEM_THEME.id) return;
    const el = document.documentElement;
    known.add(c.id);
    el.dataset.vars = '1';
    el.dataset.theme = c.id;
    for (const [k, v] of Object.entries(c.vars || {})) if (k.startsWith('--theme-') && typeof v === 'string') el.style.setProperty(k, v);
    if (c.scheme) { el.style.colorScheme = c.scheme; el.dataset.scheme = c.scheme; }
  } catch {}
}

/** Loads the palettes from main; on failure the boot values in styles.css stay in place. */
export async function loadThemes(api, dir) {
  if (!api || !api.themesList) return [];
  try {
    const r = await api.themesList(dir);
    const themes = (r && r.themes) || [];
    setKnownThemes(themes);
    applyThemeVars();
    return themes.map(({ file, ...t }) => t);
  } catch { return []; }
}

export function applyTextSize(size, remember = true) {
  const found = TEXT_SIZES.find(([id]) => id === size) || TEXT_SIZES[1];
  document.documentElement.style.setProperty('--fs', found[2] + 'px');
  if (remember) { try { localStorage.setItem('artemis.textSize', found[0]); } catch {} }
}