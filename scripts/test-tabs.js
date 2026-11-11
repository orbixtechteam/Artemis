const assert = require('assert');
(async () => {
  const T = await import('../src/lib/tabs.mjs');
  const F = await import('../src/lib/fuzzy.mjs');
  const mk = (spec) => spec.split(' ').map((x) => ({ id: x.replace('*', ''), pinned: x.endsWith('*') }));
  const ids = (ts) => ts.map((t) => t.id + (t.pinned ? '*' : '')).join(' ');

  // order: pinned first, stable inside each group
  assert.strictEqual(ids(T.orderTabs(mk('a b* c d*'))), 'b* d* a c');
  assert.strictEqual(T.pinnedCount(mk('a b* c')), 1);

  // drag: slots are gaps in the ordered list
  const ts = mk('p* q* a b c');
  assert.strictEqual(ids(T.moveTab(ts, 'a', 5)), 'p* q* b c a');
  assert.strictEqual(ids(T.moveTab(ts, 'c', 2)), 'p* q* c a b');
  assert.strictEqual(ids(T.moveTab(ts, 'b', 4)), 'p* q* a b c'); // own slot: unchanged
  assert.strictEqual(ids(T.moveTab(ts, 'c', 0)), 'p* q* c a b'); // unpinned cannot go before pinned tabs
  assert.strictEqual(ids(T.moveTab(ts, 'p', 5)), 'q* p* a b c'); // pinned stays among pinned tabs
  assert.strictEqual(ids(T.moveTab(ts, 'zz', 1)), 'p* q* a b c');
  assert.strictEqual(T.clampSlot(ts, 'a', 0), 2);
  assert.strictEqual(T.clampSlot(ts, 'q', 4), 2);
  assert.strictEqual(T.clampSlot(ts, 'zz', 1), -1);
  assert.ok(T.isNoopSlot(ts, 'a', 2) && T.isNoopSlot(ts, 'a', 3) && T.isNoopSlot(ts, 'a', 0));
  assert.ok(!T.isNoopSlot(ts, 'a', 4));

  // keyboard moves
  assert.strictEqual(ids(T.shiftTab(ts, 'a', 1)), 'p* q* b a c');
  assert.strictEqual(ids(T.shiftTab(ts, 'b', -1)), 'p* q* b a c');
  assert.strictEqual(ids(T.shiftTab(ts, 'a', -1)), 'p* q* a b c'); // at the group border
  assert.strictEqual(ids(T.shiftTab(ts, 'c', 1)), 'p* q* a b c');
  assert.strictEqual(ids(T.shiftTab(ts, 'p', 1)), 'q* p* a b c');
  assert.strictEqual(ids(T.shiftTab(ts, 'q', 1)), 'p* q* a b c');

  // pin / unpin land on the group border
  assert.strictEqual(ids(T.setPinned(ts, 'c', true)), 'p* q* c* a b');
  assert.strictEqual(ids(T.setPinned(ts, 'p', false)), 'q* p a b c');
  assert.strictEqual(ids(T.setPinned(ts, 'a', false)), 'p* q* a b c');
  assert.notStrictEqual(T.setPinned(ts, 'c', true).find((t) => t.id === 'c'), ts.find((t) => t.id === 'c')); // no mutation
  assert.strictEqual(ts.find((t) => t.id === 'c').pinned, false);

  // closing
  assert.strictEqual(T.nextAfterClose(ts, 'b').id, 'c');
  assert.strictEqual(T.nextAfterClose(ts, 'c').id, 'b');
  assert.strictEqual(T.nextAfterClose(mk('a'), 'a'), null);
  assert.strictEqual(ids(T.closeOthers(ts, 'b')), 'p* q* b');

  // fuzzy
  assert.strictEqual(F.fold('Zürich Café'), 'zurich cafe');
  assert.strictEqual(F.fold('a😀b').length, 3);
  assert.strictEqual(F.fuzzyScore('', 'anything').score, 0);
  assert.strictEqual(F.fuzzyScore('xyz', 'New chat'), null);
  assert.deepStrictEqual(F.fuzzyScore('nc', 'New chat').idx, [0, 4]);
  assert.deepStrictEqual(F.fuzzyScore('chat', 'New chat').idx, [4, 5, 6, 7]);
  assert.ok(F.fuzzyScore('set', 'Settings').score > F.fuzzyScore('set', 'Reset layout').score, 'prefix beats inner match');
  assert.ok(F.fuzzyScore('nt', 'New tab').score > F.fuzzyScore('nt', 'Agents').score, 'word starts beat scattered letters');
  assert.ok(F.fuzzyScore('term', 'Terminal').score > F.fuzzyScore('term', 'New terminal tab').score);
  assert.ok(F.fuzzyScore('settings', 'Settings').score > F.fuzzyScore('settings', 'Settings: Providers').score, 'shorter label wins');
  assert.ok(F.fuzzyScore('cafe', 'Café notes'), 'accents are ignored');
  assert.ok(F.fuzzyScore('theme dark', 'Theme: Dark'));
  assert.strictEqual(F.fuzzyScore('theme zzz', 'Theme: Dark'), null);
  const kw = F.fuzzyScore('appearance', 'Theme: Dark', 'appearance color');
  assert.ok(kw && kw.idx.length === 0, 'keyword hit matches but highlights nothing');
  assert.deepStrictEqual(F.highlight('New chat', [0, 4, 5]), [{ t: 'N', m: true }, { t: 'ew ', m: false }, { t: 'ch', m: true }, { t: 'at', m: false }]);
  assert.deepStrictEqual(F.highlight('', []), []);
  const r = F.rank('nt', [{ label: 'Agents' }, { label: 'New tab' }, { label: 'Close' }], (x) => x);
  assert.deepStrictEqual(r.map((x) => x.item.label), ['New tab', 'Agents']);
  // a page tab (Settings) sits on top of a chat id: it must never be taken for that chat's tab
  const page = { id: 'set', s: { view: 'chat', chatId: 'c1', modal: 'settings' } };
  const chatTab = { id: 'c', s: { view: 'chat', chatId: 'c1', modal: null } };
  assert.strictEqual(T.isChatTab(page), false);
  assert.strictEqual(T.isChatTab(chatTab), true);
  assert.strictEqual(T.findChatTab([page], 'c1'), null);
  assert.strictEqual(T.findChatTab([page, chatTab], 'c1').id, 'c');
  assert.strictEqual(T.findChatTab([page, chatTab], 'c1', 'c'), null);
  assert.strictEqual(T.findChatTab([chatTab], ''), null);
  console.log('tabs + fuzzy tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
