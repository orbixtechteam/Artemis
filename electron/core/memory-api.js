// The memory object the agent gets (ctx.memory): the old list API (list / add / remove, used by memory_save,
// memory_forget, Telegram /memory and the Memory panel) plus search / get / note / context for memory v2.
const providersLib = require('../providers');
const { httpEmbedder } = require('./memindex');

function createMemoryApi({ workspace, index, notify = () => {} }) {
  return {
    list: () => workspace.list(),
    add: (text) => { const r = workspace.add(text); if (!r.duplicate) notify(); return r; },
    remove: (id) => { const ok = workspace.remove(id); if (ok) notify(); return ok; },
    replaceAll: (items) => { const l = workspace.replaceAll(items); notify(); return l; },
    search: index ? (q, n, signal) => index.search(q, { limit: n, signal }) : null,
    get: (p, from, lines) => workspace.read(p, from, lines),
    note: (text) => workspace.note(text),
    context: () => workspace.context()
  };
}

/** Embedding model from settings.embeddingModel ("prov:<id>:<model>"), or null when none is set. Cached per model id. */
function embedderFrom({ getSettings, readProviders, getProviderKey }) {
  let cache = { id: '', e: null };
  return () => {
    const id = String(getSettings().embeddingModel || '');
    if (!id) return null;
    if (cache.id === id) return cache.e;
    const r = providersLib.resolve(id, readProviders(), getProviderKey);
    let e = null;
    if (!r.error) {
      const url = providersLib.joinUrl(r.baseUrl, 'embeddings');
      e = httpEmbedder({ url, key: r.key, model: r.model, headers: providersLib.headersFor(url) });
      e.model = id; // vectors are tagged with the full id, so another provider's model of the same name is not mixed in
    }
    cache = { id, e };
    return e;
  };
}

module.exports = { createMemoryApi, embedderFrom };
