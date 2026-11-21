// Home server pieces: pairing and client tokens, public host / origin rules, the web app, runs that survive a dropped
// connection, the turn builder, the server-side history (same as the window's), and the session helpers used by clients.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { createClients, normCode } = require('../electron/core/clients');
const { createGateway } = require('../electron/core/gateway');
const { createRunHub } = require('../electron/core/runhub');
const { createTurnBuilder } = require('../electron/core/turn-builder');
const { toApiMessages } = require('../electron/core/history');

function call(port, method, p, { token, body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), ...(data ? { 'content-type': 'application/json' } : {}), ...headers } }, (res) => {
      let s = ''; res.setEncoding('utf8'); res.on('data', (x) => { s += x; });
      res.on('end', () => { let j = null; try { j = JSON.parse(s); } catch {} resolve({ status: res.statusCode, json: j, raw: s, headers: res.headers }); });
    });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}
const events = (raw) => raw.split('\n\n').filter(Boolean).map((b) => { let ev = '', d = '', id = ''; for (const l of b.split('\n')) { if (l.startsWith('event: ')) ev = l.slice(7); if (l.startsWith('data: ')) d += l.slice(6); if (l.startsWith('id: ')) id = l.slice(4); } return d ? { ev, id: Number(id), d: JSON.parse(d) } : null; }).filter(Boolean);
/** Opens an SSE request and resolves after `n` events, then drops the connection (like a phone going to the background). */
function partial(port, p, { token, body, n }) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ host: '127.0.0.1', port, method: data ? 'POST' : 'GET', path: p, headers: { authorization: 'Bearer ' + token, ...(data ? { 'content-type': 'application/json' } : {}) } }, (res) => {
      let buf = ''; const got = []; res.setEncoding('utf8');
      res.on('data', (x) => { buf += x; let i; while ((i = buf.indexOf('\n\n')) >= 0) { got.push(...events(buf.slice(0, i + 2))); buf = buf.slice(i + 2); } if (got.length >= n) { req.destroy(); resolve(got); } });
      res.on('end', () => resolve(got));
    });
    req.on('error', (e) => { if (e.code !== 'ECONNRESET') reject(e); });
    if (data) req.write(data); req.end();
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'artemis-server-'));

  // ---- clients: pairing codes and tokens ----
  {
    let t = 1000;
    const file = path.join(tmp, 'clients.json');
    const cl = createClients({ file, now: () => t, maxFailures: 3 });
    const p = cl.createPairing({ label: 'console' });
    assert.ok(/^[2-9A-Z]{4}-[2-9A-Z]{4}$/.test(p.code), p.code);
    assert.ok(!fs.readFileSync(file, 'utf8').includes(p.code.replace('-', '')), 'only the hash of a code is stored');
    if (process.platform !== 'win32') assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
    assert.throws(() => cl.exchange('AAAA-AAAA', { from: 'x' }), (e) => e.status === 401);
    const r = cl.exchange(p.code.toLowerCase().replace('-', ' '), { name: 'Ulvi\u0000 Mac', kind: 'desktop', from: 'x' });
    assert.ok(/^art_[a-f0-9]{16}\./.test(r.token));
    assert.strictEqual(r.client.name, 'Ulvi Mac'); assert.strictEqual(r.client.kind, 'desktop');
    assert.ok(!fs.readFileSync(file, 'utf8').includes(r.token.split('.')[1]), 'only the hash of a token is stored');
    assert.throws(() => cl.exchange(p.code, { from: 'y' }), (e) => e.status === 401, 'single use');
    assert.strictEqual(cl.verify(r.token).id, r.client.id);
    assert.strictEqual(cl.verify(r.token + 'x'), null);
    assert.strictEqual(cl.verify('art_0000000000000000.' + 'a'.repeat(40)), null);
    // expiry
    const p2 = cl.createPairing();
    t += 11 * 60 * 1000;
    assert.throws(() => cl.exchange(p2.code, { from: 'z' }), (e) => e.status === 401, 'expired');
    // rate limit: 3 wrong codes from one address block it, even a right code then
    const p3 = cl.createPairing();
    assert.throws(() => cl.exchange('BBBB-BBBB', { from: 'evil' }));
    assert.throws(() => cl.exchange('CCCC-CCCC', { from: 'evil' }));
    assert.throws(() => cl.exchange(p3.code, { from: 'evil' }), (e) => e.status === 429);
    t += 11 * 60 * 1000;
    const p4 = cl.createPairing();
    const r2 = cl.exchange(p4.code, { name: 'Phone', kind: 'mobile', from: 'evil' });
    // rotate and revoke
    const rot = cl.rotate(r2.client.id);
    assert.strictEqual(cl.verify(r2.token), null, 'old token dead after rotate');
    assert.strictEqual(cl.verify(rot.token).name, 'Phone');
    assert.ok(cl.revoke(r2.client.id));
    assert.strictEqual(cl.verify(rot.token), null, 'revoked');
    assert.ok(cl.list().find((x) => x.id === r2.client.id).revoked);
    assert.ok(cl.remove(r2.client.id));
    assert.ok(!cl.list().some((x) => x.id === r2.client.id));
    assert.ok(!cl.remove(r.client.id), 'an active client is not removed, only revoked ones');
    // survives a restart
    const cl2 = createClients({ file, now: () => t });
    assert.strictEqual(cl2.verify(r.token).id, r.client.id);
    assert.strictEqual(normCode(' k7qm-2xrd '), 'K7QM2XRD');
  }

  // ---- turn builder ----
  {
    let t = 0;
    const tb = createTurnBuilder({ id: 'a1', via: 'mobile', model: 'prov:x:m', now: () => (t += 10) });
    tb.apply({ type: 'thinking', text: 'hmm ' });
    tb.apply({ type: 'chunk', text: 'Let me check.' });
    tb.apply({ type: 'tool:call', id: 't1', name: 'write_file', args: { path: 'a.txt' } });
    tb.apply({ type: 'tool:approval', id: 't1', category: 'write', summary: 'Write a.txt' });
    tb.apply({ type: 'tool:result', id: 't1', ok: true, text: 'Wrote a.txt' });
    tb.apply({ type: 'files', items: [{ path: '/srv/a.csv', name: 'a.csv', size: 3, ext: 'csv' }] });
    tb.apply({ type: 'step:new' });
    tb.apply({ type: 'tool:call', id: 'd1', name: 'delegate', args: {} });
    tb.apply({ type: 'agent:start', parent: 'd1', idx: 0, agent: 'Athena', role: 'research', task: 'x' });
    tb.apply({ type: 'tool:call', id: 's1', name: 'web_search', args: {}, agent: { parent: 'd1', idx: 0 } });
    tb.apply({ type: 'chunk', text: 'ignored: a helper agent', agent: { parent: 'd1', idx: 0 } });
    tb.apply({ type: 'step:new' });
    tb.apply({ type: 'chunk', text: 'Done.' });
    tb.apply({ type: 'artifact', id: 'art1', title: 'Plan', kind: 'markdown', content: '# x' });
    tb.apply({ type: 'step:new' });
    const m = tb.finish();
    assert.strictEqual(m.steps.length, 3, 'empty trailing step dropped');
    assert.strictEqual(m.steps[0].text, 'Let me check.');
    assert.strictEqual(m.steps[0].thinking.text, 'hmm ');
    assert.strictEqual(typeof m.steps[0].thinking.ms, 'number');
    assert.strictEqual(m.steps[0].toolCalls[0].status, 'done');
    assert.strictEqual(m.steps[0].files[0].env, 'server');
    assert.strictEqual(m.steps[1].toolCalls[0].status, 'cancelled', 'open delegate card closed');
    assert.strictEqual(m.steps[1].toolCalls[0].agents[0].status, 'cancelled');
    assert.strictEqual(m.steps[1].toolCalls[0].agents[0].tools[0].status, 'cancelled');
    assert.deepStrictEqual(m.steps[2].artifactRefs, ['art1']);
    assert.strictEqual(tb.artifacts().art1.versions[0], '# x');
    assert.strictEqual(tb.text(), 'Done.');
    assert.strictEqual(m.via, 'mobile'); assert.strictEqual(m.env, 'server');
    const blank = createTurnBuilder({}); blank.apply({ type: 'step:new' });
    assert.ok(/No answer was written/.test(blank.finish().notices[0]));
  }

  // ---- history: same as the window's toApiMessages ----
  {
    const msgs = [
      { id: 'u0', role: 'user', content: 'old' }, { id: 'a0', role: 'assistant', steps: [{ text: 'old answer', toolCalls: [] }] },
      { id: 'u1', role: 'user', content: 'Summary so far', compacted: true },
      { id: 'u2', role: 'user', content: 'look', attachments: [{ kind: 'image', name: 'p', url: 'artemis-media://0123456789abcdef0123456789abcdef.png' }, { kind: 'file', name: 'a.txt', text: 'x'.repeat(3500), lib: 'a.txt' }], mentions: [{ kind: 'skill', name: 'Deploy' }] },
      { id: 'a2', role: 'assistant', steps: [{ text: '<think>plan</think>Reading', toolCalls: [{ id: 'c1', name: 'read_file', args: { path: 'a' }, result: 'data' }, { id: 'c2', name: 'x', args: null }] }, { text: 'Answer [warm]', toolCalls: [] }] }
    ];
    const mine = toApiMessages(msgs);
    assert.strictEqual(mine[0].content, 'Summary so far', 'starts at the latest compact');
    assert.strictEqual(mine[1].content[1].image_url.url, 'artemis-media://0123456789abcdef0123456789abcdef.png');
    assert.strictEqual(mine[4].content, '(cancelled)');
    // the window's own implementation, loaded as ESM
    const dir = fs.mkdtempSync(path.join(tmp, 'h-'));
    const lib = path.join(__dirname, '..', 'src', 'lib');
    for (const f of ['think.mjs', 'tts-emotion.mjs', 'mentions.mjs']) fs.copyFileSync(path.join(lib, f), path.join(dir, f));
    fs.writeFileSync(path.join(dir, 'history.mjs'), fs.readFileSync(path.join(lib, 'history.js'), 'utf8'));
    const theirs = (await import(require('url').pathToFileURL(path.join(dir, 'history.mjs')).href)).toApiMessages(msgs);
    assert.deepStrictEqual(mine, theirs, 'server history = window history');
  }

  // ---- run hub: resume after a gap, snapshot, approvals ----
  {
    const hub = createRunHub({ maxEvents: 5 });
    let release;
    const gate = new Promise((r) => { release = r; });
    hub.start({ runId: 'r1', sessionId: 's1', exec: async (emit, ctx) => {
      ctx.setSnapshot(() => ({ id: 'm', steps: [{ text: 'so far' }] }));
      for (let i = 0; i < 8; i++) emit({ type: 'chunk', text: String(i) });
      emit({ type: 'tool:approval', id: 'ap1', summary: 'Run ls', category: 'shell' });
      await gate;
      return { sessionId: 's1', text: 'ok' };
    }, abort: () => true });
    await sleep(5);
    assert.throws(() => hub.start({ sessionId: 's1', exec: async () => ({}) }), (e) => e.status === 409);
    assert.deepStrictEqual(hub.approvals().map((a) => a.id), ['ap1']);
    const got = [];
    const un = hub.subscribe('r1', 2, (e) => got.push(e));
    assert.strictEqual(got[0].type, 'snapshot', 'missed events are replaced by a snapshot');
    assert.strictEqual(got[0].data.message.steps[0].text, 'so far');
    assert.deepStrictEqual(got.slice(1).map((e) => e.seq), [6, 7, 8, 9, 10]);
    release(); await hub.wait('r1');
    assert.strictEqual(got[got.length - 1].type, 'done');
    assert.strictEqual(hub.approvals().length, 0, 'approvals of a finished run are gone');
    un();
    const late = []; hub.subscribe('r1', 10, (e) => late.push(e.type));
    assert.deepStrictEqual(late, ['done']);
    hub.start({ runId: 'r2', exec: async () => { throw Object.assign(new Error('Bad model\nstack'), { status: 400 }); } });
    await assert.rejects(hub.wait('r2'), /Bad model/);
    assert.strictEqual(hub.get('r2').error, 'Bad model');
  }

  // ---- gateway: pairing over HTTP, hosts, origins, web app, detach and resume ----
  {
    const web = path.join(tmp, 'web');
    fs.mkdirSync(path.join(web, '_expo', 'static'), { recursive: true });
    fs.writeFileSync(path.join(web, 'index.html'), '<html>app</html>');
    fs.writeFileSync(path.join(web, 'chats.html'), '<html>chats</html>');
    fs.writeFileSync(path.join(web, '_expo', 'static', 'a.js'), 'x');
    fs.writeFileSync(path.join(tmp, 'secret.txt'), 'nope');
    const mediaDir = path.join(tmp, 'media'); fs.mkdirSync(mediaDir);
    fs.writeFileSync(path.join(mediaDir, '0123456789abcdef0123456789abcdef.png'), 'PNG');
    const clients = createClients({ file: path.join(tmp, 'gw-clients.json') });
    const approved = [];
    let slowRelease = null;
    const gw = createGateway({ port: 0, token: 'admin-token-xyz', clients, publicHosts: 'artemis.example.com', allowedOrigins: ['https://app.example.com'], webRoot: web, handlers: {
      info: () => ({ mode: 'test', version: '9.9.9' }),
      chat: async ({ message, client }, emit, ctx) => {
        ctx.setSnapshot(() => ({ id: 'm1' }));
        emit({ type: 'chunk', text: 'hi ' + (client ? client.kind : 'admin') });
        if (message === 'slow') { emit({ type: 'tool:approval', id: 'ap9', summary: 'x' }); await new Promise((r) => { slowRelease = r; }); }
        return { sessionId: 'sx', text: 'hi' };
      },
      abort: () => { if (slowRelease) slowRelease(); return true; }, approve: (id, ok) => { approved.push([id, ok]); return true; },
      sessions: { recent: (n, o) => [{ id: 's1', o }], get: (id) => (id === 's1' ? { id: 's1', title: 'T', messages: [{ id: 'x', role: 'user', content: 'hi' }] } : null), search: () => [] },
      media: { file: (n) => path.join(mediaDir, n) },
      extra: async (area, o) => (area === 'echo' ? { parts: o.parts, body: await o.body() } : undefined)
    } });
    const { port } = await gw.start();
    // no token: ping and pair only
    assert.strictEqual((await call(port, 'GET', '/v1/ping')).json.version, '9.9.9');
    assert.strictEqual((await call(port, 'GET', '/v1/health')).status, 401);
    let r = await call(port, 'POST', '/v1/pairing', { token: 'admin-token-xyz', body: { label: 'test' } });
    const code = r.json.code;
    r = await call(port, 'POST', '/v1/pair', { body: { code: 'ZZZZ-ZZZZ' }, headers: { 'cf-connecting-ip': '1.2.3.4' } });
    assert.strictEqual(r.status, 401);
    r = await call(port, 'POST', '/v1/pair', { body: { code, name: 'Pixel', kind: 'mobile' } });
    assert.strictEqual(r.status, 200); assert.strictEqual(r.json.server.version, '9.9.9');
    const tok = r.json.token;
    assert.strictEqual((await call(port, 'GET', '/v1/me', { token: tok })).json.client.name, 'Pixel');
    // a client can make a code for another device, list and revoke
    r = await call(port, 'POST', '/v1/pairing', { token: tok, body: {} });
    const r2 = await call(port, 'POST', '/v1/pair', { body: { code: r.json.code, name: 'Browser', kind: 'web' } });
    r = await call(port, 'GET', '/v1/clients', { token: tok });
    assert.deepStrictEqual(r.json.clients.map((c) => c.name).sort(), ['Browser', 'Pixel']);
    await call(port, 'POST', `/v1/clients/${r2.json.client.id}/revoke`, { token: tok });
    assert.strictEqual((await call(port, 'GET', '/v1/me', { token: r2.json.token })).status, 401, 'revoked token refused');
    // Host: loopback, the tunnel's hostname, nothing else
    assert.strictEqual((await call(port, 'GET', '/v1/health', { token: tok, headers: { host: 'artemis.example.com' } })).status, 200);
    assert.strictEqual((await call(port, 'GET', '/v1/health', { token: tok, headers: { host: 'evil.example.com' } })).status, 403);
    // Origin: the allowed list and the gateway's own web app get CORS; others are refused
    r = await call(port, 'OPTIONS', '/v1/chat', { headers: { origin: 'https://app.example.com', 'access-control-request-method': 'POST' } });
    assert.strictEqual(r.status, 204); assert.strictEqual(r.headers['access-control-allow-origin'], 'https://app.example.com');
    r = await call(port, 'GET', '/v1/health', { token: tok, headers: { origin: 'https://artemis.example.com', host: 'artemis.example.com' } });
    assert.strictEqual(r.status, 200, 'same origin as the served web app');
    assert.strictEqual((await call(port, 'GET', '/v1/health', { token: tok, headers: { origin: 'https://evil.example' } })).status, 403);
    // web app: files, client routes, no escaping the folder
    assert.strictEqual((await call(port, 'GET', '/')).raw, '<html>app</html>');
    assert.strictEqual((await call(port, 'GET', '/chats')).raw, '<html>chats</html>');
    assert.strictEqual((await call(port, 'GET', '/chat/abc')).raw, '<html>app</html>');
    r = await call(port, 'GET', '/_expo/static/a.js');
    assert.ok(/immutable/.test(r.headers['cache-control']));
    assert.notStrictEqual((await call(port, 'GET', '/..%2fsecret.txt')).raw, 'nope');
    assert.notStrictEqual((await call(port, 'GET', '/../secret.txt')).raw, 'nope');
    // media and the full chat
    assert.strictEqual((await call(port, 'GET', '/v1/media/0123456789abcdef0123456789abcdef.png', { token: tok })).raw, 'PNG');
    assert.strictEqual((await call(port, 'GET', '/v1/media/..%2fsecret.txt', { token: tok })).status, 404);
    assert.strictEqual((await call(port, 'GET', '/v1/sessions/s1?full=1', { token: tok })).json.chat.messages[0].id, 'x');
    assert.strictEqual((await call(port, 'GET', '/v1/sessions?limit=5&before=99&project_id=p', { token: tok })).json.sessions[0].o.before, 99);
    // extra areas
    r = await call(port, 'POST', '/v1/x/echo/a/b', { token: tok, body: { z: 1 } });
    assert.deepStrictEqual(r.json.parts, ['a', 'b']); assert.strictEqual(r.json.body.z, 1);
    assert.strictEqual((await call(port, 'GET', '/v1/x/nothing', { token: tok })).status, 404);
    // a detached run keeps going when the client drops, and can be resumed
    const first = await partial(port, '/v1/chat', { token: tok, body: { message: 'slow', session_id: 'sess-1', detach: true }, n: 3 });
    assert.deepStrictEqual(first.map((e) => e.ev), ['run', 'chunk', 'tool:approval']);
    assert.strictEqual(first[1].d.text, 'hi mobile');
    const runId = first[0].d.run_id;
    assert.strictEqual(first[0].d.session_id, 'sess-1');
    await sleep(50);
    r = await call(port, 'GET', '/v1/runs?active=1', { token: tok });
    assert.deepStrictEqual(r.json.runs.map((x) => x.run_id), [runId], 'still running after the client left');
    assert.strictEqual((await call(port, 'POST', '/v1/chat', { token: tok, body: { message: 'x', session_id: 'sess-1' } })).status, 409);
    r = await call(port, 'GET', '/v1/approvals', { token: tok });
    assert.deepStrictEqual(r.json.approvals.map((a) => a.id), ['ap9']);
    r = await call(port, 'POST', '/v1/approvals/ap9', { token: tok, body: { approve: true } });
    assert.ok(r.json.ok); assert.deepStrictEqual(approved, [['ap9', true]]);
    assert.strictEqual((await call(port, 'GET', '/v1/approvals', { token: tok })).json.approvals.length, 0);
    setTimeout(() => slowRelease(), 50);
    r = await call(port, 'GET', `/v1/runs/${runId}/events?after=2`, { token: tok });
    assert.deepStrictEqual(events(r.raw).map((e) => e.ev), ['tool:approval', 'done']);
    assert.strictEqual(events(r.raw)[1].d.text, 'hi');
    r = await call(port, 'GET', `/v1/runs/${runId}/events`, { token: tok, headers: { 'last-event-id': '3' } });
    assert.deepStrictEqual(events(r.raw).map((e) => e.ev), ['done']);
    // a run that is not detached stops when its client leaves
    slowRelease = null;
    await partial(port, '/v1/chat', { token: tok, body: { message: 'slow', session_id: 'sess-2' }, n: 2 });
    await sleep(50);
    assert.strictEqual((await call(port, 'GET', '/v1/runs?active=1', { token: tok })).json.runs.length, 0, 'aborted');
    // the gateway's own token still works for the CLI
    assert.strictEqual((await call(port, 'GET', '/v1/me', { token: 'admin-token-xyz' })).json.client.id, 'gateway-token');
    await gw.stop();
  }

  // ---- sessions: turns written by the server, patches, imports ----
  const { available, openDb } = require('../electron/core/db');
  if (available()) {
    const { createSessions } = require('../electron/core/sessions');
    const db = openDb(path.join(tmp, 's.db'));
    const s = createSessions({ db, writer: 'headless' });
    s.startTurn('c1', { user: { id: 'u1', role: 'user', content: 'hello there' }, assistant: { id: 'a1', role: 'assistant', steps: [{ text: '', toolCalls: [] }] }, title: 'hello there', source: 'mobile', model: 'prov:x:m' });
    s.putMessage('c1', { id: 'a1', role: 'assistant', steps: [{ text: 'partial kamal', toolCalls: [] }] });
    assert.deepStrictEqual(s.search('kamal').map((h) => h.id), ['c1'], 'progress is searchable');
    const fin = s.putMessage('c1', { id: 'a1', role: 'assistant', steps: [{ text: 'final answer', toolCalls: [] }] }, { patch: { model: 'prov:x:n' }, final: true });
    assert.strictEqual(fin.messages.length, 2); assert.strictEqual(fin.messages[1].steps[0].text, 'final answer'); assert.strictEqual(fin.model, 'prov:x:n');
    assert.deepStrictEqual(s.search('kamal'), [], 'old text left the index');
    // a window saving the same chat back changes nothing
    assert.strictEqual(s.sync(s.toArray(), { writer: 'headless' }).changed, 0);
    s.startTurn('c1', { user: { id: 'u2', role: 'user', content: 'more' }, assistant: { id: 'a2', role: 'assistant', steps: [] } });
    assert.strictEqual(s.get('c1').messages.length, 4);
    assert.strictEqual(s.page({ limit: 5 })[0].id, 'c1');
    assert.strictEqual(s.patchChat('c1', { title: 'Renamed', pinned: true, junk: 1 }).title, 'Renamed');
    assert.ok(!('junk' in s.get('c1')));
    assert.deepStrictEqual(s.search('Renamed').map((h) => h.id), ['c1']);
    const imp = s.importChats([{ id: 'c1', title: 'x', messages: [{ id: 'u1', role: 'user', content: 'hello there' }, { id: 'u9', role: 'user', content: 'from the mac' }] }, { id: 'c2', title: 'Mac chat', updatedAt: 5, createdAt: 4, messages: [{ id: 'm', role: 'user', content: 'imported' }] }, { id: 'bad' }]);
    assert.deepStrictEqual([imp.added, imp.merged, imp.skipped, imp.failed.length], [1, 1, 0, 1]);
    assert.strictEqual(s.get('c2').updatedAt, 5, 'timestamps kept');
    const again = s.importChats([{ id: 'c2', title: 'Mac chat', messages: [{ id: 'm', role: 'user', content: 'imported' }] }]);
    assert.strictEqual(again.skipped, 1, 'a retried import adds nothing');
    assert.ok(s.remove('c2')); assert.strictEqual(s.get('c2'), null); assert.ok(!s.remove('c2'));
    db.close();
  } else console.log('test-server: node:sqlite not available, session part skipped');

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('test-server: ok');
})().catch((e) => { console.error(e); process.exit(1); });
