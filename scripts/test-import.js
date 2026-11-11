const assert = require('assert'), JSZip = require('jszip');
const { parseExport } = require('../electron/importer');
const gpt = [{
  title: 'Trip plan', conversation_id: 'c1', update_time: 1700000000, current_node: 'a2',
  mapping: {
    root: { id: 'root', parent: null, children: ['s'], message: null },
    s: { id: 's', parent: 'root', children: ['u1'], message: { author: { role: 'system' }, content: { content_type: 'text', parts: [''] } } },
    u1: { id: 'u1', parent: 's', children: ['a1', 'a1b'], message: { author: { role: 'user' }, create_time: 1699999990, content: { content_type: 'text', parts: ['Plan a trip to Lisbon'] } } },
    a1b: { id: 'a1b', parent: 'u1', children: [], message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: ['discarded branch'] } } },
    a1: { id: 'a1', parent: 'u1', children: ['t', 'u2'], message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: ['Sure! Day 1...'] } } },
    t: { id: 't', parent: 'a1', children: [], message: { author: { role: 'tool' }, content: { content_type: 'text', parts: ['tool noise'] } } },
    u2: { id: 'u2', parent: 'a1', children: ['a2'], message: { author: { role: 'user' }, content: { content_type: 'multimodal_text', parts: [{ content_type: 'image_asset_pointer' }, 'what is this?'] } } },
    a2: { id: 'a2', parent: 'u2', children: [], message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: ['A bridge.'] } } }
  }
}, { title: 'empty', mapping: { r: { id: 'r', parent: null, children: [], message: null } } }];
const claude = [{ uuid: 'x1', name: 'Hello', updated_at: '2026-01-02T10:00:00Z', chat_messages: [
  { sender: 'human', text: 'hi', created_at: '2026-01-02T09:00:00Z' },
  { sender: 'assistant', text: 'old', content: [{ type: 'text', text: 'Hello there' }], created_at: '2026-01-02T09:00:05Z' }] }];
(async () => {
  let r = await parseExport(Buffer.from(JSON.stringify(gpt)), 'm/x');
  assert.strictEqual(r.source, 'ChatGPT'); assert.strictEqual(r.chats.length, 1);
  const c = r.chats[0];
  assert.deepStrictEqual(c.messages.map((m) => m.role), ['user', 'assistant', 'user', 'assistant']);
  assert.strictEqual(c.messages[0].content, 'Plan a trip to Lisbon');
  assert.strictEqual(c.messages[2].content, '[image]\n\nwhat is this?');
  assert.strictEqual(c.messages[3].steps[0].text, 'A bridge.');
  assert.strictEqual(c.importKey, 'chatgpt:c1'); assert.strictEqual(c.title, 'Trip plan');
  const zip = new JSZip(); zip.file('export/conversations.json', JSON.stringify(claude)); zip.file('export/users.json', '[]');
  r = await parseExport(await zip.generateAsync({ type: 'nodebuffer' }), 'm/x');
  assert.strictEqual(r.source, 'Claude'); assert.strictEqual(r.chats[0].messages[1].steps[0].text, 'Hello there');
  await assert.rejects(parseExport(Buffer.from('{"a":1}'), 'm'), /No ChatGPT or Claude/);
  await assert.rejects(parseExport(Buffer.from('[{"foo":1}]'), 'm'), /No ChatGPT or Claude/);
  console.log('import: all tests passed');
})().catch((e) => { console.error(e); process.exit(1); });

// Claude: full export (projects with docs, memories, branches, attachments) and the account import
(async () => {
  const { parseExport, fromJsonValues } = require('../electron/importer');
  const { importClaudeAccount } = require('../electron/claude-account');
  const conv = { uuid: 'c9', name: 'Branchy', current_leaf_message_uuid: 'm3b', project_uuid: 'p1', chat_messages: [
    { uuid: 'm1', sender: 'human', text: 'q', created_at: '2026-01-01T00:00:00Z', attachments: [{ file_name: 'notes.txt', extracted_content: 'NOTE BODY' }], files: [{ file_name: 'pic.png', file_kind: 'image' }] },
    { uuid: 'm2', parent_message_uuid: 'm1', sender: 'assistant', content: [{ type: 'thinking', thinking: 'x' }, { type: 'text', text: 'a' }], created_at: '2026-01-01T00:00:01Z' },
    { uuid: 'm3a', parent_message_uuid: 'm2', sender: 'human', text: 'old edit', created_at: '2026-01-01T00:00:02Z' },
    { uuid: 'm3b', parent_message_uuid: 'm2', sender: 'human', text: 'new edit', created_at: '2026-01-01T00:00:03Z' }] };
  const proj = { uuid: 'p1', name: 'Artemis', description: 'desk app', prompt_template: 'Be brief.', docs: [{ filename: 'spec.md', content: '# Spec' }] };
  const mem = [{ conversations_memory: 'Likes tea.\n\nWorks in Baku.', project_memories: { p1: 'Purpose: build Artemis' } }];
  const zip = new JSZip(); zip.file('conversations.json', JSON.stringify([conv])); zip.file('projects.json', JSON.stringify([proj])); zip.file('memories.json', JSON.stringify(mem)); zip.file('users.json', '[{"uuid":"u"}]');
  const r = await parseExport(await zip.generateAsync({ type: 'nodebuffer' }), 'm');
  const c = r.chats[0];
  assert.deepStrictEqual(c.messages.map((m) => m.content || m.steps[0].text), ['q\n\n[attached in Claude: pic.png]', 'a', 'new edit'], 'the current branch only');
  assert.deepStrictEqual(c.messages[0].attachments, [{ kind: 'text', name: 'notes.txt', text: 'NOTE BODY', truncated: false }]);
  assert.strictEqual(c.projectImportKey, 'claude-project:p1');
  assert.strictEqual(r.projects.length, 1); const p = r.projects[0];
  assert.strictEqual(p.instructions, 'Be brief.'); assert.deepStrictEqual(p.docs, [{ name: 'spec.md', text: '# Spec' }]); assert.strictEqual(p.memory, 'Purpose: build Artemis');
  assert.deepStrictEqual(r.memory.map((m) => m.text), ['Likes tea.', 'Works in Baku.']);
  assert.strictEqual(fromJsonValues([[proj]], 'm').projects.length, 1, 'a projects.json alone imports');

  // account import: projects, docs and conversations from the web app's endpoints; unchanged chats are skipped
  const calls = [];
  const api = {
    '/organizations': [{ uuid: 'o1', capabilities: ['chat'] }],
    '/organizations/o1/projects?limit=500': [{ uuid: 'p1', name: 'Artemis' }],
    '/organizations/o1/projects/p1': { uuid: 'p1', name: 'Artemis', prompt_template: 'Be brief.' },
    '/organizations/o1/projects/p1/docs': [{ file_name: 'spec.md', content: '# Spec' }],
    '/organizations/o1/chat_conversations': [{ uuid: 'c9', updated_at: '2026-02-01T00:00:00Z', project_uuid: 'p1' }, { uuid: 'old', updated_at: '2026-01-01T00:00:00Z' }],
    '/organizations/o1/chat_conversations/c9?tree=True&rendering_mode=messages&render_all_tools=true': { ...conv, project_uuid: undefined }
  };
  const fetchJson = async (url) => { const k = url.replace('https://claude.ai/api', ''); calls.push(k); if (!(k in api)) { const e = new Error('404'); e.status = 404; throw e; } return api[k]; };
  const a = await importClaudeAccount({ fetchJson, known: { 'claude:old': Date.parse('2026-01-05T00:00:00Z') }, fallbackModel: 'm' });
  assert.strictEqual(a.chats.length, 1); assert.strictEqual(a.chats[0].projectImportKey, 'claude-project:p1', 'project from the list');
  assert.strictEqual(a.projects[0].instructions, 'Be brief.'); assert.strictEqual(a.projects[0].docs[0].text, '# Spec'); assert.strictEqual(a.skipped, 1);
  assert.ok(!calls.some((k) => k.includes('/old')), 'unchanged chat not fetched');
  await assert.rejects(importClaudeAccount({ fetchJson: async () => { const e = new Error('x'); e.status = 403; throw e; } }), (e) => e.needLogin === true);
  console.log('import: Claude export + account tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
