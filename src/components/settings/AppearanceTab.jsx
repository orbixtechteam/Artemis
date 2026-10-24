import React from 'react';
import Select from '../Select.jsx';
import { Group, Row, Segmented } from './ui.jsx';
import { TEXT_SIZES } from '../../lib/themes.js';
import { families, customThemes, ACCENTS, DEFAULT_PALETTE } from '../../lib/palette.mjs';

const MODES = [['system', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']];

/** A tiny window drawn in a theme's own colours (sidebar, two lines of text, the composer with its accent). */
function Thumb({ theme, className = '' }) {
  const v = (theme && theme.vars) || {};
  const style = {
    '--t-bg': v['--theme-bg'], '--t-side': v['--theme-side'], '--t-elev': v['--theme-elev'] || v['--theme-panel'],
    '--t-text': v['--theme-text'], '--t-accent': v['--theme-accent'], '--t-line': v['--theme-border'],
  };
  return (
    <span className={`ap-thumb ${className}`} style={style} aria-hidden="true">
      <span className="ap-ts"><i /><i /><i /></span>
      <span className="ap-tm"><i className="l1" /><i className="l2" /><span className="ap-tp"><i /></span></span>
    </span>
  );
}

export function AppearanceTab({ s, setS, themes, themeMsg, themeBusy, onRefresh, onImport, onOpenFolder }) {
  const fams = families(themes);
  const custom = customThemes(themes);
  const customOn = custom.find((t) => t.id === s.theme);
  const familyThemeOn = !customOn && themes.find((t) => t.id === s.theme && t.family);
  const forced = s.theme === 'light' || s.theme === 'dark' ? s.theme : null;
  const mode = forced || (familyThemeOn ? (familyThemeOn.dark === false ? 'light' : 'dark') : s.appearance || 'system');
  const pal = familyThemeOn ? familyThemeOn.family : s.palette || DEFAULT_PALETTE;
  const osDark = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)').matches : false;
  const dark = mode === 'dark' || (mode === 'system' && osDark);
  const current = fams.find((f) => f.id === pal) || fams[0] || {};
  const version = (f, d) => (d ? f.dark || f.light : f.light || f.dark);
  // picking a palette or a mode always lands on the palette system: a leftover single theme id would win otherwise
  const pick = (patch) => setS((x) => ({ ...x, theme: 'system', ...patch }));
  const accent = s.accent || '';

  return (
    <>
      <Group title="Appearance" footer={customOn ? `${customOn.name} is a fixed ${customOn.dark === false ? 'light' : 'dark'} theme. Pick a palette below to follow Light, Dark or Automatic again.` : null}>
        <div className="ap-modes" role="radiogroup" aria-label="Appearance">
          {MODES.map(([id, name]) => {
            const on = !customOn && mode === id;
            return (
              <button key={id} type="button" role="radio" aria-checked={on} className={`ap-mode ${on ? 'on' : ''}`} onClick={() => pick({ appearance: id })}>
                {id === 'system'
                  ? <span className="ap-auto"><Thumb theme={version(current, false)} /><Thumb theme={version(current, true)} className="half" /></span>
                  : <Thumb theme={version(current, id === 'dark')} />}
                <span>{name}</span>
              </button>
            );
          })}
        </div>
      </Group>

      <Group title="Palette" footer="Each palette has a light and a dark version and follows the setting above.">
        <div className="ap-grid" role="radiogroup" aria-label="Palette">
          {fams.map((f) => {
            const on = !customOn && pal === f.id;
            return (
              <button key={f.id} type="button" role="radio" aria-checked={on} className={`ap-pal ${on ? 'on' : ''}`} onClick={() => pick({ palette: f.id })}>
                <Thumb theme={version(f, dark)} />
                <span className="ap-name">{f.name}</span>
                {f.about && <span className="ap-about">{f.about}</span>}
              </button>
            );
          })}
        </div>
      </Group>

      <Group title="Accent colour">
        <Row label="Accent" description={customOn ? 'Custom themes bring their own accent.' : accent ? (ACCENTS.find(([id]) => id === accent) || [])[1] : 'From the palette'}>
          <div className="ap-dots" role="radiogroup" aria-label="Accent colour">
            <button type="button" role="radio" aria-checked={!accent} aria-label="Palette accent" title="Palette accent" className={`ap-dot multi ${!accent ? 'on' : ''}`} disabled={!!customOn} onClick={() => setS((x) => ({ ...x, accent: '' }))} />
            {ACCENTS.map(([id, name, onDark, onLight]) => (
              <button key={id} type="button" role="radio" aria-checked={accent === id} aria-label={name} title={name} className={`ap-dot ${accent === id ? 'on' : ''}`} style={{ background: dark ? onDark : onLight }} disabled={!!customOn} onClick={() => setS((x) => ({ ...x, accent: id }))} />
            ))}
          </div>
        </Row>
      </Group>

      <Group title="Text">
        <Row label="Text size">
          <Segmented value={s.textSize || 'medium'} options={TEXT_SIZES.map(([id, n]) => [id, n])} onChange={(v) => setS((x) => ({ ...x, textSize: v }))} />
        </Row>
        <Row label="Show reasoning" description="How the model’s thinking appears in replies. It is never sent back to the model or read aloud.">
          <Select value={s.showThinking || 'collapsed'} onChange={(e) => setS((x) => ({ ...x, showThinking: e.target.value }))}>
            <option value="collapsed">Collapsed</option>
            <option value="expanded">Expanded</option>
            <option value="hidden">Hidden</option>
          </Select>
        </Row>
      </Group>

      <Group title="Custom themes" footer={<>A custom theme is a .json file in the themes folder; two files with the same <code>"family"</code> make a palette with light and dark versions. A project can carry its own in .artemis/themes.</>}>
        {custom.length > 0 && (
          <div className="ap-grid" role="radiogroup" aria-label="Custom theme">
            {custom.map((t) => (
              <button key={t.id} type="button" role="radio" aria-checked={s.theme === t.id} className={`ap-pal ${s.theme === t.id ? 'on' : ''}`} onClick={() => setS((x) => ({ ...x, theme: t.id }))} title={t.source && t.source !== 'builtin' ? `${t.name} (${t.source})` : t.name}>
                <Thumb theme={t} />
                <span className="ap-name">{t.name}</span>
                <span className="ap-about">{t.dark === false ? 'Light' : 'Dark'}{t.source && t.source !== 'builtin' ? ' · ' + t.source : ''}</span>
              </button>
            ))}
          </div>
        )}
        <Row label={custom.length ? `${custom.length} custom theme${custom.length === 1 ? '' : 's'}` : 'No custom themes yet'} description={themeMsg || undefined}>
          <div className="pref-inline">
            <button type="button" className="pref-btn" onClick={onRefresh} disabled={themeBusy}>{themeBusy ? 'Refreshing…' : 'Refresh'}</button>
            <button type="button" className="pref-btn" onClick={onOpenFolder}>Open folder</button>
            <button type="button" className="pref-btn" onClick={onImport} disabled={themeBusy}>Import…</button>
          </div>
        </Row>
      </Group>
    </>
  );
}
