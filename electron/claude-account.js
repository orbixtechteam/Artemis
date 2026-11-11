// Import from the user's own Claude account, through the claude.ai session they signed into in Artemis's built-in
// browser. The official data export has no link between chats and projects; the web app's API does: projects with
// their instructions and knowledge docs, every conversation with its project, and the full message tree.
// These are claude.ai's own web endpoints (not a public API), read only, with the user's session, a few at a time.
const { fromJsonValues } = require('./importer');

const BASE = 'https://claude.ai/api';
const CONCURRENCY = 4;

/**
 * fetchJson(url) → parsed JSON (throws { status } on HTTP errors). known: { importKey: updatedAtMs } of chats already
 * imported, so unchanged chats are not fetched again. onProgress({ phase, done, total }).
 */
async function importClaudeAccount({ fetchJson, known = {}, onProgress = () => {}, signal, fallbackModel }) {
  let orgs;
  try { orgs = await fetchJson(`${BASE}/organizations`); }
  catch (e) { if (e && (e.status === 401 || e.status === 403)) { const err = new Error('Sign in to claude.ai in the Artemis browser first.'); err.needLogin = true; throw err; } throw e; }
  orgs = (Array.isArray(orgs) ? orgs : []).filter((o) => o && o.uuid && (!Array.isArray(o.capabilities) || o.capabilities.includes('chat')));
  if (!orgs.length) { const err = new Error('Sign in to claude.ai in the Artemis browser first.'); err.needLogin = true; throw err; }

  const projects = [], convs = [];
  let skipped = 0;
  for (const org of orgs) {
    const o = `${BASE}/organizations/${org.uuid}`;
    onProgress({ phase: 'projects', done: 0, total: 0 });
    const plist = await fetchJson(`${o}/projects?limit=500`).catch(() => []);
    const items = Array.isArray(plist) ? plist : (plist && plist.data) || [];
    await pool(items.filter((p) => p && p.uuid && !p.is_starter_project), async (p) => {
      const [full, docs] = await Promise.all([fetchJson(`${o}/projects/${p.uuid}`).catch(() => p), fetchJson(`${o}/projects/${p.uuid}/docs`).catch(() => [])]);
      projects.push({ ...p, ...(full || {}), docs: (Array.isArray(docs) ? docs : []).map((d) => ({ filename: d.file_name || d.filename, content: d.content })) });
    }, signal);
    onProgress({ phase: 'chats', done: 0, total: 0 });
    let list = await fetchJson(`${o}/chat_conversations`).catch(() => []);
    list = (Array.isArray(list) ? list : (list && list.data) || []).filter((c) => c && c.uuid);
    const todo = list.filter((c) => { const k = 'claude:' + c.uuid, at = Date.parse(c.updated_at || ''); if (known[k] && at && known[k] >= at) { skipped++; return false; } return true; });
    let done = 0;
    onProgress({ phase: 'chats', done, total: todo.length });
    await pool(todo, async (c) => {
      const full = await fetchJson(`${o}/chat_conversations/${c.uuid}?tree=True&rendering_mode=messages&render_all_tools=true`).catch(() => null);
      if (full && Array.isArray(full.chat_messages)) convs.push({ ...full, project_uuid: full.project_uuid || c.project_uuid || (c.project && c.project.uuid) || '' });
      onProgress({ phase: 'chats', done: ++done, total: todo.length });
    }, signal);
  }
  const out = fromJsonValues([convs, projects], fallbackModel);
  out.source = 'Claude'; out.skipped = skipped;
  return out;
}

/** Runs fn over items, CONCURRENCY at a time, stopping when signal aborts. */
async function pool(items, fn, signal) {
  let i = 0;
  const worker = async () => { while (i < items.length) { if (signal && signal.aborted) throw new Error('Import stopped.'); const it = items[i++]; await fn(it); } };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
}

/** fetchJson over an Electron session (the built-in browser's cookies). */
function sessionFetcher(ses) {
  return async (url) => {
    const res = await ses.fetch(url, { headers: { accept: 'application/json', 'content-type': 'application/json' }, credentials: 'include' });
    if (!res.ok) { const e = new Error(`claude.ai answered ${res.status}`); e.status = res.status; throw e; }
    return res.json();
  };
}

module.exports = { importClaudeAccount, sessionFetcher };
