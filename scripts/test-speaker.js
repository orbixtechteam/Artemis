// Tests for speaker recognition: the Kaldi-style audio front end, voice prints, enrolment, scoring, and the gate that decides what Sentinel may do
// with a voice (electron/speaker-fbank.js, speaker.js, voice-gate.js). The neural network itself is replaced by a small fake: what is checked here is
// everything around it. With the real model file in ARTEMIS_SPEAKER_MODEL (and onnxruntime-node installed) the same flow is also run on it.
const assert = require('assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const fb = require('../electron/speaker-fbank.js');
const { createSpeaker, cosine, normalize, meanVector, MODEL_ID } = require('../electron/speaker.js');
const { createVoiceGate } = require('../electron/voice-gate.js');
const { createLock } = require('../electron/lock.js');

(async () => {
  const core = await import('../src/lib/sentinel-core.mjs'); // encodeWav, as Sentinel writes its recordings
  const wavOf = (f32) => Buffer.from(core.encodeWav(f32, 16000));

  // synthetic "voices": a harmonic stack with vibrato (A) and bursts of noise (B); `seed` makes a different sentence
  const voice = (kind, seconds, seed) => {
    const n = Math.round(seconds * 16000); const x = new Float32Array(n); let s = seed * 7919 + 13;
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff - 0.5; };
    for (let i = 0; i < n; i++) {
      const t = i / 16000;
      if (kind === 'A') { const f0 = 140 + 12 * Math.sin(2 * Math.PI * (4 + seed % 3) * t); let v = 0; for (let h = 1; h <= 8; h++) v += Math.sin(2 * Math.PI * f0 * h * t) / h; x[i] = 0.15 * v * (0.6 + 0.4 * Math.sin(2 * Math.PI * (1.5 + seed % 2) * t)); }
      else x[i] = 0.2 * rnd() * (Math.sin(2 * Math.PI * (6 + seed % 3) * t) > 0 ? 1 : 0.15);
    }
    return x;
  };

  // ---- WAV and the audio front end ----
  { const x = voice('A', 1.5, 1); const w = fb.parseWav(wavOf(x));
    assert.strictEqual(w.sampleRate, 16000); assert.strictEqual(w.samples.length, x.length);
    assert.ok(Math.abs(w.samples[4000] - x[4000]) < 1e-3);
    assert.throws(() => fb.parseWav(Buffer.from('not a wav file at all, not even close to one......')), /Not a WAV/);
    // a Uint8Array view (what arrives over IPC) works too, also with an offset
    const big = new Uint8Array(wavOf(x).length + 10); big.set(wavOf(x), 10); assert.strictEqual(fb.parseWav(big.subarray(10)).samples.length, x.length); }
  { const r = fb.resampleLinear(Float32Array.from({ length: 22050 }, (_, i) => Math.sin(i / 20)), 22050, 16000); assert.strictEqual(r.length, 16000); }
  { const f = fb.fbank(voice('A', 2, 1));
    assert.strictEqual(f.bins, 80); assert.strictEqual(f.frames, 1 + Math.floor((32000 - 400) / 160)); assert.strictEqual(f.data.length, f.frames * 80);
    assert.ok(Array.from(f.data).every(Number.isFinite));
    for (const b of [0, 33, 79]) { let m = 0; for (let i = 0; i < f.frames; i++) m += f.data[i * 80 + b]; assert.ok(Math.abs(m / f.frames) < 1e-3, 'mean-normalised'); }
    const raw = fb.fbank(voice('A', 2, 1), { cmn: false }); assert.ok(raw.data.some((v) => Math.abs(v) > 3), 'raw log energies are not centred');
    assert.strictEqual(fb.fbank(new Float32Array(300)).frames, 0, 'less than 25 ms');
    assert.strictEqual(fb.fbank(new Float32Array(400)).frames, 1);
    assert.ok(Array.from(fb.fbank(new Float32Array(16000)).data).every((v) => Number.isFinite(v)), 'silence stays finite (floored log)'); }
  { // the Kaldi mel banks: 80 triangles inside 20 Hz..8 kHz, each non-empty, weights in (0, 1]
    assert.strictEqual(fb.BANKS.length, 80);
    for (const b of fb.BANKS) { assert.ok(b.w.length >= 1); assert.ok(Array.from(b.w).every((v) => v > 0 && v <= 1)); assert.ok(b.first + b.w.length <= 256); } }
  { // a pure tone shows up in the right mel bin
    const n = 16000; const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = 0.5 * Math.sin(2 * Math.PI * 1000 * i / 16000);
    const f = fb.fbank(x, { cmn: false }); let best = 0; for (let b = 1; b < 80; b++) if (f.data[10 * 80 + b] > f.data[10 * 80 + best]) best = b;
    const mel = (hz) => 1127 * Math.log(1 + hz / 700); const want = Math.round(((mel(1000) - mel(20)) / ((mel(8000) - mel(20)) / 81)) - 1);
    assert.ok(Math.abs(best - want) <= 1, `1 kHz lands in bin ${best}, expected about ${want}`); }

  // ---- vector helpers ----
  assert.ok(Math.abs(cosine([1, 0], [1, 0]) - 1) < 1e-9); assert.ok(Math.abs(cosine([1, 0], [0, 1])) < 1e-9); assert.strictEqual(cosine([1, 2], [1, 2, 3]), 0); assert.strictEqual(cosine([0, 0], [1, 1]), 0);
  assert.ok(Math.abs(Math.hypot(...normalize([3, 4])) - 1) < 1e-6);
  assert.deepStrictEqual(Array.from(meanVector([Float32Array.from([1, 3]), Float32Array.from([3, 5])])), [2, 4]);

  // ---- the speaker module on a fake network ----
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'artemis-spk-'));
  const realModel = process.env.ARTEMIS_SPEAKER_MODEL && fs.existsSync(process.env.ARTEMIS_SPEAKER_MODEL) ? process.env.ARTEMIS_SPEAKER_MODEL : '';
  let fake = 0;
  const fakeOrt = { // the "network": mean absolute deviation of 8 groups of mel bins, so a tone and noise bursts get different prints
    Tensor: class { constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; } },
    InferenceSession: { create: async () => ({ inputNames: ['feats'], outputNames: ['embs'], run: async (feeds) => {
      fake++; const { data, dims } = feeds.feats; const T = dims[1]; const out = new Float32Array(8);
      for (let g = 0; g < 8; g++) { let s = 0; for (let t = 0; t < T; t++) for (let b = g * 10; b < g * 10 + 10; b++) s += Math.abs(data[t * 80 + b]); out[g] = s / (T * 10); }
      const m = out.reduce((a, v) => a + v, 0) / 8; for (let g = 0; g < 8; g++) out[g] -= m; // centred, so unlike voices can score low
      return { embs: { data: out } };
    } }) }
  };
  const keychain = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from('ENC' + Buffer.from(s).toString('base64')), decryptString: (b) => Buffer.from(b.toString().slice(3), 'base64').toString() };
  const dirOf = (name) => path.join(tmp, name);
  const mkSpeaker = (name, over = {}) => createSpeaker({ fs, path, dir: () => dirOf(name), safeStorage: keychain, loadOrt: () => fakeOrt, ...over });

  // before anything: no model, no print; the status tells Settings what to offer
  { const sp = mkSpeaker('a'); const st = sp.status();
    assert.deepStrictEqual({ ready: st.model.ready, enrolled: st.enrolled, rt: st.runtime.ok, pending: st.pending }, { ready: false, enrolled: null, rt: true, pending: 0 });
    const r = await sp.enrollAdd(wavOf(voice('A', 3, 1))); assert.ok(!r.ok && /not downloaded/.test(r.error), r.error);
    assert.ok(!(await sp.score(wavOf(voice('A', 3, 1)))).ok); }
  // a missing runtime says what to do
  { const sp = createSpeaker({ fs, path, dir: () => dirOf('a'), safeStorage: keychain, loadOrt: () => { throw new Error("Cannot find module 'onnxruntime-node'"); } });
    assert.ok(!sp.runtime().ok && /pnpm install/.test(sp.runtime().error)); }

  // the model download: streamed, size-checked, renamed into place
  fs.mkdirSync(dirOf('d'), { recursive: true });
  const MB = 1048576;
  const fetchOf = (bytes, status = 200) => async () => ({ ok: status === 200, status, headers: { get: () => String(bytes) }, body: { getReader: () => { let sent = 0; return { read: async () => { if (sent >= bytes) return { done: true }; const n = Math.min(4 * MB, bytes - sent); sent += n; return { done: false, value: new Uint8Array(n) }; } }; } } });
  { const sp = mkSpeaker('d', { fetch: fetchOf(1000) }); const r = await sp.download(); assert.ok(!r.ok && /incomplete/.test(r.error)); assert.ok(!fs.existsSync(path.join(dirOf('d'), 'model.onnx')) && !fs.existsSync(path.join(dirOf('d'), 'model.onnx.part'))); }
  { const sp = mkSpeaker('d', { fetch: fetchOf(0, 404) }); const r = await sp.download(); assert.ok(!r.ok && /404/.test(r.error)); }
  { const seen = []; const sp = mkSpeaker('d', { fetch: fetchOf(25 * MB) }); const r = await sp.download((p) => seen.push(p)); assert.ok(r.ok); assert.ok(sp.modelReady()); assert.strictEqual(seen[seen.length - 1], 100);
    assert.ok((await sp.download()).ok, 'already there'); assert.ok(sp.removeModel().ok && !sp.modelReady()); }

  // enrolment and scoring, with the fake network
  const dirE = dirOf('e'); fs.mkdirSync(dirE, { recursive: true }); fs.writeFileSync(path.join(dirE, 'model.onnx'), Buffer.alloc(21 * MB));
  const sp = mkSpeaker('e');
  assert.ok(sp.modelReady());
  assert.ok((await sp.enrollAdd(wavOf(voice('A', 1.2, 1)))).short, 'under 2 s is refused for enrolment');
  assert.ok(!sp.enrollFinish().ok, 'needs three sentences');
  for (let i = 1; i <= 3; i++) { const r = await sp.enrollAdd(wavOf(voice('A', 3 + i * 0.3, i))); assert.ok(r.ok && r.count === i && r.enough === (i >= 3)); }
  { const r = sp.enrollFinish(); assert.ok(r.ok && r.n === 3 && r.spread > 0.9 && !r.weak, JSON.stringify(r)); }
  assert.ok(sp.hasPrint()); assert.strictEqual(sp.status().enrolled.n, 3); assert.strictEqual(sp.status().pending, 0);
  { const raw = fs.readFileSync(path.join(dirE, 'voiceprint.json'), 'utf8'); assert.ok(!/embedding/.test(raw), 'the print on disk is encrypted'); }
  { const mine = []; const other = [];
    for (const s of [4, 5, 6]) mine.push((await sp.score(wavOf(voice('A', 2.5 + s * 0.2, s)))).score);
    for (const s of [4, 5, 6]) other.push((await sp.score(wavOf(voice('B', 2.5 + s * 0.2, s)))).score);
    assert.ok(Math.min(...mine) > Math.max(...other) + 0.02, `owner ${mine.map((v) => v.toFixed(3))} vs other ${other.map((v) => v.toFixed(3))}`); }
  { const r = await sp.score(wavOf(voice('A', 0.6, 9))); assert.ok(!r.ok && r.short, 'half a second is too short'); }
  // the print survives a restart (a new module instance reads the file), and is dropped when it belongs to another model
  { const sp2 = mkSpeaker('e'); assert.ok(sp2.hasPrint()); assert.ok((await sp2.score(wavOf(voice('A', 3, 2)))).ok);
    const f = path.join(dirE, 'voiceprint.json'); const j = JSON.parse(fs.readFileSync(f, 'utf8')); const p = JSON.parse(Buffer.from(j.enc, 'base64').toString().slice(3) ? Buffer.from(Buffer.from(j.enc, 'base64').toString().slice(3), 'base64').toString() : '{}');
    p.model = 'some-other-model'; fs.writeFileSync(f, JSON.stringify({ enc: keychain.encryptString(JSON.stringify(p)).toString('base64') }));
    assert.ok(!mkSpeaker('e').hasPrint(), 'a print from another model is not used'); }
  // no keychain: stored with a plain marker, still works; removing the print
  { const sp3 = mkSpeaker('f', { safeStorage: null }); fs.mkdirSync(dirOf('f'), { recursive: true }); fs.writeFileSync(path.join(dirOf('f'), 'model.onnx'), Buffer.alloc(21 * MB));
    for (let i = 1; i <= 3; i++) await sp3.enrollAdd(wavOf(voice('A', 3, i))); assert.ok(sp3.enrollFinish().ok); assert.ok(mkSpeaker('f', { safeStorage: null }).hasPrint()); sp3.removePrint(); assert.ok(!sp3.hasPrint() && !mkSpeaker('f', { safeStorage: null }).hasPrint()); }
  assert.ok(fake > 8);

  // ---- the gate: what Sentinel may do with a voice ----
  let t = 5_000_000; const store = { v: null }; const alerts = [];
  const lock = createLock({ now: () => t, read: () => store.v, write: (d) => { store.v = JSON.parse(JSON.stringify(d)); }, touchId: { available: () => false }, onAlert: (a) => alerts.push(a) });
  await lock.setPassword('open sesame 1'); await lock.setConfig({ enabled: true });
  const gate = createVoiceGate({ lock, speaker: sp });
  const mine = wavOf(voice('A', 3.1, 7)); const theirs = wavOf(voice('B', 3.1, 7)); const tiny = wavOf(voice('A', 0.5, 7));
  // nothing is asked of the voice while the lock and owner-only are off
  assert.deepStrictEqual(await gate.verify(theirs), { ok: true, skipped: 'not-needed' });
  // Sentinel asks for the check itself (always): a stranger who says the wake phrase is refused with the fixed line even though no lock setting asks for the check
  await lock.setConfig({ voiceThreshold: 0.5 });
  { const r = await gate.verify(theirs, { always: true, phase: 'wake' }); assert.ok(!r.ok && r.reason === 'mismatch' && r.say === 'Unauthorized access.', JSON.stringify(r)); }
  { const r = await gate.verify(tiny, { always: true }); assert.deepStrictEqual(r, { ok: false, reason: 'short' }, 'Sentinel does not act on speech too short to recognise'); }
  // owner-only: the owner passes, others get the fixed line, short speech is let through (not a failed attempt)
  await lock.setConfig({ voiceOnly: true, voiceThreshold: 0.5 });
  { const own = await gate.verify(mine); assert.ok(own.ok && own.match && !own.unlocked, JSON.stringify(own)); }
  { const r = await gate.verify(theirs); assert.ok(!r.ok && r.reason === 'mismatch' && r.say === 'Unauthorized access.' && !r.lockdown, JSON.stringify(r)); }
  assert.deepStrictEqual(await gate.verify(tiny), { ok: true, skipped: 'short' });
  // inside an open conversation another voice is ignored in silence: no spoken line, no failed attempt, no lock; the owner still passes. A spoken yes/no is held to the same rule
  for (let i = 0; i < 5; i++) { const r = await gate.verify(theirs, { always: true, phase: 'session' }); assert.ok(!r.ok && r.reason === 'mismatch' && !r.say && !r.lockdown && !r.locked, JSON.stringify(r)); }
  assert.ok(!lock.isLocked(), 'a stranger talking inside a conversation never locks the app');
  { const r = await gate.verify(mine, { always: true, phase: 'session', strict: true }); assert.ok(r.ok && r.match, JSON.stringify(r)); }
  { const r = await gate.verify(theirs, { always: true, phase: 'session', strict: true }); assert.ok(!r.ok && !r.say, JSON.stringify(r)); }
  assert.deepStrictEqual(await gate.verify(tiny, { always: true, phase: 'session', strict: true }), { ok: false, reason: 'short' });
  // the third unrecognised voice locks down and raises the alert; the owner in between resets the count
  await gate.verify(mine); assert.ok(!(await gate.verify(theirs)).lockdown); assert.ok(!(await gate.verify(theirs)).lockdown);
  { const r = await gate.verify(theirs); assert.ok(r.lockdown && r.lockdown.kind === 'voice' && r.lockdown.attempts === 3 && r.say); assert.strictEqual(alerts.length, 1); assert.ok(lock.isLocked(), 'a lockdown locks the app'); }
  // locked: during the lockdown even the owner's voice does nothing, and says nothing
  assert.deepStrictEqual(await gate.verify(mine), { ok: false, reason: 'lockdown' });
  t += 6 * 60000;
  // locked, lockdown over: short speech cannot unlock, a stranger is refused, the owner unlocks
  assert.deepStrictEqual(await gate.verify(tiny), { ok: false, reason: 'short' });
  { const r = await gate.verify(theirs); assert.ok(!r.ok && r.say === 'Unauthorized access.'); assert.ok(lock.isLocked()); }
  { const r = await gate.verify(mine); assert.ok(r.ok && r.unlocked && r.match, JSON.stringify(r)); assert.ok(!lock.isLocked()); }
  // locked with voice unlock off: nothing is done by voice
  await lock.setConfig({ voiceUnlock: false, voiceOnly: false }); lock.lock('manual');
  assert.deepStrictEqual(await gate.verify(mine), { ok: false, reason: 'locked' });
  await lock.unlock('password', 'open sesame 1'); await lock.setConfig({ voiceUnlock: true });
  // locked but nobody is enrolled / the engine breaks
  { const empty = createSpeaker({ fs, path, dir: () => dirOf('g'), safeStorage: keychain, loadOrt: () => fakeOrt }); const g2 = createVoiceGate({ lock, speaker: empty });
    lock.lock('manual'); assert.deepStrictEqual(await g2.verify(mine), { ok: false, reason: 'not-enrolled' });
    await lock.unlock('password', 'open sesame 1'); await lock.setConfig({ voiceOnly: true }); assert.deepStrictEqual(await g2.verify(mine), { ok: true, skipped: 'not-enrolled' }, 'owner-only without an enrolled voice does not lock Sentinel out'); }
  { const broken = { hasPrint: () => true, score: async () => ({ ok: false, error: 'engine exploded' }) }; const g3 = createVoiceGate({ lock, speaker: broken });
    const r = await g3.verify(mine); assert.ok(!r.ok && r.reason === 'error' && /exploded/.test(r.error), 'owner-only fails closed when the engine breaks'); }
  // Settings "test my voice" counts nothing
  { const before = lock.state(); const r = await gate.test(mine); assert.ok(r.ok && r.match && r.threshold === 0.5); const r2 = await gate.test(theirs); assert.ok(r2.ok && !r2.match); assert.ok(!(await gate.test(tiny)).ok); assert.deepStrictEqual(lock.state().lockdown, before.lockdown); }

  // "lock when another voice speaks": the first stranger locks at once (no lockdown), and it also switches the check on without owner-only
  { const st2 = { v: null }; const lk = createLock({ now: () => t, read: () => st2.v, write: (d) => { st2.v = JSON.parse(JSON.stringify(d)); }, touchId: { available: () => false } });
    await lk.setPassword('open sesame 2'); await lk.setConfig({ enabled: true, voiceOnly: false, voiceThreshold: 0.5 });
    const g = createVoiceGate({ lock: lk, speaker: sp });
    assert.deepStrictEqual(await g.verify(theirs), { ok: true, skipped: 'not-needed' }, 'anyone may talk while both are off');
    await lk.setConfig({ lockOnStranger: true }); assert.strictEqual(lk.wantsVoiceCheck(), true);
    { const own = await g.verify(mine); assert.ok(own.ok && !lk.isLocked(), 'the owner does not lock it'); }
    { const r = await g.verify(theirs); assert.ok(!r.ok && r.say === 'Unauthorized access.' && r.locked === true && !r.lockdown, JSON.stringify(r)); assert.ok(lk.isLocked() && lk.state().reason === 'voice'); }
    await lk.unlock('password', 'open sesame 2'); await lk.setConfig({ lockOnStranger: false });
    { const r = await g.verify(theirs); assert.ok(r.ok && r.skipped === 'not-needed'); assert.ok(!lk.isLocked()); } }

  // ---- the same flow on the real network, when its files are at hand ----
  if (realModel) {
    const real = createSpeaker({ fs, path, dir: () => dirOf('real'), safeStorage: keychain }); fs.mkdirSync(dirOf('real'), { recursive: true }); fs.copyFileSync(realModel, path.join(dirOf('real'), 'model.onnx'));
    for (let i = 1; i <= 3; i++) assert.ok((await real.enrollAdd(wavOf(voice('A', 3 + i * 0.3, i)))).ok);
    assert.ok(real.enrollFinish().ok); const a = await real.score(wavOf(voice('A', 3, 9))); const b = await real.score(wavOf(voice('B', 3, 9)));
    assert.ok(a.ok && b.ok && a.score > b.score, `real model: tone ${a.score} vs noise ${b.score}`);
    console.log('speaker: real model checked (' + a.score.toFixed(2) + ' vs ' + b.score.toFixed(2) + ')');
  }
  console.log('speaker: all tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
