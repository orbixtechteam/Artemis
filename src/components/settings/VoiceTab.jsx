import React, { useEffect, useRef, useState } from 'react';
import Select from '../Select.jsx';
import { dropSentinelModel } from '../../lib/sentinel.js';
import { LANGS, listVoices, rankVoice, speak, stopSpeaking, ttsConfig, pickVoice } from '../../lib/voice.js';
import { VOICE_LANGS, KOKORO_VOICES, kokoroVoiceFits, langName, LANG_ENGINES, LANG_NOTES, PIPER_LANG_URL, PIPER_VOICES, VOICE_TEST_SAMPLES, langMapFrom, normLangEntry, okUrl, routeLang } from '../../lib/lang.mjs';
import { listDevices, unlockLabels } from '../../lib/audio-devices.js';
import { Group, Row, SwitchRow } from './ui.jsx';
import { Icon } from '../Icons.jsx';
import { ModelSelect, STT_MODELS, TTS_MODELS } from './shared.jsx';
import { recordCombo, heldMods, modsLabel, pttLabel, pttComboOk, PTT_COMBO_HINT } from '../../lib/ptt.mjs';
import { formatAccelerator } from '../../lib/shortcuts.mjs';

const IS_MAC = window.api?.platform === 'darwin';
const pauseShortcuts = (on) => { try { window.api.shortcutsPause && window.api.shortcutsPause(on); } catch {} };

export function AudioDevices({ s, setS }) {
  const [dev, setDev] = useState({ inputs: [], outputs: [], labeled: true });
  const refresh = async () => setDev(await listDevices());
  useEffect(() => {
    refresh();
    const md = navigator.mediaDevices; if (md && md.addEventListener) md.addEventListener('devicechange', refresh);
    return () => { if (md && md.removeEventListener) md.removeEventListener('devicechange', refresh); };
  }, []);
  const allow = async () => { await unlockLabels(); refresh(); };
  const has = (list, id) => !id || list.some((d) => d.id === id);
  return (
    <Group title="Audio devices">
      <Row label="Microphone" description="Used by the mic button and Sentinel. Sentinel picks it up the next time it starts.">
        <Select value={s.micDeviceId || ''} onChange={(e) => { window.__micId = e.target.value; setS((x) => ({ ...x, micDeviceId: e.target.value })); }}>
          <option value="">System default</option>
          {!has(dev.inputs, s.micDeviceId) && <option value={s.micDeviceId}>Not connected (using the default)</option>}
          {dev.inputs.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
        </Select>
      </Row>
      <Row label="Speakers / headphones" description="Where Artemis’s voice plays. The built-in computer voice always uses the system output; Kokoro, Chatterbox and Piper follow this choice.">
        <Select value={s.speakerDeviceId || ''} onChange={(e) => { window.__speakerId = e.target.value; setS((x) => ({ ...x, speakerDeviceId: e.target.value })); }}>
          <option value="">System default</option>
          {!has(dev.outputs, s.speakerDeviceId) && <option value={s.speakerDeviceId}>Not connected (using the default)</option>}
          {dev.outputs.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
        </Select>
      </Row>
      <Row>
        <div className="pref-inline">
          <button type="button" className="pref-btn" onClick={refresh}>Refresh devices</button>
          {!dev.labeled && <button type="button" className="pref-btn" onClick={allow}>Show device names</button>}
        </div>
      </Row>
    </Group>
  );
}
/** One place to see and change what Artemis can reach: macOS permissions and the features it is allowed to use. */

const CB_DEFAULT_URL = 'http://localhost:8004';
const EMOTION_TEST = 'This is my normal voice, calm and even. [warm] And this is how I sound when something really matters to me.';
const PACING_TEST = 'Let me think about that for a moment. Does the pause after a question sound natural?\n\nA new paragraph gets a longer pause, just like this one.';

/**
 * The push-to-talk recorder: click, then press a combination (⌘ / ⌥ / ⌃, optionally ⇧, plus a key). Held modifiers show live;
 * a single key or a lone modifier is rejected with a hint. Esc cancels. Global shortcuts are paused while it records.
 */
function PttRecorder({ s, setS, pttError }) {
  const [rec, setRec] = useState(null); // null = not recording, else { mods, err }
  const recRef = useRef(false);
  useEffect(() => () => { if (recRef.current) pauseShortcuts(false); }, []);
  const combo = s.sentinelPtt || '';
  const legacy = !!combo && !pttComboOk(combo, IS_MAC);
  const onKeyDown = (e) => {
    if (e.key === 'Tab') return;
    e.preventDefault(); e.stopPropagation();
    if (e.key === 'Escape') return e.currentTarget.blur();
    const r = recordCombo(e, IS_MAC);
    if (r.combo) { setS((x) => ({ ...x, sentinelPtt: r.combo })); e.currentTarget.blur(); return; }
    setRec({ mods: r.mods, err: r.error });
  };
  const onKeyUp = (e) => { e.preventDefault(); const mods = heldMods(e); setRec((x) => (x ? { ...x, mods } : x)); };
  const shown = rec ? (rec.mods.length ? modsLabel(rec.mods) + ' …' : 'Press a combination…') : pttLabel(combo);
  return (
    <Row label="Push-to-talk shortcut"
      description={<>Talk to Sentinel without “Wake up”; it turns Sentinel on if needed. Click the box and press a combination: ⌘, ⌥ or ⌃ (optionally with ⇧) plus a key, e.g. ⌥ Space. Esc cancels.{' '}
        {!(rec && rec.err) && !legacy && combo ? 'In Artemis: hold it to talk, let go to send. From any app: press once to talk, again to send.' : null}</>}
      error={(rec && rec.err ? rec.err + '.' : legacy ? `“${pttLabel(combo)}” is a single key, not a combination: it can type text and does not work from other apps. It still works for now; record a combination to replace it (${PTT_COMBO_HINT}).` : '') + (pttError ? ' ' + pttError : '')}>
      <div className="pref-inline">
        <input readOnly data-ptt-recorder="" className={`pref-shortcut ${rec ? 'recording' : ''}`} value={shown} placeholder="Click to record" aria-label="Push-to-talk shortcut"
          onFocus={() => { recRef.current = true; pauseShortcuts(true); setRec({ mods: [], err: '' }); }}
          onBlur={() => { recRef.current = false; pauseShortcuts(false); setRec(null); }}
          onKeyDown={onKeyDown} onKeyUp={onKeyUp} />
        <button type="button" className="pref-btn" onClick={() => setS((x) => ({ ...x, sentinelPtt: '' }))} disabled={!combo} aria-label="Clear push-to-talk shortcut">Clear</button>
      </div>
    </Row>
  );
}

/** A slider with its value shown next to it. */
function Slider({ value, min, max, step, onChange, ...rest }) {
  return (
    <div className="pref-slider">
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} {...rest} />
      <output className="pref-slider-val">{Number(value).toFixed(2)}</output>
    </div>
  );
}
Slider.acceptsLabel = true;

/** Chatterbox settings: server, voice (from the server's list), emotion sliders. Kept apart from the Kokoro settings. */
function ChatterboxFields({ s, setS }) {
  const [list, setList] = useState({ voices: [], err: '', busy: false });
  const url = (s.cbUrl || '').trim() || CB_DEFAULT_URL;
  const refresh = async () => {
    setList((l) => ({ ...l, busy: true, err: '' }));
    try {
      const r = await window.api.voiceCbVoices(url);
      setList({ voices: (r && r.ok && r.voices) || [], err: r && r.ok ? '' : ((r && r.error) || 'Could not read the voices.'), busy: false });
    } catch (e) { setList({ voices: [], err: (e && e.message) || String(e), busy: false }); }
  };
  useEffect(() => { refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // sliders apply to the next piece at once (the renderer sends them with each request); address and voice once saved (a moment later)
  const set = (k, v) => setS((x) => { const n = { ...x, [k]: v }; window.__tts = ttsConfig(n); return n; });
  const voice = s.cbVoice || '';
  return (
    <>
      <Row stacked label="Chatterbox server address" description="Default http://localhost:8004 (Chatterbox-TTS-Server). Its API documentation is at <address>/docs.">
        <input value={s.cbUrl || ''} onChange={(e) => setS((x) => ({ ...x, cbUrl: e.target.value }))} placeholder={CB_DEFAULT_URL} spellCheck={false} />
      </Row>
      <Row label="Voice" description={list.err ? `Voices could not be loaded (${list.err}). Type a voice file name from the server's voices folder, e.g. Emily.wav.` : 'The voices from the server’s voices folder. Use “clone:<file>” for a reference audio file (voice cloning).'}>
        <div className="pref-inline">
          {list.voices.length ? (
            <Select value={voice} onChange={(e) => set('cbVoice', e.target.value)} aria-label="Chatterbox voice">
              <option value="">Server default (first voice)</option>
              {voice && !list.voices.some((v) => v.id === voice) && <option value={voice}>{voice}</option>}
              {list.voices.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </Select>
          ) : (
            <input className="pref-input" value={voice} onChange={(e) => set('cbVoice', e.target.value)} placeholder="Emily.wav" spellCheck={false} aria-label="Chatterbox voice" />
          )}
          <button type="button" className="pref-btn" onClick={refresh} disabled={list.busy}>{list.busy ? 'Loading…' : 'Refresh'}</button>
        </div>
      </Row>
      <Row label="Emotion (exaggeration)" description="0.25 flat · 0.5 natural · above 1 very expressive. Emotion tags in an answer use their own values for that sentence.">
        <Slider value={s.cbExaggeration ?? 0.5} min={0.25} max={2} step={0.05} onChange={(v) => set('cbExaggeration', v)} />
      </Row>
      <Row label="Pace / guidance (cfg weight)" description="Lower is slower and more deliberate, higher follows the voice more closely. Default 0.5.">
        <Slider value={s.cbCfg ?? 0.5} min={0} max={1} step={0.05} onChange={(v) => set('cbCfg', v)} />
      </Row>
      <Row label="Temperature" description="Variation between readings. Default 0.8.">
        <Slider value={s.cbTemperature ?? 0.8} min={0.1} max={1.5} step={0.05} onChange={(v) => set('cbTemperature', v)} />
      </Row>
      <Row label="Speed factor" description="Optional. 1 = as the model speaks; the Speed setting below is applied on top.">
        <Slider value={s.cbSpeed ?? 1} min={0.5} max={1.5} step={0.05} onChange={(v) => set('cbSpeed', v)} />
      </Row>
    </>
  );
}

const ENGINE_LABEL = { openai: 'Kokoro', chatterbox: 'Chatterbox', piper: 'Piper', system: 'Computer voice' };
const ENGINE_URL = { openai: 'http://localhost:8880', chatterbox: CB_DEFAULT_URL };

/**
 * Voices per language: for each language the engine that reads an answer in it (Default = the main engine above, with the
 * Kokoro voice for that language), an optional server address (e.g. a Piper server with a Turkish voice, or a second
 * Kokoro-compatible server) and the voice name. Stored as voiceLangMap; the older ttsVoices map is read as Default + voice.
 * `voices` (the installed computer voices) is passed so the rows update when macOS reports them.
 */
function LanguageVoices({ s, setS, engine, voices }) { // eslint-disable-line no-unused-vars
  const map = langMapFrom(s);
  const [piperList, setPiperList] = useState({}); // url -> { voices, err }
  const [testing, setTesting] = useState({}); // lang -> status text
  const [kept, setKept] = useState([]); // languages added here this session: they stay listed even when set back to Default
  const [open, setOpen] = useState({}); // lang -> edit area shown
  const setEntry = (l, patch) => setS((x) => {
    const cur = langMapFrom(x);
    const n = { ...x, voiceLangMap: { ...((x.voiceLangMap && typeof x.voiceLangMap === 'object') ? x.voiceLangMap : {}), [l]: normLangEntry({ ...(cur[l] || {}), ...patch }) } };
    window.__tts = ttsConfig(n); return n;
  });
  const main = { engine, voice: s.ttsVoice, voices: {} };
  const piperUrl = (e) => okUrl(e.url) || (engine === 'piper' ? okUrl(s.ttsUrl) || 'http://localhost:5000' : PIPER_LANG_URL);
  const loadPiper = async (url) => {
    try { const r = await window.api.voicePiperVoices(url); setPiperList((m) => ({ ...m, [url]: { voices: (r && r.ok && r.voices) || [], err: r && r.ok ? '' : ((r && r.error) || '') } })); }
    catch (err) { setPiperList((m) => ({ ...m, [url]: { voices: [], err: (err && err.message) || String(err) } })); }
  };
  useEffect(() => { // the official Piper server lists its voices; older servers do not (then the field stays free text)
    const urls = new Set(Object.values(map).filter((e) => e.engine === 'piper').map(piperUrl));
    for (const u of urls) if (!piperList[u] && window.api.voicePiperVoices) loadPiper(u);
  }, [JSON.stringify(s.voiceLangMap || {}), engine, s.ttsUrl]); // eslint-disable-line react-hooks/exhaustive-deps
  const test = (l) => {
    const text = VOICE_TEST_SAMPLES[l] || VOICE_TEST_SAMPLES.en;
    setTesting((m) => ({ ...m, [l]: 'Speaking…' }));
    let err = '';
    const ok = speak(text, { fixedLang: l, onError: (e) => { err = e; }, onEnd: () => setTesting((m) => ({ ...m, [l]: err ? `Failed, the computer voice was used: ${err}` : '' })) });
    if (!ok) setTesting((m) => ({ ...m, [l]: '' }));
  };
  const computer = (l) => { const v = pickVoice(l); return v ? v.name + (rankVoice(v) >= 35 ? ' (high quality)' : '') : 'no voice installed'; };
  const host = (u) => String(u || '').replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  // one muted line: "Piper · tr_TR-dfki-medium · localhost:5100"
  const summary = (l, e) => {
    const r = routeLang({ lang: l, main, map });
    const pre = e.engine === 'default' ? 'Default · ' : '';
    if (r.engine === 'system') return `${pre}Computer voice · ${computer(l)}${r.reason ? ' · ' + r.reason : ''}`;
    const where = r.url ? host(r.url) : r.engine === engine ? 'main server' : host(r.engine === 'piper' ? PIPER_LANG_URL : ENGINE_URL[r.engine]);
    const v = r.voice || (r.engine === 'piper' && r.key === 'main' ? (s.ttsVoiceEn || 'server default') : r.engine === 'chatterbox' ? (s.cbVoice || 'server default') : 'server default');
    return `${pre}${ENGINE_LABEL[r.engine]} · ${v} · ${where}`;
  };
  const custom = (e) => !!e && (e.engine !== 'default' || !!e.voice || !!e.url);
  const all = VOICE_LANGS.slice(1).map(([l]) => l);
  const listed = all.filter((l) => custom(map[l]) || kept.includes(l));
  const rest = all.filter((l) => !listed.includes(l));
  const firstEngine = (l) => (l === 'tr' || l === 'az' ? 'piper' : l in KOKORO_VOICES ? 'openai' : 'system');
  const add = (l) => {
    if (!l) return;
    setKept((k) => (k.includes(l) ? k : [...k, l]));
    setOpen((o) => ({ ...o, [l]: firstEngine(l) !== 'system' }));
    setEntry(l, { engine: firstEngine(l) });
  };
  const remove = (l) => {
    setKept((k) => k.filter((x) => x !== l));
    setOpen((o) => ({ ...o, [l]: false }));
    setTesting((m) => ({ ...m, [l]: '' }));
    setEntry(l, { engine: 'default', url: '', voice: '' });
  };
  // the footer: how every language that is not listed is read
  const names = (ls) => { const n = ls.map(langName); return n.length < 2 ? n.join('') : n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1]; };
  const others = (() => {
    const by = {};
    let en = '';
    for (const l of rest) {
      const r = routeLang({ lang: l, main, map });
      if (l === 'en') { en = r.engine === 'system' ? 'the computer voice' : ENGINE_LABEL[r.engine]; continue; }
      (by[r.engine] = by[r.engine] || []).push(l);
    }
    const parts = [];
    if (en) parts.push(`English uses ${en}`);
    for (const [eng, ls] of Object.entries(by)) {
      if (eng === 'system') continue;
      parts.push(`${names(ls)} ${ls.length > 1 ? 'use' : 'uses'} ${ENGINE_LABEL[eng]}${eng === 'openai' ? ' voices' : ''}`);
    }
    const sys = by.system || [];
    if (sys.length) {
      const inst = sys.filter((l) => pickVoice(l));
      const lead = parts.length ? 'the rest' : names(sys);
      parts.push(`${lead} ${parts.length || sys.length > 1 ? 'use' : 'uses'} the computer voice (installed: ${inst.length ? names(inst) : 'none'})`);
    }
    if (!parts.length) return '';
    const txt = parts.length < 2 ? parts[0] : parts.slice(0, -1).join('; ') + '; ' + parts[parts.length - 1];
    return `${listed.length ? 'Other languages' : 'Languages'}: ${txt}.`;
  })();
  const footer = <>{others}{others ? ' ' : ''}If a language’s engine fails, the computer voice reads it. Better computer voices on a Mac: System Settings → Accessibility → Spoken Content → System Voice → Manage Voices (then restart Artemis).</>;
  return (
    <Group title="Voices per language" className="pref-langvoices" footer={footer}>
      {listed.length === 0 && (
        <div className="pref-row pref-lang-empty"><div className="pref-row-label">All languages use the default routing.</div><div className="pref-row-desc">Add a language to give it its own engine, server or voice.</div></div>
      )}
      {listed.map((l) => {
        const e = map[l] || normLangEntry(null);
        const name = langName(l);
        const server = e.engine === 'openai' || e.engine === 'piper' || e.engine === 'chatterbox';
        const pl = e.engine === 'piper' ? piperList[piperUrl(e)] : null;
        const urlPh = e.engine === 'piper' ? (engine === 'piper' ? (s.ttsUrl || 'http://localhost:5000') : PIPER_LANG_URL) : (e.engine === engine && s.ttsUrl && e.engine !== 'chatterbox' ? s.ttsUrl : e.engine === 'chatterbox' ? (s.cbUrl || CB_DEFAULT_URL) : ENGINE_URL[e.engine]);
        const voicePh = e.engine === 'piper' ? (PIPER_VOICES[l] || 'voice model name') : e.engine === 'chatterbox' ? (s.cbVoice || 'Emily.wav') : e.engine === 'openai' ? (l === 'en' ? (s.ttsVoice || 'af_heart') : (KOKORO_VOICES[l] || 'voice name')) : (kokoroVoiceFits(s.ttsVoice, l) ? s.ttsVoice : KOKORO_VOICES[l] || '');
        const showDefaultVoice = e.engine === 'default' && engine === 'openai' && l !== 'en' && l in KOKORO_VOICES;
        const editable = server || showDefaultVoice;
        const urlBad = server && e.url && !okUrl(e.url);
        const listId = `piper-voices-${l}`;
        const editId = `lang-edit-${l}`;
        const isOpen = editable && !!open[l];
        const note = LANG_NOTES[l] && e.engine !== 'piper' ? LANG_NOTES[l] : '';
        return (
          <Row key={l} label={name} className="pref-lang-row"
            description={<><span className="pref-lang-sum">{summary(l, e)}</span>{testing[l] ? <span className="pref-lang-status" role="status">{testing[l]}</span> : null}</>}
            error={urlBad ? 'The address must start with http:// or https://' : ''}
            below={isOpen && (
              <div className="pref-lang-edit" id={editId}>
                <div className="pref-inline wrap grow">
                  {server && <input className="pref-input" value={e.url} placeholder={urlPh} onChange={(ev) => setEntry(l, { url: ev.target.value })} spellCheck={false} aria-label={`${name} server address (optional)`} aria-invalid={urlBad ? 'true' : undefined} />}
                  <input className="pref-input" value={e.voice} placeholder={voicePh} list={pl && pl.voices.length ? listId : undefined} onChange={(ev) => setEntry(l, { voice: ev.target.value })} spellCheck={false} aria-label={`${name} voice name`} />
                  {pl && pl.voices.length ? <datalist id={listId}>{pl.voices.map((v) => <option key={v} value={v} />)}</datalist> : null}
                  {e.engine === 'piper' && <button type="button" className="pref-btn" onClick={() => loadPiper(piperUrl(e))} title={pl && pl.err ? pl.err : 'Read the voices the Piper server lists'}>{pl && pl.voices.length ? `${pl.voices.length} voices` : 'List voices'}</button>}
                </div>
                <div className="pref-lang-hint">Leave a field empty to use the address or voice shown in grey.{note ? ' ' + note : ''}</div>
              </div>
            )}>
            <div className="pref-inline">
              {editable && (
                <button type="button" className={`pref-btn pref-lang-toggle ${isOpen ? 'open' : ''}`} aria-expanded={isOpen} aria-controls={isOpen ? editId : undefined}
                  aria-label={`Edit ${name} server and voice`} onClick={() => setOpen((o) => ({ ...o, [l]: !o[l] }))}>
                  Edit<Icon name="chevronDown" size={12} />
                </button>
              )}
              <Select value={e.engine} onChange={(ev) => setEntry(l, { engine: ev.target.value })} aria-label={`Engine for ${name}`}>
                {LANG_ENGINES.map(([id, n]) => <option key={id} value={id}>{id === 'default' ? `Default (${ENGINE_LABEL[engine] || 'computer voice'})` : n}</option>)}
              </Select>
              <button type="button" className="pref-btn" onClick={() => test(l)} title={`Speaks a short ${name} sentence with this engine`} aria-label={`Test ${name} voice`}>Test</button>
              <button type="button" className="pref-icon-btn" onClick={() => remove(l)} title="Remove (use the default routing)" aria-label={`Remove ${name}, use the default routing`}>
                <Icon name="x" size={14} />
              </button>
            </div>
          </Row>
        );
      })}
      {rest.length > 0 && (
        <div className="pref-lang-add">
          <Select value="" onChange={(ev) => add(ev.target.value)} placeholder="+ Add language" aria-label="Add a language with its own voice" className="pref-lang-add-sel">
            {rest.map((l) => <option key={l} value={l}>{langName(l)}</option>)}
          </Select>
        </div>
      )}
    </Group>
  );
}

export function VoiceTab({ s, setS, providers, chatGroups = [], pttError = '' }) {
  const sel = s.voiceSttProvider || '';
  const [model, setModel] = useState(null);
  const [voices, setVoices] = useState(() => listVoices());
  const [lat, setLat] = useState('');
  // Time from pressing the button to the first sound: what you wait for before every spoken answer.
  const testLatency = () => {
    setLat('Measuring…');
    let err = '';
    const ok = speak('This is how fast I start talking.', { language: 'auto', onError: (e) => { err = e; }, onFirstAudio: (ms) => setLat(`First audio after ${ms} ms${err ? ' (computer voice: ' + err + ')' : ''}`) });
    if (!ok) setLat('Nothing to read.');
  };
  useEffect(() => { window.api.sentinelStatus().then(setModel).catch(() => {}); const f = () => setVoices(listVoices()); try { speechSynthesis.addEventListener('voiceschanged', f); } catch {} return () => { try { speechSynthesis.removeEventListener('voiceschanged', f); } catch {} }; }, []);
  const engine = s.ttsEngine || 'system';
  const sentinelKey = formatAccelerator(s.sentinelShortcut ?? 'CommandOrControl+Shift+A', IS_MAC);
  return (
    <>
      <Group title="Dictation" footer="Press the mic button next to the message box, speak, press it again and your words are typed for you. With Auto-detect you can speak any language.">
        <Row label="Speech-to-text provider" description="Needs an endpoint that supports /audio/transcriptions (Whisper). OpenAI and Groq do. Add one under Providers first, then pick it here.">
          <Select value={sel} onChange={(e) => setS((x) => ({ ...x, voiceSttProvider: e.target.value }))}>
            <option value="">None</option>
            {providers.filter((p) => p.enabled !== false).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Row>
        <Row label="Speech-to-text model" description="OpenAI: whisper-1 or gpt-4o-mini-transcribe. Groq: whisper-large-v3-turbo.">
          <ModelSelect value={s.voiceSttModel || ''} options={STT_MODELS} onChange={(v) => setS((x) => ({ ...x, voiceSttModel: v }))} />
        </Row>
        <Row label="Language" description="Auto-detect hears which language you speak; Sentinel then answers in that language and reads the answer with a voice for it. Pick one language only if short sentences get misheard.">
          <Select value={LANGS.some(([id]) => id === s.voiceLanguage) ? s.voiceLanguage : 'auto'} onChange={(e) => setS((x) => ({ ...x, voiceLanguage: e.target.value }))}>
            {LANGS.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
          </Select>
        </Row>
        {s.voiceLanguage && s.voiceLanguage !== 'auto' && (
          <Row description={`Set to ${langName(s.voiceLanguage) || s.voiceLanguage}: everything you say is transcribed as ${langName(s.voiceLanguage) || 'that language'}, so speaking another language gives wrong text. Auto-detect (recommended) lets you speak any language and get the answer in it.`}>
            <button type="button" className="pref-btn" onClick={() => setS((x) => ({ ...x, voiceLanguage: 'auto' }))}>Use Auto-detect</button>
          </Row>
        )}
        <SwitchRow label="Read replies aloud automatically" description="Uses the reading voice below. You can also press the speaker button under any reply."
          checked={!!s.voiceAutoRead} onChange={(v) => setS((x) => ({ ...x, voiceAutoRead: v }))} />
      </Group>
      <Group title="Reading voice" footer={engine === 'chatterbox' ? 'Chatterbox makes each sentence as a whole file (no streaming), so the first words come a little later than with Kokoro.' : engine !== 'system' ? 'Server settings are saved as you type; press Test voice to hear them.' : null}>
        <Row label="Voice engine" description="Computer voices work offline but sound robotic. A local voice server sounds far more natural and still runs only on your Mac: Kokoro is fast (streamed), Chatterbox is slower but expressive (emotion), Piper is light. Each engine keeps its own settings. If the server is not running, Artemis falls back to the computer voice.">
          <Select value={engine} onChange={(e) => { const v = e.target.value; setS((x) => { const n = { ...x, ttsEngine: v }; window.__tts = ttsConfig(n); return n; }); }}>
            <option value="system">Computer voice (built in)</option>
            <option value="openai">Kokoro (local server, OpenAI-compatible)</option>
            <option value="chatterbox">Chatterbox (local server, emotional)</option>
            <option value="piper">Piper (local server)</option>
          </Select>
        </Row>
        {engine === 'chatterbox' && <ChatterboxFields s={s} setS={setS} />}
        {(engine === 'openai' || engine === 'piper') && (
          <>
            <Row stacked label="Server address" description={engine === 'piper' ? 'Default http://localhost:5000. Start it with: python3 -m piper.http_server -m <voice>' : 'Default http://localhost:8880 (Kokoro-FastAPI). Anything that serves /v1/audio/speech works.'}>
              <input value={s.ttsUrl || ''} onChange={(e) => setS((x) => ({ ...x, ttsUrl: e.target.value }))} placeholder={engine === 'piper' ? 'http://localhost:5000' : 'http://localhost:8880'} spellCheck={false} />
            </Row>
            {engine === 'openai' && <Row label="Model"><ModelSelect value={s.ttsModel || ''} options={TTS_MODELS} onChange={(v) => setS((x) => ({ ...x, ttsModel: v }))} /></Row>}
            {engine === 'openai' && ((s.cbUrl || '').trim()
              ? <SwitchRow label="Emotional sentences with Chatterbox" description={`Normal sentences stay on fast Kokoro; sentences the model marks as emotional are made by Chatterbox (${s.cbUrl.trim()}). If Chatterbox fails or needs more than 8 s, Kokoro reads that sentence.`}
                  checked={!!s.cbHybrid} onChange={(v) => setS((x) => { const n = { ...x, cbHybrid: v }; window.__tts = ttsConfig(n); return n; })} />
              : <Row description="To mix in emotional sentences from Chatterbox, pick Chatterbox above once and set its address, then come back to Kokoro." />)}
            {engine === 'openai' && <SwitchRow label="Streaming voice (faster start)" description="Audio plays while the server is still making it, and the next sentence is made while one plays. Turn off only if your server does not support streamed PCM."
              checked={s.ttsStream !== false} onChange={(v) => { window.__tts = { ...(window.__tts || {}), stream: v }; setS((x) => ({ ...x, ttsStream: v })); }} />}
            {engine === 'piper' ? (
              <Row label="English voice" description="e.g. en_US-lessac-medium or en_GB-alba-medium."><input value={s.ttsVoiceEn || ''} onChange={(e) => setS((x) => ({ ...x, ttsVoiceEn: e.target.value }))} placeholder="en_US-lessac-medium" spellCheck={false} /></Row>
            ) : (
              <Row label="Voice name" description="Kokoro: af_heart, af_bella, am_michael, bf_emma … Used for English; other languages: Voices per language below.">
                <input value={s.ttsVoice || ''} onChange={(e) => setS((x) => ({ ...x, ttsVoice: e.target.value }))} placeholder="af_heart" spellCheck={false} />
              </Row>
            )}
          </>
        )}
        <Row label="Computer voice" description="Automatic picks the nicest voice installed for the language of the reply. For much better quality on a Mac: System Settings → Accessibility → Spoken Content → System Voice → Manage Voices, then download a Premium or Enhanced voice. It shows up here after you restart Artemis.">
          <Select value={s.voiceName || ''} onChange={(e) => { window.__voiceName = e.target.value; setS((x) => ({ ...x, voiceName: e.target.value })); }}>
            <option value="">Automatic (best available)</option>
            {voices.map((v) => <option key={v.name + v.lang} value={v.name}>{v.name} · {v.lang}{rankVoice(v) >= 35 ? ' · high quality' : ''}</option>)}
          </Select>
        </Row>
        <Row label="Speed">
          <Select value={String(s.voiceRate || 1)} onChange={(e) => { window.__voiceRate = Number(e.target.value); setS((x) => ({ ...x, voiceRate: Number(e.target.value) })); }}>
            <option value="0.9">Slower</option><option value="1">Normal</option><option value="1.1">Faster</option><option value="1.25">Fast</option>
          </Select>
        </Row>
        <Row label="Natural pacing" description="Short pauses between sentences, longer after a question or a paragraph, slightly varied so it does not sound mechanical. Expressive pauses longer and varies the speed a little from sentence to sentence.">
          <Select value={s.voicePacing === 'off' || s.voicePacing === 'expressive' ? s.voicePacing : 'subtle'} onChange={(e) => { const v = e.target.value; setS((x) => { const n = { ...x, voicePacing: v }; window.__tts = ttsConfig(n); return n; }); }}>
            <option value="off">Off</option><option value="subtle">Subtle</option><option value="expressive">Expressive</option>
          </Select>
        </Row>
        <SwitchRow label="Thinking out loud" description="When answers are read aloud (Sentinel or automatic reading), the model may start a reflective answer with “Hmm,” or “Well,” and use “…” for a brief pause, once or twice per answer at most. These words also appear in the chat."
          checked={s.voiceThinkingSounds === true} onChange={(v) => setS((x) => ({ ...x, voiceThinkingSounds: v }))} />
        <Row stacked label="Try it" description={lat ? <span role="status">{lat}</span> : null}>
          <div className="pref-inline wrap">
            <button type="button" className="pref-btn" onClick={() => speak('Hello, this is how I sound.', { language: 'auto' })}>Test voice</button>
            <button type="button" className="pref-btn" onClick={testLatency}>Test latency</button>
            <button type="button" className="pref-btn" title="Speaks one neutral and one warm sentence" onClick={() => speak(EMOTION_TEST, { language: 'auto' })}>Test emotion</button>
            <button type="button" className="pref-btn" title="Reads three sentences with a question and a paragraph break" onClick={() => speak(PACING_TEST, { language: 'auto' })}>Test natural pacing</button>
            <button type="button" className="pref-btn" onClick={() => { stopSpeaking(); setLat(''); }}>Stop</button>
          </div>
        </Row>
      </Group>
      <LanguageVoices s={s} setS={setS} engine={engine} voices={voices} />
      <AudioDevices s={s} setS={setS} />
      <Group title="Sentinel mode" footer={<>Turn it on with the shield button next to the mic{sentinelKey ? ` (or ${sentinelKey} from any app)` : ''}. Artemis then listens for the phrase “Wake up”, like “Hey Siri”. The phrase is recognised on your computer by a small offline model, without AI or internet. After you say it, Artemis keeps listening: it answers in the chat, reads the answer aloud and waits for your next sentence, until you say “bye bye” or stay silent for 10 seconds. Your sentence is transcribed with the speech-to-text provider above.</>}>
        <SwitchRow label="Start Sentinel when Artemis opens" description="Needs the voice model below. The microphone stays on while Sentinel is on."
          checked={!!s.sentinelAuto} onChange={(v) => setS((x) => ({ ...x, sentinelAuto: v }))} />
        <SwitchRow label="Only react when I say “Artemis”" description="Inside a conversation, a sentence counts only if it starts with “Artemis” or follows Artemis' answer within a few seconds. Other people talking nearby, or you talking to someone else, is ignored."
          checked={s.sentinelNameOnly !== false} onChange={(v) => setS((x) => ({ ...x, sentinelNameOnly: v }))} />
        <PttRecorder s={s} setS={setS} pttError={pttError} />
        <SwitchRow label="Push-to-talk only" description="Sentinel listens only while you use the push-to-talk key: it does not wait for “Wake up” and does not keep listening after it answers."
          error={s.sentinelPttOnly === true && !s.sentinelPtt ? 'Set a push-to-talk shortcut above first, otherwise there is no way to talk to it.' : ''}
          checked={s.sentinelPttOnly === true} onChange={(v) => setS((x) => ({ ...x, sentinelPttOnly: v }))} />
        <Row label="Microphone sensitivity" description="Lower it if voices from further away or from other people are picked up. Speak closer to the microphone, or use headphones.">
          <Select value={s.sentinelSensitivity || 'normal'} onChange={(e) => setS((x) => ({ ...x, sentinelSensitivity: e.target.value }))}>
            <option value="high">High (quiet room)</option><option value="normal">Normal</option><option value="low">Low (noisy room, speak close)</option>
          </Select>
        </Row>
        <SwitchRow label="Load the voice model in the background" description="Makes turning Sentinel on instant, but uses a lot of CPU and memory for a minute after Artemis opens. Leave off if your computer slows down."
          checked={s.sentinelPreload === true} onChange={(v) => setS((x) => ({ ...x, sentinelPreload: v }))} />
        <SwitchRow label="Interrupt by talking" description="Start talking while Artemis is speaking and it stops. Best with headphones; off by default because other voices can cut it off."
          checked={s.sentinelInterrupt === true} onChange={(v) => setS((x) => ({ ...x, sentinelInterrupt: v }))} />
        <SwitchRow label="Stop words" description="Say “stop”, “enough” or “be quiet” while Artemis is thinking or speaking to cancel it. Off by default: room noise can be mistaken for a stop word and cancel an answer. Push-to-talk always interrupts."
          checked={s.sentinelStopWords === true} onChange={(v) => setS((x) => ({ ...x, sentinelStopWords: v }))} />
        <SwitchRow label="Hide the widget while Artemis is open" description="The floating Sentinel widget disappears when the Artemis window is in front and comes back when you switch to another app or minimize it."
          checked={s.sentinelHideInApp === true} onChange={(v) => setS((x) => ({ ...x, sentinelHideInApp: v }))} />
        <Row label="Sentinel model" description="Voice answers start sooner with a small, fast model. Sentinel chats use it instead of the default model; short spoken answers rarely need a big one.">
          <Select value={s.sentinelModel || ''} onChange={(e) => setS((x) => ({ ...x, sentinelModel: e.target.value }))}>
            <option value="">Same as the default model</option>
            {chatGroups.map((g) => <optgroup key={g.label} label={g.label}>{g.items.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</optgroup>)}
          </Select>
        </Row>
        <Row label="Voice model" description={model ? (model.ready ? `Installed (${Math.round(model.size / 1048576)} MB).` : 'Not downloaded yet (about 40 MB, downloaded the first time you turn Sentinel on).') : 'Checking…'}>
          {model && model.ready ? <button type="button" className="pref-btn" onClick={async () => { await window.api.sentinelDelete(); dropSentinelModel(); setModel(await window.api.sentinelStatus()); }}>Remove</button> : null}
        </Row>
      </Group>
    </>
  );
}
