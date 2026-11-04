const assert = require('assert');

// ---- automatic summarising (compact)
(async () => {
  const { summarizeHistory } = require('../electron/agent.js');
  const realFetch = global.fetch; let calls = 0; let lastBody = null;
  global.fetch = async (u, o) => { calls++; lastBody = JSON.parse(o.body); return { ok: true, json: async () => ({ choices: [{ message: { content: 'SUMMARY-' + calls } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }) }; };
  const mk = () => {
    const h = [];
    for (let i = 0; i < 6; i++) { h.push({ role: 'user', content: 'question ' + i + ' ' + 'y'.repeat(3000) }); h.push({ role: 'assistant', content: 'answer ' + i }); }
    h.push({ role: 'user', content: 'latest request' });
    h.push({ role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a"}' } }] });
    h.push({ role: 'tool', tool_call_id: 'c1', content: 'file text' });
    return h;
  };
  const opts = { url: 'http://x/v1/chat/completions', key: 'k', model: 'm', limitTokens: 1000 };
  let h = mk();
  assert.strictEqual(await summarizeHistory(h, opts), true);
  assert.strictEqual(calls, 1);
  assert.ok(h[0].content.includes('SUMMARY-1'));
  assert.strictEqual(h[1].content, 'latest request');           // the latest request is kept
  assert.strictEqual(h[h.length - 1].role, 'tool');             // tool pair is not split
  assert.strictEqual(h.length, 4);
  assert.ok(lastBody.messages[1].content.includes('question 0'));
  // next turn of the same chat: the summary comes from the cache, the model is not called again
  h = mk();
  assert.strictEqual(await summarizeHistory(h, opts), true);
  assert.strictEqual(calls, 1);
  // failed summary -> false
  global.fetch = async () => ({ ok: false });
  assert.strictEqual(await summarizeHistory(mk().concat([{ role: 'user', content: 'z' }]), opts), false);
  global.fetch = realFetch;
  console.log('agent: summarizeHistory ok');
})().catch((e) => { console.error(e); process.exit(1); });

// ---- prompt cache marks
{
  const { withCache, cacheable } = require('../electron/agent.js');
  assert.ok(cacheable('anthropic/claude-sonnet-5.5') && cacheable('amazon/nova-2-lite-v1') && !cacheable('openai/gpt-6-sol'));
  const msgs = [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }, { role: 'assistant', content: null, tool_calls: [{ id: '1', type: 'function', function: { name: 'x', arguments: '{}' } }] }, { role: 'tool', tool_call_id: '1', content: 'result' }];
  const out = withCache(msgs);
  assert.deepStrictEqual(out[0].content, [{ type: 'text', text: 'sys', cache_control: { type: 'ephemeral' } }]);
  assert.strictEqual(out[3].content[0].cache_control.type, 'ephemeral');   // latest markable message (tool)
  assert.strictEqual(out[1].content, 'hi');                                  // the others are untouched
  assert.strictEqual(msgs[0].content, 'sys');                                // the original history is not changed
  const shot = [{ role: 'system', content: 's' }, { role: 'user', content: [{ type: 'text', text: 'look' }, { type: 'image_url', image_url: { url: 'data:x' } }] }];
  assert.strictEqual(withCache(shot)[1].content[0].cache_control.type, 'ephemeral');
  console.log('agent: withCache ok');
}

// ---- automatic compact threshold: per-model window and the token estimate of a chat
(async () => {
  const { contextWindowOf, chatTokens } = await import('../src/lib/history.js');
  assert.strictEqual(contextWindowOf('cli:claude:claude-opus-5-5'), 200000);
  assert.strictEqual(contextWindowOf('prov:google:gemini-3-flash'), 1000000);
  assert.strictEqual(contextWindowOf('prov:groq:llama-3.1-8b-instant'), 32000);
  assert.strictEqual(contextWindowOf('prov:x:unknown-model'), 128000);
  const msgs = [{ role: 'user', content: 'a'.repeat(4000) }, { role: 'assistant', steps: [{ text: 'b'.repeat(4000), toolCalls: [] }] }];
  const t = chatTokens(msgs);
  assert.ok(t >= 2000 && t < 2100, 'chat tokens ~ chars/4: ' + t);
  console.log('compact window ok');
})().catch((e) => { console.error(e); process.exit(1); });
