import React, { useEffect, useState } from 'react';
import Select from '../Select.jsx';
import { Group, Row, SwitchRow } from './ui.jsx';

/** Long-term memory (Settings → Tools): the workspace files, the search index and the memory flush. */
export function MemoryGroup({ s, setS, put, providers = [], modelOptions }) {
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState('');
  const load = () => window.api.workspaceInfo && window.api.workspaceInfo().then(setInfo).catch(() => {});
  useEffect(() => { load(); }, [s.embeddingModel]);
  const emb = /^prov:([^:]+):(.+)$/.exec(s.embeddingModel || '');
  const [embProv, setEmbProv] = useState(emb ? emb[1] : '');
  const [embModel, setEmbModel] = useState(emb ? emb[2] : '');
  const saveEmb = (p, m) => setS((x) => ({ ...x, embeddingModel: p && m.trim() ? `prov:${p}:${m.trim()}` : '' }));
  const reindex = async () => { setBusy('Indexing…'); const r = await window.api.workspaceReindex(); setBusy(r.ok ? `Done. ${r.embedded ? r.embedded + ' pieces embedded.' : ''}` : r.error); load(); };
  const st = info && info.stats;
  return (
    <Group title="Long-term memory" footer={info && info.enabled ? <>Memory lives in plain Markdown files: <code>SOUL.md</code> (who Artemis is for you), <code>USER.md</code> (about you), <code>MEMORY.md</code> (saved facts) and one daily note per day in <code>memory/</code>. Edit them in any editor; changes are picked up on the next message.</> : null}>
      <Row label="Memory folder" description={info ? (info.enabled ? info.dir : 'Off: memory is kept in memory.json (the old way).') : ''}>
        <div className="pref-inline">
          <button type="button" className="pref-btn" disabled={!info || !info.enabled} onClick={() => window.api.workspaceOpen()}>Open folder</button>
          <button type="button" className="pref-btn" disabled={!info || !info.enabled} onClick={() => window.api.workspaceOpen('SOUL.md')}>Edit SOUL.md</button>
          <button type="button" className="pref-btn" disabled={!info || !info.enabled} onClick={() => window.api.workspaceOpen('USER.md')}>Edit USER.md</button>
        </div>
      </Row>
      <SwitchRow label="Save what matters before compacting" description="When a long chat is summarized to save tokens, a small model first copies lasting facts to MEMORY.md and notable events to today's note. Never in incognito chats."
        checked={s.memoryFlush !== false} onChange={put('memoryFlush')} />
      {s.memoryFlush !== false && (
        <Row label="Memory model" description="A small, cheap model is enough.">
          <Select value={s.memoryModel || ''} onChange={(e) => setS((x) => ({ ...x, memoryModel: e.target.value }))}>
            <option value="">Automatic (the scheduled-task model, else the chat's model)</option>
            {modelOptions}
          </Select>
        </Row>
      )}
      <Row label="Search by meaning" description="Optional. With an embedding model (for example text-embedding-3-small on OpenAI or OpenRouter, or nomic-embed-text on Ollama), memory_search also finds notes that use other words. Without one it searches by keywords.">
        <div className="pref-inline">
          <Select value={embProv} onChange={(e) => { setEmbProv(e.target.value); saveEmb(e.target.value, embModel); }}>
            <option value="">Off (keywords only)</option>
            {providers.filter((p) => p.enabled !== false).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          {embProv && <input className="pref-input" value={embModel} placeholder="text-embedding-3-small" spellCheck={false} onChange={(e) => setEmbModel(e.target.value)} onBlur={() => saveEmb(embProv, embModel)} />}
        </div>
      </Row>
      <Row label="Index" description={st ? `${st.files} files, ${st.chunks} pieces${st.embedded ? `, ${st.embedded} with meaning vectors` : ''}.${info.sqlite ? '' : ' Needs SQLite.'}` : info && !info.sqlite ? 'Search needs SQLite, which is not available here.' : ''}>
        <div className="pref-inline">
          <button type="button" className="pref-btn" disabled={!info || !st} onClick={reindex}>Rebuild index</button>
          {busy && <span className="muted">{busy}</span>}
        </div>
      </Row>
    </Group>
  );
}
