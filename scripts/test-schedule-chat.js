// A scheduled task on the server keeps all its runs in one chat, titled from its template ("Report {date}").
const assert = require('assert');
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
const { createHeadless } = require('../electron/core/headless');
const { chatTitle } = require('../electron/scheduler');
(async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'artemis-schedchat-'));
  const hl = createHeadless({ dataDir: data, port: 0, keychain: false, scheduler: false, telegram: false, connectors: false, browser: false, computer: false, log: () => {} });
  const addr = await hl.start();
  const T = JSON.parse(fs.readFileSync(path.join(data, 'gateway.json'), 'utf8')).token;
  const call = (method, p, body) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: addr.port, path: p, method, headers: { authorization: 'Bearer ' + T, 'content-type': 'application/json' } }, (res) => {
      let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(new Error(b)); } });
    });
    req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined);
  });
  const r = await call('POST', '/v1/x/schedules', { name: 'Daily report', prompt: 'Drink water', reminder: true, title: 'Daily report {date}', repeat: { type: 'daily', at: '09:00' } });
  const job = r.schedule; assert.ok(job && job.id, JSON.stringify(r));
  assert.strictEqual(job.oneChat, true);
  const wait = async (n) => { for (let i = 0; i < 50; i++) { const c = hl.sessions.get('sch-' + job.id); if (c && c.messages.length >= n) return c; await new Promise((res) => setTimeout(res, 100)); } return hl.sessions.get('sch-' + job.id); };
  await call('POST', `/v1/x/schedules/${job.id}/run`);
  let c = await wait(2);
  assert.ok(c, 'the task has its own chat');
  assert.strictEqual(c.title, chatTitle(job));
  assert.ok(/^Daily report \d{4}-\d{2}-\d{2}$/.test(c.title), c.title);
  await call('POST', `/v1/x/schedules/${job.id}/run`);
  c = await wait(4);
  assert.strictEqual(c.messages.length, 4, 'the second run goes into the same chat');
  assert.strictEqual(hl.sessions.toArray().filter((x) => x.source === 'schedule').length, 1);
  // a chat the AI renamed keeps that name
  hl.sessions.patchChat(c.id, { title: 'Renamed', titleManual: true });
  assert.strictEqual(hl.sessions.get(c.id).title, 'Renamed');
  assert.strictEqual(hl.sessions.get(c.id).titleManual, true);
  await hl.stop();
  console.log('test-schedule-chat: ok');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
