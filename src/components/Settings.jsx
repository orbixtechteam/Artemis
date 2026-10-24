import React, { useEffect, useRef, useState } from 'react';
import Select from './Select.jsx';
import PERSONALITIES from '../../electron/personality.json';
import { ImportRow } from './Modals.jsx';
import { Icon } from './Icons.jsx';
import { Page, Group, Row, SwitchRow, Note } from './settings/ui.jsx';
import { PhoneTab } from './settings/PhoneTab.jsx';
import { ProvidersTab } from './settings/ProvidersTab.jsx';
import { LimitsTab } from './settings/LimitsTab.jsx';
import { AppearanceTab } from './settings/AppearanceTab.jsx';
import { AccessTab } from './settings/AccessTab.jsx';
import { SecurityTab } from './settings/SecurityTab.jsx';
import { VoiceTab } from './settings/VoiceTab.jsx';
import { UpdatesGroup } from './settings/UpdatesGroup.jsx';
import { MakeTab } from './settings/MakeTab.jsx';
import { AgentsTab } from './settings/AgentsTab.jsx';
import { BrainsTab } from './settings/BrainsTab.jsx';
import MemoryPanel from './MemoryPanel.jsx';
import { MemoryGroup } from './settings/MemoryGroup.jsx';
import { SandboxGroup } from './settings/SandboxGroup.jsx';
import { eventToAccelerator, formatAccelerator, parseAccelerator } from '../lib/shortcuts.mjs';

const IS_MAC = window.api?.platform === 'darwin';

/** A shortcut box, recorded like the push-to-talk key in Voice: click it, press the keys; Esc cancels, Clear turns it off. */
function ShortcutField({ label, about, value, onChange, placeholder, error }) {
  const v = String(value || '').trim();
  const [rec, setRec] = useState(false);
  const [msg, setMsg] = useState('');
  const bad = !!v && !parseAccelerator(v);
  const shown = formatAccelerator(v, IS_MAC);
  const err = error || (bad ? `"${v}" is not a valid shortcut. Example: ${formatAccelerator(placeholder, IS_MAC) || placeholder}` : '');
  const pause = (on) => { try { window.api.shortcutsPause && window.api.shortcutsPause(on); } catch {} };
  useEffect(() => () => { if (rec) pause(false); }, [rec]); // give the global shortcuts back if Settings closes while recording
  const onKeyDown = (e) => {
    if (e.key === 'Tab') return;
    e.preventDefault(); e.stopPropagation(); // the app's own shortcuts (the palette) must not fire while recording
    if (e.key === 'Escape') { e.currentTarget.blur(); return; }
    if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) { setMsg(''); return; } // wait for the main key
    const a = eventToAccelerator(e, IS_MAC);
    if (!a) { setMsg(IS_MAC ? 'Add ⌘, ⌥ or ⌃ (or use an F-key).' : 'Add Ctrl or Alt (or use an F-key).'); return; }
    setMsg(''); onChange(a); e.currentTarget.blur();
  };
  const example = placeholder ? formatAccelerator(placeholder.replace(/^e\.g\.\s*/, ''), IS_MAC) : '';
  return (
    <Row label={label} description={<>{about}{example && !shown ? <> For example <kbd>{example}</kbd>.</> : null}</>} error={err || msg}>
      <div className="pref-inline">
        <input readOnly className={`pref-shortcut ${rec ? 'recording' : ''} ${shown ? '' : 'empty'}`} value={rec ? 'Press the keys…' : (shown || '')} placeholder="Click to record"
          title="Click, then press the keys. Esc cancels." aria-invalid={!!err} aria-label={label + ' shortcut'}
          onFocus={() => { setRec(true); setMsg(''); pause(true); }} onBlur={() => { setRec(false); pause(false); }} onKeyDown={onKeyDown} />
        <button type="button" className="pref-btn" onClick={() => { onChange(''); setMsg(''); }} disabled={!v} aria-label={'Clear ' + label + ' shortcut'}>Clear</button>
      </div>
    </Row>
  );
}

// id, sidebar label, icon, one-line description, group (the sidebar leaves a gap between groups, like System Settings),
// and the parts the page shows in order. A part id is what the rest of the app opens (openSettings('make') …),
// so an old id still lands on the right section and scrolls to its part.
export const SECTIONS = [
  ['general', 'General', 'sliders', 'Default model, personality and how Artemis starts.', 'app', ['general']],
  ['appearance', 'Appearance', 'eye', 'Light or dark, palette, accent colour and text size.', 'app', ['appearance']],
  ['shortcuts', 'Keyboard', 'keyboard', 'Shortcuts that work from any app, and inside Artemis.', 'app', ['shortcuts']],
  ['providers', 'Models & providers', 'plug', 'Model providers, endpoints and API keys.', 'models', ['providers']],
  ['agents', 'Agents & brains', 'layers', 'Helper agents, and personalities with their own model.', 'models', ['agents', 'brains']],
  ['voice', 'Voice & Sentinel', 'mic', 'Dictation, reading answers aloud and Sentinel voice mode.', 'models', ['voice']],
  ['privacy', 'Privacy & safety', 'shield', 'What Artemis may do and reach, and the app lock.', 'more', ['tools', 'access', 'security']],
  ['integrations', 'Integrations', 'link', 'Make.com scenarios, and chatting from your phone.', 'more', ['make', 'phone']],
  ['limits', 'Usage & limits', 'chart', 'What Artemis has used, and the limits that pause it.', 'more', ['limits']]
];
// headings of the parts inside a section that has more than one
const PART_TITLES = { agents: 'Agents', brains: 'Brains', tools: 'Tools & safety', access: 'Access', security: 'Security', make: 'Make', phone: 'Phone' };
const sectionOf = (id) => SECTIONS.find(([sec, , , , , parts]) => sec === id || parts.includes(id));

// words people look for, so the search finds a setting by what it does and not only by its section name
const KEYWORDS = {
  general: 'language model default reasoning effort image video system prompt instructions personality tray background dock launch login startup import chatgpt claude export notes folder files memory use ram',
  appearance: 'theme appearance palette accent dark light automatic colors color text size font thinking reasoning display custom',
  shortcuts: 'shortcut shortcuts keyboard hotkey keys palette command quick chat search sentinel global',
  providers: 'api key keys openai anthropic claude gemini ollama openrouter model models endpoint base url provider',
  tools: 'permissions approve approval auto allow safety safe terminal shell commands web search computer use browser connectors mcp files skills learning lazy tokens',
  security: 'security lock password touch id fingerprint recovery code voice recognition speaker only my voice unauthorized access lockdown telegram alert photo camera idle sleep sensitive',
  access: 'remote access network allow folders paths mcp server connectors permissions macos screen recording accessibility token port',
  agents: 'agent agents subagent delegate helper',
  brains: 'brain brains council persona personality',
  limits: 'usage limit limits budget cost token tokens daily monthly usd spend spending max length answer',
  voice: 'voice speech microphone mic speakers speak wake word sentinel transcribe tts dictation kokoro chatterbox piper push to talk',
  make: 'make make.com scenarios automation token zone',
  phone: 'phone telegram bot pair mobile send file remote'
};

// Settings that are not saved from here: secrets go through their own commit path, the rest is computed by main.
const NOT_SAVED = new Set(['hasApiKey', 'hasMakeToken', 'hasTelegramToken', 'hasBraveKey', 'braveKey', 'braveKeyEnc', 'shortcutError', 'shortcutErrors', 'telegramToken', 'apiKey', 'apiKeyEnc', 'telegramTokenEnc', 'makeTokenEnc', 'mcpTokenEnc']);
// Typed or dragged values: saved 400 ms after the last change instead of at once.
const DEBOUNCED = new Set(['systemPrompt', 'personalityCustom', 'maxTokens', 'cbUrl', 'ttsUrl', 'ttsVoice', 'ttsVoiceEn', 'ttsVoices', 'voiceLangMap', 'cbVoice', 'voiceSttModel', 'ttsModel', 'remoteFolder', 'cbExaggeration', 'cbCfg', 'cbTemperature', 'cbSpeed']);
const normalize = (k, v) => {
  if (k === 'maxTokens') return Math.max(256, parseInt(v, 10) || 8192);
  if (k === 'dailyTokenLimit' || k === 'monthlyTokenLimit') return Math.max(0, parseInt(v, 10) || 0);
  if (k === 'dailyUsdLimit' || k === 'monthlyUsdLimit') return Math.max(0, parseFloat(v) || 0);
  return v;
};
const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
/** What the page shows but main does not have yet. */
export const pendingPatch = (s, base) => {
  const out = {};
  for (const k of Object.keys(s)) {
    if (NOT_SAVED.has(k)) continue;
    const v = normalize(k, s[k]);
    if (!same(v, base[k])) out[k] = v;
  }
  return out;
};
const validTab = (t) => (sectionOf(t) || SECTIONS[0])[0];

export function SettingsModal({ settings, groups = [], projects = [], providers = [], onProviders = () => {}, onApply = async () => {}, onTabChange, initialTab = 'general', onBack, profile, onProfile }) {
  const [tab, setTabState] = useState(() => validTab(initialTab));
  // opening a part (Access, Brains, Phone …) shows its section and scrolls to that part (after the reset to the top below)
  const showPart = (part) => setTimeout(() => { scrollIntent.current = Date.now(); const el = contentRef.current?.querySelector(`[data-part="${part}"]`); if (el) el.scrollIntoView({ block: 'start' }); }, 60);
  useEffect(() => { setTabState(validTab(initialTab)); if (initialTab !== validTab(initialTab)) showPart(initialTab); }, [initialTab]);
  const setTab = (t) => { const sec = validTab(t); setTabState(sec); if (onTabChange) onTabChange(sec); if (t !== sec) showPart(t); };
  const [tq, setTq] = useState('');
  const [s, setS] = useState({ ...settings });
  const set = (k) => (e) => setS((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const put = (k) => (v) => setS((x) => ({ ...x, [k]: v }));
  const chatGroups = groups;

  // ---- auto-save: every change goes to main at once (typed text after a short pause); nothing waits for a Save button ----
  const baseRef = useRef(settings);
  const sRef = useRef(s); sRef.current = s;
  const applyRef = useRef(onApply); applyRef.current = onApply;
  const timer = useRef(null);
  const [status, setStatus] = useState(''); // '' | 'saved' | 'error'
  const flush = async () => {
    clearTimeout(timer.current); timer.current = null;
    const patch = pendingPatch(sRef.current, baseRef.current || {});
    if (!Object.keys(patch).length) return;
    try { await applyRef.current(patch); setStatus('saved'); } catch (e) { console.error('Saving settings failed', e); setStatus('error'); }
  };
  useEffect(() => { // settings changed in main (our own save, Sentinel, the MCP server …): take over what the page has not changed itself
    const prev = baseRef.current || {};
    baseRef.current = settings;
    setS((cur) => {
      let n = null;
      for (const k of Object.keys(settings)) {
        if (same(settings[k], prev[k])) continue;
        if (NOT_SAVED.has(k) || same(normalize(k, cur[k]), prev[k])) { n = n || { ...cur }; n[k] = settings[k]; }
      }
      return n || cur;
    });
  }, [settings]);
  useEffect(() => {
    const keys = Object.keys(pendingPatch(s, baseRef.current || {}));
    if (!keys.length) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, keys.some((k) => DEBOUNCED.has(k)) ? 400 : 0);
  }, [s]);
  useEffect(() => () => { if (timer.current) flush(); }, []); // closing the tab saves what is still waiting
  useEffect(() => { if (status !== 'saved') return undefined; const t = setTimeout(() => setStatus(''), 1600); return () => clearTimeout(t); }, [status]);
  const [braveDraft, setBraveDraft] = useState('');
  const saveSecret = async (patch) => { try { await applyRef.current(patch); setStatus('saved'); } catch (e) { console.error('Saving settings failed', e); setStatus('error'); } };

  // Themes come from main: built-in JSON plus <userData>/themes and <project>/.artemis/themes, refreshed here.
  const projectFolder = (projects.find((p) => p.id === (settings.activeProjectId || (settings.projectId || ''))) || {}).folder || (projects[0] || {}).folder || '';
  const [themeInfo, setThemeInfo] = useState({ themes: [], folder: '' });
  const [themeMsg, setThemeMsg] = useState('');
  const [themeBusy, setThemeBusy] = useState(false);
  const refreshThemes = async () => {
    try {
      const r = await window.api.themesList(projectFolder);
      if (r) setThemeInfo({ themes: r.themes || [], folder: (r.folders && r.folders.user) || '' });
    } catch {}
  };
  const importThemes = async () => {
    setThemeBusy(true);
    try {
      const r = await window.api.themesImport('');
      if (r) setThemeMsg(r.added ? `Imported: ${r.added.join(', ')}` : '');
      await refreshThemes(); await onApply({});
    } catch (e) { setThemeMsg(String((e && e.message) || e)); }
    setThemeBusy(false);
  };
  useEffect(() => { refreshThemes(); }, []);
  useEffect(() => window.api.onThemeChanged ? window.api.onThemeChanged(() => refreshThemes()) : undefined, []);
  const mediaGroups = providers.filter((p) => p.enabled !== false && (p.models || []).length).map((p) => <optgroup key={p.id} label={p.name}>{p.models.map((m) => <option key={m.id} value={`prov:${p.id}:${m.id}`}>{m.name || m.id}</option>)}</optgroup>);
  const known = !s.model || chatGroups.some((g) => g.items.some(([id]) => id === s.model));
  const modelOptions = chatGroups.map((g) => <optgroup key={g.label} label={g.label}>{g.items.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</optgroup>);

  // ---- search: while there is a query, every section is rendered and only the rows that match stay visible ----
  // (labels, descriptions, option names and values of every field, not only section names). The sidebar lists the sections with hits.
  const terms = tq.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const searching = terms.length > 0;
  const [hitSecs, setHitSecs] = useState([]);
  const kwSecs = searching ? SECTIONS.filter(([, label, , , , parts]) => { const hay = [label, ...parts.map((p) => (PART_TITLES[p] || '') + ' ' + (KEYWORDS[p] || ''))].join(' ').toLowerCase(); return terms.every((t) => hay.includes(t)); }).map(([id]) => id) : [];
  const shown = searching ? SECTIONS.filter(([id]) => hitSecs.includes(id) || kwSecs.includes(id)) : SECTIONS;
  const contentRef = useRef(null);
  const navRef = useRef(null);
  const textOf = (el) => {
    let t = el.textContent || '';
    el.querySelectorAll('input, textarea').forEach((x) => { if (x.type !== 'password') t += ' ' + (x.value || '') + ' ' + (x.placeholder || ''); });
    el.querySelectorAll('select option').forEach((o) => { t += ' ' + o.textContent; });
    return t.toLowerCase();
  };
  const matches = (el) => terms.every((t) => textOf(el).includes(t));
  useEffect(() => { // runs after every render: some sections load their rows asynchronously
    const root = contentRef.current; if (!root) return;
    const page = root.querySelector('.pref-page'); if (!page) return;
    const kids = [...page.children].filter((k) => !k.classList.contains('pref-page-head'));
    if (!searching) { kids.forEach((k) => k.classList.remove('search-hidden')); page.querySelectorAll('.search-hidden, .match').forEach((e) => e.classList.remove('search-hidden', 'match')); return; }
    const secs = new Set();
    let head = null, headHit = false, first = null;
    const closeHead = () => { if (head) { head.classList.toggle('search-hidden', !headHit); if (headHit && head.dataset.sec) secs.add(head.dataset.sec); } };
    for (const k of kids) {
      if (k.matches('h2.pref-part')) { closeHead(); head = k; headHit = false; continue; }
      const rows = [...k.querySelectorAll('.pref-row')];
      let visible = false;
      if (rows.length) {
        const titleHit = (r) => { const g = r.closest('.pref-group'); const t = g && g.querySelector('.pref-group-title'); return !!t && terms.every((x) => (t.textContent || '').toLowerCase().includes(x)); };
        for (const r of rows) {
          const byTitle = titleHit(r);
          const hit = byTitle || matches(r);
          r.classList.toggle('search-hidden', !hit);
          r.classList.toggle('match', hit && !byTitle);
          if (hit) { visible = true; if (!first) first = r; }
        }
        // cards inside this block whose rows are all hidden go too (a tab can hold several groups in one wrapper)
        k.querySelectorAll('.pref-group').forEach((g) => { const rs = g.querySelectorAll('.pref-row'); if (rs.length) g.classList.toggle('search-hidden', ![...rs].some((r) => !r.classList.contains('search-hidden'))); });
      } else visible = matches(k);
      k.classList.toggle('search-hidden', !visible);
      if (visible) headHit = true;
    }
    closeHead();
    const list = [...secs];
    if (list.join() !== hitSecs.join()) setHitSecs(list);
    if (first && root.dataset.q !== tq) { root.dataset.q = tq; root.scrollTop = 0; scrollKeep.current = 0; }
  });
  useEffect(() => { if (contentRef.current) contentRef.current.scrollTop = 0; scrollKeep.current = 0; }, [tab]);
  // Keep the scroll position when something on the page re-renders: a part that loads or redraws for a moment (a status that
  // refreshes, a card that reloads) can make the page shorter for a frame, and the browser then jumps to the top.
  const scrollKeep = useRef(0);
  const scrollIntent = useRef(0);
  useEffect(() => {
    const el = contentRef.current; if (!el) return undefined;
    // only scrolling the user (or our own jump to a part) asked for counts; a jump caused by the page getting shorter does not
    const mark = () => { scrollIntent.current = Date.now(); };
    const onScroll = () => { if (Date.now() - scrollIntent.current < 1200) scrollKeep.current = el.scrollTop; };
    for (const ev of ['wheel', 'keydown', 'pointerdown', 'touchmove']) el.addEventListener(ev, mark, { passive: true });
    el.addEventListener('scroll', onScroll, { passive: true });
    const keep = new ResizeObserver(() => { if (scrollKeep.current > 0 && el.scrollTop < scrollKeep.current - 2 && el.scrollHeight >= scrollKeep.current + el.clientHeight - 2) el.scrollTop = scrollKeep.current; });
    if (el.firstElementChild) keep.observe(el.firstElementChild);
    return () => { el.removeEventListener('scroll', onScroll); for (const ev of ['wheel', 'keydown', 'pointerdown', 'touchmove']) el.removeEventListener(ev, mark); keep.disconnect(); };
  }, []);
  const onNavKey = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const i = shown.findIndex(([id]) => id === tab);
    const next = shown[(i + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length];
    if (!next) return;
    setTab(next[0]);
    requestAnimationFrame(() => navRef.current?.querySelector(`[data-sec="${next[0]}"]`)?.focus());
  };
  const sec = SECTIONS.find(([id]) => id === tab) || SECTIONS[0];
  const parts = sec[5];
  const has = (p) => searching || parts.includes(p);
  // a section made of several parts gets a heading per part; data-part is where openSettings('<part>') scrolls to.
  // While searching every part has a heading (with its section), so the results are grouped and the sidebar can jump to them.
  const partHead = (p) => {
    const own = sectionOf(p);
    if (searching) return <h2 className="pref-part" data-part={p} data-sec={own[0]}>{own[5].length > 1 ? `${own[1]} · ${PART_TITLES[p]}` : own[1]}</h2>;
    return parts.length > 1 ? <h2 className="pref-part" data-part={p}>{PART_TITLES[p]}</h2> : null;
  };
  const openSec = (id) => {
    if (!searching) return setTab(id);
    scrollIntent.current = Date.now();
    const el = contentRef.current?.querySelector(`h2.pref-part[data-sec="${id}"]:not(.search-hidden)`);
    if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  const statusEl = (
    <span className={`pref-status ${status}`} role="status" aria-live="polite">
      {status === 'saved' ? <><Icon name="check" size={13} /> Saved</> : status === 'error' ? 'Could not save. Try again.' : ''}
    </span>
  );

  return (
    <div className="prefs">
      <nav className="prefs-side" aria-label="Settings sections">
        {onBack && <button type="button" className="prefs-back" onClick={onBack} title="Close Settings (⌘W)"><Icon name="chevronLeft" size={14} /> Back</button>}
        <div className="prefs-search">
          <Icon name="search" size={13} />
          <input type="search" placeholder="Search" aria-label="Search settings" value={tq} spellCheck={false} onChange={(e) => setTq(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && shown[0]) { const id = shown[0][0]; setTq(''); setTab(id); } else if (e.key === 'Escape') { e.stopPropagation(); setTq(''); } else if (e.key === 'ArrowDown') { e.preventDefault(); navRef.current?.querySelector('[data-sec]')?.focus(); } }} />
        </div>
        {onProfile && !terms.length && (
          <button type="button" className="prefs-who" onClick={onProfile}>
            {profile && profile.avatar ? <img className="avatar" src={profile.avatar} alt="" /> : <span className="avatar">{((profile && profile.name) || '').trim().slice(0, 1).toUpperCase() || <Icon name="user" size={15} />}</span>}
            <span className="prefs-who-t"><b>{(profile && profile.name) || 'Set up profile'}</b><small>Profile, memory, personality</small></span>
          </button>
        )}
        <div className="prefs-nav" ref={navRef} onKeyDown={onNavKey}>
          {shown.map(([id, label, icon, , group], i) => (
            <React.Fragment key={id}>
            {i > 0 && !terms.length && group !== shown[i - 1][4] && <div className="prefs-nav-gap" aria-hidden="true" />}
            <button type="button" data-sec={id} className={`prefs-nav-item ${tab === id ? 'active' : ''} ${terms.length ? 'match' : ''}`} aria-current={tab === id ? 'page' : undefined}
              tabIndex={tab === id || !shown.some(([x]) => x === tab) ? 0 : -1} onClick={() => openSec(id)}>
              <span className={`prefs-nav-icon ic-${id}`}><Icon name={icon} size={14} /></span>
              <span className="prefs-nav-label">{label}</span>
            </button>
            </React.Fragment>
          ))}
          {terms.length > 0 && !shown.length && <div className="prefs-none">No settings match “{tq.trim()}”.</div>}
        </div>
      </nav>
      <main className="prefs-content" ref={contentRef}>
        <Page title={searching ? 'Search' : sec[1]} description={searching ? (shown.length ? `Settings that match “${tq.trim()}”. Clear the search to go back.` : `No settings match “${tq.trim()}”.`) : sec[3]} aside={statusEl}>
          {has('general') && partHead('general')}
          {has('general') && (
            <>
              <Group title="Model">
                <Row label="Default model" description="Used for new chats. Add more models in Providers.">
                  <Select value={s.model} onChange={set('model')}>
                    {!s.model && <option value="">First model of the first provider</option>}
                    {!known && <option value={s.model}>{s.model}</option>}
                    {modelOptions}
                  </Select>
                </Row>
                <Row label="Reasoning level" description="How hard the model thinks before it answers: low is faster and cheaper, high thinks harder. Auto leaves it to the model. Used for new chats; change it per chat at the top. Models that do not support it ignore it.">
                  <Select value={s.reasoningEffort || 'auto'} onChange={(e) => setS((x) => ({ ...x, reasoningEffort: e.target.value === 'auto' ? '' : e.target.value }))}>
                    <option value="auto">Auto</option>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </Select>
                </Row>
                <Row label="Image model" description="Needs a provider whose endpoint supports /images/generations. Off = no image generation.">
                  <Select value={s.imageModel || ''} onChange={set('imageModel')}><option value="">Off</option>{mediaGroups}</Select>
                </Row>
                <Row label="Video model" description="Needs a provider whose endpoint supports /videos/generations. Off = no video generation.">
                  <Select value={s.videoModel || ''} onChange={set('videoModel')}><option value="">Off</option>{mediaGroups}</Select>
                </Row>
              </Group>
              <Group title="Scheduled tasks" footer="A task can still pick its own model in its editor. Scheduled tasks always run, whether Artemis is locked or not.">
                <Row label="Model for scheduled tasks" description="A small, cheap model is usually enough for recurring tasks. Used by every task that has no model of its own.">
                  <Select value={s.scheduleModel || ''} onChange={set('scheduleModel')}>
                    <option value="">Same as the default model</option>
                    {modelOptions}
                  </Select>
                </Row>
              </Group>
              <Group title="Chat titles">
                <SwitchRow label="Automatic titles" description="Names each chat from its topic after the first reply, and again as the topic changes. A name you give a chat yourself is never changed. Not used for incognito, phone or scheduled chats."
                  checked={s.autoTitles !== false} onChange={put('autoTitles')} />
                {s.autoTitles !== false && (
                  <Row label="Title model" description="A small, fast model is enough. The request sends only the first message, the start of the reply and, when re-titling, the last few messages (text only).">
                    <Select value={s.titleModel || ''} onChange={set('titleModel')}>
                      <option value="">Same as the chat</option>
                      {modelOptions}
                    </Select>
                  </Row>
                )}
              </Group>
              <Group title="Personality">
                <Row label="Personality" description={(PERSONALITIES.find((p) => p.id === (s.personality || '')) || {}).hint || ''}>
                  <Select value={s.personality || ''} onChange={set('personality')}>
                    {PERSONALITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </Select>
                </Row>
                <Row stacked label="Personality notes" description="Optional. Your own words, e.g. “Talk like a sarcastic best friend”. Added to the preset above.">
                  <textarea rows={2} value={s.personalityCustom || ''} onChange={set('personalityCustom')} placeholder="How should Artemis talk to you?" />
                </Row>
                <Row stacked label="Custom instructions" description="Added to the system prompt of every chat.">
                  <textarea rows={4} value={s.systemPrompt || ''} onChange={set('systemPrompt')} placeholder="e.g. Keep answers short and direct." />
                </Row>
              </Group>
              <Group title="Startup and background">
                <SwitchRow label="Keep running in the background" description="Closing the window keeps Artemis running. Needed for the phone bot and scheduled tasks. Artemis stays in the Dock; quit it from the Artemis menu (⌘Q) or the menu bar icon."
                  checked={s.closeToTray !== false} onChange={put('closeToTray')} />
                <SwitchRow label="Start Artemis when I log in" checked={!!s.launchAtLogin} onChange={put('launchAtLogin')} />
              </Group>
              <UpdatesGroup s={s} put={put} />
              <Group title="Import">
                <ImportRow />
              </Group>
              <Group title="Memory use">
                <div className="pref-block"><MemoryPanel /></div>
              </Group>
            </>
          )}
          {has('appearance') && partHead('appearance')}
          {has('appearance') && (
            <AppearanceTab s={s} setS={setS} themes={themeInfo.themes} themeMsg={themeMsg} themeBusy={themeBusy}
              onRefresh={refreshThemes} onImport={importThemes} onOpenFolder={() => window.api.themesOpen('user').then(refreshThemes).catch(() => {})} />
          )}
          {has('shortcuts') && partHead('shortcuts')}
          {has('shortcuts') && (
            <>
              <Group title="From any app" footer="Click a box, then press the keys. Esc cancels, Clear turns the shortcut off. The push-to-talk key for Sentinel is under Voice.">
                {[
                  ['quickChatShortcut', 'Quick chat', 'Opens or hides the Quick window on its Chat tab.', 'CommandOrControl+Shift+Space'],
                  ['quickSearchShortcut', 'Quick search', 'Opens the Quick window on its Search tab (chats, notes, files, actions).', 'e.g. CommandOrControl+Shift+F'],
                  ['sentinelShortcut', 'Sentinel on/off', 'Turns Sentinel (voice mode) on or off without bringing Artemis to the front.', 'CommandOrControl+Shift+A'],
                  ['lockShortcut', 'Lock Artemis', 'Locks the app right away (needs a password set in Security).', 'CommandOrControl+Alt+Shift+L']
                ].map(([k, label, about, ph]) => (
                  <ShortcutField key={k} label={label} about={about} placeholder={ph} value={s[k]} onChange={put(k)}
                    error={s[k] === settings[k] ? ((settings.shortcutErrors || {})[k] || '') : ''} />
                ))}
              </Group>
              <Group title="In Artemis">
                <ShortcutField label="Command palette" about="Opens or closes the command palette in the Artemis window." placeholder="CommandOrControl+K" value={s.paletteShortcut} onChange={put('paletteShortcut')}
                  error={s.paletteShortcut === settings.paletteShortcut ? ((settings.shortcutErrors || {}).paletteShortcut || '') : ''} />
                <SwitchRow label="Quick chat shortcut opens the palette" description="With the Artemis window in front, the Quick chat shortcut opens the command palette instead of the Quick window (the old behaviour)."
                  checked={!!s.paletteFromQuickShortcut} onChange={put('paletteFromQuickShortcut')} />
              </Group>
              {settings.shortcutError && !settings.shortcutErrors && <Note tone="err">{settings.shortcutError}</Note>}
            </>
          )}
          {has('providers') && partHead('providers')}
          {has('providers') && <ProvidersTab s={s} set={set} settings={settings} providers={providers} onProviders={onProviders} onApply={onApply} />}
          {has('tools') && partHead('tools')}
          {has('tools') && (
            <>
              <Group title="Tools">
                <SwitchRow label="Tools on by default in new chats" description="Files, memory, notes, web and terminal. You can switch tools on or off per chat with the “Tools” pill next to the model picker. Off sends much smaller requests, which small local models and free tiers need."
                  checked={!!s.toolsEnabled} onChange={put('toolsEnabled')} />
                <SwitchRow label="Auto-allow all in new chats" description={'Off by default: every action asks. On: file edits, agent file writes, web, terminal, computer control, Make and connectors run without asking. Deleting files always asks. Each chat can switch to "Ask every time" next to the message box. Messages from your phone follow this too, but only file edits are auto-allowed there.'}
                  checked={!!s.autoApproveEdits} onChange={put('autoApproveEdits')} />
                <SwitchRow label="Memory" checked={!!s.memoryEnabled} onChange={put('memoryEnabled')} />
                <SwitchRow label="Web search and page fetch" checked={!!s.webEnabled} onChange={put('webEnabled')} />
                <Row label="Search engine" description="Web search needs one of these. Brave Search API is a real search API with your own key. An AI search model (for example perplexity/sonar through OpenRouter) returns an answer with sources. Nothing is scraped.">
                  <Select value={s.searchEngine || (s.searchProvider ? 'provider' : '')} onChange={(e) => setS((x) => ({ ...x, searchEngine: e.target.value }))}>
                    <option value="">Not set (web search is off)</option>
                    <option value="brave">Brave Search API</option>
                    <option value="provider">AI search model</option>
                  </Select>
                </Row>
                {s.searchEngine === 'brave' ? (
                  <Row stacked label="Brave Search API key" description={s.hasBraveKey ? 'A key is saved (stored encrypted). Paste a new one to replace it. Get a key at brave.com/search/api; the key goes only to api.search.brave.com.' : 'Get a key at brave.com/search/api (create an account, pick a plan, copy the key from the dashboard) and paste it here. It goes only to api.search.brave.com.'}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input type="password" value={braveDraft} onChange={(e) => setBraveDraft(e.target.value)} placeholder={s.hasBraveKey ? 'Saved. Paste to replace' : 'BSA…'} spellCheck={false} autoComplete="off" style={{ flex: 1 }} />
                      <button type="button" className="pref-btn primary" disabled={!braveDraft.trim()} onClick={async () => { const k = braveDraft.trim(); setS((x) => ({ ...x, hasBraveKey: true })); setBraveDraft(''); await saveSecret({ braveKey: k }); }}>Save key</button>
                    </div>
                  </Row>
                ) : null}
                {(s.searchEngine || (s.searchProvider ? 'provider' : '')) === 'provider' ? (
                  <>
                    <Row label="Search provider" description="The provider that serves the search model.">
                      <Select value={s.searchProvider || ''} onChange={(e) => setS((x) => ({ ...x, searchProvider: e.target.value }))}>
                        <option value="">Choose a provider</option>
                        {providers.filter((p) => p.enabled !== false).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </Select>
                    </Row>
                    <Row label="Search model" description="An online-search model of that provider. Default: perplexity/sonar.">
                      <input value={s.searchModel ?? 'perplexity/sonar'} onChange={(e) => setS((x) => ({ ...x, searchModel: e.target.value }))} placeholder="perplexity/sonar" spellCheck={false} />
                    </Row>
                  </>
                ) : null}
                <SwitchRow label="Notes knowledge base" description="Artemis can search and read your notes after you approve." checked={s.notesAi !== false} onChange={put('notesAi')} />
                <SwitchRow label="Terminal commands" description="Asks once per task." checked={!!s.shellEnabled} onChange={put('shellEnabled')} />
                <SwitchRow label="Computer control (macOS)" description="Screen, mouse and keyboard. Asks once per task. Emergency stop: ⌘⇧Esc." checked={!!s.computerEnabled} onChange={put('computerEnabled')} />
                <SwitchRow label="Browser control" description="Artemis can open pages, click, type and fill forms in the integrated browser while you watch. Asks once per site per task; it never runs in scheduled or phone tasks." checked={s.browserTools !== false} onChange={put('browserTools')} />
                <SwitchRow label="Connectors (MCP servers)" checked={s.connectorsEnabled !== false} onChange={put('connectorsEnabled')} />
                <SwitchRow label="Full file access" description="The assistant can reach files anywhere on this computer, not only in the project folder. It asks first: once per outside folder for reading, every time for keys and credentials, and for every change." checked={s.fullFileAccess !== false} onChange={put('fullFileAccess')} />
              </Group>
              <Group title="Saving tokens">
                <SwitchRow label="Switch heavy tools on only when needed" description="Computer control, browser control, terminal, media, phone, scheduling, helper agents and Make are sent only after the assistant asks for them. Files, web, memory and notes are always on." checked={s.toolsLazy !== false} onChange={put('toolsLazy')} />
                <SwitchRow label="Switch connectors on only when needed" description="Connector tools are sent only after the assistant asks for that app." checked={s.connectorsLazy !== false} onChange={put('connectorsLazy')} />
              </Group>
              <Group title="Skills and learning">
                <SwitchRow label="Skills" description="Artemis can load your saved instructions for tasks you repeat." checked={s.skillsEnabled !== false} onChange={put('skillsEnabled')} />
                <SwitchRow label="Let Artemis learn by itself" description="It saves a skill after a task you are likely to repeat and improves skills when you correct it. Off = it asks before saving. Not used in incognito chats or scheduled tasks." checked={s.autoLearn !== false} onChange={put('autoLearn')} />
                {s.autoLearn !== false && (
                  <Row label="Learning model" description="After a task with several steps this model decides whether it is worth saving as a skill. You always see the skill first and choose Allow or Deny. A small, cheap model is enough.">
                    <Select value={s.reflectModel || ''} onChange={set('reflectModel')}>
                      <option value="">Automatic (a small, cheap model)</option>
                      {modelOptions}
                    </Select>
                  </Row>
                )}
                <SwitchRow label="Search my earlier chats" description="Lets Artemis look things up in your saved chats when you refer to them. Incognito chats are never searched." checked={s.chatSearchEnabled !== false} onChange={put('chatSearchEnabled')} />
              </Group>
              {s.memoryEnabled && <MemoryGroup s={s} setS={setS} put={put} providers={providers} modelOptions={modelOptions} />}
              {s.shellEnabled && <SandboxGroup s={s} setS={setS} put={put} />}
            </>
          )}
          {has('access') && partHead('access')}
          {has('access') && <AccessTab s={s} set={set} setS={setS} projects={projects} goTo={setTab} />}
          {has('security') && partHead('security')}
          {has('security') && <SecurityTab />}
          {has('agents') && partHead('agents')}
          {has('agents') && <AgentsTab s={s} set={set} setS={setS} chatGroups={chatGroups} />}
          {has('brains') && partHead('brains')}
          {has('brains') && <BrainsTab s={s} setS={setS} chatGroups={chatGroups} />}
          {has('limits') && partHead('limits')}
          {has('limits') && <LimitsTab s={s} setS={setS} />}
          {has('voice') && partHead('voice')}
          {has('voice') && <VoiceTab s={s} setS={setS} providers={providers} chatGroups={chatGroups} pttError={s.sentinelPtt === settings.sentinelPtt ? ((settings.shortcutErrors || {}).sentinelPtt || '') : ''} />}
          {has('make') && partHead('make')}
          {has('make') && <MakeTab s={s} setS={setS} />}
          {has('phone') && partHead('phone')}
          {has('phone') && <PhoneTab s={s} setS={setS} onSaveToken={(t) => saveSecret({ telegramToken: t })} />}
        </Page>
      </main>
    </div>
  );
}
