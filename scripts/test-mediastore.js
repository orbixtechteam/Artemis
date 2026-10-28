// Chat images as files: save/dedupe, links back to base64 for a model, the one-time move of old chats, clean-up.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createMediaStore, nameOf, namesIn } = require('../electron/core/mediastore');
const { openDb } = require('../electron/core/db');
const { createSessions } = require('../electron/core/sessions');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artemis-media-'));
const media = createMediaStore({ dir });
const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4d00000000049454e44ae426082', 'hex');
const dataUrl = 'data:image/png;base64,' + png.toString('base64');

// same picture -> same file; a link round-trips to the same bytes
const url = media.putDataUrl(dataUrl);
assert.match(url, /^artemis-media:\/\/[a-f0-9]{32}\.png$/);
assert.strictEqual(media.putDataUrl(dataUrl), url);
assert.strictEqual(fs.readdirSync(dir).length, 1);
assert.strictEqual(media.toDataUrl(url), dataUrl);
assert.strictEqual(media.putDataUrl('https://x.test/a.png'), 'https://x.test/a.png');
assert.strictEqual(media.putDataUrl('data:image/svg+xml;base64,PHN2Zy8+'), 'data:image/svg+xml;base64,PHN2Zy8+');

// only hash names inside the folder are served
assert.strictEqual(nameOf('artemis-media://../../etc/passwd'), '');
assert.strictEqual(nameOf(url + '/'), url.slice('artemis-media://'.length));
assert.strictEqual(media.read('artemis-media://' + 'a'.repeat(32) + '.png'), null);

// a message: attachments and tool screenshots become links; an unchanged message is the same object
const msg = { id: 'm1', role: 'user', content: 'look', attachments: [{ kind: 'image', name: 'a.png', dataUrl }, { kind: 'text', name: 'n.txt', text: 'hi' }] };
const out = media.externalize(msg);
assert.deepStrictEqual(out.attachments[0], { kind: 'image', name: 'a.png', url });
assert.strictEqual(out.attachments[1], msg.attachments[1]);
assert.strictEqual(media.externalize(out), out);
const shot = media.externalize({ id: 'm2', role: 'assistant', steps: [{ text: '', toolCalls: [{ id: 't', name: 'computer', image: dataUrl }] }] });
assert.strictEqual(shot.steps[0].toolCalls[0].image, url);

// right before a model call: links become base64; a missing file becomes a note
const api = media.resolveMessages([{ role: 'user', content: [{ type: 'text', text: 'x' }, { type: 'image_url', image_url: { url } }, { type: 'image_url', image_url: { url: 'artemis-media://' + 'b'.repeat(32) + '.jpg' } }] }, { role: 'user', content: 'plain' }]);
assert.strictEqual(api[0].content[1].image_url.url, dataUrl);
assert.deepStrictEqual(api[0].content[2], { type: 'text', text: '[image no longer available]' });
assert.strictEqual(api[1].content, 'plain');

const db = openDb(':memory:');
if (!db) { console.log('test-mediastore: node:sqlite not available, database part skipped'); process.exit(0); }

// an old database with base64 inside: migrateMedia moves it out and bumps the chat's change number
const old = createSessions({ db, writer: 'renderer' });
old.sync([{ id: 'c1', title: 'pics', updatedAt: 1, messages: [msg, { id: 'm3', role: 'assistant', steps: [{ text: 'ok', toolCalls: [] }] }] }, { id: 'c2', title: 'text', updatedAt: 2, messages: [{ id: 'm4', role: 'user', content: 'no images' }] }]);
const s = createSessions({ db, writer: 'renderer', media });
const seq0 = s.seq();
assert.deepStrictEqual(s.migrateMedia(), { messages: 1, chats: 1 });
assert.strictEqual(db.get("SELECT COUNT(*) AS n FROM messages WHERE json LIKE '%data:image/%'").n, 0);
assert.strictEqual(s.get('c1').messages[0].attachments[0].url, url);
assert.deepStrictEqual(s.changesSince(seq0, { exclude: 'renderer' }).chats.map((c) => c.id), ['c1']);
assert.deepStrictEqual(s.migrateMedia(), { messages: 0, chats: 0 });

// new saves with base64 are stored as links too
s.sync([...s.toArray(), { id: 'c3', title: 'new', updatedAt: 3, messages: [{ id: 'm5', role: 'user', content: '', attachments: [{ kind: 'image', name: 'p.png', dataUrl }] }] }]);
assert.ok(!db.get("SELECT json FROM messages WHERE session_id = 'c3'").json.includes('data:image/'));
assert.ok(namesIn(db.get("SELECT json FROM messages WHERE session_id = 'c3'").json).has(nameOf(url)));

// clean-up keeps linked files (also in the trash), drops orphans
const orphan = media.put(Buffer.from('not linked'), 'image/png');
assert.strictEqual(s.gcMedia({ minAgeMs: 0 }), 1);
assert.ok(!fs.existsSync(media.fileOf(nameOf(orphan))));
assert.ok(fs.existsSync(media.fileOf(nameOf(url))));
s.sync([]); // everything soft-deleted: still in the 30-day trash
assert.strictEqual(s.gcMedia({ minAgeMs: 0 }), 0);
assert.ok(fs.existsSync(media.fileOf(nameOf(url))));

fs.rmSync(dir, { recursive: true, force: true });
console.log('test-mediastore: ok');
