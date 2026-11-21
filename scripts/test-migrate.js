// Desktop → server migration end to end: a desktop data folder is exported (electron/migrate-export.js) through a paired
// link to a real headless server (core/migrate-import.js), then checked: chats, media, memory, projects, settings,
// secrets, connectors, the report, the backup, a retry that adds nothing, and paths that must be refused.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { safeRel, unionLines } = require('../electron/core/migrate-import');
const { createSecretStore } = require('../electron/core/secret-store');

(async () => {
  const { available } = require('../electron/core/db');
  if (!available()) { console.log('test-migrate: node:sqlite not available, skipped'); return; }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'artemis-mig-'));

  // ---- paths ----
  for (const ok of ['chats.jsonl', 'workspace/MEMORY.md', 'workspace/memory/2026-11-20.md', 'skills/deploy/SKILL.md', 'agents/Athena.md', 'media/0123456789abcdef0123456789abcdef.png']) assert.strictEqual(safeRel(ok), ok);
  for (const bad of ['../x', '/etc/passwd', 'workspace/../../x.md', 'workspace/a.sh', 'skills/.git/config', 'media/x.png', 'secrets/x', 'settings.json/x', 'a\\b', 'workspace//x.md', 'headless.json', 'clients.json']) assert.throws(() => safeRel(bad), /Bad|Not allowed|Only Markdown/, bad);
  assert.strictEqual(unionLines('- a\n- b\n', '- b\n- c\n'), '- a\n- b\n- c\n');
  assert.strictEqual(unionLines('- a\n', '- a\n'), null);

  // ---- secret store ----
  {
    const d = path.join(tmp, 'ss'); fs.mkdirSync(d);
    const s = createSecretStore({ dataDir: d, env: {} });
    s.set('provider:openai', 'sk-123');
    assert.strictEqual(s.get('provider:openai'), 'sk-123');
    assert.ok(!fs.readFileSync(path.join(d, 'secrets.enc.json'), 'utf8').includes('sk-123'));
    assert.strictEqual(s.keySource(), 'file');
    const other = createSecretStore({ dataDir: d, env: { ARTEMIS_MASTER_KEY: 'different' } });
    assert.strictEqual(other.get('provider:openai'), '', 'a different master key reads nothing');
    s.set('provider:openai', ''); assert.deepStrictEqual(s.names(), []);
    assert.throws(() => s.set('bad name!', 'x'));
  }

  // ---- a desktop data folder ----
  const desk = path.join(tmp, 'desktop'); fs.mkdirSync(desk);
  const w = (rel, data) => { const f = path.join(desk, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof data === 'string' ? data : JSON.stringify(data)); };
  const png = crypto.randomBytes(64); const pngName = crypto.createHash('sha256').update(png).digest('hex').slice(0, 32) + '.png';
  w('media/' + pngName, png);
  w('media/.DS_Store', 'x');
  w('workspace/MEMORY.md', '# Memory\n\n- Deploys with Kamal.\n- Likes short answers.\n');
  w('workspace/memory/2026-11-20.md', '- met the team\n');
  w('skills/deploy/SKILL.md', '---\nname: deploy\n---\nDo it.');
  w('agents/athena.md', '---\nname: Athena\n---\nResearch.');
  w('projects.json', [{ id: 'p1', name: 'Clinic site', folder: '/Users/ulvi/nowhere-xyz' }, { id: 'p2', name: 'No folder' }]);
  w('teams.json', { teams: [{ id: 't1', name: 'Growth', members: [] }] });
  w('schedules.json', [{ id: 'j1', name: 'Morning brief', prompt: 'x', enabled: true }]);
  w('settings.json', { model: 'prov:openai:gpt-x', personality: 'warm', workspaceFolder: '/Users/ulvi/ws', gatewayPort: 9999, telegramEnabled: true, telegramChatId: '555', telegramTokenEnc: 'v10abc', profileName: 'Ulvi' });
  w('providers.json', [{ id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', enabled: true, models: [{ id: 'gpt-x' }] }]);
  w('mcp.json', [{ id: 'c1', name: 'Notion', type: 'http', url: 'https://mcp.notion.com', headers: { Authorization: 'enc:AAAA' } }, { id: 'c2', name: 'Local files', type: 'stdio', command: '/Users/ulvi/bin/fs-mcp', args: [] }]);
  const chats = [
    { id: 'c-1', title: 'Kamal deploy', updatedAt: 1700000000000, createdAt: 1690000000000, messages: [{ id: 'u1', role: 'user', content: 'how do I deploy with kamal', attachments: [{ kind: 'image', name: 'shot', url: 'artemis-media://' + pngName }] }, { id: 'a1', role: 'assistant', steps: [{ text: 'Like this.', toolCalls: [{ id: 't', name: 'read_file', args: {}, status: 'done', result: 'x' }] }] }] },
    { id: 'c-2', title: 'Secret', incognito: true, messages: [{ id: 'x', role: 'user', content: 'private' }] }
  ];

  // ---- the server ----
  const srv = path.join(tmp, 'server'); fs.mkdirSync(srv);
  fs.writeFileSync(path.join(srv, 'settings.json'), JSON.stringify({ model: 'prov:local:m', gatewayPort: 8789, profileName: 'Server' }));
  fs.writeFileSync(path.join(srv, 'projects.json'), JSON.stringify([{ id: 'p2', name: 'No folder (server copy)' }]));
  const { createHeadless } = require('../electron/core/headless');
  const h = createHeadless({ dataDir: srv, port: 0, keychain: false, scheduler: false, telegram: false, connectors: false, browser: false, computer: false, log: () => {} });
  h.workspace.write && null;
  fs.mkdirSync(path.join(srv, 'workspace'), { recursive: true });
  fs.writeFileSync(path.join(srv, 'workspace', 'MEMORY.md'), '# Memory\n\n- Lives in Baku.\n');
  const addr = await h.start();

  // ---- pair the desktop and export ----
  const { createServerLink } = require('../electron/server-link');
  const { createExporter } = require('../electron/migrate-export');
  let cfg = null, token = '';
  const link = createServerLink({ getConfig: () => cfg, setConfig: (c) => { cfg = c; }, getToken: () => token, setToken: (t) => { token = t; } });
  await link.connect({ url: `http://127.0.0.1:${addr.port}`, code: h.clients.createPairing().code, name: 'Mac' });
  const readJson = (n, fb) => { try { return JSON.parse(fs.readFileSync(path.join(desk, n + '.json'), 'utf8')); } catch { return fb; } };
  const ex = createExporter({
    dataDir: desk, workspaceDir: () => path.join(desk, 'workspace'), listChats: () => chats, readJson,
    providerKey: (id) => (id === 'openai' ? 'sk-desktop-key' : ''), secret: (n) => ({ telegramToken: '123:tg', braveKey: 'brave-1' })[n] || '',
    mcpDecrypted: () => [{ id: 'c1', headers: { Authorization: 'Bearer ntn_secret' } }, { id: 'c2' }], link, from: { name: 'Mac', platform: 'darwin', version: '1.8.1' }
  });
  const sv = ex.survey();
  assert.strictEqual(sv.chats.count, 1, 'incognito chats are not offered'); assert.strictEqual(sv.media.count, 1); assert.strictEqual(sv.memory.count, 2);
  const progress = [];
  const mig = await ex.run({ secrets: true, telegram: 'move', automations: 'keep' }, (p) => progress.push(p.phase));
  assert.deepStrictEqual([...new Set(progress)], ['preparing', 'sending', 'applying', 'done']);
  assert.strictEqual(mig.status, 'done');
  const rep = mig.report;
  assert.strictEqual(rep.chats.added, 1); assert.strictEqual(rep.media.copied, 1);
  assert.strictEqual(rep.memory.merged, 1, 'MEMORY.md merged'); assert.strictEqual(rep.memory.added, 1, 'daily note added');
  assert.deepStrictEqual(rep.projects.withoutFolder, ['Clinic site']); assert.strictEqual(rep.projects.added, 1); assert.strictEqual(rep.projects.skipped, 1);
  assert.strictEqual(rep.automations.moved, false);
  assert.ok(rep.connectors.needSetup.some((x) => x.name === 'Local files'), JSON.stringify(rep.connectors));
  assert.ok(fs.existsSync(path.join(rep.backup, 'settings.json')) && fs.existsSync(path.join(rep.backup, 'artemis.db')), 'backup made first');
  assert.strictEqual(rep.failures.length, 0, JSON.stringify(rep.failures));

  // what the server has now
  const c1 = h.sessions.get('c-1');
  assert.ok(c1 && c1.messages.length === 2 && c1.updatedAt === 1700000000000, 'chat with its ids and times');
  assert.strictEqual(c1.messages[1].steps[0].toolCalls[0].name, 'read_file');
  assert.strictEqual(h.sessions.get('c-2'), null, 'incognito chat stayed home');
  assert.ok(fs.existsSync(path.join(srv, 'media', pngName)));
  const mem = fs.readFileSync(path.join(srv, 'workspace', 'MEMORY.md'), 'utf8');
  assert.ok(mem.includes('Lives in Baku') && mem.includes('Deploys with Kamal'), mem);
  assert.ok(fs.existsSync(path.join(srv, 'skills', 'deploy', 'SKILL.md')) && fs.existsSync(path.join(srv, 'agents', 'athena.md')));
  const sst = JSON.parse(fs.readFileSync(path.join(srv, 'settings.json'), 'utf8'));
  assert.strictEqual(sst.personality, 'warm'); assert.strictEqual(sst.gatewayPort, 8789, 'machine settings stay'); assert.ok(!('workspaceFolder' in sst) && !('telegramTokenEnc' in sst));
  assert.strictEqual(sst.telegramEnabled, true, 'telegram moved');
  assert.strictEqual(h.getProviderKey('openai'), 'sk-desktop-key', 'provider key usable on the server');
  assert.strictEqual(h.secretStore.get('telegramToken'), '123:tg');
  assert.strictEqual(h.secretStore.get('braveKey'), 'brave-1');
  const smcp = JSON.parse(fs.readFileSync(path.join(srv, 'mcp.json'), 'utf8'));
  assert.ok(/^sec:mcp:c1:headers\.Authorization$/.test(smcp[0].headers.Authorization), smcp[0].headers.Authorization);
  assert.strictEqual(h.secretStore.get(smcp[0].headers.Authorization.slice(4)), 'Bearer ntn_secret');
  assert.strictEqual(smcp[1].enabled, false, 'a connector that runs a Mac program is switched off');
  assert.ok(!fs.readFileSync(path.join(srv, 'mcp.json'), 'utf8').includes('ntn_secret'), 'no secret in plain text');
  assert.ok(!fs.existsSync(path.join(srv, 'schedules.json')), 'schedules kept on the desktop');
  assert.ok(!fs.existsSync(path.join(srv, 'migrate', mig.id, 'files')), 'the uploaded copy is removed');
  // desktop data untouched
  assert.strictEqual(readJson('projects', [])[0].folder, '/Users/ulvi/nowhere-xyz');

  // ---- a retry adds nothing; moving the schedules later ----
  const again = await ex.run({ telegram: 'keep', automations: 'move', areas: ['chats', 'media', 'memory', 'automations'] });
  assert.strictEqual(again.report.chats.added, 0); assert.strictEqual(again.report.chats.skipped, 1);
  assert.strictEqual(again.report.media.skipped, 1); assert.strictEqual(again.report.memory.added, 0);
  assert.strictEqual(again.report.automations.added, 1);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(srv, 'schedules.json'), 'utf8'))[0].id, 'j1');

  // ---- secrets sent later: a connector already on the server gets them ----
  {
    const fresh = JSON.parse(fs.readFileSync(path.join(srv, 'mcp.json'), 'utf8'));
    fresh[0].headers.Authorization = ''; fs.writeFileSync(path.join(srv, 'mcp.json'), JSON.stringify(fresh)); // as after a move without secrets
    const m3 = await ex.run({ secrets: true, areas: ['connectors'] });
    assert.strictEqual(m3.report.connectors.updated, 1, JSON.stringify(m3.report.connectors));
    const back = JSON.parse(fs.readFileSync(path.join(srv, 'mcp.json'), 'utf8'));
    assert.strictEqual(h.secretStore.get(back[0].headers.Authorization.slice(4)), 'Bearer ntn_secret');
  }

  // ---- refused uploads ----
  const T = token;
  const put = (p, body) => fetch(`http://127.0.0.1:${addr.port}${p}`, { method: 'PUT', headers: { authorization: 'Bearer ' + T }, body });
  const post = (p, body) => fetch(`http://127.0.0.1:${addr.port}${p}`, { method: 'POST', headers: { authorization: 'Bearer ' + T, 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, j: await r.json() }));
  let r = await post('/v1/x/migrate', { manifest: { files: [{ path: '../../etc/passwd', size: 1, sha256: 'a'.repeat(64) }] } });
  assert.strictEqual(r.status, 400); assert.ok(/Bad path/.test(r.j.error), r.j.error);
  const good = Buffer.from('- hello\n');
  r = await post('/v1/x/migrate', { manifest: { files: [{ path: 'workspace/x.md', size: good.length, sha256: crypto.createHash('sha256').update(good).digest('hex') }] } });
  const mid = r.j.migration.id;
  let pr = await put(`/v1/x/migrate/${mid}/file?path=workspace%2Fx.md`, Buffer.from('- evil!!\n'));
  assert.strictEqual(pr.status, 413, 'too big refused');
  pr = await put(`/v1/x/migrate/${mid}/file?path=workspace%2Fx.md`, Buffer.from('- evil!\n'));
  assert.strictEqual(pr.status, 422, 'damaged file refused');
  pr = await put(`/v1/x/migrate/${mid}/file?path=workspace%2Fother.md`, good);
  assert.strictEqual(pr.status, 400, 'not in the manifest');
  r = await post(`/v1/x/migrate/${mid}/commit`, {});
  assert.strictEqual(r.status, 409, 'nothing applied before every file arrived');
  pr = await put(`/v1/x/migrate/${mid}/file?path=workspace%2Fx.md`, good);
  assert.strictEqual(pr.status, 200);
  r = await post(`/v1/x/migrate/${mid}/commit`, {});
  assert.strictEqual(r.j.migration.status, 'done');
  // without a token: nothing
  assert.strictEqual((await fetch(`http://127.0.0.1:${addr.port}/v1/x/migrate`, { method: 'POST', body: '{}' })).status, 401);
  // keys over the API: names only, never values
  r = await post('/v1/x/secrets', { providerKeys: { anthropic: 'sk-ant' } });
  assert.ok(r.j.names.includes('provider:anthropic'));
  const g = await fetch(`http://127.0.0.1:${addr.port}/v1/x/secrets`, { headers: { authorization: 'Bearer ' + T } }).then((x) => x.json());
  assert.ok(!JSON.stringify(g).includes('sk-'), 'secret values are never sent back');

  await h.stop();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('test-migrate: ok');
})().catch((e) => { console.error(e); process.exit(1); });
