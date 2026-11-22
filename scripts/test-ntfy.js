// Phone notifications through ntfy: settings, the message sent, and the server sending one when a scheduled task ends.
const assert = require('assert');
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
const ntfy = require('../electron/core/ntfy');
const { createHeadless } = require('../electron/core/headless');
(async () => {
  // settings: switching on makes a private topic; bad servers fall back to ntfy.sh
  const p = ntfy.patchFrom({ on: true }, {});
  assert.ok(p.ntfyOn && /^artemis-[a-f0-9]{24}$/.test(p.ntfyTopic));
  assert.strictEqual(ntfy.config({ ...p, ntfyServer: 'not a url' }).server, 'https://ntfy.sh');
  assert.strictEqual(ntfy.config({ ...p }).links.app, 'ntfy://ntfy.sh/' + p.ntfyTopic);
  assert.ok(!ntfy.patchFrom({ schedules: false }, p).ntfyTopic, 'a topic is kept');
  assert.notStrictEqual(ntfy.patchFrom({ newTopic: true }, p).ntfyTopic, p.ntfyTopic);
  // what goes out
  const got = [];
  const fake = async (url, o) => { got.push({ url, body: JSON.parse(o.body) }); return { ok: true, status: 200 }; };
  let r = await ntfy.send({}, { kind: 'schedule', title: 'x' }, { fetchImpl: fake });
  assert.ok(r.skipped && !got.length, 'off: nothing is sent');
  r = await ntfy.send(p, { kind: 'schedule', title: 'Daily report', message: '**Done**: 3 [links](http://x)', chatId: 'sch-a1' }, { fetchImpl: fake });
  assert.ok(r.ok);
  assert.strictEqual(got[0].url, 'https://ntfy.sh');
  assert.deepStrictEqual([got[0].body.topic, got[0].body.title, got[0].body.message, got[0].body.click], [p.ntfyTopic, 'Daily report', 'Done: 3 links', 'artemis://chat/sch-a1']);
  await ntfy.send({ ...p, ntfyPreview: false }, { kind: 'chat', title: 'T', message: 'secret' }, { fetchImpl: fake });
  assert.ok(!/secret/.test(got[1].body.message), 'no text when the preview is off');
  r = await ntfy.send({ ...p, ntfyApprovals: false }, { kind: 'approval', title: 'T' }, { fetchImpl: fake });
  assert.ok(r.skipped && got.length === 2, 'a switched-off kind is not sent');
  r = await ntfy.send(p, { kind: 'test' }, { fetchImpl: async () => ({ ok: false, status: 429 }) });
  assert.ok(!r.ok && /429/.test(r.error));

  // the server: settings over /v1/x/notify, and a scheduled task pushes when it ends
  const pushed = [];
  const fakeNtfy = http.createServer((req, res) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { pushed.push(JSON.parse(b)); res.end('{}'); }); });
  await new Promise((ok) => fakeNtfy.listen(0, '127.0.0.1', ok));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'artemis-ntfy-'));
  const hl = createHeadless({ dataDir: data, port: 0, keychain: false, scheduler: false, telegram: false, connectors: false, browser: false, computer: false, log: () => {} });
  const addr = await hl.start();
  const T = JSON.parse(fs.readFileSync(path.join(data, 'gateway.json'), 'utf8')).token;
  const call = (method, u, body) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: addr.port, path: u, method, headers: { authorization: 'Bearer ' + T, 'content-type': 'application/json' } }, (res) => {
      let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => { try { resolve(JSON.parse(b)); } catch { reject(new Error(b)); } });
    });
    req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined);
  });
  let n = (await call('GET', '/v1/x/notify')).notify;
  assert.strictEqual(n.on, false);
  n = (await call('POST', '/v1/x/notify', { on: true, server: `http://127.0.0.1:${fakeNtfy.address().port}` })).notify;
  assert.ok(n.on && n.topic);
  assert.ok((await call('POST', '/v1/x/notify/test', {})).ok);
  const job = (await call('POST', '/v1/x/schedules', { name: 'Daily report', prompt: 'Drink water', reminder: true, repeat: { type: 'daily', at: '09:00' } })).schedule;
  await call('POST', `/v1/x/schedules/${job.id}/run`);
  for (let i = 0; i < 50 && pushed.length < 2; i++) await new Promise((ok) => setTimeout(ok, 100));
  assert.strictEqual(pushed[0].topic, n.topic);
  assert.strictEqual(pushed[1].title, 'Daily report');
  assert.strictEqual(pushed[1].click, 'artemis://chat/sch-' + job.id);
  assert.strictEqual(pushed[1].message, 'Drink water');
  await hl.stop(); fakeNtfy.close();
  console.log('test-ntfy: ok');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
