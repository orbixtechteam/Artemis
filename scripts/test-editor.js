// Page scripts against a post composer (an open dialog with a rich editor). Skipped when Playwright's Chromium is missing.
const assert = require('assert');
const Module = require('module');
const load = Module._load;
Module._load = function (r, ...a) { return r === 'electron' ? {} : load.call(this, r, ...a); };
const B = require('../electron/browser');
const { loadPlaywright } = require('../electron/core/pwbrowser');

(async () => {
  let pw; try { pw = loadPlaywright(); } catch { console.log('test-editor: Playwright not installed, skipped'); return; }
  let b; try { b = await pw.chromium.launch(); } catch { console.log('test-editor: Chromium not installed, skipped'); return; }
  const p = await b.newPage();
  await p.setContent(`<main><button>Create</button><div>Someone else's note</div></main>
    <div role="dialog" aria-modal="true"><div class="ProseMirror" contenteditable="true"><p data-placeholder="What's on your mind?"><br></p></div><button>Post</button></div>`);
  const out = await p.evaluate(B.inPage(B.readPageScript, {}));
  assert.match(out, /Open dialog[^\n]*\n\s+\[ref_\d+\] textbox "editor: What's on your mind\?"/, 'the open dialog comes first, its editor named by its hint');
  assert.ok(out.indexOf('Open dialog') < out.indexOf('"Create"'));
  const ref = /textbox "editor[^\n]*/.exec(out) && /ref_\d+/.exec(out.split('\n').find((l) => /editor:/.test(l)))[0];
  const r = await p.evaluate(B.inPage(B.formScript, { ref, value: 'Hello Notes' }));
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(await p.$eval('.ProseMirror', (e) => e.innerText.trim()), 'Hello Notes');
  await b.close();
  console.log('test-editor: ok');
})().catch((e) => { console.error(e); process.exit(1); });
