const assert = require('assert');
(async () => {
  const { canResume, resumeMessage, CONTINUE_NOTE } = await import('../src/lib/resume.mjs');
  const m = { id: 'a', role: 'assistant', error: 'fetch failed', steps: [
    { text: 'Looking', toolCalls: [{ id: 't1', name: 'list_dir', args: {}, result: 'a.txt', status: 'done' }] },
    { text: '', toolCalls: [{ id: 't2', name: 'read_file', args: { path: 'a.txt' }, status: 'running' }] },
    { text: '', toolCalls: [] }] };
  assert.ok(canResume(m));
  assert.ok(!canResume({ ...m, error: '' }), 'only failed answers');
  assert.ok(!canResume({ role: 'assistant', error: 'x', steps: [{ text: 'hi', toolCalls: [] }] }), 'nothing done: regenerate instead');
  const { sent, kept } = resumeMessage(m);
  assert.strictEqual(sent.error, undefined); assert.strictEqual(sent.steps.length, 1); assert.strictEqual(sent.steps[0].toolCalls.length, 1);
  assert.strictEqual(kept.steps.length, 2); assert.deepStrictEqual(kept.steps[1], { text: '', toolCalls: [] }); assert.strictEqual(kept.id, 'a', 'the same message carries on');
  assert.match(CONTINUE_NOTE, /Continue from where you stopped/);
  console.log('resume tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
