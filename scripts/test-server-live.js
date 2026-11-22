// The apps' live stream (GET /v1/events): a chat written on the server is announced at once (id, title, deleted), and
// which chats have an answer running.
const assert = require('assert');
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
const { createHeadless } = require('../electron/core/headless');
(async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'artemis-live-'));
  const hl = createHeadless({ dataDir: data, port: 0, keychain: false, scheduler: false, telegram: false, connectors: false, browser: false, computer: false, log: () => {} });
  const addr = await hl.start();
  const T = JSON.parse(fs.readFileSync(path.join(data, 'gateway.json'), 'utf8')).token;
  let buf = '';
  const req = http.get({ host: '127.0.0.1', port: addr.port, path: '/v1/events', headers: { authorization: 'Bearer ' + T } }, (res) => { assert.ok(/event-stream/.test(res.headers['content-type'])); res.setEncoding('utf8'); res.on('data', (d) => { buf += d; }); });
  await new Promise((r) => setTimeout(r, 400));
  hl.sessions.importChats([{ id: 'c1', title: 'Hello', messages: [{ id: 'm1', role: 'user', content: 'hi' }], updatedAt: Date.now() }]);
  await new Promise((r) => setTimeout(r, 1500));
  hl.sessions.remove('c1');
  await new Promise((r) => setTimeout(r, 1500));
  req.destroy(); await hl.stop();
  const evs = buf.split('\n\n').filter(Boolean).map((b) => ({ type: (/event: (.+)/.exec(b) || [])[1], data: JSON.parse((/data: (.+)/.exec(b) || [])[1] || 'null') }));
  assert.strictEqual(evs[0].type, 'hello');
  assert.ok(evs.some((e) => e.type === 'runs' && Array.isArray(e.data.sessions)));
  const s = evs.filter((e) => e.type === 'sessions').flatMap((e) => e.data.items);
  assert.ok(s.some((x) => x.id === 'c1' && x.title === 'Hello' && !x.deleted), 'a new chat is announced');
  assert.ok(s.some((x) => x.id === 'c1' && x.deleted), 'a deleted chat is announced');
  console.log('test-server-live: ok');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
