// Code mode: programs run in a locked-down child, call connector tools through the parent, print a short result.
const assert = require('assert');
const { runCode, describeTools } = require('../electron/code-mode');

(async () => {
  const seen = [];
  const call = async (name, args) => { seen.push([name, args]); if (name === 'mcp__cal__list') return { ok: true, text: JSON.stringify([{ t: 'a', n: 1 }, { t: 'b', n: 5 }, { t: 'c', n: 9 }]) }; if (name === 'mcp__cal__fail') return { ok: false, text: 'nope' }; return { ok: true, text: 'plain text' }; };
  const names = ['mcp__cal__list', 'mcp__cal__fail', 'mcp__my-srv__get-item'];

  let r = await runCode('const xs = await tools.cal.list({ day: 1 }); console.log(xs.filter((x) => x.n > 3).map((x) => x.t).join(","));', { call, names });
  assert.ok(r.ok, r.text); assert.strictEqual(r.text, 'b,c'); assert.deepStrictEqual(seen[0], ['mcp__cal__list', { day: 1 }]);

  r = await runCode('return { total: (await tools.cal.list()).length }', { call, names });
  assert.ok(r.ok); assert.match(r.text, /"total": 3/);

  r = await runCode('try { await tools.cal.fail() } catch (e) { return "caught " + e.message }', { call, names });
  assert.strictEqual(r.text, 'caught nope');

  r = await runCode('return await tools.my_srv.get_item({})', { call, names }); // dashes reachable as underscores
  assert.strictEqual(r.text, 'plain text');

  r = await runCode('return await callTool("mcp__other__x", {})', { call, names });
  assert.ok(!r.ok); assert.match(r.text, /unknown tool/);

  // locked down: no require, no process, no eval / Function, and the Function-constructor escape is closed
  r = await runCode('return typeof require + "," + typeof process', { call, names }); assert.strictEqual(r.text, 'undefined,undefined');
  r = await runCode('return eval("1+1")', { call, names }); assert.ok(!r.ok);
  r = await runCode('return (function(){}).constructor.constructor("return process")().pid', { call, names }); assert.ok(!r.ok, r.text);
  r = await runCode('return tools.constructor.constructor("return process")().pid', { call, names }); assert.ok(!r.ok, r.text);

  r = await runCode('throw new Error("boom")', { call, names }); assert.ok(!r.ok); assert.match(r.text, /boom/);
  r = await runCode('syntax error here(', { call, names }); assert.ok(!r.ok);
  r = await runCode('while (true) {}', { call, names }); assert.ok(!r.ok); // the sync timeout stops it

  r = await runCode('await sleep(50); console.log("x".repeat(60000))', { call, names }); assert.match(r.text, /output cut/);
  r = await runCode('await sleep(5000)', { call, names, timeoutMs: 400 }); assert.ok(!r.ok); assert.match(r.text, /stopped/);
  r = await runCode('return 1', { call, names, signal: AbortSignal.abort() }); assert.ok(!r.ok);

  const denied = async () => ({ ok: true, denied: true, text: 'The user declined' });
  r = await runCode('return await tools.cal.list()', { call: denied, names }); assert.ok(!r.ok); assert.match(r.text, /declined/);

  const defs = [{ type: 'function', function: { name: 'mcp__cal__list', description: '[Calendar] List events', parameters: { type: 'object', properties: { day: { type: 'number' }, mode: { enum: ['a', 'b'] } }, required: ['day'] } } }];
  assert.strictEqual(describeTools(defs), 'tools.cal.list({day: number, mode?: "a"|"b"}) — List events');
  assert.match(describeTools(defs, { query: 'mail' }), /No connector tool/);
  // through the real tool runner: connector calls inside a program ask for approval like direct calls do
  const tools = require('../electron/tools');
  const asked = [];
  const mcp = {
    definitions: () => defs, index: () => [{ slug: 'cal', name: 'Calendar', tools: ['list'] }],
    info: (n) => (n === 'mcp__cal__list' ? { server: 'cal', serverName: 'Calendar', readOnly: true } : null),
    call: async (n, a) => ({ ok: true, text: JSON.stringify({ n, a }) })
  };
  const ctx = { mcp, root: process.cwd(), session: new Set(), approve: async (q) => { asked.push(q.category); return true; } };
  r = await tools.run('run_code', { code: 'const a = await tools.cal.list({ day: 2 }); const b = await tools.cal.list({ day: 3 }); return [a.a.day, b.a.day]' }, ctx);
  assert.ok(r.ok, r.text); assert.match(r.text, /2,\s*3/); assert.deepStrictEqual(asked, ['mcp-read:cal']); // asked once for the connector
  r = await tools.run('connector_tools', { query: 'events' }, ctx); assert.match(r.text, /tools\.cal\.list/);
  const no = { ...ctx, session: new Set(), approve: async () => false };
  r = await tools.run('run_code', { code: 'return await tools.cal.list({ day: 1 })' }, no); assert.ok(!r.ok); assert.match(r.text, /declined/);
  // Artemis's own tools from a program: tools.artemis.create_diagram / create_document / read_file, with approval
  const os = require('os'), fsx = require('fs'), px = require('path');
  const root = fsx.mkdtempSync(px.join(os.tmpdir(), 'cm-'));
  const own = require('../electron/tools').definitions({ hasFolder: true }).filter((d) => ['read_file', 'create_diagram', 'create_document', 'run_command'].includes(d.function.name));
  const sent = [], okd = [];
  const c2 = { root, toolDefs: own, session: new Set(), send: (e) => sent.push(e), approve: async (q) => { okd.push(q.name); return true; } };
  r = await tools.run('connector_tools', { query: 'diagram' }, c2); assert.match(r.text, /tools\.artemis\.create_diagram\(\{path: string/);
  r = await tools.run('run_code', { code: `
    await tools.artemis.create_diagram({ path: 'flow.excalidraw', nodes: [{ id: 'a', label: 'Start' }, { id: 'b', label: 'End' }], edges: [{ from: 'a', to: 'b' }] });
    await tools.artemis.create_document({ path: 'r.docx', markdown: '# Report\\n\\n| a | b |\\n|---|---|\\n| 1 | 2 |' });
    const t = await tools.artemis.read_file({ path: 'flow.excalidraw' });
    return typeof t === 'string' ? t.length > 100 : true;` }, c2);
  assert.ok(r.ok, r.text); assert.strictEqual(r.text, 'true');
  assert.ok(fsx.existsSync(px.join(root, 'flow.excalidraw')) && fsx.existsSync(px.join(root, 'r.docx')));
  assert.deepStrictEqual(okd, ['create_diagram', 'create_document'], 'each write asked for approval');
  assert.strictEqual(sent.filter((e) => e.type === 'files').length, 2, 'file cards for both');
  r = await tools.run('run_code', { code: 'return await tools.artemis.run_command({ command: "ls" })' }, c2); assert.ok(!r.ok, 'the shell is not reachable from a program');
  fsx.rmSync(root, { recursive: true, force: true });
  console.log('code-mode tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
