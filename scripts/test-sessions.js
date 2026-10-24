// SQLite chat sessions: sync from the renderer's array, rebuild, search, append, soft delete.
const assert = require('assert');
const { openDb, ftsQuery } = require('../electron/core/db');
const { createSessions } = require('../electron/core/sessions');

const db = openDb(':memory:');
if (!db) { console.log('test-sessions: node:sqlite not available, skipped'); process.exit(0); }
const s0 = createSessions({ db, writer: 'renderer' });
const pick = (r) => ({ changed: r.changed, deleted: r.deleted });
const s = { ...s0, sync: (a, o) => pick(s0.sync(a, o)) };

const chats = [
  { id: 'a', title: 'Deploy plan', projectId: 'p1', model: 'prov:x:m', updatedAt: 2000, messages: [
    { id: 'm1', role: 'user', content: 'How do we deploy the Nocturne server to Hetzner?' },
    { id: 'm2', role: 'assistant', steps: [{ text: 'Use Docker compose and a Caddy reverse proxy.', toolCalls: [] }] }] },
  { id: 'b', title: 'Şəkil ölçüsü', updatedAt: 1000, messages: [{ id: 'm3', role: 'user', content: 'Ölçünü dəyiş, rəngləri saxla' }] },
  { id: 'c', title: 'Secret', incognito: true, updatedAt: 3000, messages: [{ id: 'm4', role: 'user', content: 'deploy something private' }] }
];

// round trip is lossless and keeps the order
let r = s.sync(chats);
assert.deepStrictEqual(r, { changed: 3, deleted: 0 });
assert.deepStrictEqual(s.toArray(), chats);
assert.strictEqual(s.count(), 3);

// unchanged array writes nothing; a moved chat only updates its order
assert.deepStrictEqual(s.sync(chats), { changed: 0, deleted: 0 });
assert.deepStrictEqual(s.sync([chats[1], chats[0], chats[2]]), { changed: 0, deleted: 0 });
assert.deepStrictEqual(s.toArray().map((c) => c.id), ['b', 'a', 'c']);

// search: BM25, prefix match, diacritics folded, incognito never found
let hits = s.search('deploy');
assert.deepStrictEqual(hits.map((h) => h.id), ['a']);
assert.ok(/deploy/i.test(hits[0].snippet));
assert.deepStrictEqual(s.search('depl').map((h) => h.id), ['a']);
assert.deepStrictEqual(s.search('olcunu').map((h) => h.id), ['b']);
assert.deepStrictEqual(s.search('sekil').map((h) => h.id), ['b'], 'title match');
assert.deepStrictEqual(s.search('caddy hetzner').map((h) => h.id), ['a'], 'words from two messages');
assert.deepStrictEqual(s.search('caddy kubernetes').map((h) => h.id), ['a'], 'falls back to OR');
assert.deepStrictEqual(s.search('').length, 0);
assert.strictEqual(ftsQuery('ab "cd" ef"gh'), '"ab" "cd" "ef" "gh"', 'quotes cannot break out');
assert.strictEqual(ftsQuery('deploy'), '"deploy"*');
assert.strictEqual(ftsQuery('NEAR(x y) OR -z'), '"near" "or"', 'operators are plain words');

// edit a message: rewritten and re-indexed
const edited = JSON.parse(JSON.stringify(chats));
edited[0].messages[1].steps[0].text = 'Use Kamal instead.';
assert.deepStrictEqual(s.sync(edited), { changed: 1, deleted: 0 });
assert.deepStrictEqual(s.search('caddy').map((h) => h.id), []);
assert.deepStrictEqual(s.search('kamal').map((h) => h.id), ['a']);

// removed chat: soft deleted, gone from search and the array, listed in trash
assert.deepStrictEqual(s.sync([edited[0], edited[2]]), { changed: 0, deleted: 1 });
assert.deepStrictEqual(s.toArray().map((c) => c.id), ['a', 'c']);
assert.deepStrictEqual(s.search('olcunu').length, 0);
assert.deepStrictEqual(s.trash().map((t) => t.id), ['b']);
assert.strictEqual(s.purge(30), 0);
assert.strictEqual(s.purge(-1), 1);
assert.deepStrictEqual(s.trash().length, 0);

// appendTurn: new chat goes to the top; existing chat grows
const c1 = s.appendTurn('gw-1', { user: 'hello from the gateway', assistant: 'hi', via: 'gateway', source: 'gateway', model: 'prov:x:m' });
assert.strictEqual(c1.messages.length, 2);
assert.strictEqual(s.toArray()[0].id, 'gw-1');
s.appendTurn('a', { user: 'and the database?', assistant: 'SQLite with WAL.' });
assert.strictEqual(s.get('a').messages.length, 4);
assert.deepStrictEqual(s.search('wal').map((h) => h.id), ['a']);
// the renderer saving its (older) array afterwards keeps working: the chat is rewritten from what it sends
const back = s.toArray();
assert.deepStrictEqual(s.sync(back), { changed: 0, deleted: 0 }, 'array read back is in sync');

// recent and read
const rec = s.recent(5);
assert.deepStrictEqual(rec.map((x) => x.id).sort(), ['a', 'gw-1']);
assert.ok(/SQLite with WAL/.test(s.read('a', 10)));
assert.strictEqual(s.read('c', 10), null, 'incognito is never read');

// a second open of the same database sees the same data (hash cache rebuilt)
const s2 = createSessions({ db, writer: 'renderer' });
assert.deepStrictEqual(pick(s2.sync(back)), { changed: 0, deleted: 0 });

assert.throws(() => s.sync(null));

// ---- two writers on one database (desktop window + headless gateway) ----
{
  const db2 = openDb(':memory:');
  const ui = createSessions({ db: db2, writer: 'renderer' });
  const gw = createSessions({ db: db2, writer: 'headless' });
  const base = [{ id: 'x', title: 'X', updatedAt: 1, messages: [{ id: 'u1', role: 'user', content: 'one' }] }];
  ui.sync(base);
  let seen = db2.seq();
  // the gateway adds a turn to x and creates a new chat y
  gw.appendTurn('x', { user: 'two', assistant: 'answer two' });
  gw.appendTurn('y', { user: 'new chat from the phone', assistant: 'hi' });
  let ch = ui.changesSince(seen, { exclude: 'renderer' });
  assert.deepStrictEqual(ch.chats.map((c) => c.id).sort(), ['x', 'y']);
  assert.strictEqual(ch.chats.find((c) => c.id === 'x').messages.length, 3);
  assert.ok(ch.seq > seen);
  // the window saves its stale array (without the gateway turn, without y): nothing is lost
  const known = new Set(['x']);
  const stale = [{ ...base[0], title: 'X renamed' }];
  const r1 = ui.sync(stale, { known });
  assert.strictEqual(r1.merged.length, 1, 'stale save merged');
  assert.strictEqual(ui.get('x').messages.length, 3);
  assert.strictEqual(ui.get('x').title, 'X renamed');
  assert.ok(ui.get('y'), 'unseen chat is not deleted');
  // the merged copy is reported back as a change for the window (writer "merge")
  ch = ui.changesSince(ch.seq, { exclude: 'renderer' });
  assert.deepStrictEqual(ch.chats.map((c) => c.id), ['x']);
  // after the window has the chats, a save without y deletes it (the user deleted it)
  const now = ui.toArray();
  known.add('y');
  ui.sync(now.filter((c) => c.id !== 'y'), { known });
  assert.strictEqual(ui.get('y'), null);
  ch = ui.changesSince(0, { exclude: 'renderer' });
  assert.ok(!ch.deleted.includes('y'), 'own deletes are not echoed back');
  gw.appendTurn('x', { user: 'three', assistant: 'a3' });
  ch = ui.changesSince(ch.seq, { exclude: 'renderer' });
  assert.strictEqual(ch.chats[0].messages.length, 5);
  // a delete by the gateway side shows up as deleted
  const gwArr = gw.toArray();
  gw.sync(gwArr.filter((c) => c.id !== 'x'));
  ch = ui.changesSince(ch.seq, { exclude: 'renderer' });
  assert.deepStrictEqual(ch.deleted, ['x']);
}
console.log('test-sessions: ok');
