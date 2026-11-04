// Tool layer test (no Electron needed): node scripts/test-tools.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const tools = require('../electron/tools');
const files = require('../electron/files');
const XLSX = require('xlsx');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aid-'));
  const mem = [];
  const ctx = (extra = {}) => ({
    root, autoApprove: false, approve: async () => true,
    memory: {
      list: () => mem,
      add: (text) => { const i = { id: 'm' + mem.length, text }; mem.push(i); return i; },
      remove: (id) => { const n = mem.findIndex((m) => m.id === id); if (n < 0) return false; mem.splice(n, 1); return true; }
    },
    ...extra
  });
  const run = (n, a, c) => tools.run(n, a, c || ctx());

  // write / read / edit
  let r = await run('write_file', { path: 'notes/a.txt', content: 'hello wörld\nsecond line' });
  assert(r.ok, r.text);
  r = await run('read_file', { path: 'notes/a.txt' });
  assert(r.text.includes('hello wörld'));
  // line range: only the asked lines come back, with a hint for the next part
  await run('write_file', { path: 'notes/lines.txt', content: Array.from({ length: 500 }, (_, i) => `row ${i + 1}`).join('\n') });
  r = await run('read_file', { path: 'notes/lines.txt', start_line: 10, end_line: 12 });
  assert(r.ok && r.text.startsWith('row 10\nrow 11\nrow 12') && !r.text.includes('row 13\n') && /lines 10-12 of 500; continue with start_line=13/.test(r.text), r.text);
  r = await run('read_file', { path: 'notes/lines.txt', start_line: 495 });
  assert(r.text.includes('row 500') && /lines 495-500 of 500\]/.test(r.text) && !/continue with/.test(r.text), r.text);
  r = await run('edit_file', { path: 'notes/a.txt', old_string: 'wörld', new_string: 'universe' });
  assert(r.ok && fs.readFileSync(path.join(root, 'notes/a.txt'), 'utf8').includes('hello universe'));
  r = await run('edit_file', { path: 'notes/a.txt', old_string: 'no such text', new_string: 'x' });
  assert(!r.ok);

  // approval denied
  r = await run('write_file', { path: 'x.txt', content: 'x' }, ctx({ approve: async () => false }));
  assert(r.denied && !fs.existsSync(path.join(root, 'x.txt')));
  // autoApprove (except deleting)
  let asked = 0;
  r = await run('write_file', { path: 'auto.txt', content: 'x' }, ctx({ autoApprove: true, approve: async () => { asked++; return true; } }));
  assert(r.ok && asked === 0);
  r = await run('delete_file', { path: 'auto.txt' }, ctx({ autoApprove: true, approve: async () => { asked++; return true; } }));
  assert(r.ok && asked === 1 && !fs.existsSync(path.join(root, 'auto.txt')));

  // path escape
  for (const p of ['../outside.txt', '/etc/passwd', 'notes/../../x']) {
    r = await run('read_file', { path: p }, ctx({ approve: async () => false }));
    assert(!r.ok && /declined/.test(r.text), p + ' -> ' + r.text);
  }
  // outside the project: read-only, after approval; secrets never; missing things say so
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aid-out-'));
  fs.writeFileSync(path.join(outDir, 'wg.conf'), '[Interface]\nAddress=10.0.0.2');
  let asked2 = 0; const ok2 = ctx({ approve: async () => { asked2++; return true; }, session: new Set() });
  r = await run('read_file', { path: path.join(outDir, 'wg.conf') }, ok2);
  assert(r.ok && /Interface/.test(r.text) && asked2 === 1, r.text);
  r = await run('list_dir', { path: outDir }, ok2);
  assert(r.ok && /wg\.conf/.test(r.text) && asked2 === 1, 'same folder asked once: ' + r.text);
  r = await run('write_file', { path: path.join(outDir, 'x.txt'), content: 'no' }, ok2);
  const outW = r;
  assert(!r.ok && !fs.existsSync(path.join(outDir, 'x.txt')), 'writing outside stays blocked');
  // credentials outside: readable, but every read asks (no session, not even autoAll)
  fs.mkdirSync(path.join(outDir, '.ssh')); fs.writeFileSync(path.join(outDir, '.ssh', 'id_rsa'), 'k');
  const keyAsks = []; const kc = ctx({ autoAll: true, session: new Set(), approve: async (i) => { keyAsks.push(i); return true; } });
  r = await run('read_file', { path: path.join(outDir, '.ssh', 'id_rsa') }, kc);
  assert(r.ok && /k/.test(r.text), r.text);
  r = await run('read_file', { path: path.join(outDir, '.ssh', 'id_rsa') }, kc);
  assert(keyAsks.length === 2 && keyAsks.every((i) => !i.session && /credentials/.test(i.summary)), JSON.stringify(keyAsks));
  r = await run('read_file', { path: path.join(outDir, '.ssh', 'id_rsa') }, ctx({ approve: async () => false }));
  assert(!r.ok && /declined/.test(r.text), r.text);
  fs.writeFileSync(path.join(outDir, '.git-credentials'), 'https://u:p@h');
  keyAsks.length = 0; await run('read_file', { path: path.join(outDir, '.git-credentials') }, kc); assert(keyAsks.length === 1);
  // a symlink to an outside file: the approval names the real target and its folder
  const lnDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aid-ln-'));
  fs.symlinkSync(path.join(outDir, 'wg.conf'), path.join(lnDir, 'shortcut.conf'));
  const lnAsks = []; r = await run('read_file', { path: path.join(lnDir, 'shortcut.conf') }, ctx({ session: new Set(), approve: async (i) => { lnAsks.push(i); return true; } }));
  assert(r.ok && lnAsks.length === 1 && lnAsks[0].summary.includes(fs.realpathSync(path.join(outDir, 'wg.conf'))) && /is a link to/.test(lnAsks[0].summary), JSON.stringify(lnAsks));
  // full file access: write and read anywhere, keys included, no outside prompt
  let askedF = 0; const full = ctx({ fullAccess: true, approve: async () => { askedF++; return true; }, session: new Set() });
  r = await run('write_file', { path: path.join(outDir, 'y.txt'), content: 'yes' }, full);
  assert(r.ok && fs.readFileSync(path.join(outDir, 'y.txt'), 'utf8') === 'yes', r.text);
  r = await run('read_file', { path: path.join(outDir, '.ssh', 'id_rsa') }, full);
  assert(r.ok && /k/.test(r.text), r.text);
  assert(askedF >= 2, 'writing and reading keys outside still ask: ' + askedF);
  r = await run('read_file', { path: path.join(outDir, '.ssh', 'id_rsa') }, ctx({ fullAccess: true, approve: async () => false }));
  assert(!r.ok && /declined/.test(r.text), 'declined key read: ' + r.text);
  r = await run('list_dir', { path: 'Downloads' });
  assert(!r.ok && /Folder not found/.test(r.text) && /project folder/.test(r.text), r.text);
  r = await run('read_file', { path: 'nope.conf' });
  assert(!r.ok && /File not found/.test(r.text), r.text);
  fs.symlinkSync(os.tmpdir(), path.join(root, 'link'));
  r = await run('write_file', { path: 'link/pwn.txt', content: 'x' });
  assert(!r.ok, 'symlink escape must be blocked');

  // write Excel → read → update cells
  r = await run('write_spreadsheet', {
    path: 'report.xlsx',
    sheets: [{ name: 'Sales', rows: [['Product', 'Qty', 'Price', 'Total'], ['Apple', 3, 10, '=B2*C2'], ['Pear', 2, 15, '=B3*C3']] }, { name: 'Memo', rows: [['Unicode: éüñøç']] }]
  });
  assert(r.ok, r.text);
  const wb = XLSX.readFile(path.join(root, 'report.xlsx'), { sheetStubs: true });
  assert.deepStrictEqual(wb.SheetNames, ['Sales', 'Memo']);
  assert.strictEqual(wb.Sheets['Sales'].D2.f, 'B2*C2');
  r = await run('read_file', { path: 'report.xlsx' });
  assert(r.text.includes('## Sheet: Sales') && r.text.includes('Apple,3,10,=B2*C2') && r.text.includes('éüñøç'), r.text);
  r = await run('read_file', { path: 'report.xlsx', sheet: 'Memo' });
  assert(!r.text.includes('Apple'));
  r = await run('update_cells', { path: 'report.xlsx', sheet: 'Sales', cells: [{ cell: 'B2', value: 5 }, { cell: 'A4', value: 'Banana' }] });
  assert(r.ok, r.text);
  const wb2 = XLSX.readFile(path.join(root, 'report.xlsx'), { sheetStubs: true });
  assert.strictEqual(wb2.Sheets['Sales'].B2.v, 5);
  assert.strictEqual(wb2.Sheets['Sales'].A4.v, 'Banana');
  assert.strictEqual(wb2.Sheets['Sales'].D2.f, 'B2*C2');

  // write/read/update CSV
  r = await run('write_spreadsheet', { path: 'data.csv', sheets: [{ rows: [['name', 'city'], ['Émile', 'Zürich']] }] });
  assert(r.ok, r.text);
  assert(fs.readFileSync(path.join(root, 'data.csv'), 'utf8').startsWith('﻿'));
  r = await run('read_file', { path: 'data.csv' });
  assert(r.text.includes('Émile'));
  r = await run('update_cells', { path: 'data.csv', cells: [{ cell: 'B2', value: 'Geneva' }] });
  assert(r.ok && fs.readFileSync(path.join(root, 'data.csv'), 'utf8').includes('Geneva'));
  const att = await files.parseAttachment(path.join(root, 'report.xlsx'));
  assert(att.kind === 'sheet' && att.text.includes('Sales'));

  // folder tools
  r = await run('list_dir', { recursive: true });
  assert(r.text.includes('notes/') && r.text.includes('report.xlsx'), r.text);
  r = await run('search_files', { query: 'universe' });
  assert(r.text.includes('notes/a.txt:1'), r.text);
  r = await run('search_files', { name: 'report' });
  assert(r.text.includes('report.xlsx'));
  r = await run('move_file', { from: 'data.csv', to: 'archive/data.csv' });
  assert(r.ok && fs.existsSync(path.join(root, 'archive/data.csv')));
  r = await run('delete_file', { path: '.' });
  assert(!r.ok, 'the root cannot be deleted');

  // memory
  r = await run('memory_save', { text: 'User prefers short answers' });
  assert(r.ok && mem.length === 1);
  r = await run('memory_forget', { id: 'm0' });
  assert(r.ok && mem.length === 0);

  // when the folder is missing
  r = await tools.run('list_dir', {}, { root: null });
  assert(!r.ok && /folder/.test(r.text));
  assert.deepStrictEqual(tools.definitions({ hasFolder: false, memoryEnabled: false }).map((d) => d.function.name), ['create_artifact', 'compact_chat', 'ask_user', 'lock_app']);

  // long file paging
  fs.writeFileSync(path.join(root, 'long.txt'), 'a'.repeat(130000));
  r = await run('read_file', { path: 'long.txt' });
  assert(/Too big to send whole/.test(r.text) && /start_line\/end_line/.test(r.text) && r.text.length < 4000, 'a big file comes back as an outline');
  r = await run('read_file', { path: 'long.txt', full: true });
  assert(r.text.includes('offset=60000'));
  fs.writeFileSync(path.join(root, 'big.js'), 'const a = 1;\n'.repeat(30) + 'function alpha() {\n  return 1;\n}\n' + 'x();\n'.repeat(4000) + 'export const beta = (v) => v * 2;\n');
  r = await run('read_file', { path: 'big.js' });
  assert(/\d+: function alpha\(\)/.test(r.text) && /\d+: export const beta = /.test(r.text), 'outline lists declarations with line numbers: ' + r.text.slice(0, 300));
  r = await run('read_file', { path: 'long.txt', offset: 120000 });
  assert(!r.text.includes('more content'));

  { const evs = []; const r = await tools.run('create_artifact', { title: 'T', type: 'html', content: '<b>x</b>' }, { send: (e) => evs.push(e) });
    assert(r.ok && evs[0].type === 'artifact' && evs[0].kind === 'html' && /^[\w-]+$/.test(evs[0].id));
    const r2 = await tools.run('create_artifact', { title: 'T', type: 'html', content: '' }, { send: () => {} });
    assert(!r2.ok); }
  fs.rmSync(root, { recursive: true, force: true });
  console.log('tools: all tests passed');
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });

// ---- get_location: saved profile location, approval, IP lookup with fallback
(async () => {
  const assert = require('assert');
  const tools = require('../electron/tools');
  const { buildSystem } = require('../electron/agent');
  assert(tools.definitions({ webEnabled: true }).some((d) => d.function.name === 'get_location'));
  assert(!tools.definitions({ webEnabled: false }).some((d) => d.function.name === 'get_location'));
  // saved location: no network, no approval
  let r = await tools.run('get_location', {}, { userLocation: 'Berlin, Germany', approve: async () => { throw new Error('must not ask'); } });
  assert(r.ok && /Berlin, Germany/.test(r.text));
  // no saved location: asks once per run, declined = nothing is sent
  const realFetch = global.fetch; let calls = 0;
  global.fetch = async () => { calls++; throw new Error('must not fetch when declined'); };
  r = await tools.run('get_location', {}, { session: new Set(), approve: async () => false });
  assert(r.denied && calls === 0 && /Profile/.test(r.text));
  // approved: first service fails, second answers
  global.fetch = async (url) => { calls++; if (/ipwho/.test(url)) return { ok: false, status: 429 }; return { ok: true, json: async () => ({ city: 'Berlin', region: 'Berlin', country_name: 'Germany', latitude: 52.52, longitude: 13.4049, timezone: 'Europe/Berlin' }) }; };
  let asked = 0; const ctx = { session: new Set(), approve: async (i) => { asked++; assert(i.category === 'location' && i.session); return true; } };
  r = await tools.run('get_location', {}, ctx);
  assert(r.ok && /Berlin, Berlin, Germany \(52\.52, 13\.40\), time zone Europe\/Berlin/.test(r.text), r.text);
  await tools.run('get_location', {}, ctx); assert.strictEqual(asked, 1);
  // both services down: a clear error for the model
  global.fetch = async () => { throw new Error('offline'); };
  r = await tools.run('get_location', {}, { session: new Set(['location']) });
  assert(!r.ok && /Ask the user for their city/.test(r.text), r.text);
  global.fetch = realFetch;
  // the saved location reaches the system prompt
  const sys = buildSystem({ userLocation: 'Berlin, Germany', webEnabled: true, hasTools: true });
  assert(/Location: Berlin, Germany/.test(sys) && /get_location/.test(sys));
  assert(!/Location:/.test(buildSystem({ userName: 'U', webEnabled: true, hasTools: true })));
  console.log('tools: get_location ok');
  { // update_schedule changes a task in place instead of creating another one
    const jobs = [{ id: 's1', name: 'Water', prompt: 'Drink water', projectId: null, model: '', repeat: { type: 'daily', at: '09:00' }, enabled: true, allowEdits: false, notifyPhone: false, reminder: true, description: 'daily' }];
    const saves = [];
    const schedule = { list: () => jobs, save: (j) => { saves.push(j); return { ...j, nextRun: null }; } };
    const ctx2 = { schedule, session: new Set(), approve: async () => true };
    const u = await tools.run('update_schedule', { id: 's1', at: '10:30', notify_phone: true }, ctx2);
    assert(u.ok && saves.length === 1 && saves[0].id === 's1' && saves[0].repeat.at === '10:30' && saves[0].repeat.type === 'daily' && saves[0].notifyPhone === true && saves[0].reminder === true && saves[0].prompt === 'Drink water', JSON.stringify(u));
    const bad = await tools.run('update_schedule', { id: 'nope' }, ctx2).catch(() => ({ ok: false }));
    assert(!bad.ok && saves.length === 1);
    console.log('tools: update_schedule ok');
  }
  { // notes_edit replaces one passage in a note instead of rewriting it
    const { createNotes } = require('../electron/notes');
    const nroot = fs.mkdtempSync(path.join(require('os').tmpdir(), 'artemis-notes-'));
    const notes = createNotes({ getRoot: () => nroot });
    notes.write('AI/Guide.md', 'one\ntwo\nthree');
    const nctx = { notes, session: new Set(), approve: async () => true };
    let e = await tools.run('notes_edit', { path: 'AI/Guide.md', old_text: 'two', new_text: '2' }, nctx);
    assert(e.ok && notes.read('AI/Guide.md').text === 'one\n2\nthree', JSON.stringify(e));
    e = await tools.run('notes_edit', { path: 'AI/Guide.md', old_text: 'nope', new_text: 'x' }, nctx).catch(() => ({ ok: false }));
    assert(!e.ok && notes.read('AI/Guide.md').text === 'one\n2\nthree');
    console.log('tools: notes_edit ok');
    { // library_edit updates a stored file in place
      const { createLibrary } = require('../electron/library');
      const lib = createLibrary({ getRoot: () => path.join(nroot, 'Files'), files: require('../electron/files') });
      lib.write('todo.md', 'a\nb\nc');
      const lctx = { library: lib, session: new Set(), approve: async () => true };
      let l = await tools.run('library_edit', { path: 'todo.md', old_text: 'b', new_text: 'B' }, lctx);
      assert(l.ok && (await lib.read('todo.md')).text === 'a\nB\nc', JSON.stringify(l));
      l = await tools.run('library_search', { query: 'todo' }, lctx);
      assert(l.ok && l.text.includes('todo.md'));
      l = await tools.run('library_edit', { path: 'todo.md', old_text: 'zzz', new_text: 'x' }, lctx).catch(() => ({ ok: false }));
      assert(!l.ok);
      console.log('tools: library_edit ok');
    }
    { // library_delete, and delete_file of a library-only / missing file fails before any approval
      const { createLibrary } = require('../electron/library');
      const lroot = fs.mkdtempSync(path.join(os.tmpdir(), 'aid-lib-'));
      const proot = fs.mkdtempSync(path.join(os.tmpdir(), 'aid-proj-'));
      const lib = createLibrary({ getRoot: () => lroot, files: require('../electron/files') });
      lib.write('Arch Doc.md', '# x');
      const asks = [];
      const lctx = (approve = async () => true) => ({ root: proot, library: lib, session: new Set(), approve: async (i) => { asks.push(i); return approve(i); } });
      // delete_file of a file that is only in the library: fast failure with the hint, no approval
      let d = await tools.run('delete_file', { path: 'Arch Doc.md' }, lctx());
      assert(!d.ok && /Not found in the project folder\. "Arch Doc\.md" is in the Files library — use library_delete/.test(d.text) && asks.length === 0, d.text);
      // missing everywhere: no approval; similar names in the project are suggested
      fs.mkdirSync(path.join(proot, 'docs')); fs.writeFileSync(path.join(proot, 'docs', 'gone.txt'), 'x');
      d = await tools.run('delete_file', { path: 'gone.txt' }, lctx());
      assert(!d.ok && /Not found: gone\.txt/.test(d.text) && /Did you mean: docs\/gone\.txt/.test(d.text) && asks.length === 0, d.text);
      d = await tools.run('delete_file', { path: 'nothing.txt' }, { ...lctx(), autoApprove: true });
      assert(!d.ok && asks.length === 0, d.text);
      d = await tools.run('move_file', { from: 'nothing.txt', to: 'b.txt' }, lctx());
      assert(!d.ok && /Source not found/.test(d.text) && asks.length === 0, d.text);
      // library_delete: refused outside the root, missing fails fast, asks approval (even with autoApprove), denial keeps the file
      d = await tools.run('library_delete', { path: '../outside.md' }, lctx());
      assert(!d.ok && /outside/.test(d.text) && asks.length === 0, d.text);
      d = await tools.run('library_delete', { path: 'missing.md' }, lctx());
      assert(!d.ok && /Not found in the Files library/.test(d.text) && asks.length === 0, d.text);
      d = await tools.run('library_delete', { path: 'Arch Doc.md' }, { ...lctx(async () => false), autoApprove: true });
      assert(d.denied && asks.length === 1 && asks[0].summary === 'Delete from Files: Arch Doc.md' && fs.existsSync(path.join(lroot, 'Arch Doc.md')), JSON.stringify(d));
      d = await tools.run('library_delete', { path: 'Arch Doc.md' }, lctx());
      assert(d.ok && asks.length === 2 && !fs.existsSync(path.join(lroot, 'Arch Doc.md')), d.text);
      // folders: empty ok, non-empty only with recursive
      lib.write('sub/a.md', 'a');
      d = await tools.run('library_delete', { path: 'sub' }, lctx());
      assert(!d.ok && /not empty/.test(d.text) && fs.existsSync(path.join(lroot, 'sub', 'a.md')), d.text);
      d = await tools.run('library_delete', { path: 'sub', recursive: true }, lctx());
      assert(d.ok && !fs.existsSync(path.join(lroot, 'sub')), d.text);
      assert(tools.definitions({ notesEnabled: true }).some((x) => x.function.name === 'library_delete'));
      fs.rmSync(lroot, { recursive: true, force: true }); fs.rmSync(proot, { recursive: true, force: true });
      console.log('tools: library_delete and delete_file prechecks ok');
    }
  }
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });

// long content can be built in parts: write_file and create_artifact accept append
{
  const assert2 = require('assert'); const fs2 = require('fs'); const os2 = require('os'); const path2 = require('path');
  const tools2 = require('../electron/tools');
  const dir2 = fs2.mkdtempSync(path2.join(os2.tmpdir(), 'append-'));
  (async () => {
    const ctx = { root: dir2, send: (e) => { ctx.last = e; }, approve: async () => ({ ok: true }) };
    await tools2.run('write_file', { path: 'a.html', content: '<p>one</p>' }, ctx);
    await tools2.run('write_file', { path: 'a.html', content: '<p>two</p>', append: true }, ctx);
    assert2.strictEqual(fs2.readFileSync(path2.join(dir2, 'a.html'), 'utf8'), '<p>one</p><p>two</p>');
    await tools2.run('create_artifact', { title: 'T', type: 'html', content: 'AAA', id: 'x1' }, ctx);
    await tools2.run('create_artifact', { title: 'T', type: 'html', content: 'BBB', id: 'x1', append: true }, ctx);
    assert2.strictEqual(ctx.last.content, 'AAABBB');
    console.log('tools: append ok');
  })().catch((e) => { console.error('FAILED append:', e); process.exit(1); });
}

// symlinks, atomic writes, encodings, CRLF edits, read_file paging, approval categories
(async () => {
  const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path');
  const tools = require('../electron/tools');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aid-sec-')));
  const out = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aid-sec-out-')));
  const ctx = (extra = {}) => ({ root, autoApprove: true, approve: async () => true, session: new Set(), ...extra });
  const run = (n, a, c) => tools.run(n, a, c || ctx());
  let r;
  // search_files does not follow links out of the project, survives link cycles and skips node_modules
  fs.writeFileSync(path.join(out, 'secret.txt'), 'SECRETWORD');
  fs.symlinkSync(out, path.join(root, 'outlink'));
  fs.symlinkSync(path.join(out, 'secret.txt'), path.join(root, 'filelink.txt'));
  fs.mkdirSync(path.join(root, 'sub')); fs.writeFileSync(path.join(root, 'sub', 'in.txt'), 'INSIDEWORD');
  fs.symlinkSync(root, path.join(root, 'sub', 'loop'));
  fs.mkdirSync(path.join(root, 'node_modules')); fs.writeFileSync(path.join(root, 'node_modules', 'm.txt'), 'INSIDEWORD');
  r = await run('search_files', { query: 'SECRETWORD' });
  assert(r.ok && /No matches/.test(r.text), r.text);
  r = await run('search_files', { query: 'INSIDEWORD' });
  assert(r.ok && /sub\/in\.txt:1/.test(r.text) && !/node_modules/.test(r.text), r.text);
  r = await run('list_dir', {});
  assert(/outlink -> .*not followed/.test(r.text), r.text);
  // regex: invalid, too long, too slow
  r = await run('search_files', { query: '(', regex: true }); assert(!r.ok && /Invalid regular expression/.test(r.text), r.text);
  r = await run('search_files', { query: 'a'.repeat(600) }); assert(!r.ok && /too long/.test(r.text), r.text);
  fs.writeFileSync(path.join(root, 'sub', 'redos.txt'), 'a'.repeat(40) + '!');
  const t0 = Date.now();
  r = await run('search_files', { query: '^(a+)+$', regex: true, path: 'sub' }, ctx({ searchMs: 1000 }));
  assert(r.ok && /stopped after 1 s/.test(r.text) && Date.now() - t0 < 5000, r.text);
  // writing through a dangling symlink that points outside is blocked
  fs.symlinkSync(path.join(out, 'new.txt'), path.join(root, 'dangling.txt'));
  r = await run('write_file', { path: 'dangling.txt', content: 'x' });
  assert(!r.ok && /escapes/.test(r.text) && !fs.existsSync(path.join(out, 'new.txt')), r.text);
  fs.symlinkSync(path.join(out, 'nodir', 'deeper'), path.join(root, 'dlink'));
  r = await run('write_file', { path: 'dlink/x.txt', content: 'x' });
  assert(!r.ok && !fs.existsSync(path.join(out, 'nodir')), r.text);
  r = await run('write_file', { path: '~/aid-should-not-exist.txt', content: 'x' });
  assert(!r.ok && /outside the project folder/.test(r.text), r.text);
  // atomic write keeps the mode and leaves no temp files
  fs.writeFileSync(path.join(root, 'run.sh'), 'echo 1'); fs.chmodSync(path.join(root, 'run.sh'), 0o755);
  r = await run('write_file', { path: 'run.sh', content: 'echo 2' });
  assert(r.ok && (fs.statSync(path.join(root, 'run.sh')).mode & 0o777) === 0o755 && fs.readFileSync(path.join(root, 'run.sh'), 'utf8') === 'echo 2');
  assert(!fs.readdirSync(root).some((n) => /\.tmp-/.test(n)));
  // lock keys: one file under two spellings shares a lock
  fs.symlinkSync(path.join(root, 'sub'), path.join(root, 'alias'));
  assert.strictEqual(tools.lockKey(path.join(root, 'alias', 'in.txt')), tools.lockKey(path.join(root, 'sub', 'in.txt')));
  // a legacy windows-1254 file is read correctly and kept on edit
  const legacy = Buffer.from([0x46, 0x61, 0xe7, 0x61, 0x64, 0x65, 0x20, 0x6e, 0x61, 0xef, 0x76, 0x65]); // "Façade naïve"
  fs.writeFileSync(path.join(root, 'legacy.txt'), legacy);
  r = await run('read_file', { path: 'legacy.txt' });
  assert(r.ok && r.text.includes('Façade naïve') && /windows-1254/.test(r.text), r.text);
  r = await run('edit_file', { path: 'legacy.txt', old_string: 'Façade', new_string: 'Zürich' });
  assert(r.ok && /kept windows-1254/.test(r.text), r.text);
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'legacy.txt')), Buffer.concat([Buffer.from([0x5a, 0xfc, 0x72, 0x69, 0x63, 0x68]), legacy.subarray(6)]));
  r = await run('write_file', { path: 'legacy.txt', content: 'Crème' });
  assert(r.ok && fs.readFileSync(path.join(root, 'legacy.txt')).equals(Buffer.from([0x43, 0x72, 0xe8, 0x6d, 0x65])), r.text);
  r = await run('edit_file', { path: 'legacy.txt', old_string: 'Crème', new_string: 'emoji ✓' });
  assert(r.ok && /UTF-8/.test(r.text) && fs.readFileSync(path.join(root, 'legacy.txt'), 'utf8') === 'emoji ✓', r.text);
  // UTF-16 is text, not binary; UTF-8 BOM is kept once
  fs.writeFileSync(path.join(root, 'u16.txt'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('café crème', 'utf16le')]));
  r = await run('read_file', { path: 'u16.txt' }); assert(r.ok && r.text.includes('café crème'), r.text);
  r = await run('edit_file', { path: 'u16.txt', old_string: 'crème', new_string: 'brûlée' });
  assert(r.ok && fs.readFileSync(path.join(root, 'u16.txt')).equals(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('café brûlée', 'utf16le')])));
  fs.writeFileSync(path.join(root, 'bom.txt'), '﻿a=1');
  await run('edit_file', { path: 'bom.txt', old_string: 'a=1', new_string: 'a=2' });
  assert.strictEqual(fs.readFileSync(path.join(root, 'bom.txt'), 'utf8'), '﻿a=2');
  // CRLF files accept LF old_string; ambiguous matches name the lines
  fs.writeFileSync(path.join(root, 'crlf.txt'), 'a\r\nb\r\nc\r\nb\r\n');
  r = await run('edit_file', { path: 'crlf.txt', old_string: 'a\nb', new_string: 'x\ny' });
  assert(r.ok && fs.readFileSync(path.join(root, 'crlf.txt'), 'utf8') === 'x\r\ny\r\nc\r\nb\r\n', r.text);
  r = await run('edit_file', { path: 'crlf.txt', old_string: 'c', new_string: 'C\nD' });
  assert(r.ok && fs.readFileSync(path.join(root, 'crlf.txt'), 'utf8') === 'x\r\ny\r\nC\r\nD\r\nb\r\n', r.text);
  fs.writeFileSync(path.join(root, 'dup.txt'), 'b\nx\nb\n');
  r = await run('edit_file', { path: 'dup.txt', old_string: 'b', new_string: 'z' });
  assert(!r.ok && /matches 2 places \(lines 1, 3\)/.test(r.text), r.text);
  // read_file paging: past EOF, offset + start_line, cut output says how to continue
  fs.writeFileSync(path.join(root, 'ten.txt'), Array.from({ length: 10 }, (_, i) => 'L' + (i + 1)).join('\n'));
  r = await run('read_file', { path: 'ten.txt', start_line: 50 }); assert(!r.ok && /past the end.*10 lines/.test(r.text), r.text);
  r = await run('read_file', { path: 'ten.txt', start_line: 2, offset: 5 }); assert(!r.ok && /not both/.test(r.text), r.text);
  r = await run('read_file', { path: 'ten.txt', offset: 999 }); assert(!r.ok && /past the end/.test(r.text), r.text);
  fs.writeFileSync(path.join(root, 'wide.txt'), Array.from({ length: 30 }, () => 'w'.repeat(5000)).join('\n'));
  r = await run('read_file', { path: 'wide.txt', start_line: 1, end_line: 30 });
  assert(r.ok && /output cut at 60000 characters: lines 1-11 of 30 shown; continue with start_line=12/.test(r.text), r.text.slice(-200));
  // a text file over 20 MB is streamed, never loaded whole
  const bigLines = 400000; const big = path.join(root, 'big.log');
  fs.writeFileSync(big, Array.from({ length: bigLines }, (_, i) => `line ${i + 1} ` + 'x'.repeat(50)).join('\n'));
  assert(fs.statSync(big).size > 20 * 1024 * 1024);
  r = await run('read_file', { path: 'big.log', start_line: 300000, end_line: 300002 });
  assert(r.ok && /large file/.test(r.text) && /^line 300000 /m.test(r.text) && /^line 300002 /m.test(r.text) && !/^line 300003 /m.test(r.text) && /continue with start_line=300003/.test(r.text), r.text.slice(0, 300));
  r = await run('read_file', { path: 'big.log', start_line: bigLines + 5 }); assert(!r.ok && /past the end/.test(r.text), r.text);
  r = await run('read_file', { path: 'big.log' }); assert(r.ok && /^\[large file/.test(r.text) && /continue with offset=60000/.test(r.text) && r.text.length < 61000);
  // approval categories: terminal_read and schedule edits/deletes are separate from shell / schedule_task; read-only connectors ask once
  const S = tools.SESSION_TOOLS;
  assert(S.terminal_read !== S.run_command && S.terminal_read !== S.terminal_run);
  assert(new Set([S.schedule_task, S.update_schedule, S.delete_schedule]).size === 3);
  const asks = [];
  const mctx = { session: new Set(), approve: async (i) => { asks.push(i); return true; }, mcp: { info: () => ({ readOnly: true, server: 'docs' }), call: async () => ({ ok: true, text: 'res' }) } };
  r = await tools.run('mcp__docs__search', { q: 'x' }, mctx); assert(r.ok, JSON.stringify(r));
  await tools.run('mcp__docs__search', { q: 'y' }, mctx);
  assert(asks.length === 1 && asks[0].category === 'mcp-read:docs' && asks[0].session);
  const dctx = { session: new Set(), approve: async () => false, mcp: mctx.mcp };
  r = await tools.run('mcp__docs__search', { q: 'x' }, dctx); assert(r.denied);
  // computer: app_screenshot never starts screen control (so the window is not minimized); include_artemis wraps the capture
  const cev = [];
  const shotRes = { ok: true, text: 'shot', image: 'data:image/jpeg;base64,AA==' };
  const cctx = { session: new Set(), approve: async () => true,
    computer: { run: async (a) => { cev.push('run:' + a.action); return shotRes; } },
    onComputerStart: () => cev.push('start'),
    appShot: async () => { cev.push('app'); return { ...shotRes, text: 'app shot' }; },
    withArtemisVisible: async (fn) => { cev.push('show'); try { return await fn(); } finally { cev.push('hide'); } } };
  r = await tools.run('computer', { action: 'app_screenshot' }, cctx); assert(r.ok && /app shot/.test(r.text) && cev.join() === 'app', cev.join());
  cev.length = 0;
  r = await tools.run('computer', { action: 'screenshot', include_artemis: true }, cctx); assert(r.ok && cev.join() === 'start,show,run:screenshot,hide', cev.join());
  cev.length = 0;
  r = await tools.run('computer', { action: 'screenshot' }, cctx); assert(r.ok && cev.join() === 'start,run:screenshot', cev.join());
  cev.length = 0;
  r = await tools.run('computer', { actions: [{ action: 'app_screenshot' }] }, cctx); assert(!r.ok && /own call/.test(JSON.stringify(r)) && !cev.length, JSON.stringify(r));
  r = await tools.run('computer', { action: 'app_screenshot' }, { ...cctx, appShot: null }); assert(!r.ok && /not available/.test(JSON.stringify(r)), JSON.stringify(r));
  const cdefs = tools.definitions({ computerEnabled: true }).find((d) => d.function.name === 'computer');
  assert(cdefs && cdefs.function.parameters.properties.action.enum.includes('app_screenshot') && cdefs.function.parameters.properties.include_artemis);
  fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(out, { recursive: true, force: true });
  console.log('tools: links, encodings and paging ok');
})().catch((e) => { console.error('FAILED security:', e); process.exit(1); });
