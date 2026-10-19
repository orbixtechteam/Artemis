// Voice helpers for the renderer: record from the microphone, send to speech-to-text, read replies aloud.
import { speakable, chunkText, chunkPieces } from './sentinel-core.mjs';
import { parseTag, cbParams, plainAdjust } from './tts-emotion.mjs';
import { pacingMode, pauseAfter, pauseBefore, paceRate } from './tts-pacing.mjs';
import { createPcmDecoder, fade, PCM_RATE } from './pcm.mjs';
import { openMic } from './audio-devices.js';
import { log } from './log.js';
import { VOICE_LANGS, detectTextLang, routeLang, langMapFrom, baseLang, langName } from './lang.mjs';
const api = window.api;

export const LANGS = VOICE_LANGS;

/** Records the microphone. Returns { stop() -> Blob, cancel(), stream } */
export async function startRecording() {
  if (api.voicePermission) {
    const st = await api.voicePermission();
    if (st === 'denied' || st === 'restricted') throw new Error('Microphone access is blocked. Allow Artemis in System Settings → Privacy & Security → Microphone, then try again.');
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('This computer has no microphone available to Artemis.');
  let stream;
  try { stream = await openMic({ echoCancellation: true, noiseSuppression: true }); }
  catch (e) { throw new Error(/denied|permission/i.test(String(e && e.message)) || (e && e.name === 'NotAllowedError') ? 'Microphone access was denied. Allow Artemis in System Settings → Privacy & Security → Microphone.' : 'Could not open the microphone: ' + ((e && e.message) || e)); }
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const release = () => stream.getTracks().forEach((t) => t.stop());
  rec.start(250);
  return {
    stream,
    stop: () => new Promise((resolve) => { rec.onstop = () => { release(); resolve(new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' })); }; try { rec.stop(); } catch { release(); resolve(new Blob([])); } }),
    cancel: () => { rec.onstop = null; try { rec.stop(); } catch {} release(); }
  };
}

export async function transcribe(blob, language) {
  if (!blob || blob.size < 800) return { ok: false, error: 'Nothing was recorded. Hold on a little longer and speak closer to the microphone.' };
  const audio = new Uint8Array(await blob.arrayBuffer());
  return api.voiceTranscribe({ audio, mime: blob.type, language: language && language !== 'auto' ? language : '' });
}

// ---- read aloud (system voices, works offline) ----
/** The language of a text for the computer voice ('en' when unclear). */
export const detectLang = (text) => detectTextLang(text) || 'en';
// Computer-voice locales per language, best first. macOS has no Azerbaijani voice: a Turkish one is closest.
const LOCALE = { en: ['en'], az: ['az', 'tr'], zh: ['zh', 'yue'], nb: ['nb', 'no'] };
const NOVELTY = /^(albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|fred|junior|kathy|ralph|agnes|princess|bruce|hysterical|pipe organ)\b/i;
/** Higher is nicer: premium/enhanced/natural voices first, novelty voices last. */
export function rankVoice(v) {
  const n = String(v.name || '');
  let r = 0;
  if (/premium/i.test(n)) r += 60;
  if (/enhanced|improved/i.test(n)) r += 45;
  if (/siri|natural|neural|online/i.test(n)) r += 35;
  if (v.localService) r += 8;
  if (NOVELTY.test(n)) r -= 200;
  return r;
}
export const listVoices = () => ((window.speechSynthesis && speechSynthesis.getVoices()) || []).slice().sort((a, b) => a.lang.localeCompare(b.lang) || rankVoice(b) - rankVoice(a) || a.name.localeCompare(b.name));
/**
 * The computer voice for a language: the voice chosen in Settings when it speaks that language (or the language is unknown),
 * else the nicest installed voice for it (e.g. Turkish: Yelda). null when none is installed.
 */
export function pickVoice(lang) {
  const voices = (window.speechSynthesis && speechSynthesis.getVoices()) || [];
  const L = baseLang(lang);
  const chosen = window.__voiceName && voices.find((x) => x.name === window.__voiceName);
  if (chosen && (!L || baseLang(chosen.lang) === L)) return chosen;
  for (const l of LOCALE[L] || (L ? [L] : ['en'])) {
    const best = voices.filter((x) => x.lang && x.lang.toLowerCase().startsWith(l)).sort((a, b) => rankVoice(b) - rankVoice(a))[0];
    if (best) return best;
  }
  return null;
}
export { speakable, chunkText, chunkPieces };
/** What the reader needs from the settings (window.__tts): engine, streaming, and the Chatterbox sliders / hybrid option. */
export function ttsConfig(st) {
  const s = st || {};
  const engine = s.ttsEngine || 'system';
  return {
    engine, stream: s.ttsStream !== false, pacing: pacingMode(s.voicePacing),
    hybrid: engine === 'openai' && !!s.cbHybrid && !!String(s.cbUrl || '').trim(),
    cb: { exaggeration: s.cbExaggeration, cfg: s.cbCfg, temperature: s.cbTemperature, speed: s.cbSpeed },
    voice: s.ttsVoice || '', voices: {}, // Kokoro: the chosen voice (per-language voices are in langMap)
    langMap: langMapFrom(s) // engine / server / voice per reply language (Settings → Voice → Voices per language)
  };
}
const clampRate = (v) => Math.min(1.6, Math.max(0.6, Number(v) || 1));
const errText = (e) => (e && e.message) || String(e);

// ---------- One audio timeline for the server voice (Kokoro, Chatterbox, Piper) ----------
// Every piece, streamed PCM or a whole file, is scheduled on one shared AudioContext right after the previous one, so
// the pieces play back to back without gaps. Stopping fades out within a few ms and cancels the server requests.
let ctx = null; let ctxSink = ''; let master = null; let nextTime = 0;
const live = new Set();     // scheduled sources, stopped at once by stopSpeaking
const pcmReqs = new Map();  // id -> streamed request that is still receiving
const fileReqs = new Set(); // ids of whole-file requests still running
let reqSeq = 0; let pcmListening = false; let serverRun = 0; let current = null;
const noStream = new Map(); // server key -> time until which it gets whole files (it refused a streamed request)
const SERVER_ENGINES = ['openai', 'piper', 'chatterbox'];
/** Streaming is only for Kokoro-type servers; Piper and Chatterbox make whole files. */
// Raw PCM has no header, so only the main Kokoro server (24 kHz) is streamed; another OpenAI-compatible server set for a language
// (e.g. an Edge TTS bridge) sends WAV, whose header carries its own sample rate.
const streamable = (it) => { const t = window.__tts || {}; return !!it && it.route.engine === 'openai' && !it.route.url && t.stream !== false && !!api.voiceStream && !!api.onVoicePcm && Date.now() > (noStream.get(it.key) || 0); };
const useServer = () => { const t = window.__tts || {}; return SERVER_ENGINES.includes(t.engine) || Object.values(t.langMap || {}).some((e) => e && SERVER_ENGINES.includes(e.engine)); };
/** What the main process needs for one piece: its engine, server (empty = the main engine's address) and voice. */
const reqOpts = (it) => { const r = it.route || {}; return { engine: r.engine, url: r.url || undefined, voice: r.voice || undefined }; };
const ENGINE_NAME = { openai: 'Kokoro', piper: 'Piper', chatterbox: 'Chatterbox' };
// Hybrid (Kokoro + Chatterbox): a tagged piece that Chatterbox has not made within this time is read by Kokoro instead.
const HYBRID_WAIT_MS = 8000;

function audio() {
  if (!ctx || ctx.state === 'closed') {
    ctx = new AudioContext({ sampleRate: PCM_RATE, latencyHint: 'interactive' });
    master = ctx.createGain(); master.connect(ctx.destination); ctxSink = ''; nextTime = 0;
    const c0 = ctx; ctx.onstatechange = () => { log('info', 'voice', 'Audio output ' + c0.state); if (c0.state === 'suspended' && live.size) c0.resume().catch(() => {}); };
  }
  const id = window.__speakerId || '';
  if (ctx.setSinkId && id !== ctxSink) { ctxSink = id; ctx.setSinkId(id).catch(() => {}); }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}
/** A short silence before the next piece (an emotionally tagged sentence on a voice without emotion settings). */
function gap(sec) { const c = audio(); nextTime = Math.max(nextTime, c.currentTime + 0.03) + sec; }
/**
 * Natural pacing: a silence of `sec` after the end of the previous piece. If that piece already ended a while ago (the server
 * was slow), the silence that already passed counts, so the pause is never longer than asked.
 */
function pace(sec) { const c = audio(); nextTime = Math.max(nextTime + sec, c.currentTime + 0.03); }
// Pauses between computer-voice utterances (natural pacing): stopSpeaking ends them at once.
const waits = new Set();
const sleep = (ms) => new Promise((res) => { const w = { res, id: 0 }; w.id = setTimeout(() => { waits.delete(w); res(); }, ms); waits.add(w); });
/** Plays a buffer right after what is already scheduled (or 30 ms from now when nothing is). Returns its start time. */
function schedule(buf) {
  const c = audio();
  const src = c.createBufferSource(); src.buffer = buf; src.connect(master);
  const t = Math.max(nextTime, c.currentTime + 0.03);
  src.start(t); nextTime = t + buf.duration;
  live.add(src); src.onended = () => live.delete(src);
  return t;
}
function stopAudio() {
  if (!ctx || !master) return;
  const now = ctx.currentTime; const g = master;
  try { g.gain.cancelScheduledValues(now); g.gain.setValueAtTime(g.gain.value, now); g.gain.linearRampToValueAtTime(0, now + 0.012); } catch {}
  for (const src of live) { try { src.stop(now + 0.015); } catch {} }
  live.clear();
  master = ctx.createGain(); master.connect(ctx.destination); // what plays next is not muted by this fade
  setTimeout(() => { try { g.disconnect(); } catch {} }, 100);
  nextTime = 0;
}
/** Resolves when everything scheduled has been heard (or the run was stopped). */
const drain = (alive) => new Promise((res) => {
  const tick = () => { if (!alive() || !ctx) return res(); const left = nextTime - ctx.currentTime; if (left <= 0.005) return res(); setTimeout(tick, Math.min(250, left * 1000 + 10)); };
  tick();
});

/** Starts making one piece on the server as streamed PCM. Chunks collect in r.chunks as they arrive (also while an earlier piece plays). */
function pcmRequest(text, rate, onDone, opts) {
  if (!pcmListening) {
    pcmListening = true;
    api.onVoicePcm(({ id, data, end, bytes }) => {
      const r = pcmReqs.get(id); if (!r) return;
      if (end) { r.endSeen = true; r.total = bytes; r.check(); return; }
      if (!r.firstAt) r.firstAt = performance.now();
      r.got += data.length; r.chunks.push(data); r.poke(); r.check();
    });
  }
  const id = 'p' + (++reqSeq);
  const r = { id, chunks: [], got: 0, total: -1, endSeen: false, res: null, done: false, error: '', status: 0, sentAt: performance.now(), firstAt: 0, wake: null, poke() { const w = this.wake; this.wake = null; if (w) w(); }, check() {} };
  pcmReqs.set(id, r);
  let grace = null;
  const finish = () => {
    if (r.done) return;
    clearTimeout(grace);
    r.done = true; pcmReqs.delete(id);
    const res = r.res;
    if (!res || !res.ok) { r.error = (res && res.error) || 'The voice server failed.'; r.status = (res && res.status) || 0; }
    else if (r.got < (res.bytes || 0)) log('warn', 'voice', `Voice piece lost audio: got ${r.got} of ${res.bytes} bytes`);
    r.poke(); onDone?.();
  };
  // Finished when the reply is in AND every byte it reports has arrived (or the end marker came); a short grace period covers a lost marker.
  r.check = () => { if (r.res && (!r.res.ok || r.endSeen || r.got >= (r.res.bytes || 0))) finish(); };
  const end = (res) => {
    if (r.done || r.res) return;
    r.res = res || { ok: false };
    r.check();
    if (!r.done) grace = setTimeout(finish, 2000);
  };
  api.voiceStream({ id, text, speed: rate, ...(opts || {}) }).then(end).catch((e) => end({ ok: false, error: errText(e) }));
  return r;
}
/** Starts making one piece as a whole file (Piper, Chatterbox, or a server without streaming). extra = { engine, url, voice, cb }. */
function fileRequest(text, rate, onDone, extra) {
  const id = 'w' + (++reqSeq); fileReqs.add(id);
  const r = { id, done: false, sentAt: performance.now(), firstAt: 0 };
  r.promise = Promise.resolve().then(() => api.voiceSpeak({ id, text, speed: rate, ...(extra || {}) })).catch((e) => ({ ok: false, error: errText(e) }))
    .then((res) => { r.done = true; r.firstAt = performance.now(); fileReqs.delete(id); onDone?.(); return res; });
  return r;
}

export function stopSpeaking() {
  serverRun++;
  if (live.size || pcmReqs.size) log('info', 'voice', 'Speech stopped');
  for (const r of pcmReqs.values()) { try { api.voiceStreamCancel(r.id).catch(() => {}); } catch {} r.done = true; r.error = 'Stopped.'; r.poke(); }
  pcmReqs.clear();
  for (const id of fileReqs) { try { api.voiceStreamCancel(id).catch(() => {}); } catch {} }
  fileReqs.clear();
  stopAudio();
  for (const w of waits) { clearTimeout(w.id); w.res(); }
  waits.clear();
  try { speechSynthesis.cancel(); } catch {}
  if (current) { const c = current; current = null; c.onend?.(); }
}

/** Get the voice ready before there is anything to say (the audio output, and the server's model), e.g. while the model is still thinking. */
// Who started the voice: the Logs name the caller and the first words, so an unexpected reading can be traced (Settings → Logs, source "voice").
const callerOf = () => { try { return String(new Error().stack || '').split('\n').slice(3, 7).map((l) => l.trim().replace(/^at\s+/, '').replace(/\(?(?:file|app|http)[^)]*\/([^/)]+)\)?$/, '$1')).join(' < '); } catch { return ''; } };
export function prepareVoice() {
  log('info', 'voice', 'Voice prepared (warming the voice server) by: ' + callerOf());
  if (!useServer()) return;
  try { audio(); } catch {}
  try { api.voiceWarm && api.voiceWarm().catch(() => {}); } catch {}
}

// Server requests in flight at once. A local voice server (Kokoro on the CPU) makes two pieces at once at half the speed each,
// which delays the first words; one at a time, with the next one started as soon as the previous one is made, keeps ahead of playback.
const AHEAD = 1;

/**
 * Reads text as it arrives: push() pieces while the reply is still being written, end() when it is finished.
 * Pieces play back to back on one audio timeline; with a voice server the next piece is already being made while one
 * plays (at most AHEAD requests at once, in order). If the server fails, the computer voice reads the rest.
 * onIdle fires once, after everything has been heard (or when it is stopped). onFirstAudio(ms) reports the time from
 * creating the speaker to the first sound.
 */
export function createSpeaker({ language = 'auto', fixedLang = '', onIdle, onStart, onChunk, onError, onFirstAudio } = {}) {
  log('info', 'voice', 'Reader created by: ' + callerOf());
  stopSpeaking();
  const run = ++serverRun; const t0 = performance.now();
  const alive = () => run === serverRun;
  const items = []; let at = 0; let playing = false; let ended = false; let idled = false; let started = false;
  const dead = new Set(); // server keys that failed in this answer: their pieces go to the computer voice
  // The reply's language: the language the user spoke (or the one set in Settings) until the text itself says otherwise.
  // Each piece is checked too, and the whole reply so far (more reliable than one short piece).
  const hintLang = language && language !== 'auto' ? baseLang(language) : '';
  let replyText = ''; let replyLang = ''; const told = new Set();
  const langOf = (clean) => {
    if (fixedLang) return baseLang(fixedLang); // a voice test in Settings: the language is known
    replyText = (replyText + ' ' + clean).slice(-600);
    replyLang = detectTextLang(replyText) || replyLang;
    const own = clean.length >= 25 ? detectTextLang(clean) : '';
    return own || replyLang || hintLang;
  };
  const idle = () => { if (idled) return; idled = true; if (current === token) current = null; onIdle?.(); };
  const token = { onend: idle };
  current = token;
  // silence before a piece: the natural-pacing pause after the previous piece, then the emotion pause (never before the first piece)
  const lead = (it) => { if (it.paceMs) pace(it.paceMs / 1000); if (it.pauseMs) gap(it.pauseMs / 1000); };
  const kick = () => { if (!started) { started = true; onStart?.(); onFirstAudio?.(Math.round(performance.now() - t0)); } };
  const start = (it) => {
    // a Chatterbox piece: the main / per-language Chatterbox engine, or a hybrid piece (then the main Chatterbox server)
    if (it.cb) { it.kind = 'file'; it.req = fileRequest(it.text, it.rate, fill, { ...(it.route.engine === 'chatterbox' ? reqOpts(it) : {}), engine: 'chatterbox', cb: it.cb }); }
    else if (streamable(it)) { it.kind = 'pcm'; it.req = pcmRequest(it.text, it.rate, fill, reqOpts(it)); }
    else { it.kind = 'file'; it.req = fileRequest(it.text, it.rate, fill, reqOpts(it)); }
  };
  // start the server requests for the coming pieces, in order, at most AHEAD at once per server
  // (with the hybrid option Kokoro and Chatterbox are two servers: an emotional piece is made while Kokoro makes the others;
  // a per-language server is its own queue too)
  function fill() {
    if (!alive()) return;
    const busy = {};
    for (let i = at; i < items.length && i < at + 8; i++) {
      const it = items[i]; const k = it.hybrid && it.cb ? 'cb' : it.key;
      if (it.local || dead.has(it.key)) continue; // read by the computer voice (no server voice for its language, or its server failed)
      busy[k] = busy[k] || 0;
      if (it.req) { if (!it.req.done) busy[k]++; continue; }
      if (busy[k] >= AHEAD) continue;
      start(it); busy[k]++;
    }
  }
  // the piece is heard at time t: tell the caller then (follow-along highlight, Sentinel state) and log how fast it was
  const begin = (it, t, r) => {
    const wait = Math.max(0, (t - audio().currentTime) * 1000);
    const plays = performance.now() + wait;
    if (r && r.firstAt) log('info', 'voice', `Voice piece ${it.n} (${it.text.length} chars): first audio from the server after ${Math.round(r.firstAt - r.sentAt)} ms, heard ${Math.round(plays - r.firstAt)} ms after that${it.n === 1 ? ` (${Math.round(plays - t0)} ms after the text was ready)` : ''}`);
    setTimeout(() => { if (!alive()) return; kick(); onChunk?.(it.text); }, wait);
  };
  const playStream = async (it) => {
    const r = it.req; const dec = createPcmDecoder(); const c = audio(); let first = true;
    for (;;) {
      if (!alive()) return true;
      if (r.chunks.length) {
        let buf = null;
        const f = dec.feed(r.chunks.shift(), (n) => { buf = c.createBuffer(1, n, PCM_RATE); return buf.getChannelData(0); });
        if (!f) continue;
        if (first) { fade(f, 96, 1); lead(it); }
        const t = schedule(buf);
        if (first) { first = false; begin(it, t, r); }
        continue;
      }
      if (r.done) break;
      await new Promise((res) => { r.wake = res; });
    }
    if (!first) { log('info', 'voice', `Voice piece ${it.n}: ${(r.got / 2 / PCM_RATE).toFixed(1)} s of audio queued`); return true; }
    it.error = r.error || 'The voice server sent no audio.';
    if (r.status) noStream.set(it.key, Date.now() + 5 * 60000); // the server answered but refused streaming: use whole files for now
    return false;
  };
  const playFile = async (it, r) => playRes(it, await r.promise, r);
  const playRes = async (it, res, r) => {
    if (!alive()) return true;
    if (!res || !res.ok) { it.error = (res && res.error) || 'The voice server failed.'; return false; }
    let buf;
    try { const a = res.audio; buf = await audio().decodeAudioData(a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength)); }
    catch { it.error = 'The voice server sent audio that could not be played.'; return false; }
    if (!alive()) return true;
    fade(buf.getChannelData(0), 96, 1);
    lead(it);
    begin(it, schedule(buf), r);
    return true;
  };
  // Hybrid: an emotional piece from Chatterbox. If it fails or takes longer than HYBRID_WAIT_MS, Kokoro reads it (never silence).
  const playHybrid = async (it) => {
    const r = it.req;
    const left = Math.max(0, HYBRID_WAIT_MS - (performance.now() - r.sentAt));
    let timer = null;
    const res = await Promise.race([r.promise, new Promise((ok) => { timer = setTimeout(() => ok(null), left); })]);
    clearTimeout(timer);
    if (!alive()) return true;
    let why;
    if (!res) { why = `took longer than ${HYBRID_WAIT_MS / 1000} s`; try { api.voiceStreamCancel(r.id).catch(() => {}); } catch {} fileReqs.delete(r.id); }
    else if (res.ok && await playRes(it, res, r)) return true;
    else why = 'failed: ' + ((res && res.error) || it.error || 'no audio');
    if (!alive()) return true;
    log('warn', 'voice', `Chatterbox piece ${it.n} (${it.emotion}) ${why}; Kokoro reads it`);
    it.cb = null; it.rate = it.plainRate; it.pauseMs = it.plainPause; it.error = '';
    if (streamable(it)) { it.kind = 'pcm'; it.req = pcmRequest(it.text, it.rate, fill, reqOpts(it)); if (await playStream(it)) return true; if (!alive()) return true; }
    it.kind = 'file';
    return playFile(it, fileRequest(it.text, it.rate, null, reqOpts(it)));
  };
  const sys = (it) => new Promise((resolve) => {
    if (!window.speechSynthesis) return resolve();
    const lang = it.lang || detectLang(it.text);
    const u = new SpeechSynthesisUtterance(it.text);
    const v = pickVoice(lang);
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = lang && lang !== 'en' ? lang : 'en-US';
    u.rate = it.rate;
    u.onstart = () => { if (!alive()) return; kick(); onChunk?.(it.text); };
    u.onend = resolve; u.onerror = resolve;
    speechSynthesis.speak(u);
  });
  const pump = async () => {
    if (playing) return;
    playing = true;
    try {
      while (at < items.length) {
        if (!alive()) return;
        const it = items[at];
        let ok = false;
        if (!it.local && !dead.has(it.key)) {
          try {
            if (!it.req) start(it);
            fill();
            ok = it.kind === 'pcm' ? await playStream(it) : it.hybrid && it.cb ? await playHybrid(it) : await playFile(it, it.req);
            if (!alive()) return;
            if (!ok && it.kind === 'pcm') { ok = await playFile(it, fileRequest(it.text, it.rate, null, reqOpts(it))); if (!alive()) return; } // streaming did not work: ask for a whole file
          } catch (e) { ok = false; it.error = errText(e); } // e.g. the audio output could not be opened: the computer voice reads it
          if (!ok) {
            // only this server is given up for this answer; a per-language server never stops the main one (and the main
            // one never reads a language it cannot speak): the computer voice reads these pieces in their own language
            dead.add(it.key);
            if (it.custom) log('warn', 'voice', `${ENGINE_NAME[it.route.engine] || 'Voice server'} for ${langName(it.lang) || it.lang || 'English'}${it.route.url ? ' at ' + it.route.url : ''} failed, the computer voice reads that language: ${it.error}`);
            else log('warn', 'voice', 'Voice server failed, the computer voice reads the rest: ' + it.error);
            onError?.(it.error);
          }
        }
        if (!ok) { // no server, or it failed: the answer is never silent
          await drain(alive); if (!alive()) return;
          if (it.paceMs) { await sleep(it.paceMs); if (!alive()) return; } // natural pacing between utterances
          try { await sys(it); } catch {} if (!alive()) return;
        }
        at++; fill();
      }
    } finally { playing = false; }
    if (ended && alive()) { await drain(alive); if (alive() && !playing && at >= items.length) idle(); }
  };
  const run1 = () => { pump().catch((e) => { log('warn', 'voice', 'Read aloud failed: ' + errText(e)); if (alive()) idle(); }); }; // never an unhandled rejection, and onIdle still fires
  return {
    // A piece is a string (a leading emotion tag such as "[warm] " is taken off and changes how it is spoken) or an object
    // { text, emotion?, para? } (from takePieceItems / chunkPieces: without `emotion` the tag is read from the text; para = it ends a paragraph).
    push(piece) {
      const obj = piece && typeof piece === 'object';
      const tagged = obj ? (piece.emotion ? { emotion: piece.emotion, text: piece.text } : parseTag(piece.text)) : parseTag(piece);
      const clean = speakable(tagged.text);
      if (!clean || !alive()) return;
      const emotion = tagged.emotion; const t = window.__tts || {};
      const mode = pacingMode(t.pacing); const para = !!(obj && piece.para);
      const user = clampRate(window.__voiceRate);
      const rate = clampRate(paceRate(user, mode)); const plain = plainAdjust(emotion);
      const prev = items[items.length - 1];
      const it = { text: clean, emotion, rate: clampRate(rate * plain.rate), pauseMs: plain.pauseMs, n: items.length + 1, para };
      // natural pacing: the pause after this piece is decided by how it ends; the first piece is never delayed
      it.afterMs = pauseAfter(clean, { para, mode });
      it.paceMs = prev ? prev.afterMs + pauseBefore(emotion, mode) : 0;
      it.plainRate = it.rate; it.plainPause = it.pauseMs;
      // language routing: Kokoro gets the voice for the piece's language; a language the server cannot speak (Turkish,
      // Russian … on Kokoro; anything but English on Chatterbox / Piper) is read by the computer voice, without counting as a failure
      it.lang = langOf(clean);
      // per-language engines (Voices per language) choose the engine, server and voice for this piece
      const route = routeLang({ lang: it.lang, main: { engine: t.engine || 'system', voice: t.voice, voices: t.voices }, map: t.langMap || {} });
      it.route = route; it.key = route.key; it.custom = route.custom;
      it.voice = route.engine === 'openai' ? route.voice : '';
      it.local = route.engine === 'system';
      if (it.local && route.reason && !told.has(route.lang)) { told.add(route.lang); const cv = pickVoice(route.lang); log('info', 'voice', `${route.reason}: the computer voice reads it (${cv ? cv.name : 'no ' + (langName(route.lang) || route.lang) + ' voice installed'})`); }
      const english = !it.lang || it.lang === 'en'; // the hybrid Chatterbox speaks English only
      if (route.engine === 'chatterbox') { it.cb = cbParams(emotion, t.cb, rate); it.rate = rate; it.pauseMs = 0; }
      else if (emotion && route.engine === 'openai' && route.key === 'main' && t.hybrid && english) { it.cb = cbParams(emotion, t.cb, rate); it.hybrid = true; it.rate = rate; it.pauseMs = 0; }
      if (emotion) log('info', 'voice', `Voice piece ${it.n}: [${emotion}]${it.cb ? ` via Chatterbox (exaggeration ${it.cb.exaggeration}, cfg ${it.cb.cfg_weight}, speed ${it.cb.speed})` : ', slower with a pause'}`);
      items.push(it);
      fill(); run1();
    },
    end() { ended = true; if (!playing) run1(); },
    get started() { return started; }
  };
}

/** Reads a finished text: short first piece so the voice starts at once, the next pieces made while it plays. */
export function speak(text, { language = 'auto', fixedLang = '', onEnd, onError, onChunk, onFirstAudio } = {}) {
  log('info', 'voice', `Reading aloud "${String(text || '').replace(/\s+/g, ' ').trim().slice(0, 60)}" by: ${callerOf()}`);
  const clean = speakable(text);
  if (!clean) { stopSpeaking(); onEnd?.(); return false; }
  const sp = createSpeaker({ language, fixedLang, onIdle: onEnd, onChunk, onError, onFirstAudio });
  for (const p of chunkPieces(text, { pacing: (window.__tts || {}).pacing })) sp.push(p); // from the text itself: the pieces keep their emotion tags
  sp.end();
  return true;
}
export const isSpeaking = () => !!current;
