// Memory v2: workspace files (MEMORY.md entries, daily notes, context), the hybrid index and the pre-compaction flush.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createWorkspace, idOf } = require('../electron/core/workspace');
const { createMemIndex, chunk, cosine } = require('../electron/core/memindex');
const { flushMemory } = require('../electron/core/memflush');
const { openDb } = require('../electron/core/db');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artemis-ws-'));
  let changes = 0;
  const ws = createWorkspace({ dir, onChange: () => changes++ });

  // first run: starter files, old memory.json entries moved into MEMORY.md
  ws.ensure([{ id: 'x1', text: 'Prefers short answers.' }, { id: 'x2', text: 'Lives in Baku.' }]);
  for (const f of ['SOUL.md', 'USER.md', 'MEMORY.md']) assert.ok(fs.existsSync(path.join(dir, f)), f);
  assert.deepStrictEqual(ws.list().map((m) => m.text), ['Prefers short answers.', 'Lives in Baku.']);
  ws.ensure([{ text: 'never imported twice' }]);
  assert.strictEqual(ws.list().length, 2);

  // add: stable ids, duplicates by words
  const a = ws.add('Works with n8n and Make.');
  assert.strictEqual(a.id, idOf('works with n8n and make'));
  assert.ok(ws.add('works with N8N and make').duplicate);
  assert.strictEqual(ws.list().length, 3);
  assert.ok(changes >= 1);

  // hand edits: comments, code fences and checkboxes are not entries; text around entries survives
  fs.appendFileSync(path.join(dir, 'MEMORY.md'), '\n## Projects\n<!--\n- not an entry\n-->\n```\n- also not\n```\n- [ ] a todo\n* Runs Orbix Tech.\n');
  assert.deepStrictEqual(ws.list().map((m) => m.text), ['Prefers short answers.', 'Lives in Baku.', 'Works with n8n and Make.', 'Runs Orbix Tech.']);
  assert.ok(ws.remove(idOf('Lives in Baku.')));
  assert.ok(!ws.remove('nope'));
  assert.ok(fs.readFileSync(path.join(dir, 'MEMORY.md'), 'utf8').includes('## Projects'));

  // replaceAll (the Memory panel): entries replaced in place, the rest kept
  ws.replaceAll([{ text: 'Prefers short answers.' }, { text: 'Uses pnpm.' }]);
  const body = fs.readFileSync(path.join(dir, 'MEMORY.md'), 'utf8');
  assert.deepStrictEqual(ws.list().map((m) => m.text), ['Prefers short answers.', 'Uses pnpm.']);
  assert.ok(body.includes('## Projects') && body.includes('- not an entry') && body.includes('- [ ] a todo'), body);

  // daily notes and context
  const d = new Date(2026, 9, 24, 14, 5);
  const y = new Date(2026, 9, 23, 9, 0);
  ws.note('Started the core gateway branch', d);
  ws.note('Picked SQLite (node:sqlite)\nno native module', d);
  ws.note('Read the OpenClaw docs', y);
  const day = fs.readFileSync(path.join(dir, 'memory/2026-10-24.md'), 'utf8');
  assert.ok(day.startsWith('# 2026-10-24') && day.includes('- 14:05 Started the core gateway branch') && day.includes('\n  no native module'), day);
  let ctx = ws.context({ now: d });
  assert.strictEqual(ctx.soul, '', 'template only = empty');
  assert.strictEqual(ctx.user, '');
  assert.ok(ctx.daily.includes('Yesterday (2026-10-23)') && ctx.daily.includes('OpenClaw') && ctx.daily.includes('Today (2026-10-24)'), ctx.daily);
  fs.appendFileSync(path.join(dir, 'SOUL.md'), '\nSpeak Azerbaijani with me. Never use filler.\n');
  ctx = ws.context({ now: d });
  assert.strictEqual(ctx.soul, 'Speak Azerbaijani with me. Never use filler.');

  // read: inside the workspace only
  const r = ws.read('memory/2026-10-24.md', 3, 1);
  assert.strictEqual(r.from, 3); assert.ok(r.text.includes('Started the core'));
  assert.throws(() => ws.read('../secret.md'), /inside the workspace/);
  assert.throws(() => ws.read('/etc/passwd'), /Markdown|outside|inside/);
  fs.writeFileSync(path.join(os.tmpdir(), 'artemis-outside.md'), 'x');
  try { fs.symlinkSync(path.join(os.tmpdir(), 'artemis-outside.md'), path.join(dir, 'link.md')); assert.throws(() => ws.read('link.md'), /outside/); } catch (e) { if (e.code !== 'EPERM') throw e; }
  try { fs.unlinkSync(path.join(dir, 'link.md')); } catch {}

  // chunking keeps line numbers
  const ch = chunk('# A\nline one\nline two\n# B\nthree');
  assert.deepStrictEqual(ch.map((c) => [c.start, c.end]), [[1, 3], [4, 5]]);
  assert.ok(Math.abs(cosine([1, 0], [1, 0]) - 1) < 1e-9 && cosine([1, 0], [0, 1]) === 0);

  // index + search
  const db = openDb(':memory:');
  if (!db) { console.log('test-workspace: node:sqlite not available, index tests skipped'); return; }
  fs.writeFileSync(path.join(dir, 'USER.md'), '# User\n\nUlvi runs Orbix Tech, an automation agency in Baku.\n\n## Stack\nElectron, React, n8n, Cloudflare Workers.\n');
  const idx = createMemIndex({ db, workspace: ws });
  idx.reindex({ force: true });
  assert.ok(idx.stats().chunks >= 4);
  let hits = await idx.search('cloudflare');
  assert.strictEqual(hits[0].path, 'USER.md');
  assert.ok(hits[0].from >= 5 && hits[0].text.includes('Cloudflare'));
  hits = await idx.search('sqlite native');
  assert.strictEqual(hits[0].path, 'memory/2026-10-24.md');
  hits = await idx.search('baku agency');
  assert.ok(hits.some((h) => h.path === 'USER.md'));
  // file change is picked up, deleted files leave the index
  fs.writeFileSync(path.join(dir, 'memory/2026-10-23.md'), '# 2026-10-23\n\n- 09:00 Tried Hermes Agent session search\n');
  idx.reindex({ force: true });
  assert.strictEqual((await idx.search('openclaw')).length, 0);
  assert.strictEqual((await idx.search('hermes'))[0].path, 'memory/2026-10-23.md');
  fs.unlinkSync(path.join(dir, 'memory/2026-10-23.md'));
  idx.reindex({ force: true });
  assert.strictEqual((await idx.search('hermes')).length, 0);

  // vectors: a fake embedder that maps words to fixed axes; meaning-only matches are found and cached
  const AX = ['deploy', 'server', 'cat', 'pet'];
  const vec = (t) => AX.map((w) => (String(t).toLowerCase().includes(w) ? 1 : 0)).concat([0.01]);
  let calls = 0;
  const fake = { model: 'fake-1', embed: async (texts) => { calls++; return texts.map(vec); } };
  fs.writeFileSync(path.join(dir, 'memory/2026-10-20.md'), '# 2026-10-20\n\n- 10:00 Bought food for the pet\n');
  const vidx = createMemIndex({ db, workspace: ws, embedder: () => fake });
  vidx.reindex({ force: true });
  hits = await vidx.search('pet');
  assert.strictEqual(hits[0].path, 'memory/2026-10-20.md');
  assert.strictEqual(hits[0].via, 'both');
  assert.ok(vidx.stats().embedded >= vidx.stats().chunks - 0);
  const before = calls;
  await vidx.embedPending();
  assert.strictEqual(calls, before, 'nothing left to embed');
  // a failing embedder falls back to keywords
  const bad = createMemIndex({ db, workspace: ws, embedder: () => ({ model: 'bad', embed: async () => { throw new Error('down'); } }) });
  assert.strictEqual((await bad.search('pet'))[0].path, 'memory/2026-10-20.md');

  // flush: facts to MEMORY.md (deduped, secrets dropped), notes to today's daily file
  let seen = '';
  const ask = async (sys, user) => { seen = user; return { facts: ['Uses pnpm.', 'Deploys with Kamal.', 'My API key is sk-abcdefghijk'], notes: ['Decided to keep chats.json as a mirror'] }; };
  const r2 = await flushMemory({ transcript: 'x'.repeat(500), ask, workspace: ws });
  assert.deepStrictEqual(r2, { facts: 1, notes: 1 });
  assert.ok(seen.includes('- Uses pnpm.'), 'existing memory is passed so it is not repeated');
  assert.ok(ws.list().some((m) => m.text === 'Deploys with Kamal.'));
  assert.ok(!ws.list().some((m) => /sk-/.test(m.text)));
  assert.deepStrictEqual(await flushMemory({ transcript: 'short', ask, workspace: ws }), { facts: 0, notes: 0 });
  assert.deepStrictEqual(await flushMemory({ transcript: 'y'.repeat(500), ask: async () => null, workspace: ws }), { facts: 0, notes: 0 });

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('test-workspace: ok');
})().catch((e) => { console.error(e); process.exit(1); });
