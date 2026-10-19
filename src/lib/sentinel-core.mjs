// Pure helpers for Sentinel mode (no browser APIs, so they can be unit-tested in Node).
// Wake word detection is done by a small offline recogniser (Vosk) limited to a few words; no AI model or network is involved.

import { TAG_RE, EMOTION_HINT } from './tts-emotion.mjs';

export const RATE = 16000;

// The wake phrase is "Wake up". The offline recogniser is limited to this phrase (and "hey"/"okay" in front of it).
export const DEFAULT_WAKE = 'wake up';
export const WAKE_PHRASE = DEFAULT_WAKE;
export const WAKE_WORDS = [DEFAULT_WAKE];
/** The wake phrase from Settings → Voice: 1 to 3 English words (the offline recogniser only knows words of its own list); anything else falls back to "wake up". */
export function normWake(s) {
  const w = String(s || '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const n = w ? w.split(' ').length : 0;
  return n >= 1 && n <= 3 && w.length >= 3 && w.length <= 30 ? w : DEFAULT_WAKE;
}
/** The phrase as it is shown to the user ("Wake up", "Hello computer"). */
export function wakeLabel(s) { const w = normWake(s); return w.charAt(0).toUpperCase() + w.slice(1); }
/** Which wake engine Settings → Voice chose: 'oww' (a trained model, any language) only when a model is picked, otherwise 'vosk' (the typed English phrase). */
export function wakeEngine(s) {
  const o = s || {};
  const model = typeof o.sentinelOwwModel === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$/.test(o.sentinelOwwModel) ? o.sentinelOwwModel : '';
  const t = o.sentinelOwwThreshold == null || o.sentinelOwwThreshold === '' ? NaN : Number(o.sentinelOwwThreshold);
  return { engine: o.sentinelEngine === 'oww' && model ? 'oww' : 'vosk', model, threshold: Number.isFinite(t) ? Math.min(0.95, Math.max(0.2, t)) : 0.5 };
}
export function wakeGrammar(word) { const w = normWake(word); return JSON.stringify([w, 'hey ' + w, 'okay ' + w, '[unk]']); }
export const GRAMMAR = wakeGrammar(DEFAULT_WAKE);

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();

// While Artemis is thinking or speaking the offline recogniser also listens for a few words that interrupt it.
export function bargeGrammar(word) { const w = normWake(word); return JSON.stringify(['stop', 'okay stop', 'stop it', 'enough', 'quiet', 'be quiet', 'shut up', 'cancel', w, 'hey ' + w, '[unk]']); }
export const BARGE_GRAMMAR = bargeGrammar(DEFAULT_WAKE);
export function hasBarge(text, word = DEFAULT_WAKE) { const t = norm(text); return !!t && new RegExp('\\b(' + normWake(word).split(' ').join('\\s+') + '|stop|enough|quiet|cancel|shut up)\\b').test(t); }

/** True when the recogniser output contains the wake phrase. */
export function hasWake(text, word = DEFAULT_WAKE) {
  return new RegExp('\\b' + normWake(word).split(' ').join('\\s+') + '\\b').test(norm(text));
}

// How a speech-to-text model tends to write the spoken phrase "Wake up".
// STRONG spellings are unlikely in ordinary speech; WEAK ones are real English phrases (still only accepted at the very start).
const STRONG = ['wake up', 'wakeup', 'wake op', 'wake app', 'wake ap', 'weyk ap', 'veyk ap', 'weik ap', 'wake upp', 'wakap'];
const WEAK = ['weak up', 'wait up', 'wake of', 'wake a'];
const HEY = ['hey', 'hi', 'ok', 'okay', 'he', 'hee', 'hej'];
const deburr = (w) => w.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const bare = (w) => deburr(w).replace(/[^a-z]/g, '');
// Where the phrase ends (index after its last word), or -1. It must be at the very start, or right after "hey" / "okay":
// "wake up" is also an ordinary English phrase, so it never counts later in a sentence.
// A phrase chosen in Settings has no known spellings: the first words (or the ones after "hey" / "okay") must be close to it, so a different way of
// writing it (one letter off, or split or joined: "wake up" / "wakeup") still counts.
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
function matchCustom(words, wake) {
  const target = wake.replace(/ /g, ''); const n = wake.split(' ').length;
  const tol = target.length >= 8 ? 2 : target.length >= 5 ? 1 : 0;
  for (const start of [0, 1]) {
    if (start === 1 && !(words.length && HEY.includes(bare(words[0])))) break;
    for (let k = Math.max(1, n - 1); k <= n + 1; k++) {
      if (start + k > words.length) break;
      const got = words.slice(start, start + k).map(bare).join('');
      if (got && lev(got, target) <= tol) return start + k;
    }
  }
  return -1;
}
function matchWake(words, word = DEFAULT_WAKE) {
  const wake = normWake(word);
  if (wake !== DEFAULT_WAKE) return matchCustom(words, wake);
  for (let i = 0; i < Math.min(words.length, 2); i++) {
    if (i === 1 && !HEY.includes(bare(words[0]))) break;
    const one = bare(words[i]); const two = i + 1 < words.length ? one + ' ' + bare(words[i + 1]) : '';
    if (two && (STRONG.includes(two) || WEAK.includes(two))) return i + 2;
    if (STRONG.includes(one)) return i + 1;
  }
  return -1;
}
const tidy = (words) => words.join(' ').replace(/^[\s,.:;!?\-\u2013\u2014]+/, '').trim();

/** Remove a leading "Wake up," / "Hey wake up" from a transcript. */
export function stripWake(text, word = DEFAULT_WAKE) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const end = matchWake(words, word);
  return end < 0 ? words.join(' ') : tidy(words.slice(end));
}

// Second check on the transcript of the recording. The offline recogniser only knows a few words and can mistake ordinary
// speech for the wake phrase, so the real speech-to-text must also hear it at the start.
/** Text after the wake phrase, or null when the transcript does not start with it (then the recording is ignored). */
export function afterWake(text, word = DEFAULT_WAKE) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const end = matchWake(words, word);
  return end < 0 ? null : tidy(words.slice(end));
}

// Speech-to-text often invents a few stock phrases from room noise. Inside a conversation these must not be sent as a message.
// What speech-to-text makes of clicks, typing and breathing (it never returns nothing): dropped unless it is a command
const NOISE = new Set(['you', 'thank you', 'thanks', 'thanks for watching', 'thank you for watching', 'okay', 'ok', 'hmm', 'hm', 'mm', 'mhm', 'uh huh', 'huh', 'uh', 'um', 'ah', 'oh', 'so', 'and', 'the', 'a', 'i', 'well', 'bye', 'you know', 'so so', 'oh okay']);
export function looksLikeNoise(text) {
  const raw = String(text || '');
  // words in another script (Cyrillic, Arabic, CJK …) are speech, not noise; the checks below only know Latin letters
  if ((raw.match(/\p{L}/gu) || []).filter((ch) => !/\p{Script=Latin}/u.test(ch)).length >= 2) return false;
  const t = deburr(raw).replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length < 2 || NOISE.has(t);
}

export function rms(f32) {
  let s = 0;
  for (let i = 0; i < f32.length; i++) s += f32[i] * f32[i];
  return Math.sqrt(s / (f32.length || 1));
}

/**
 * Decides when an utterance starts and ends from the signal level only.
 * feed(chunk) returns null, or { done: true, reason: 'silence' | 'nospeech' | 'max' } when the recording should stop.
 */
export class Segmenter {
  constructor({ rate = RATE, silenceMs = 850, noSpeechMs = 7000, maxMs = 40000, minRms = 0.012, factor = 3, noise = 0.004 } = {}) {
    Object.assign(this, { rate, silenceMs, noSpeechMs, maxMs, minRms, factor });
    this.noise = noise; this.ms = 0; this.quiet = 0; this.spoke = false; this.speechMs = 0; this.run = 0; this.maxRun = 0;
  }
  get threshold() { return Math.max(this.minRms, this.noise * this.factor); }
  feed(chunk) {
    const ms = (chunk.length / this.rate) * 1000;
    const level = rms(chunk);
    this.ms += ms;
    this.level = level;
    // Voiced time is counted in 20 ms frames, not whole chunks (a chunk is ~250 ms): a key click is loud for only a frame or two,
    // while speech stays loud for a syllable (100 ms or more) at a time. maxRun is the longest unbroken loud stretch.
    const th = this.threshold, fl = Math.max(1, Math.round(this.rate / 50));
    for (let i = 0; i < chunk.length; i += fl) {
      if (rms(chunk.subarray(i, Math.min(chunk.length, i + fl))) > th) { this.speechMs += 20; this.run += 20; if (this.run > this.maxRun) this.maxRun = this.run; }
      else this.run = 0;
    }
    if (level > this.threshold) { this.spoke = true; this.quiet = 0; }
    else {
      this.quiet += ms;
      if (!this.spoke || this.quiet > 400) this.noise = this.noise * 0.95 + level * 0.05; // learn the room noise only from silence
    }
    if (this.spoke && this.quiet >= this.silenceMs) return { done: true, reason: 'silence' };
    if (!this.spoke && this.ms >= this.noSpeechMs) return { done: true, reason: 'nospeech' };
    if (this.ms >= this.maxMs) return { done: true, reason: 'max' };
    return null;
  }
  /** Enough real speech to be worth sending to speech-to-text. */
  get hasSpeech() { return this.spoke && this.speechMs >= 250 && this.maxRun >= 120; } // typing or a single knock is not speech
}

/** Keeps the last `ms` of audio so the start of a sentence is not cut off. */
export class Ring {
  constructor(ms = 600, rate = RATE) { this.max = Math.round((ms / 1000) * rate); this.chunks = []; this.len = 0; }
  push(c) {
    this.chunks.push(c); this.len += c.length;
    while (this.chunks.length > 1 && this.len - this.chunks[0].length >= this.max) this.len -= this.chunks.shift().length;
  }
  take() { const out = this.chunks; this.chunks = []; this.len = 0; return out; }
  clear() { this.chunks = []; this.len = 0; }
}

export function concat(chunks) {
  const n = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Float32Array(n);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

/** 16-bit mono PCM WAV. */
export function encodeWav(f32, rate = RATE) {
  const buf = new ArrayBuffer(44 + f32.length * 2);
  const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + f32.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, f32.length * 2, true);
  for (let i = 0; i < f32.length; i++) { const s = Math.max(-1, Math.min(1, f32[i])); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  return new Uint8Array(buf);
}

/**
 * Strip Markdown so the voice does not read symbols: code is skipped, links are read by their text, list markers and emoji are dropped.
 * Emotion tags ("[warm]") are never read: they are removed, or with { tags: true } kept as "[warm] " so takePieces can tell
 * which piece they belong to (the speaker takes them off again before reading).
 * With { paras: true } a paragraph break (an empty line) is kept as PARA_MARK so takePieces can pause there (natural pacing).
 */
export const PARA_MARK = '\uE000';
export function speakable(md, { tags = false, paras = false } = {}) {
  let s0 = String(md || '');
  const lone = /<\/think(?:ing)?>/i.exec(s0), open = /<think(?:ing)?>/i.exec(s0);
  if (lone && (!open || lone.index < open.index)) s0 = s0.slice(lone.index + lone[0].length); // reasoning written before a lone closing tag
  const s1 = s0
    .replace(/<(think|thinking)>[\s\S]*?(<\/\1>|$)/gi, ' ') // thinking blocks (an unclosed one is still being thought)
    .replace(/```[\s\S]*?(```|$)/g, '\n') // code is shown in the chat, not read (an unclosed block is still being written)
    .replace(TAG_RE, (_m, t) => (tags ? ' [' + t.toLowerCase() + '] ' : ' '))
    .replace(/`([^`\n]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'link')
    .replace(/^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(\|[ \t]*:?-*:?[ \t]*)*\|?[ \t]*$/gm, '') // table separator rows
    .replace(/^[ \t]*(?:\d{1,3}[.)][ \t]+|[#>*+-][#>*+\- \t]*)/gm, '') // headings, quotes, list markers and numbers, rules
    .replace(/[*_~|`]/g, '')
    .replace(/[\p{Extended_Pictographic}️‍⃣\u{1F3FB}-\u{1F3FF}\u{1F1E6}-\u{1F1FF}]/gu, '') // emoji are not read out ("smiling face with ...")
    .replace(/([^\s.!?:;,…])[ \t]*\n/g, '$1.\n'); // a heading or list item ends where its line ends
  return (paras ? s1.replace(/\n[ \t]*\n\s*/g, ' ' + PARA_MARK + ' ') : s1)
    .replace(/\s+/g, ' ').replace(/ ([.,!?;:])(?=\s|$)/g, '$1').trim();
}

// Sentence ends: punctuation followed by a space (or the end), so "3.5" is never split.
const SENT = /[.!?…]+["”')\]]*(?=\s|$)/g;
// Abbreviations and initials that end in a full stop but do not end the sentence ("Dr. Smith", "e.g. this", "J. K. Rowling").
const ABBR = /(?:^|[\s("'])(?:mr|mrs|ms|dr|prof|sr|jr|st|mt|vs|fig|vol|approx|dept|corp|cf|al|e\.g|i\.e|a\.m|p\.m|u\.s|u\.k)\.$/i;
const INITIAL = /(?:^|\s)[A-Z]\.$/;
// Clause marks where a short pause sounds natural.
const CLAUSE = /[,;:](?=\s)|[–—]/g;

/** End of the first sentence that is at least `min` long, or -1 (also when the text after it has not arrived yet). */
function sentenceEnd(s, min, final) {
  SENT.lastIndex = 0; let m;
  while ((m = SENT.exec(s))) {
    const end = m.index + m[0].length;
    if (end >= s.length && !final) return -1; // nothing after it yet: "3." may still become "3.5"
    if (m[0][0] === '.') { const head = s.slice(0, m.index + 1); if (ABBR.test(head) || INITIAL.test(head)) continue; }
    if (end >= min) return end;
  }
  return -1;
}

/** The very first piece starts the voice, so it does not wait for a full stop: the first clause mark, or about eight words. */
function firstCut(s) {
  CLAUSE.lastIndex = 0; let m;
  while ((m = CLAUSE.exec(s))) { const e = m.index + m[0].length; if (e >= 12 && e < s.length) return e; }
  const words = /\S+\s+/g; let n = 0; let w;
  while ((w = words.exec(s))) { const e = w.index + w[0].length; if (++n >= 8 && e >= 40) return e; }
  return -1;
}

/** Cut a long piece at its last clause mark before `max`, else at its last space. */
function clauseCut(s, max, min = 40) {
  const head = s.slice(0, max); let cut = -1; let m;
  CLAUSE.lastIndex = 0;
  while ((m = CLAUSE.exec(head))) { const e = m.index + m[0].length; if (e >= min) cut = e; }
  if (cut > 0) return cut;
  const sp = head.lastIndexOf(' ');
  return sp > min ? sp : max;
}

const LEAD_TAG = /^\s*\[(?:warm|soft|excited|sad|serious)\] /;
const ANY_TAG = /\[(?:warm|soft|excited|sad|serious)\] /g;
/** Where the next emotion tag starts (after `from`, with real text before it), or -1. */
function nextTag(s, from) {
  ANY_TAG.lastIndex = from; let m;
  while ((m = ANY_TAG.exec(s))) if (s.slice(0, m.index).trim()) return m.index;
  return -1;
}

const PARA_LEAD = /^[\s\uE000]*\uE000\s*/;
/**
 * Reading a reply while it is still being written. Call it with the whole text so far; it returns the new pieces
 * that are ready to be spoken. st = { consumed: 0, spoken: 0, n: 0 } is kept between calls.
 * The first piece is short (up to the first clause mark) so the voice starts at once; later pieces are whole
 * sentences, short ones merged, long ones (over `max`) cut at a clause mark.
 * With final=true the rest is returned too. At most `cap` characters are spoken in total (the chat has the full text).
 * Returns strings; takePieceItems returns { text, para } objects instead.
 */
export function takePieces(md, st, final = false, cap = Infinity, max = 250) {
  return takePieceItems(md, st, final, cap, max).map((p) => p.text);
}

/**
 * Same as takePieces, but each piece is { text, para }: para = the piece ends a paragraph (the speaker pauses longer).
 * With natural pacing on (st.pacing 'subtle' or 'expressive') sentences are split more eagerly: one sentence per piece unless
 * it is under ~25 characters, and a paragraph always ends a piece, so the pauses land between sentences. With st.pacing
 * unset or 'off' the pieces are exactly those of takePieces before pacing existed (para is then always false).
 */
export function takePieceItems(md, st, final = false, cap = Infinity, max = 250) {
  const eager = !!st.pacing && st.pacing !== 'off';
  let t = String(md || '');
  if (!final) {
    if ((t.match(/```/g) || []).length % 2 === 1) t = t.slice(0, t.lastIndexOf('```')); // a code block that is not closed yet
    const link = /!?\[[^\]\n]*(?:\]\([^)\s]*)?$/.exec(t); // a link still being written: "[the docs](https://ex"
    if (link) t = t.slice(0, link.index);
  }
  const view = speakable(t, { tags: true, paras: eager });
  if (st.consumed > view.length) st.consumed = view.length; // the text got shorter (thinking was cut out of it)
  const out = [];
  let rest = view.slice(st.consumed);
  // a paragraph mark right after a piece: it is consumed and the piece gets para: true
  const skipPara = () => { const m = PARA_LEAD.exec(rest); if (!m) return false; rest = rest.slice(m[0].length); st.consumed += m[0].length; return true; };
  const blank = (x) => !x.replace(/\uE000/g, ' ').trim();
  const take = (n) => {
    const p = rest.slice(0, n).replace(/\s*\uE000\s*/g, ' ').trim(); rest = rest.slice(n); st.consumed += n;
    const para = eager && skipPara();
    if (!p) return; out.push({ text: p, para }); st.spoken += p.length; st.n++;
  };
  if (eager) skipPara(); // a paragraph break before anything was said
  const capped = () => { st.capped = true; out.push({ text: 'The rest is in the chat.', para: false }); };
  for (;;) {
    if (st.spoken >= cap) { if (!blank(rest) && !st.capped) capped(); st.consumed = view.length; break; }
    // an emotion tag starts its own piece: a tagged sentence is not merged with others, and the text before a tag is complete
    const lead = LEAD_TAG.exec(rest);
    let cut = sentenceEnd(rest, lead ? 1 : st.n === 0 ? 8 : eager ? 25 : st.n === 1 ? 40 : 80, final);
    if (st.n === 0 && !lead) { const c = firstCut(rest); if (c > 0 && (cut < 0 || c < cut)) cut = c; }
    const nx = nextTag(rest, lead ? lead[0].length : 0);
    if (nx > 0 && (cut < 0 || cut > nx)) cut = nx;
    if (eager) { const pi = rest.indexOf(PARA_MARK); if (pi > 0 && !blank(rest.slice(0, pi)) && (cut < 0 || cut > pi)) cut = pi; } // a paragraph ends the piece
    if (cut > max || (cut < 0 && rest.trim().length > max)) cut = clauseCut(rest, max);
    if (cut < 0) break;
    take(cut);
  }
  if (final && !blank(rest)) { if (st.spoken < cap) take(rest.length); else if (!st.capped) capped(); }
  return out;
}

/** A whole text in speakable pieces (the same rules as takePieces), for reading a finished reply. */
export function chunkText(text, max = 250) {
  return takePieces(text, { consumed: 0, spoken: 0, n: 0 }, true, Infinity, max);
}

/** chunkText as { text, para } pieces, split for natural pacing when pacing is 'subtle' or 'expressive'. */
export function chunkPieces(text, { pacing = 'off', max = 250 } = {}) {
  return takePieceItems(text, { consumed: 0, spoken: 0, n: 0, pacing }, true, Infinity, max);
}

/** Shorten a reply for reading aloud: whole sentences, at most `max` characters. The full text stays in the chat. */
export function spokenPart(text, max = Infinity) {
  const t = String(text || '').trim();
  if (t.length <= max) return { text: t, cut: false };
  const head = t.slice(0, max);
  const i = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '), head.lastIndexOf('\n'));
  return { text: (i > max * 0.5 ? head.slice(0, i + 1) : head).trim(), cut: true };
}

export { EMOTION_HINT };
export { THINKING_HINT } from './tts-pacing.mjs';
export const VOICE_HINT = 'The user is talking to you by voice (Sentinel mode) and will hear your answer read aloud as well as read it. Answer in the language they used. Keep it short and natural to listen to: a few sentences, no tables, no long lists, no code unless they ask. If a long result is needed, put it in the chat and give a short spoken summary.';

/** Running estimate of the room noise: drops fast when it gets quieter, rises slowly when it gets louder. */
export function trackNoise(noise, level) {
  return level < noise ? noise * 0.8 + level * 0.2 : noise + (level - noise) * 0.01;
}
