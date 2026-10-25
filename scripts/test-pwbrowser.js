// Headless browser tools (Playwright). Skipped when Playwright or its Chromium is not installed.
const assert = require('assert');
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { createPwBrowser, loadPlaywright } = require('../electron/core/pwbrowser');
// the app's sign-ins (Electron cookies) become Playwright cookies
{
  const { toPwCookies } = require('../electron/core/pwbrowser');
  const out = toPwCookies([
    { name: 'substack.sid', value: 'abc', domain: '.substack.com', path: '/', expirationDate: 1893456000.5, httpOnly: true, secure: true, sameSite: 'lax' },
    { name: 'x', value: '1', domain: 'example.com', path: '/', secure: false, sameSite: 'no_restriction' },
    { name: '', value: 'skip', domain: 'a.com' }
  ]);
  require('assert').deepStrictEqual(out, [
    { name: 'substack.sid', value: 'abc', domain: '.substack.com', path: '/', httpOnly: true, secure: true, expires: 1893456000, sameSite: 'Lax' },
    { name: 'x', value: '1', domain: 'example.com', path: '/', httpOnly: false, secure: false, expires: -1 }
  ]);
  console.log('test-pwbrowser: cookies ok');
}

(async () => {
  try { loadPlaywright(); } catch { console.log('test-pwbrowser: Playwright not installed, skipped'); return; }
  const page = `<!doctype html><title>Form test</title><h1>Hello</h1>
<input id="q" placeholder="Search"><button id="go" onclick="document.getElementById('out').textContent='clicked:'+document.getElementById('q').value">Go</button>
<p id="out"></p><a href="/two">Second page</a><script>console.log('page ready')</script>`;
  const srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(req.url === '/two' ? '<title>Two</title><p>second</p>' : page); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artemis-pw-'));
  const br = createPwBrowser({ profileDir: dir });
  const a = br.agent();
  let r;
  try { r = await a.run('browser_navigate', { url: base }); } catch (e) { r = { ok: false, text: e.message }; }
  if (!r.ok && /Executable doesn't exist|browserType.launch|install/i.test(r.text)) { console.log('test-pwbrowser: Chromium not installed, skipped'); srv.close(); return; }
  assert.ok(r.ok, r.text);
  assert.ok(r.text.includes('Form test'));
  assert.strictEqual(a.host(), '127.0.0.1');
  r = await a.run('browser_read_page', {});
  assert.ok(/textbox "Search"/.test(r.text), r.text);
  const ref = (/\[([\w-]+)\] textbox "Search"/.exec(r.text) || [])[1];
  r = await a.run('browser_get_text', {});
  assert.ok(r.text.includes('Hello'), r.text);
  r = await a.run('browser_find', { query: 'Search box' });
  assert.ok(r.ok);
  const qref = ref || (/\[([\w-]+)\]/.exec(r.text) || [])[1];
  assert.ok(qref, 'a ref for the input: ' + r.text);
  r = await a.run('browser_type', { ref: qref, text: 'artemis' });
  assert.ok(r.ok && /Typed 7/.test(r.text), r.text);
  r = await a.run('browser_find', { query: 'Go button' });
  const gref = (/\[([\w-]+)\] button/.exec(r.text) || /\[([\w-]+)\]/.exec(r.text) || [])[1];
  r = await a.run('browser_click', { ref: gref });
  assert.ok(r.ok, r.text);
  r = await a.run('browser_javascript', { code: "document.getElementById('out').textContent" });
  assert.ok(r.text.includes('clicked:artemis'), r.text);
  r = await a.run('browser_console', {});
  assert.ok(r.text.includes('page ready'), r.text);
  r = await a.run('browser_screenshot', {});
  assert.ok(r.image && r.image.startsWith('data:image/jpeg;base64,'));
  r = await a.run('browser_tabs', { action: 'new', url: base + '/two' });
  assert.ok(/Tab 2/.test(r.text) && r.text.includes('Two'), r.text);
  r = await a.run('browser_tabs', {});
  assert.ok(r.text.includes('[1]') && r.text.includes('[2] (active)'), r.text);
  r = await a.run('browser_key', { keys: 'cmd+a Tab' });
  assert.ok(r.ok, r.text);
  r = await a.run('browser_navigate', { url: 'back', tabId: 1 });
  assert.ok(r.ok);
  r = await a.run('browser_navigate', { url: 'file:///etc/passwd' });
  assert.ok(!r.ok && /http/.test(r.text));
  r = await a.run('browser_click', {});
  assert.ok(!r.ok && /ref/.test(r.text));
  await br.close();
  srv.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('test-pwbrowser: ok');
})().catch((e) => { console.error(e); process.exit(1); });
