const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const C = require('../electron/core/context.js');

assert.strictEqual(C.thresholdFor(200000, 8192), 141808);
assert.strictEqual(C.thresholdFor(128000, 8192), 87808);
assert.strictEqual(C.thresholdFor(32000, 4096), 19904);
assert.ok(C.thresholdFor(1000000, 32000) <= 800000);
assert.ok(C.thresholdFor(8000) >= 3200, 'never below 40% of the window');

// pressure: the provider's number plus an estimate of what came after it
const m = C.createPressureMeter();
const h = [{ role: 'user', content: 'x'.repeat(400) }];
assert.strictEqual(m.measure(h, 1000), 1100, 'no anchor: everything estimated (100 + fixed 1000)');
m.observe(5000, 1, 1000);
assert.strictEqual(m.measure(h, 1000), 5000);
h.push({ role: 'assistant', content: 'y'.repeat(800) });
assert.strictEqual(m.measure(h, 1000), 5200, 'anchor + estimate of the new message');
assert.strictEqual(m.measure(h, 1400), 5600, 'a bigger tool list counts too');
m.reset(); assert.strictEqual(m.anchored, false);

const framed = C.frameSummary('## Primary Request and Intent\n- x');
assert.ok(C.isCheckpoint({ role: 'user', content: framed }) && framed.includes('Continue the task'));
assert.ok(C.SUMMARY_INSTRUCTION.includes('## Next Step') && C.SUMMARY_INSTRUCTION.includes('PRIOR checkpoint'));

// spill
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artemis-spill-'));
assert.deepStrictEqual(C.spillText('short', { dir }), { text: 'short', file: '' });
const big = 'A'.repeat(30000) + 'MIDDLE' + 'Z'.repeat(30000);
const r = C.spillText(big, { dir, owner: 'chat 1', name: 'run_command', id: 'call_123' });
assert.ok(r.file && fs.readFileSync(r.file, 'utf8') === big, 'the whole result is on disk');
assert.ok(r.text.length < 30000 && r.text.startsWith('AAAA') && r.text.endsWith('ZZZZ') && r.text.includes(r.file));
assert.ok(!r.text.includes('MIDDLE'));
assert.ok(C.spillText(big, {}).text.includes('omitted to save tokens'), 'no folder: cut, not lost silently');
fs.utimesSync(path.dirname(r.file), new Date(0), new Date(0));
assert.strictEqual(C.cleanSpill(dir), 1);
fs.rmSync(dir, { recursive: true, force: true });
(async () => {
  const { costOf } = await import('../src/lib/cost.js').catch(() => ({}));
  if (costOf) assert.strictEqual(costOf({ model: 'x', prompt: 1e6, completion: 0, usd: 0.0123 }), 0.0123, "the provider's own cost wins");
  console.log('context tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
(async () => {
  const assert = require('assert');
  const ctx = require('../electron/core/context');
  const { thresholdFor, compactLimit } = await import('../src/lib/compact-threshold.mjs');
  for (const [w, o] of [[200000, 8192], [128000, 4096], [32000, 2048], [1000000, 32000], [8000, 1024]]) assert.strictEqual(thresholdFor(w, o), ctx.thresholdFor(w, o));
  assert.strictEqual(compactLimit(200000, 50), 100000);
  assert.strictEqual(compactLimit(200000, 95, 8192), ctx.thresholdFor(200000, 8192));
  console.log('compact threshold (renderer = main) tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
