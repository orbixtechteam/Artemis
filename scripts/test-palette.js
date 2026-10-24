const assert = require('assert');
const themes = require('../electron/themes');

(async () => {
  const { resolveTheme, families, customThemes, accentVars, ACCENTS, DEFAULT_PALETTE } = await import('../src/lib/palette.mjs');
  const list = themes.list({}).themes;

  // 1. every shipped palette has a light and a dark file, and the default exists
  const fams = families(list);
  assert.ok(fams.length >= 5, 'expected the shipped palettes, got ' + fams.map((f) => f.id));
  for (const f of fams) assert.ok(f.light && f.dark, f.id + ' needs a light and a dark version');
  assert.ok(fams.some((f) => f.id === DEFAULT_PALETTE), 'the default palette must ship');
  assert.deepStrictEqual(customThemes(list), [], 'built-in themes are all palettes');

  // 2. Appearance picks the version; Automatic follows the OS
  assert.strictEqual(resolveTheme({ palette: 'forest', appearance: 'light' }, list, true).theme.id, 'forest-light');
  assert.strictEqual(resolveTheme({ palette: 'forest', appearance: 'dark' }, list, false).theme.id, 'forest-dark');
  assert.strictEqual(resolveTheme({ palette: 'forest', appearance: 'system' }, list, true).theme.id, 'forest-dark');
  assert.strictEqual(resolveTheme({ palette: 'forest', appearance: 'system' }, list, false).theme.id, 'forest-light');
  assert.strictEqual(resolveTheme({}, list, true).theme.id, 'artemis-dark', 'no settings = Artemis following the OS');
  assert.strictEqual(resolveTheme({ palette: 'gone' }, list, false).theme.id, 'artemis-light', 'a removed palette falls back to Artemis');
  assert.strictEqual(resolveTheme({ palette: 'forest' }, [], true).theme, null, 'nothing to paint before the list loads');

  // 3. older settings and MCP: theme light/dark forces the scheme; a real theme id wins over the palette
  assert.strictEqual(resolveTheme({ theme: 'dark', appearance: 'light' }, list, false).theme.id, 'artemis-dark');
  assert.strictEqual(resolveTheme({ theme: 'light', palette: 'ember' }, list, true).theme.id, 'ember-light');
  assert.strictEqual(resolveTheme({ theme: 'midnight-light', palette: 'forest' }, list, true).theme.id, 'midnight-light');
  const mine = { id: 'neon', name: 'Neon', dark: true, vars: { '--theme-bg': '#000' } };
  const r = resolveTheme({ theme: 'neon', palette: 'forest' }, [...list, mine], false);
  assert.strictEqual(r.theme.id, 'neon'); assert.strictEqual(r.custom, true); assert.strictEqual(r.dark, true);
  assert.deepStrictEqual(customThemes([...list, mine]).map((t) => t.id), ['neon']);

  // 4. accents: known names override the accent, unknown or empty change nothing
  assert.deepStrictEqual(accentVars('', true), {});
  assert.deepStrictEqual(accentVars('nope', true), {});
  const blue = ACCENTS.find(([id]) => id === 'blue');
  assert.strictEqual(accentVars('blue', true)['--theme-accent'], blue[2]);
  assert.strictEqual(accentVars('blue', false)['--theme-accent'], blue[3]);
  assert.strictEqual(accentVars('gold', true)['--theme-accent-text'], '#1A1408', 'light accents get dark text on dark backgrounds');

  // 5. main's native light/dark follows the same rules
  assert.strictEqual(themes.nativeSource({ appearance: 'light' }, list), 'light');
  assert.strictEqual(themes.nativeSource({ appearance: 'system' }, list), 'system');
  assert.strictEqual(themes.nativeSource({ theme: 'dark', appearance: 'light' }, list), 'dark');
  assert.strictEqual(themes.nativeSource({ theme: 'forest-light', appearance: 'dark' }, list), 'light');
  assert.strictEqual(themes.nativeSource({}, list), 'system');

  // 6. the MCP tool takes the same palette and accent names
  const { SAFE_SETTINGS } = require('../electron/artemis-tools');
  assert.strictEqual(SAFE_SETTINGS.appearance('dark'), 'dark');
  assert.throws(() => SAFE_SETTINGS.appearance('dim'));
  for (const [id] of ACCENTS) assert.strictEqual(SAFE_SETTINGS.accent(id), id, 'MCP must accept accent ' + id);
  assert.strictEqual(SAFE_SETTINGS.accent(''), '');
  assert.throws(() => SAFE_SETTINGS.accent('neon'));

  console.log('palette: all tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
