// Wake word engine: openWakeWord (https://github.com/dscripka/openWakeWord, Apache-2.0). A small neural network that listens for ONE phrase it was trained on,
// so the phrase can be in any language (the Vosk engine only knows English words). Everything runs on this computer with onnxruntime-node.
//
// Three ONNX models run in a chain, exactly as in the openWakeWord project:
//   audio (16 kHz, int16 scale) --melspectrogram.onnx--> mel frames --embedding_model.onnx--> 96 numbers per 80 ms --<wake model>.onnx--> score 0..1
// melspectrogram.onnx and embedding_model.onnx are shared by every wake model and are downloaded once. A wake model is a small .onnx file trained for
// one phrase (the project has a Colab notebook that makes one in about an hour); the user imports it, or downloads one of the project's ready models.
// Files, the runtime and the network are injected, so scripts/test-wakeword.js runs without Electron.

const FEATURE_BASE = 'https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/';
const FEATURES = [
  { file: 'melspectrogram.onnx', min: 500 * 1024, max: 8 * 1048576 },
  { file: 'embedding_model.onnx', min: 500 * 1024, max: 12 * 1048576 }
];
// ready-made models of the project (a few are enough to try the engine; a phrase of your own is a model you import)
const PRESETS = [{ id: 'hey_mycroft_v0.1', label: 'Hey Mycroft', file: 'hey_mycroft_v0.1.onnx' }];
const MODEL_MIN = 10 * 1024;
const MODEL_MAX = 30 * 1048576;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$/;

const BLOCK = 1280;  // 80 ms at 16 kHz: the engine works in steps of this many samples
const EXTRA = 480;   // the mel model needs a little audio from before each block (3 hop lengths of 160)
const MEL_BINS = 32;
const EMB_WINDOW = 76; // mel frames per embedding
const EMB_DIM = 96;

/** The number of embeddings a wake model looks at (16 for the models the project trains), read from its input shape when onnxruntime tells it. */
function framesOf(session) {
  try {
    const m = session.inputMetadata;
    const first = Array.isArray(m) ? m[0] : m && m[session.inputNames[0]];
    const n = first && first.shape && first.shape[1];
    return Number.isInteger(n) && n > 0 && n <= 120 ? n : 16;
  } catch { return 16; }
}

/**
 * The detector: feed(samples) takes mono 16 kHz audio in -1..1 and returns { hit, score } for what it has heard since the last call.
 * threshold: score from which a block counts (0.5 is the project's advice); patience: how many blocks in a row (80 ms each) must reach it.
 * After a hit the embeddings are cleared, so the same phrase cannot fire twice in a row (about 1.3 s before it can fire again).
 */
function createDetector({ ort, mel, embed, wake, threshold = 0.5, patience = 2, frames }) {
  const need = frames || framesOf(wake);
  const melIn = mel.inputNames[0]; const embIn = embed.inputNames[0]; const wakeIn = wake.inputNames[0];
  let pending = new Float32Array(0); let tail = new Float32Array(0);
  let melRows = []; let feats = []; let streak = 0;

  async function block(samples) {
    const input = new Float32Array(tail.length + samples.length); input.set(tail); input.set(samples, tail.length);
    tail = input.slice(Math.max(0, input.length - EXTRA));
    const m = (await mel.run({ [melIn]: new ort.Tensor('float32', input, [1, input.length]) }))[mel.outputNames[0]].data;
    const rows = Math.floor(m.length / MEL_BINS);
    for (let r = 0; r < rows; r++) { const row = new Float32Array(MEL_BINS); for (let j = 0; j < MEL_BINS; j++) row[j] = m[r * MEL_BINS + j] / 10 + 2; melRows.push(row); }
    if (melRows.length > 400) melRows = melRows.slice(-400);
    if (melRows.length < EMB_WINDOW) return { score: 0, hit: false };
    const win = new Float32Array(EMB_WINDOW * MEL_BINS); const last = melRows.slice(-EMB_WINDOW);
    for (let i = 0; i < EMB_WINDOW; i++) win.set(last[i], i * MEL_BINS);
    const e = (await embed.run({ [embIn]: new ort.Tensor('float32', win, [1, EMB_WINDOW, MEL_BINS, 1]) }))[embed.outputNames[0]].data;
    feats.push(Float32Array.from(e).slice(0, EMB_DIM));
    if (feats.length > 120) feats = feats.slice(-120);
    if (feats.length < need) return { score: 0, hit: false };
    const x = new Float32Array(need * EMB_DIM); const recent = feats.slice(-need);
    for (let i = 0; i < need; i++) x.set(recent[i], i * EMB_DIM);
    const out = (await wake.run({ [wakeIn]: new ort.Tensor('float32', x, [1, need, EMB_DIM]) }))[wake.outputNames[0]].data;
    const score = Number(out[0]) || 0;
    streak = score >= threshold ? streak + 1 : 0;
    if (streak >= patience) { streak = 0; feats = []; return { score, hit: true }; }
    return { score, hit: false };
  }

  async function feed(samples) {
    const s = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) { const v = samples[i] * 32768; s[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v; } // the models expect the int16 scale
    const joined = new Float32Array(pending.length + s.length); joined.set(pending); joined.set(s, pending.length);
    let off = 0; let hit = false; let top = 0;
    while (joined.length - off >= BLOCK) {
      const r = await block(joined.subarray(off, off + BLOCK)); off += BLOCK;
      if (r.score > top) top = r.score;
      if (r.hit) hit = true;
    }
    pending = joined.slice(off);
    return { hit, score: top };
  }
  function reset() { pending = new Float32Array(0); tail = new Float32Array(0); melRows = []; feats = []; streak = 0; }
  return { feed, reset };
}

function createWakeWord({ fs, path, dir, fetch: fetchFn = globalThis.fetch, loadOrt = () => require('onnxruntime-node'), log = () => {} }) {
  const featurePath = (f) => path.join(dir(), f.file);
  const modelsDir = () => path.join(dir(), 'models');
  const sizeOf = (p) => { try { return fs.statSync(p).size; } catch { return 0; } };
  const featuresReady = () => FEATURES.every((f) => { const n = sizeOf(featurePath(f)); return n >= f.min && n <= f.max; });
  let ort = null; let sessions = null; let current = null; let busy = false;

  function runtime() {
    if (ort) return { ok: true };
    try { ort = loadOrt(); return { ok: true }; } catch (e) {
      return { ok: false, error: 'The speech engine (onnxruntime-node) is not installed. Run "pnpm install" in the Artemis folder once and restart the app. (' + ((e && e.message) || e).toString().split('\n')[0] + ')' };
    }
  }
  const prettyName = (id) => id.replace(/_v\d+(\.\d+)*$/, '').replace(/[_-]+/g, ' ').trim();
  function listModels() {
    let names = []; try { names = fs.readdirSync(modelsDir()); } catch {}
    return names.filter((n) => /\.onnx$/i.test(n)).map((n) => {
      const id = n.replace(/\.onnx$/i, ''); const size = sizeOf(path.join(modelsDir(), n));
      return { id, name: prettyName(id), size, preset: PRESETS.some((p) => p.file === n) };
    }).filter((m) => ID_RE.test(m.id) && m.size >= MODEL_MIN && m.size <= MODEL_MAX).sort((a, b) => a.name.localeCompare(b.name));
  }
  function status() {
    const have = new Set(listModels().map((m) => m.id));
    return {
      runtime: runtime(), features: { ready: featuresReady(), size: FEATURES.reduce((a, f) => a + sizeOf(featurePath(f)), 0) },
      models: listModels(), presets: PRESETS.map((p) => ({ id: p.id, label: p.label, installed: have.has(p.id) })),
      active: current ? { model: current.model, threshold: current.threshold } : null
    };
  }

  /** Streams url into file; throws when it fails or the size is wrong. onProgress(bytesSoFar, totalBytes). */
  async function fetchTo(url, file, min, max, onProgress) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.part';
    const res = await fetchFn(url, { signal: AbortSignal.timeout(5 * 60 * 1000) });
    if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);
    const total = Number(res.headers.get('content-length')) || 0; const out = fs.createWriteStream(tmp);
    let got = 0; const reader = res.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        got += value.length; if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r));
        onProgress(got, total);
      }
      await new Promise((r, j) => out.end((err) => (err ? j(err) : r())));
    } catch (e) { try { out.destroy(); } catch {} try { fs.unlinkSync(tmp); } catch {} throw e; }
    if (got < min || got > max) { try { fs.unlinkSync(tmp); } catch {} throw new Error('The download was incomplete.'); }
    fs.renameSync(tmp, file);
  }
  const mbText = (got, total) => `${(got / 1048576).toFixed(1)} of ${total ? (total / 1048576).toFixed(1) : '?'} MB`;

  /** Downloads the two shared models. onProgress(percent, detail). */
  async function download(onProgress = () => {}) {
    if (featuresReady()) return { ok: true };
    if (busy) return { ok: false, error: 'The wake word engine files are already downloading.' };
    busy = true;
    try {
      for (let i = 0; i < FEATURES.length; i++) {
        const f = FEATURES[i];
        if (sizeOf(featurePath(f)) >= f.min) continue;
        await fetchTo(FEATURE_BASE + f.file, featurePath(f), f.min, f.max, (got, total) => onProgress(Math.round(((i + (total ? got / total : 0)) / FEATURES.length) * 100), `${f.file}: ${mbText(got, total)}`));
      }
      sessions = null; log('info', 'Wake word engine files downloaded');
      return { ok: true };
    } catch (e) {
      return { ok: false, error: 'Could not download the wake word engine files (' + ((e && e.message) || e) + '). Check your internet connection and try again.' };
    } finally { busy = false; }
  }

  async function downloadPreset(id, onProgress = () => {}) {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return { ok: false, error: 'Unknown ready-made model.' };
    if (busy) return { ok: false, error: 'A download is already running.' };
    busy = true;
    try {
      await fetchTo(FEATURE_BASE + p.file, path.join(modelsDir(), p.file), MODEL_MIN, MODEL_MAX, (got, total) => onProgress(total ? Math.round((got / total) * 100) : 0, `${p.label}: ${mbText(got, total)}`));
      log('info', `Wake word model "${p.label}" downloaded`);
      return { ok: true, id: p.id };
    } catch (e) { return { ok: false, error: 'Could not download the model (' + ((e && e.message) || e) + ').' }; }
    finally { busy = false; }
  }

  /** Saves a wake model (the bytes of an .onnx file) under a safe name. */
  function addModel(name, data) {
    const base = String(name || '').replace(/^.*[\\/]/, '').replace(/\.onnx$/i, '').replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^[^A-Za-z0-9]+/, '').slice(0, 80);
    if (!ID_RE.test(base)) return { ok: false, error: 'Use a file whose name has letters or digits, for example my_phrase.onnx.' };
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (buf.length < MODEL_MIN) return { ok: false, error: 'That file is too small to be a wake word model.' };
    if (buf.length > MODEL_MAX) return { ok: false, error: 'That file is too large to be a wake word model.' };
    fs.mkdirSync(modelsDir(), { recursive: true });
    const file = path.join(modelsDir(), base + '.onnx'); const tmp = file + '.part';
    fs.writeFileSync(tmp, buf, { mode: 0o600 }); fs.renameSync(tmp, file);
    if (current && current.model === base) stop();
    return { ok: true, id: base };
  }
  function importModel(srcPath) {
    const p = String(srcPath || '');
    if (!/\.onnx$/i.test(p)) return { ok: false, error: 'Pick an .onnx file (a model trained with openWakeWord).' };
    let data; try { data = fs.readFileSync(p); } catch (e) { return { ok: false, error: 'The file could not be read (' + ((e && e.message) || e) + ').' }; }
    return addModel(path.basename(p), data);
  }
  function removeModel(id) {
    if (!ID_RE.test(String(id || ''))) return { ok: false, error: 'Unknown model.' };
    if (current && current.model === id) stop();
    try { fs.unlinkSync(path.join(modelsDir(), id + '.onnx')); } catch (e) { if (e && e.code !== 'ENOENT') return { ok: false, error: (e && e.message) || String(e) }; }
    return { ok: true };
  }

  async function sharedSessions() {
    if (sessions) return sessions;
    const make = (f) => ort.InferenceSession.create(featurePath(f), { executionProviders: ['cpu'], intraOpNumThreads: 1, graphOptimizationLevel: 'all' });
    sessions = Promise.all(FEATURES.map(make)).then(([mel, embed]) => ({ mel, embed })).catch((e) => { sessions = null; throw e; });
    return sessions;
  }

  /** Loads the chain for one wake model and starts a fresh detector. */
  async function start({ model, threshold } = {}) {
    stop();
    const rt = runtime(); if (!rt.ok) return rt;
    if (!featuresReady()) return { ok: false, error: 'The wake word engine files are not downloaded yet. Download them in Settings → Voice.' };
    if (!ID_RE.test(String(model || '')) || sizeOf(path.join(modelsDir(), model + '.onnx')) < MODEL_MIN) return { ok: false, error: 'The wake word model is missing. Pick or import one in Settings → Voice.' };
    try {
      const { mel, embed } = await sharedSessions();
      const wake = await ort.InferenceSession.create(path.join(modelsDir(), model + '.onnx'), { executionProviders: ['cpu'], intraOpNumThreads: 1, graphOptimizationLevel: 'all' });
      const t = Number.isFinite(Number(threshold)) ? Math.min(0.95, Math.max(0.2, Number(threshold))) : 0.5;
      current = { model, threshold: t, detector: createDetector({ ort, mel, embed, wake, threshold: t }) };
      log('info', `Wake word engine started (${model}, threshold ${t})`);
      return { ok: true };
    } catch (e) { return { ok: false, error: 'The wake word engine could not start (' + ((e && e.message) || e) + '). The model may not be an openWakeWord model; remove it in Settings → Voice.' }; }
  }

  let chain = Promise.resolve();
  const serial = (fn) => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };
  /** Audio from the microphone (mono 16 kHz Float32, as an ArrayBuffer or typed array). Resolves { hit, score }. */
  function feed(buf) {
    const cur = current; if (!cur) return Promise.resolve({ ok: false, hit: false, score: 0 });
    let x;
    if (buf instanceof Float32Array) x = buf;
    else if (buf instanceof ArrayBuffer) x = new Float32Array(buf);
    else if (buf && buf.buffer) x = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
    else return Promise.resolve({ ok: false, hit: false, score: 0 });
    return serial(async () => {
      if (current !== cur) return { ok: false, hit: false, score: 0 };
      try { const r = await cur.detector.feed(x); return { ok: true, ...r }; } catch (e) { log('warn', 'Wake word engine failed: ' + ((e && e.message) || e)); return { ok: false, hit: false, score: 0, error: (e && e.message) || String(e) }; }
    });
  }
  function stop() { current = null; }

  return { status, download, downloadPreset, addModel, importModel, removeModel, start, feed, stop, listModels, featuresReady };
}

module.exports = { createWakeWord, createDetector, framesOf, FEATURES, PRESETS, BLOCK, EXTRA, EMB_WINDOW, EMB_DIM, MEL_BINS };
