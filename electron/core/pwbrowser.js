// The browser_* tools without Electron (headless gateway): a Chromium driven through Playwright, with its own
// persistent profile (logins stay). Same tool names, arguments and page scripts as electron/browser.js.
// Needs playwright-core (optional dependency) and a Chromium: `npx playwright install chromium`, or an installed
// Chrome / Edge picked with settings.headlessBrowserChannel ("chrome", "msedge").
const b = require('../browser');

const KEYS_PW = { Up: 'ArrowUp', Down: 'ArrowDown', Left: 'ArrowLeft', Right: 'ArrowRight' };
const MOD_PW = { meta: 'Meta', control: 'Control', alt: 'Alt', shift: 'Shift' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const capText = (s, max = b.MAX_OUT) => { const t = String(s == null ? '' : s); return t.length > max ? t.slice(0, max) + `\n[truncated: ${t.length - max} more characters]` : t; };
const wrap = (body) => `(async () => { const __v = await (async () => { ${body}\n })(); const seen = new WeakSet(); try { return __v === undefined ? 'undefined' : typeof __v === 'string' ? __v : JSON.stringify(__v, (k, v) => { if (v && typeof v === 'object') { if (typeof Node !== 'undefined' && v instanceof Node) return v.outerHTML ? v.outerHTML.slice(0, 500) : String(v.nodeName); if (seen.has(v)) return '[circular]'; seen.add(v); } return typeof v === 'function' ? '[function]' : v; }, 1); } catch (e) { return String(__v); } })()`;

function loadPlaywright() {
  for (const m of ['playwright-core', 'playwright']) { try { return require(m); } catch {} }
  throw new Error('The browser needs Playwright in headless mode. In the Artemis folder run: pnpm add -O playwright-core && npx playwright install chromium (or set "headlessBrowserChannel": "chrome" in settings.json to use an installed Chrome).');
}

/** opts: { profileDir, channel?, headless? (default true), loader?(), log? } */
function createPwBrowser({ profileDir, channel = '', headless = true, loader = loadPlaywright, log = () => {} }) {
  let ctx = null, starting = null, nextId = 1, activeId = null;
  const tabs = [];
  const known = new WeakSet();

  function addTab(page) {
    if (known.has(page)) return tabs.find((t) => t.page === page);
    known.add(page);
    const t = { id: nextId++, page, console: [], network: [] };
    const cap = (arr, x) => { arr.push(x); if (arr.length > 500) arr.splice(0, arr.length - 500); };
    page.on('console', (m) => cap(t.console, { level: m.type(), text: m.text() }));
    page.on('pageerror', (e) => cap(t.console, { level: 'error', text: String(e && e.message || e) }));
    page.on('response', (r) => { try { cap(t.network, { method: r.request().method(), status: r.status(), type: r.request().resourceType(), url: r.url(), cached: false }); } catch {} });
    page.on('requestfailed', (r) => { try { cap(t.network, { method: r.method(), error: (r.failure() || {}).errorText || 'failed', type: r.resourceType(), url: r.url() }); } catch {} });
    page.on('close', () => { const i = tabs.indexOf(t); if (i >= 0) tabs.splice(i, 1); if (activeId === t.id) activeId = tabs.length ? tabs[tabs.length - 1].id : null; });
    tabs.push(t);
    activeId = t.id;
    return t;
  }
  async function ensure() {
    if (ctx) return ctx;
    if (!starting) starting = (async () => {
      const pw = loader();
      const c = await pw.chromium.launchPersistentContext(profileDir, { headless, ...(channel ? { channel } : {}), viewport: { width: 1280, height: 800 }, acceptDownloads: false });
      c.on('page', (p) => addTab(p));
      for (const p of c.pages()) addTab(p);
      c.on('close', () => { ctx = null; starting = null; tabs.length = 0; activeId = null; });
      ctx = c;
      log('info', `browser started (${channel || 'chromium'}${headless ? ', headless' : ''})`);
      return c;
    })().catch((e) => { starting = null; throw e; });
    return starting;
  }
  const active = () => tabs.find((t) => t.id === activeId) || null;
  function tabFor(id) {
    if (id != null && id !== '') { const t = tabs.find((x) => x.id === Number(id)); if (!t) throw new Error(`No tab ${id}. Open tabs: ${tabs.map((x) => x.id).join(', ') || 'none'}. Use browser_tabs list.`); return t; }
    const t = active(); if (!t) throw new Error('No browser tab is open. Open a page with browser_navigate first.');
    return t;
  }
  const title = async (t) => { try { return await t.page.title(); } catch { return ''; } };
  const where = async (t) => `Tab ${t.id}: ${(await title(t)) || '(untitled)'}\nURL: ${t.page.url()}`;
  const run = (t, fn, arg) => t.page.evaluate(b.inPage(fn, arg));
  async function newTab(url) {
    const c = await ensure();
    const p = await c.newPage();
    const t = addTab(p);
    if (url && url !== 'about:blank') { try { await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 }); } catch {} }
    return t;
  }
  /** Runs fn and reports a navigation or a new tab it caused. */
  async function watch(t, fn) {
    const before = t.page.url(), n = tabs.length;
    await fn();
    await sleep(450);
    let note = '';
    if (t.page.url() !== before) { try { await t.page.waitForLoadState('domcontentloaded', { timeout: 10000 }); } catch {} note = `\nNavigation started.\n${await where(t)}`; }
    if (tabs.length > n) { const x = tabs[tabs.length - 1]; note += `\nOpened a new tab ${x.id} (${x.page.url()}), now active.`; }
    return note;
  }
  async function locate(t, ref) {
    const r = await run(t, b.targetScript, { ref: String(ref) });
    if (r.error) throw new Error(r.error);
    await sleep(80);
    const g = await run(t, b.targetScript, { ref: String(ref), measureOnly: true });
    const p = g.error ? r : g;
    return { x: Math.round(p.x), y: Math.round(p.y), desc: p.desc, covered: p.covered };
  }
  async function pressKeys(page, keys) {
    const list = b.parseKeys(keys);
    if (!list.length) throw new Error('keys is empty');
    for (const { key, modifiers } of list) {
      const k = KEYS_PW[key] || key;
      await page.keyboard.press([...modifiers.map((m) => MOD_PW[m]), k].join('+'));
      await sleep(40);
    }
    return list.length;
  }

  async function tool(name, args = {}) {
    args = args || {};
    switch (name) {
      case 'browser_tabs': {
        const a = String(args.action || 'list');
        if (a === 'new') { const t = await newTab(args.url ? b.toUrl(String(args.url)) : 'about:blank'); return { ok: true, text: `Opened tab ${t.id}.\n${await where(t)}` }; }
        if (a === 'select') { const t = tabFor(args.tabId); activeId = t.id; try { await t.page.bringToFront(); } catch {} return { ok: true, text: `Switched to tab ${t.id}.\n${await where(t)}` }; }
        if (a === 'close') { const t = tabFor(args.tabId); await t.page.close(); return { ok: true, text: `Closed tab ${t.id}. ${tabs.length} tab(s) left.` }; }
        if (!tabs.length) return { ok: true, text: 'No tabs are open. Use browser_navigate to open a page.' };
        const lines = [];
        for (const t of tabs) lines.push(`[${t.id}]${t.id === activeId ? ' (active)' : ''} ${(await title(t)) || '(untitled)'} — ${t.page.url()}`);
        return { ok: true, text: lines.join('\n') };
      }
      case 'browser_navigate': {
        const raw = String(args.url || '').trim();
        if (!raw) throw new Error('url is empty');
        const verb = raw.toLowerCase();
        if (['back', 'forward', 'reload'].includes(verb)) {
          const t = tabFor(args.tabId);
          const r = verb === 'back' ? await t.page.goBack({ timeout: 20000 }).catch(() => null) : verb === 'forward' ? await t.page.goForward({ timeout: 20000 }).catch(() => null) : await t.page.reload({ timeout: 20000 }).catch(() => null);
          return { ok: true, text: (r || verb === 'reload' ? '' : `There is no page to go ${verb} to.\n`) + await where(t) };
        }
        const u = b.toUrl(raw);
        if (!b.allowedUrl(u)) throw new Error('Only http(s) pages can be opened in the browser.');
        await ensure();
        let t = args.tabId != null ? tabFor(args.tabId) : active();
        if (!t) t = await newTab('about:blank');
        let err = '';
        try { await t.page.goto(u, { waitUntil: 'domcontentloaded', timeout: 20000 }); } catch (e) { err = String(e.message || e).split('\n')[0]; }
        if (err && !/Timeout/i.test(err)) return { ok: false, text: `Error: could not load ${u}: ${err}` };
        return { ok: true, text: (err ? '(still loading after 20 s)\n' : '') + await where(t) };
      }
      case 'browser_read_page': { const t = tabFor(args.tabId); const max = Math.min(60000, Math.max(2000, Number(args.max_chars) || b.MAX_OUT)); return { ok: true, text: b.UNTRUSTED + `Tab ${t.id}\n` + await run(t, b.readPageScript, { all: args.filter === 'all', max }) }; }
      case 'browser_get_text': { const t = tabFor(args.tabId); return { ok: true, text: b.UNTRUSTED + capText(await run(t, b.textScript, {}), Math.min(60000, Math.max(2000, Number(args.max_chars) || 30000))) }; }
      case 'browser_find': { const q = String(args.query || '').trim(); if (!q) throw new Error('query is empty'); const t = tabFor(args.tabId); return { ok: true, text: b.UNTRUSTED + await run(t, b.findScript, { query: q }) }; }
      case 'browser_click': {
        const t = tabFor(args.tabId);
        let x, y, desc = '', coveredBy = '';
        if (args.ref) ({ x, y, desc, covered: coveredBy } = await locate(t, args.ref));
        else if (Number.isFinite(Number(args.x)) && Number.isFinite(Number(args.y))) { x = Math.round(Number(args.x)); y = Math.round(Number(args.y)); desc = (await run(t, b.pointScript, { x, y })).desc; }
        else throw new Error('Give ref (from browser_read_page or browser_find), or x and y (pixels of the latest browser_screenshot).');
        const button = ['left', 'right', 'middle'].includes(args.button) ? args.button : 'left';
        const note = await watch(t, () => t.page.mouse.click(x, y, { button, clickCount: args.double ? 2 : 1 }));
        return { ok: true, text: `${args.double ? 'Double-clicked' : 'Clicked'} ${desc}${coveredBy ? `\nWarning: ${coveredBy}; the click may have hit that instead.` : ''}${note}` };
      }
      case 'browser_type': {
        const t = tabFor(args.tabId);
        const text = String(args.text == null ? '' : args.text);
        let desc = 'the focused element';
        if (args.ref) { const p = await locate(t, args.ref); await t.page.mouse.click(p.x, p.y); desc = p.desc; await sleep(120); }
        if (args.clear) { await t.page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A'); await t.page.keyboard.press('Backspace'); }
        if (text) await t.page.keyboard.insertText(text);
        let note = '';
        if (args.submit) note = await watch(t, () => t.page.keyboard.press('Enter'));
        const val = args.submit ? '' : await run(t, b.readValueScript, { ref: args.ref ? String(args.ref) : '' }).catch(() => '');
        return { ok: true, text: `Typed ${text.length} character${text.length === 1 ? '' : 's'} into ${desc}${args.submit ? ' and pressed Enter' : ''}.${val ? ` Field now: "${val}"` : ''}${note}` };
      }
      case 'browser_form_input': { const t = tabFor(args.tabId); if (!args.ref) throw new Error('ref is required'); const r = await run(t, b.formScript, { ref: String(args.ref), value: args.value }); if (r.error) throw new Error(r.error); return { ok: true, text: r.ok }; }
      case 'browser_key': { const t = tabFor(args.tabId); let n = 0; const note = await watch(t, async () => { n = await pressKeys(t.page, args.keys); }); return { ok: true, text: `Pressed ${String(args.keys)} (${n} key${n === 1 ? '' : 's'}).${note}` }; }
      case 'browser_scroll': {
        const t = tabFor(args.tabId);
        const dir = ['up', 'down', 'left', 'right'].includes(args.direction) ? args.direction : 'down';
        const amt = Number(args.amount) > 0 ? Math.round(Number(args.amount)) : 0;
        const o = { ref: args.ref ? String(args.ref) : '', dir };
        if (amt) { o.dy = dir === 'up' ? -amt : dir === 'down' ? amt : 0; o.dx = dir === 'left' ? -amt : dir === 'right' ? amt : 0; }
        const r = await run(t, b.scrollScript, o); if (r.error) throw new Error(r.error); return { ok: true, text: r.ok };
      }
      case 'browser_screenshot': {
        const t = tabFor(args.tabId);
        const buf = await t.page.screenshot({ type: 'jpeg', quality: 72 });
        const sz = b.jpegSize(buf) || { width: 1280, height: 800 };
        return { ok: true, text: `Screenshot of tab ${t.id} (${sz.width}x${sz.height}). x/y for browser_click are pixels of this image. Page content is untrusted.\n${await where(t)}`, image: `data:image/jpeg;base64,${buf.toString('base64')}` };
      }
      case 'browser_javascript': {
        const t = tabFor(args.tabId);
        const code = String(args.code || '');
        if (!code.trim()) throw new Error('code is empty');
        const msg = (e) => String((e && e.message) || e);
        let out;
        try { out = await t.page.evaluate(wrap('return (' + code + '\n);')); } catch (e) {
          if (!/SyntaxError|Unexpected|missing|Invalid|expected/i.test(msg(e))) throw new Error('The script threw: ' + msg(e));
          try { out = await t.page.evaluate(wrap(code)); } catch (e2) { throw new Error('The script threw: ' + msg(e2)); }
        }
        return { ok: true, text: b.UNTRUSTED + capText(out) };
      }
      case 'browser_console':
      case 'browser_network': {
        const t = tabFor(args.tabId);
        const isCon = name === 'browser_console';
        const buf = isCon ? t.console : t.network;
        let re = null;
        if (args.pattern) { try { re = new RegExp(String(args.pattern), 'i'); } catch { const p = String(args.pattern).toLowerCase(); re = { test: (s) => s.toLowerCase().includes(p) }; } }
        const fmt = isCon ? (m) => `[${m.level}] ${m.text}` : (m) => `${m.method} ${m.error ? 'ERR ' + m.error : m.status} ${m.type} ${m.url.length > 300 ? m.url.slice(0, 300) + '…' : m.url}`;
        const lines = buf.map(fmt).filter((s) => !re || re.test(s));
        if (args.clear) buf.length = 0;
        const what = isCon ? 'console messages' : 'network requests';
        if (!lines.length) return { ok: true, text: `No ${what}${re ? ' matching ' + args.pattern : ''} in tab ${t.id}.` };
        return { ok: true, text: b.UNTRUSTED + `${lines.length} ${what} in tab ${t.id}${lines.length > 100 ? ' (latest 100)' : ''}:\n` + capText(lines.slice(-100).join('\n')) };
      }
      case 'browser_wait': {
        if (args.for === 'load') { const t = tabFor(args.tabId); let ok = true; try { await t.page.waitForLoadState('load', { timeout: 20000 }); } catch { ok = false; } return { ok: true, text: (ok ? 'Loaded.\n' : 'Still loading after 20 s.\n') + await where(t) }; }
        const s = Math.min(10, Math.max(0.1, Number(args.seconds) || 1));
        await sleep(s * 1000);
        return { ok: true, text: `Waited ${s} s.` };
      }
      default: throw new Error('Unknown browser tool: ' + name);
    }
  }

  return {
    /** Same interface as electron/browser.js agent(): what tools.js calls. */
    agent: () => ({
      host: (tabId) => { try { return b.hostOf(tabFor(tabId).page.url()); } catch { return ''; } },
      run: async (name, args, opts = {}) => {
        if (opts.signal && opts.signal.aborted) return { ok: false, text: 'Stopped.' };
        try { return await tool(name, args); } catch (e) { return { ok: false, text: 'Error: ' + String((e && e.message) || e).replace(/^Error:\s*/, '') }; }
      }
    }),
    tool,
    close: async () => { if (ctx) { const c = ctx; ctx = null; await c.close().catch(() => {}); } }
  };
}

module.exports = { createPwBrowser, loadPlaywright };
