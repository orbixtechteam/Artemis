// Tests for the wake word engine (electron/wakeword.js): the detector's pipeline, and the files side (download, import, remove, start, feed). The three neural
// networks are replaced by small fakes that check the shapes the real ones need; what is checked here is the plumbing around them.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createWakeWord, createDetector, FEATURES, PRESETS } = require('../electron/wakeword.js');

class Tensor { constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; } }
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

function makeOrt() {
  const stats = { mel: [], embed: 0, wake: 0, created: [] };
  const state = { score: 0 };
  const fakeSession = (file) => {
    const base = path.basename(file);
    if (/broken/.test(base)) throw new Error('not a model');
    stats.created.push(base);
    if (base === 'melspectrogram.onnx') return { inputNames: ['input'], outputNames: ['output'], async run(feeds) {
      const t = feeds.input; assert(t.type === 'float32' && t.dims.length === 2 && t.dims[0] === 1 && t.dims[1] === t.data.length, 'mel input is [1, samples]');
      let max = 0; for (const v of t.data) max = Math.max(max, Math.abs(v)); stats.mel.push({ n: t.data.length, max });
      const frames = Math.max(0, Math.floor((t.data.length - 512) / 160) + 1);
      return { output: { data: new Float32Array(frames * 32) } };
    } };
    if (base === 'embedding_model.onnx') return { inputNames: ['input_1'], outputNames: ['output'], async run(feeds) {
      assert(same(feeds.input_1.dims, [1, 76, 32, 1]) && feeds.input_1.data.length === 76 * 32, 'embedding input is [1, 76, 32, 1]'); stats.embed++;
      return { output: { data: new Float32Array(96).fill(0.5) } };
    } };
    return { inputNames: ['x'], outputNames: ['y'], async run(feeds) {
      assert(same(feeds.x.dims, [1, 16, 96]) && feeds.x.data.length === 16 * 96, 'wake model input is [1, 16, 96]'); stats.wake++;
      return { y: { data: new Float32Array([state.score]) } };
    } };
  };
  const ort = { Tensor, InferenceSession: { create: async (file) => fakeSession(file) } };
  return { ort, stats, state, session: (file) => fakeSession(file) };
}
const blocks = (n, amp = 0) => new Float32Array(n * 1280).fill(amp);

(async () => {
  // ---- the detector ----
  {
    const f = makeOrt();
    const det = createDetector({ ort: f.ort, mel: f.session('melspectrogram.onnx'), embed: f.session('embedding_model.onnx'), wake: f.session('w.onnx'), threshold: 0.5, patience: 2 });
    // audio is scaled to the int16 range, and a block is 1280 samples (80 ms): half a block waits for the other half
    let r = await det.feed(new Float32Array(640).fill(0.5)); assert.deepStrictEqual(r, { hit: false, score: 0 }); assert.strictEqual(f.stats.mel.length, 0);
    r = await det.feed(new Float32Array(640).fill(0.5)); assert.strictEqual(f.stats.mel.length, 1);
    assert.strictEqual(f.stats.mel[0].n, 1280); assert.strictEqual(f.stats.mel[0].max, 16384);
    r = await det.feed(new Float32Array(1280).fill(2)); assert.strictEqual(f.stats.mel[1].n, 1280 + 480, 'every block after the first brings 480 samples of the one before'); assert.strictEqual(f.stats.mel[1].max, 32767, 'loud audio is clipped, not wrapped');
    // the first embedding needs 76 mel frames (5 from the first block, 8 from each next one): block 10; the first score needs 16 embeddings: block 25
    await det.feed(blocks(7)); assert.strictEqual(f.stats.mel.length, 9); assert.strictEqual(f.stats.embed, 0);
    await det.feed(blocks(1)); assert.strictEqual(f.stats.embed, 1);
    f.state.score = 0.9;
    r = await det.feed(blocks(14)); assert.strictEqual(f.stats.embed, 15); assert.strictEqual(f.stats.wake, 0); assert.deepStrictEqual(r, { hit: false, score: 0 }, 'no score before 16 embeddings');
    r = await det.feed(blocks(1)); assert.strictEqual(f.stats.wake, 1); assert.strictEqual(r.hit, false, 'one block above the threshold is not enough'); assert.ok(Math.abs(r.score - 0.9) < 1e-6);
    r = await det.feed(blocks(1)); assert.strictEqual(r.hit, true, 'two in a row fire'); assert.strictEqual(f.stats.wake, 2);
    // after a hit the same phrase cannot fire again until 16 new embeddings exist
    r = await det.feed(blocks(15)); assert.strictEqual(f.stats.wake, 2); assert.strictEqual(r.hit, false);
    r = await det.feed(blocks(1)); assert.strictEqual(f.stats.wake, 3); assert.strictEqual(r.hit, false);
    r = await det.feed(blocks(1)); assert.strictEqual(r.hit, true);
    // a score below the threshold breaks the streak
    f.state.score = 0.9; await det.feed(blocks(16)); f.state.score = 0.1; r = await det.feed(blocks(1)); f.state.score = 0.9; r = await det.feed(blocks(1)); assert.strictEqual(r.hit, false);
    // many blocks in one call: the hit is reported once for the call
    det.reset(); f.state.score = 0.9; r = await det.feed(blocks(40)); assert.strictEqual(r.hit, true); assert.ok(Math.abs(r.score - 0.9) < 1e-6);
    // reset starts over: the warm-up is needed again
    det.reset(); const w = f.stats.wake; r = await det.feed(blocks(24)); assert.strictEqual(f.stats.wake, w); assert.strictEqual(r.hit, false);
    // a quiet model never fires
    const f2 = makeOrt(); f2.state.score = 0.3;
    const quiet = createDetector({ ort: f2.ort, mel: f2.session('melspectrogram.onnx'), embed: f2.session('embedding_model.onnx'), wake: f2.session('w.onnx'), threshold: 0.5, patience: 2 });
    r = await quiet.feed(blocks(80)); assert.strictEqual(r.hit, false); assert.ok(Math.abs(r.score - 0.3) < 1e-6);
  }

  // ---- the files side ----
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ww-'));
  const calls = [];
  const mkFetch = (sizeFor) => async (url) => {
    calls.push(url); const n = sizeFor(url); if (!n) return { ok: false, status: 404 };
    let sent = false;
    return { ok: true, status: 200, headers: { get: () => String(n) }, body: { getReader: () => ({ async read() { if (sent) return { done: true }; sent = true; return { done: false, value: new Uint8Array(n) }; } }) } };
  };
  const KB = 1024;
  {
    const d = tmp(); const f = makeOrt();
    const ww = createWakeWord({ fs, path, dir: () => d, fetch: mkFetch(() => 600 * KB), loadOrt: () => f.ort });
    let s = ww.status();
    assert.ok(s.runtime.ok && !s.features.ready && s.models.length === 0 && s.active === null);
    assert.ok(s.presets.length >= 1 && s.presets.every((p) => !p.installed) && PRESETS.every((p) => s.presets.some((x) => x.id === p.id)));
    let r = await ww.start({ model: 'x' }); assert.ok(!r.ok && /not downloaded/.test(r.error));
    // download: both shared files, from the project's release, progress reaches 100, a second call does nothing
    const prog = []; r = await ww.download((pct, detail) => prog.push([pct, detail])); assert.ok(r.ok, JSON.stringify(r));
    assert.ok(FEATURES.every((x) => calls.some((u) => u === 'https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/' + x.file)));
    assert.strictEqual(prog[prog.length - 1][0], 100); assert.ok(/melspectrogram\.onnx/.test(prog[0][1]));
    const n = calls.length; r = await ww.download(); assert.ok(r.ok); assert.strictEqual(calls.length, n);
    assert.ok(ww.status().features.ready); assert.ok(!fs.readdirSync(d).some((x) => /\.part$/.test(x)), 'no half-downloaded file is left');
    // a ready-made model
    r = await ww.downloadPreset('nope'); assert.ok(!r.ok);
    r = await ww.downloadPreset(PRESETS[0].id); assert.ok(r.ok, JSON.stringify(r));
    s = ww.status(); assert.ok(s.presets.find((p) => p.id === PRESETS[0].id).installed); assert.ok(s.models.some((m) => m.id === PRESETS[0].id && m.preset && m.name === 'hey mycroft'));
    // importing a model of your own: safe name, size limits, only .onnx
    r = ww.addModel('My Phrase!.onnx', Buffer.alloc(20 * KB)); assert.deepStrictEqual(r, { ok: true, id: 'My_Phrase_' });
    assert.ok(!ww.addModel('tiny.onnx', Buffer.alloc(100)).ok); assert.ok(!ww.addModel('huge.onnx', Buffer.alloc(31 * 1048576)).ok); assert.ok(!ww.addModel('!!!', Buffer.alloc(20 * KB)).ok);
    const src = path.join(tmp(), 'sa lam.onnx'); fs.writeFileSync(src, Buffer.alloc(30 * KB));
    r = ww.importModel(src); assert.deepStrictEqual(r, { ok: true, id: 'sa_lam' });
    assert.ok(!ww.importModel(path.join(path.dirname(src), 'x.txt')).ok); assert.ok(!ww.importModel(path.join(path.dirname(src), 'missing.onnx')).ok);
    assert.ok(ww.listModels().some((m) => m.id === 'sa_lam' && !m.preset));
    assert.strictEqual(fs.statSync(path.join(d, 'models', 'sa_lam.onnx')).size, 30 * KB);
    // start / feed / stop
    r = await ww.start({ model: 'missing' }); assert.ok(!r.ok && /missing/.test(r.error));
    r = await ww.start({ model: '../etc/passwd' }); assert.ok(!r.ok);
    ww.addModel('broken.onnx', Buffer.alloc(20 * KB)); r = await ww.start({ model: 'broken' }); assert.ok(!r.ok && /could not start/.test(r.error)); assert.strictEqual(ww.status().active, null);
    r = await ww.start({ model: 'sa_lam', threshold: 5 }); assert.ok(r.ok, JSON.stringify(r)); assert.deepStrictEqual(ww.status().active, { model: 'sa_lam', threshold: 0.95 }, 'the threshold is kept in range');
    f.state.score = 0.99; let hit = false;
    for (let i = 0; i < 30; i++) { const x = await ww.feed(new Float32Array(1280).buffer); assert.ok(x.ok); if (x.hit) hit = true; }
    assert.ok(hit, 'a model that scores high fires through the whole chain');
    const typed = await ww.feed(new Float32Array(2560)); assert.ok(typed.ok && typeof typed.score === 'number');
    assert.ok(!(await ww.feed('not audio')).ok);
    ww.stop(); assert.deepStrictEqual(await ww.feed(new Float32Array(1280)), { ok: false, hit: false, score: 0 });
    // removing: an unknown or unsafe id is refused, the active model is stopped
    await ww.start({ model: 'sa_lam' }); assert.ok(ww.removeModel('sa_lam').ok); assert.strictEqual(ww.status().active, null); assert.ok(!ww.listModels().some((m) => m.id === 'sa_lam'));
    assert.ok(!ww.removeModel('../x').ok); assert.ok(!ww.removeModel('').ok); assert.ok(ww.removeModel('never_existed').ok);
  }
  { // a failed download says so and leaves nothing behind
    const d = tmp(); const ww = createWakeWord({ fs, path, dir: () => d, fetch: mkFetch(() => 0), loadOrt: () => makeOrt().ort });
    const r = await ww.download(); assert.ok(!r.ok && /Could not download/.test(r.error)); assert.ok(!ww.status().features.ready);
    const short = createWakeWord({ fs, path, dir: () => d, fetch: mkFetch(() => 1000), loadOrt: () => makeOrt().ort });
    const r2 = await short.download(); assert.ok(!r2.ok); assert.ok(!(fs.existsSync(d) && fs.readdirSync(d).length), 'a truncated file is not kept');
  }
  { // no runtime: a message, not a crash
    const d = tmp(); const ww = createWakeWord({ fs, path, dir: () => d, loadOrt: () => { throw new Error('Cannot find module'); } });
    assert.ok(!ww.status().runtime.ok); const r = await ww.start({ model: 'x' }); assert.ok(!r.ok && /onnxruntime-node/.test(r.error));
  }
  console.log('wake word tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
