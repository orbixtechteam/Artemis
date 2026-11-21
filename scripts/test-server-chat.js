// The desktop's server chats (electron/server-chat.js) against a real headless server and a fake model:
// a turn on the server, a turn on "this computer" saved into the server chat, history without the server's pictures,
// and no silent fallback when the server is down.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { createServerChat, localHistory } = require('../electron/server-chat');
const { createServerLink } = require('../electron/server-link');

function fakeModel(script) {
  const seen = [];
  const srv = http.createServer((req, res) => {
    let raw = ''; req.on('data', (x) => { raw += x; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      seen.push(body);
      if (!body.stream) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ choices: [{ message: { content: '{"facts":[],"notes":[]}' } }] })); }
      const step = script.shift() || { text: 'ok' };
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const send = (o) => res.write('data: ' + JSON.stringify(o) + '\n\n');
      for (const w of step.text.split(/(?<= )/)) send({ choices: [{ index: 0, delta: { content: w }, finish_reason: null }] });
      send({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
      res.write('data: [DONE]\n\n'); res.end();
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, port: srv.address().port, seen })));
}

(async () => {
  const { available } = require('../electron/core/db');
  if (!available()) { console.log('test-server-chat: node:sqlite not available, skipped'); return; }
  // history for a local turn: the server's pictures become a note
  const h0 = localHistory([{ id: 'u', role: 'user', content: 'look', attachments: [{ kind: 'image', name: 'p', url: 'artemis-media://0123456789abcdef0123456789abcdef.png' }] }]);
  assert.ok(typeof h0[0].content === 'string' && h0[0].content.includes('a picture stored on the server'));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'artemis-schat-'));
  const fm = await fakeModel([{ text: 'Answer from the server.' }]);
  const data = path.join(tmp, 'server'); fs.mkdirSync(data);
  fs.writeFileSync(path.join(data, 'providers.json'), JSON.stringify([{ id: 'fake', name: 'Fake', baseUrl: `http://127.0.0.1:${fm.port}/v1`, enabled: true, needsKey: false, models: [{ id: 'm1' }] }]));
  fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ model: 'prov:fake:m1', webEnabled: false, autoLearn: false, delegateEnabled: false, notesAi: false, memoryFlush: false }));
  const { createHeadless } = require('../electron/core/headless');
  const h = createHeadless({ dataDir: data, port: 0, keychain: false, scheduler: false, telegram: false, connectors: false, browser: false, computer: false, log: () => {} });
  const addr = await h.start();

  let cfg = null, token = '';
  const link = createServerLink({ getConfig: () => cfg, setConfig: (c) => { cfg = c; }, getToken: () => token, setToken: (t) => { token = t; } });
  await link.connect({ url: `http://127.0.0.1:${addr.port}`, code: h.clients.createPairing().code, name: 'Mac' });

  const events = new Map();
  const waiters = new Map();
  const send = (rid, ev) => { if (!events.has(rid)) events.set(rid, []); events.get(rid).push(ev); if (ev.type === 'done' && waiters.has(rid)) waiters.get(rid)(); };
  const finished = (rid) => new Promise((r) => { if ((events.get(rid) || []).some((e) => e.type === 'done')) r(); else waiters.set(rid, r); });
  const localRuns = [];
  const sc = createServerChat({ link, send, settings: () => ({ model: 'prov:mac:local' }), abortLocal: () => {},
    executeRun: async (o) => { localRuns.push(o); o.send({ type: 'chunk', text: 'Answer from the Mac.' }); o.send({ type: 'tool:call', id: 't1', name: 'computer', args: {} }); o.send({ type: 'tool:result', id: 't1', ok: true, text: 'clicked', image: 'data:image/png;base64,' + 'A'.repeat(5000) }); o.send({ type: 'done' }); } });

  // 1. a turn on the server
  const a = await sc.start({ sessionId: 'd-test-1', message: 'hello server', env: 'server' });
  await finished(a.requestId);
  const evA = events.get(a.requestId);
  assert.ok(evA.some((e) => e.type === 'server:run'));
  assert.strictEqual(evA.filter((e) => e.type === 'chunk').map((e) => e.text).join(''), 'Answer from the server.');
  assert.strictEqual(evA.find((e) => e.type === 'done').text, 'Answer from the server.');
  let chat = h.sessions.get('d-test-1');
  assert.strictEqual(chat.messages.length, 2); assert.strictEqual(chat.messages[1].env, 'server'); assert.strictEqual(chat.messages[0].via, 'server', 'desktop turns on the server are marked');

  // 2. the next turn on this computer: server history in, the turn saved back marked local, screenshots left out
  const b = await sc.start({ sessionId: 'd-test-1', message: 'now on the mac', env: 'local' });
  await finished(b.requestId);
  assert.strictEqual(localRuns.length, 1);
  const sentHistory = localRuns[0].messages;
  assert.ok(sentHistory.some((m) => m.role === 'assistant' && /Answer from the server/.test(m.content)), 'server turns are the history');
  assert.strictEqual(sentHistory[sentHistory.length - 1].content, 'now on the mac');
  chat = h.sessions.get('d-test-1');
  assert.strictEqual(chat.messages.length, 4);
  assert.strictEqual(chat.messages[3].env, 'local');
  assert.strictEqual(chat.messages[3].steps[0].text, 'Answer from the Mac.');
  assert.strictEqual(chat.messages[3].steps[0].toolCalls[0].image, undefined, 'screenshots stay on the computer');
  assert.ok(h.sessions.search('Mac').some((x) => x.id === 'd-test-1'));

  // 3. the server is down: an error, never a run somewhere else
  await h.stop();
  await assert.rejects(sc.start({ sessionId: 'd-test-1', message: 'x', env: 'server' }), /not reachable/);
  await assert.rejects(sc.start({ sessionId: 'd-test-1', message: 'x', env: 'local' }), /not reachable/);
  assert.strictEqual(localRuns.length, 1, 'nothing ran on the computer instead');
  fm.srv.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('test-server-chat: ok');
})().catch((e) => { console.error(e); process.exit(1); });
