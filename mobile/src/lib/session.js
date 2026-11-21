// The app's state: the paired server, its API, and the look. The look is the desktop's: the same palettes
// (electron/themes, served by /v1/x/themes), Appearance (Automatic / Light / Dark) and accent, kept in the server's
// settings, which the linked desktop keeps in step. Until the server answers, the last look (or Artemis) is used.
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { AppState, Platform, useColorScheme } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { loadServer, saveServer, clearServer, createApi } from './api';

const LOOK_KEY = 'artemis.look2';
const readLook = async () => { try { return JSON.parse((Platform.OS === 'web' ? globalThis.localStorage.getItem(LOOK_KEY) : await SecureStore.getItemAsync(LOOK_KEY)) || 'null'); } catch { return null; } };
const writeLook = async (v) => { try { const t = JSON.stringify(v); if (Platform.OS === 'web') globalThis.localStorage.setItem(LOOK_KEY, t); else await SecureStore.setItemAsync(LOOK_KEY, t); } catch {} };

export const PALETTES = {
  dark: {
    bg: '#121316', side: '#1A1B1E', card: '#1E1F23', round: '#26272B', text: '#F3EFE7', muted: 'rgba(243,239,231,0.56)', faint: 'rgba(243,239,231,0.32)',
    line: 'rgba(243,239,231,0.09)', fill: 'rgba(243,239,231,0.06)', user: 'rgba(243,239,231,0.10)', code: '#0C0D0F',
    accent: '#D4B06A', accentText: '#1A1408', danger: '#F08A80', ok: '#7FC79A', warn: '#E8B45A', pill: '#F3EFE7', pillText: '#121316', scrim: 'rgba(0,0,0,0.55)'
  },
  light: {
    bg: '#FBF8F2', side: '#F2EDE3', card: '#FFFFFF', round: '#ECE6DA', text: '#1B1A17', muted: 'rgba(27,26,23,0.62)', faint: 'rgba(27,26,23,0.36)',
    line: 'rgba(27,26,23,0.10)', fill: 'rgba(27,26,23,0.05)', user: 'rgba(27,26,23,0.07)', code: '#F4EFE6',
    accent: '#9C7A33', accentText: '#FFFFFF', danger: '#C2382D', ok: '#2F7A47', warn: '#A4670F', pill: '#1B1A17', pillText: '#FBF8F2', scrim: 'rgba(27,26,23,0.35)'
  }
};

// the same accents as the desktop (src/lib/palette.mjs): [id, name, on dark, on light]
export const ACCENTS = [
  ['gold', 'Gold', '#D4B06A', '#9C7A33'], ['blue', 'Blue', '#4C9BFF', '#0A6CFF'], ['violet', 'Violet', '#9B87F5', '#6E56CF'], ['rose', 'Rose', '#E57A9A', '#C2456B'],
  ['red', 'Red', '#E5645A', '#C2382D'], ['orange', 'Orange', '#E89A4F', '#B5622A'], ['green', 'Green', '#6CC28A', '#2F7A47'], ['graphite', 'Graphite', '#9A9AA0', '#5E5E66'],
];
const DARK_INK = { gold: '#1A1408', orange: '#1E0F07', green: '#0D1A12' };
const ORDER = ['artemis', 'midnight', 'graphite', 'forest', 'ember'];
const LEGACY = ['system', 'light', 'dark'];

/** Palettes: [{ id, name, about, light, dark }], in the desktop's order (Classic last). */
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

// colour helpers: a solid colour for a translucent one over a background (round buttons need a solid fill)
const parse = (s) => {
  const t = String(s || '').trim();
  let m = /^#([0-9a-f]{3})$/i.exec(t); if (m) return [...m[1]].map((h) => parseInt(h + h, 16)).concat(1);
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(t); if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)).concat(m[2] ? parseInt(m[2], 16) / 255 : 1);
  m = /^rgba?\(([^)]+)\)$/i.exec(t); if (m) { const p = m[1].split(',').map((x) => parseFloat(x)); return [p[0], p[1], p[2], p[3] == null ? 1 : p[3]]; }
  return null;
};
const hex = (r, g, b) => '#' + [r, g, b].map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');
const over = (fg, bg, alpha) => { const a = parse(fg), b = parse(bg); if (!a || !b) return bg; const k = alpha == null ? a[3] : alpha; return hex(a[0] * k + b[0] * (1 - k), a[1] * k + b[1] * (1 - k), a[2] * k + b[2] * (1 - k)); };
const withAlpha = (col, alpha) => { const a = parse(col); return a ? `rgba(${a[0]},${a[1]},${a[2]},${alpha})` : col; };

/** A desktop theme (its --theme-* values) as the app's colours. */
export function paletteFromTheme(t, accent) {
  const v = t.vars || {};
  const dark = t.dark !== false;
  const g = (k, d) => v['--theme-' + k] || d;
  const bg = g('bg', dark ? '#121316' : '#FBF8F2'), side = g('side', bg), text = g('text', dark ? '#F3EFE7' : '#1B1A17');
  const a = ACCENTS.find(([id]) => id === accent);
  const ink = parse(text) || [128, 128, 128, 1];
  return {
    dark, id: t.id,
    bg, side, card: g('elev', g('panel', side)), round: over(text, side, dark ? 0.07 : 0.06), text,
    muted: g('muted', withAlpha(text, 0.56)), faint: withAlpha(hex(ink[0], ink[1], ink[2]), dark ? 0.32 : 0.36),
    line: g('border', withAlpha(text, 0.09)), fill: g('hover', withAlpha(text, 0.06)), user: g('user', withAlpha(text, 0.1)), code: g('code', side),
    accent: a ? (dark ? a[2] : a[3]) : g('accent', '#D4B06A'), accentText: a ? (dark ? DARK_INK[a[0]] || '#FFFFFF' : '#FFFFFF') : g('accent-text', '#FFFFFF'),
    danger: g('danger', '#F08A80'), ok: g('ok', '#7FC79A'), warn: g('warn', '#E8B45A'),
    pill: text, pillText: bg, scrim: dark ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.30)',
  };
}

/** The theme the desktop would paint for these settings (same rules as src/lib/palette.mjs). */
export function resolveLook(look = {}, themes = [], osDark = true) {
  const id = look.theme || 'system';
  const named = !LEGACY.includes(id) && themes.find((t) => t && t.id === id);
  if (named) return { theme: named, custom: !named.family };
  const mode = id === 'light' || id === 'dark' ? id : look.appearance || 'system';
  const dark = mode === 'system' ? !!osDark : mode === 'dark';
  const pick = (fam) => themes.find((t) => t && t.family === fam && (t.dark !== false) === dark);
  return { theme: pick(look.palette || 'artemis') || pick('artemis') || null, custom: false, dark };
}

const DEFAULT_LOOK = { theme: 'system', palette: 'artemis', appearance: 'system', accent: '' };
const LOOK_FIELDS = ['theme', 'palette', 'appearance', 'accent', 'textSize'];

const Ctx = createContext(null);

export function SessionProvider({ children }) {
  const [server, setServerState] = useState(undefined); // undefined while loading, null = not paired
  const [look, setLookState] = useState(DEFAULT_LOOK);
  const [themes, setThemes] = useState([]);
  const system = useColorScheme();
  useEffect(() => { loadServer().then(setServerState); readLook().then((x) => { if (x) { if (x.look) setLookState({ ...DEFAULT_LOOK, ...x.look }); if (Array.isArray(x.themes)) setThemes(x.themes); } }); }, []);
  const api = useMemo(() => (server ? createApi(server) : null), [server]);
  // the look from the server (the desktop's, kept in step), and the palettes themselves
  const refreshLook = async () => {
    if (!api) return;
    try {
      const [t, st] = await Promise.all([api.get('/v1/x/themes').catch(() => null), api.get('/v1/x/settings')]);
      const next = { ...DEFAULT_LOOK };
      for (const k of LOOK_FIELDS) if (st.settings && st.settings[k]) next[k] = st.settings[k];
      const list = t && Array.isArray(t.themes) ? t.themes : themes;
      setLookState(next); setThemes(list); writeLook({ look: next, themes: list });
    } catch {}
  };
  useEffect(() => { refreshLook(); const s = AppState.addEventListener('change', (x) => { if (x === 'active') refreshLook(); }); return () => s.remove(); }, [api]);
  const value = useMemo(() => {
    const osDark = system !== 'light';
    const r = resolveLook(look, themes, osDark);
    const c = r.theme ? paletteFromTheme(r.theme, r.custom ? '' : look.accent) : { ...PALETTES[osDark && look.appearance !== 'light' || look.appearance === 'dark' ? 'dark' : 'light'], dark: osDark };
    const scheme = c.dark === false ? 'light' : 'dark';
    return {
      ready: server !== undefined,
      server: server || null,
      api,
      setServer: async (s) => { await saveServer(s); setServerState(s); },
      forget: async () => { await clearServer(); setServerState(null); },
      look, themes, families: families(themes),
      /** Changes the look here and on the server (every device and the web app follow). */
      setLook: (patch) => {
        const next = { ...look, ...patch, theme: patch.theme || 'system' };
        setLookState(next); writeLook({ look: next, themes });
        if (api) api.post('/v1/x/settings', next).catch(() => {});
      },
      refreshLook,
      scheme, c
    };
  }, [server, api, look, themes, system]);
  return React.createElement(Ctx.Provider, { value }, children);
}

export const useSession = () => useContext(Ctx);
