// Plugins: manifest checks, save / list / hot reload, running a tool in the sandbox, enable / disable / remove.
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { createPlugins, validateManifest, fullName } = require('../electron/plugins');

(async () => {
  assert.ok(!validateManifest({}).ok);
  assert.ok(!validateManifest({ name: 'x' }).ok, 'needs a tool or panel');
  assert.ok(!validateManifest({ name: 'x', tools: [{ name: 't', file: '../evil.js' }] }).ok);
  assert.ok(!validateManifest({ name: 'x', tools: [{ name: 't', file: 't.js' }] }, {}).ok, 'missing file');
  assert.ok(validateManifest({ name: 'x', tools: [{ name: 't', file: 't.js' }] }, { 't.js': 1 }).ok);
  assert.strictEqual(fullName('unit-convert', 'to-km'), 'plugin__unit_convert__to_km');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plug-'));
  let off = [];
  const pl = createPlugins({ dir, dataDir: path.join(dir, '..', path.basename(dir) + '-data'), getDisabled: () => off, setDisabled: (l) => { off = l; } });
  assert.deepStrictEqual(pl.list(), []);
  const manifest = { name: 'Unit Convert', description: 'Converts units', tools: [{ name: 'miles_to_km', description: 'Miles to km', parameters: { type: 'object', properties: { miles: { type: 'number' } }, required: ['miles'] }, file: 'tools/m.js' }, { name: 'ping', file: 'tools/p.js' }], panels: [{ id: 'main', title: 'Converter', file: 'panel.html' }] };
  const saved = pl.save({ manifest, files: { 'tools/m.js': 'return { km: Math.round(args.miles * 1.609344 * 100) / 100 }', 'tools/p.js': 'const r = await web("https://example.com/x"); return r.status + " " + r.json().hi', 'panel.html': '<!doctype html><p>hi</p>' } });
  assert.strictEqual(saved.slug, 'unit-convert');
  assert.strictEqual(pl.definitions().length, 2);
  assert.strictEqual(pl.definitions()[0].function.name, 'plugin__unit_convert__miles_to_km');

  let r = await pl.run('plugin__unit_convert__miles_to_km', { miles: 10 });
  assert.ok(r.ok, r.text); assert.match(r.text, /"km": 16.09/);
  r = await pl.run('plugin__unit_convert__ping', {}, { web: async (url) => ({ status: 200, ok: true, text: '{"hi":"there"}', url }) });
  assert.strictEqual(r.text, '200 there');
  r = await pl.run('plugin__unit_convert__ping', {}); assert.ok(!r.ok); // no web bridge given

  // hot reload: edit a tool file, the next run uses it
  pl.save({ manifest, files: { 'tools/m.js': 'return "v2"' } });
  r = await pl.run('plugin__unit_convert__miles_to_km', { miles: 1 }); assert.strictEqual(r.text, 'v2');
  assert.ok(fs.existsSync(path.join(dir, 'unit-convert', 'panel.html')), 'save without replace keeps other files');

  assert.strictEqual(pl.panel('unit-convert', 'main').html, '<!doctype html><p>hi</p>');
  assert.ok(pl.get('Unit Convert').files['tools/m.js']);

  pl.setEnabled('unit-convert', false);
  assert.strictEqual(pl.definitions().length, 0);
  await assert.rejects(pl.run('plugin__unit_convert__miles_to_km', {}), /switched off/);
  pl.setEnabled('unit-convert', true);

  assert.throws(() => pl.save({ manifest: { name: 'Bad', tools: [{ name: 't', file: 'nope.js' }] } }), /missing/);
  fs.mkdirSync(path.join(dir, 'broken')); fs.writeFileSync(path.join(dir, 'broken', 'plugin.json'), '{oops');
  const b = pl.list().find((p) => p.slug === 'broken'); assert.ok(b && !b.ok && /plugin.json/.test(b.error));

  // the plugin window: data kept outside the plugin folder, files served only from inside it, a tool app for panel-less plugins
  assert.strictEqual(pl.dataSet('unit-convert', 'last', { km: 5 }), true);
  assert.deepStrictEqual(pl.dataAll('unit-convert'), { last: { km: 5 } });
  pl.save({ manifest, files: { 'tools/m.js': 'return 1' }, replace: false });
  assert.deepStrictEqual(pl.dataAll('unit-convert').last, { km: 5 }, 'a save keeps the data');
  assert.ok(pl.fileOf('unit-convert', 'panel.html')); assert.strictEqual(pl.fileOf('unit-convert', '../../etc/passwd'), null);
  const page = pl.appPage('unit-convert');
  assert.match(page, /<form class="card" data-tool="miles_to_km">/); assert.match(page, /name="miles" data-t="number" required/);
  const { createPluginWindows } = require('../electron/plugin-windows');
  const pw = createPluginWindows({ BrowserWindow: function () {}, shell: {}, plugins: pl, pluginWebFetch: async () => ({}), appJs: '/*app*/' });
  let res = pw.serve({ url: 'artemis-plugin://unit-convert/panel.html' });
  assert.strictEqual(res.status, 200); assert.match(res.headers.get('content-security-policy'), /default-src 'self'/); assert.strictEqual(await res.text(), '<!doctype html><p>hi</p>');
  assert.strictEqual(pw.serve({ url: 'artemis-plugin://unit-convert/..%2F..%2Fplugin.json' }).status, 404);
  assert.strictEqual(pw.serve({ url: 'artemis-plugin://unit-convert/__app__.js' }).status, 200);
  assert.strictEqual(pw.serve({ url: 'artemis-plugin://nope/panel.html' }).status, 404);
  // connectors (MCP) from a plugin window: every tool, read or write, after one approval per plugin and connector
  let asks = 0;
  const fakeMcp = { info: (n) => (n.startsWith('mcp__weather__') ? { server: 'weather', serverName: 'Weather', readOnly: n.endsWith('get') } : null), call: async (n, a) => ({ ok: true, text: n + ' ' + JSON.stringify(a) }), definitions: () => [{ function: { name: 'mcp__weather__get' } }, { function: { name: 'mcp__weather__set_alert' } }] };
  const pw2 = createPluginWindows({ BrowserWindow: function () {}, shell: {}, plugins: pl, pluginWebFetch: async () => ({}), appJs: '', mcp: () => fakeMcp, approve: async () => { asks++; return true; } });
  assert.strictEqual((await pw2.connectorCall('unit-convert', 'mcp__weather__get', { city: 'Baku' })).text, 'mcp__weather__get {"city":"Baku"}');
  assert.ok((await pw2.connectorCall('unit-convert', 'mcp__weather__set_alert', {})).ok, 'write tools work too');
  assert.strictEqual(asks, 1, 'asked once per connector');
  assert.ok(!(await pw2.connectorCall('unit-convert', 'mcp__nope__x', {})).ok);
  const pw3 = createPluginWindows({ BrowserWindow: function () {}, shell: {}, plugins: pl, pluginWebFetch: async () => ({}), appJs: '', mcp: () => fakeMcp, approve: async () => false });
  assert.match((await pw3.connectorCall('unit-convert', 'mcp__weather__get', {})).text, /Not allowed/);
  // a plugin tool calling the connector from its window
  pl.save({ manifest, files: { 'tools/m.js': 'return await tools.weather.get({ city: args.city })' } });
  assert.ok(pl.remove('unit-convert')); assert.ok(!fs.existsSync(path.join(dir, 'unit-convert')));
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('plugins tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
