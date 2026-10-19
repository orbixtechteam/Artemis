import React, { useEffect, useState } from 'react';
import Select from '../Select.jsx';
import { askConfirm } from '../../lib/dialog.js';
import { Icon } from '../Icons.jsx';
import { Group, Row, SwitchRow, Switch, Buttons } from './ui.jsx';
import { ClaudeUsage, isClaudeProxy } from '../ClaudeUsage.jsx';
import { headersToText, textToHeaders, modelsToText, textToModels } from './shared.jsx';

export function ProviderEditor({ initial, presets, onDone, onProviders }) {
  const [p, setP] = useState(initial);
  const [key, setKey] = useState('');
  const [text, setText] = useState(modelsToText(initial.models));
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState('');
  const [avail, setAvail] = useState([]);
  const isNew = !initial.id;
  const set = (k) => (e) => setP({ ...p, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const [hdrText, setHdrText] = useState(headersToText(initial.headers));
  const [rtSort, setRtSort] = useState((initial.routing && initial.routing.sort) || '');
  const [rtOrder, setRtOrder] = useState(((initial.routing && initial.routing.order) || []).join(', '));
  const [rtOnly, setRtOnly] = useState(((initial.routing && initial.routing.only) || []).join(', '));
  const [rtIgnore, setRtIgnore] = useState(((initial.routing && initial.routing.ignore) || []).join(', '));
  const [rtZdr, setRtZdr] = useState(!!(initial.routing && initial.routing.zdr));
  const [rtDeny, setRtDeny] = useState(!!(initial.routing && initial.routing.denyCollection));
  const [rtNoFb, setRtNoFb] = useState(!!(initial.routing && initial.routing.noFallbacks));
  const current = () => ({ ...p, models: textToModels(text, p.models), headers: textToHeaders(hdrText), routing: { sort: rtSort, order: rtOrder, only: rtOnly, ignore: rtIgnore, zdr: rtZdr, denyCollection: rtDeny, noFallbacks: rtNoFb } });

  const test = async (fill) => {
    setBusy(fill ? 'fetch' : 'test'); setMsg(null);
    try {
      const r = await window.api.providersTest(current(), key);
      if (!r.ok) return setMsg({ bad: true, text: r.error });
      if (r.models) setAvail(r.models);
      if (fill && r.models) {
        const old = textToModels(text);
        const merged = [...old, ...r.models.filter((id) => !old.some((m) => m.id === id)).map((id) => ({ id }))];
        setText(modelsToText(merged));
        setMsg({ text: `Found ${r.models.length} model${r.models.length === 1 ? '' : 's'}.` });
      } else setMsg({ text: r.models ? `Connected. ${r.models.length} models available.` : r.note || 'Connected.' });
    } finally { setBusy(''); }
  };
  const save = async () => {
    setBusy('save');
    try {
      const r = await window.api.providersSave(current(), key);
      onProviders(r);
      onDone();
    } finally { setBusy(''); }
  };
  const remove = async () => {
    if (!(await askConfirm({ title: 'Remove provider', message: `Remove "${p.name}"? Its API key is deleted too.`, confirmLabel: 'Remove', danger: true }))) return;
    onProviders(await window.api.providersDelete(p.id));
    onDone();
  };
  const usable = p.name.trim() && /^https?:\/\//i.test(p.baseUrl.trim());
  const noTools = p.noTools === true || (p.noTools === undefined && /claude|anthropic/i.test(p.name || '') && /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(p.baseUrl || ''));
  return (
    <div className="prov-editor">
      <div className="pref-back">
        <button type="button" className="pref-btn" onClick={onDone}><Icon name="chevronLeft" size={13} /> Providers</button>
      </div>
      {isNew && presets.length > 0 && (
        <Group title="Start from">
          <div className="pref-block">
            <div className="prov-presets pref-chips">
              {presets.map((x) => (
                <button key={x.key} type="button" aria-pressed={p.preset === x.key} className={p.preset === x.key ? 'active' : ''} onClick={() => { setP({ ...p, preset: x.key, name: x.name, baseUrl: x.baseUrl, needsKey: x.needsKey, local: !!x.local, hint: x.hint }); setText(modelsToText(x.models)); setHdrText(headersToText(x.headers)); setMsg(null); }}>{x.name}</button>
              ))}
            </div>
          </div>
        </Group>
      )}
      <Group title={isNew ? 'New provider' : p.name || 'Provider'} footer={p.hint || null}>
        <Row label="Name"><input value={p.name} onChange={set('name')} placeholder="My provider" /></Row>
        <Row stacked label="Endpoint URL" description="OpenAI-compatible base URL, with or without /v1."><input value={p.baseUrl} onChange={set('baseUrl')} placeholder="http://localhost:11434/v1" spellCheck={false} /></Row>
        <Row stacked label={p.needsKey ? 'API key' : 'API key (optional)'} description={initial.hasKey ? 'A key is saved. Type a new one to replace it.' : p.local ? 'Local servers usually need no key.' : ''}>
          <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={initial.hasKey ? '••••••••' : 'sk-…'} />
        </Row>
        <SwitchRow label="This provider requires an API key" checked={!!p.needsKey} onChange={(v) => setP({ ...p, needsKey: v })} />
        <SwitchRow label="This server cannot call tools" description="Turn on for a proxy in front of the Claude CLI: it ignores tool calls. Artemis then sends plain chat only; memory still works through a hidden marker."
          checked={noTools} onChange={(v) => setP({ ...p, noTools: v })} />
        <Row stacked label="Extra headers (optional)" description="One per line, Name: value. Sent with every request to this provider. Cloudflare AI Gateway uses cf-aig-gateway-id: default. Authorization cannot be overridden.">
          <textarea rows={2} value={hdrText} onChange={(e) => setHdrText(e.target.value)} placeholder="cf-aig-gateway-id: default" spellCheck={false} />
        </Row>
        {/openrouter\.ai/i.test(p.baseUrl || '') && (
          <>
            <Row label="Routing" description="How OpenRouter picks the server that runs a model. Default balances price and speed. The other choices turn balancing off and always use the cheapest, the lowest-latency or the highest-throughput server.">
              <Select value={rtSort} onChange={(e) => setRtSort(e.target.value)}>
                <option value="">Default (balanced)</option>
                <option value="price">Cheapest first</option>
                <option value="latency">Lowest latency first</option>
                <option value="throughput">Highest throughput first</option>
              </Select>
            </Row>
            <Row stacked label="Preferred servers (optional)" description="Comma-separated OpenRouter server slugs, lowercase (for example morph, relace). They are tried first, other servers stay as the fallback. Use this or a routing choice above, not both.">
              <input value={rtOrder} onChange={(e) => setRtOrder(e.target.value)} placeholder="morph, relace" spellCheck={false} />
            </Row>
            <SwitchRow label="Zero data retention only" description="Only servers that do not store your prompts (OpenRouter zdr). If no such server serves the model, the request fails instead of going elsewhere." checked={rtZdr} onChange={setRtZdr} />
            <SwitchRow label="Deny data collection" description="Only servers that do not collect your data or train on it (data_collection: deny)." checked={rtDeny} onChange={setRtDeny} />
            <Row stacked label="Allow only these servers (optional)" description="Comma-separated OpenRouter server slugs. Nothing else is used, and there is no fallback.">
              <input value={rtOnly} onChange={(e) => setRtOnly(e.target.value)} placeholder="together, fireworks" spellCheck={false} />
            </Row>
            <Row stacked label="Never use these servers (optional)" description="Comma-separated slugs to block, for example deepseek to keep requests away from DeepSeek's own API.">
              <input value={rtIgnore} onChange={(e) => setRtIgnore(e.target.value)} placeholder="deepseek" spellCheck={false} />
            </Row>
            <SwitchRow label="No fallbacks" description="Use only the preferred servers above; if they are down the request fails." checked={rtNoFb} onChange={setRtNoFb} />
          </>
        )}
      </Group>
      <Group title="Models">
        <Row stacked label="Models" description="One per line: model-id, or model-id | price in | price out (USD per 1M tokens, optional). Local models without a price count as free.">
          <textarea rows={7} className="mono" value={text} onChange={(e) => setText(e.target.value)} placeholder={'llama3.2:3b\n@cf/google/gemma-4-26b-a4b-it | 0.1 | 0.3'} spellCheck={false} />
        </Row>
        <Row label="Add a model" description={avail.length ? `${avail.length} models reported by this provider.` : 'Press “Fetch models” to load the provider’s list, then pick from it.'}>
          <Select value="" placeholder={avail.length ? 'Pick a model to add…' : 'Fetch models first'} disabled={!avail.length}
            onChange={(e) => { const id = e.target.value; if (!id) return; const old = textToModels(text); if (!old.some((m) => m.id === id)) setText(modelsToText([...old, { id }])); }}>
            {avail.filter((id) => !textToModels(text).some((m) => m.id === id)).map((id) => <option key={id} value={id}>{id}</option>)}
          </Select>
        </Row>
        <Row label="Connection" description={msg ? <span className={msg.bad ? 'pref-err-text' : 'pref-ok-text'} role="status">{msg.text}</span> : 'Check the address and key, or load the model list.'}>
          <div className="pref-inline">
            <button type="button" className="pref-btn" onClick={() => test(true)} disabled={!!busy || !/^https?:\/\//i.test(p.baseUrl.trim())}>{busy === 'fetch' ? 'Fetching…' : 'Fetch models'}</button>
            <button type="button" className="pref-btn" onClick={() => test(false)} disabled={!!busy || !/^https?:\/\//i.test(p.baseUrl.trim())}>{busy === 'test' ? 'Testing…' : 'Test connection'}</button>
          </div>
        </Row>
      </Group>
      <Buttons end>
        {!isNew && <button type="button" className="pref-btn danger" onClick={remove}>Remove</button>}
        <span style={{ flex: 1 }} />
        <button type="button" className="pref-btn" onClick={onDone}>Cancel</button>
        <button type="button" className="pref-btn primary" onClick={save} disabled={!usable || !!busy}>{isNew ? 'Add provider' : 'Done'}</button>
      </Buttons>
    </div>
  );
}

export function ProvSwitch({ on, onClick }) {
  return <button type="button" role="switch" aria-checked={on} className={'prov-switch' + (on ? ' on' : '')} onClick={onClick} title={on ? 'Enabled — click to turn off' : 'Disabled — click to turn on'} aria-label={on ? 'Enabled — click to turn off' : 'Disabled — click to turn on'}><span className="knob" /><span className="lbl">{on ? 'Enabled' : 'Disabled'}</span></button>;
}

export function ProvidersTab({ s, set, settings, providers, onProviders, onApply }) {
  const [presets, setPresets] = useState([]);
  const [edit, setEdit] = useState(null);
  useEffect(() => { window.api.providersPresets().then(setPresets).catch(() => {}); }, []);
  const toggle = async (p) => onProviders(await window.api.providersSave({ ...p, enabled: p.enabled === false }));
  if (edit) {
    return <ProviderEditor key={edit.id || 'new'} initial={edit} presets={presets} onProviders={onProviders} onDone={() => setEdit(null)} />;
  }
  return (
    <>
      <Group title="Providers" footer="Models from every enabled provider appear in the model picker. Works with Cloudflare Workers AI, Ollama, LM Studio, OpenRouter, OpenAI, the Claude API and any OpenAI-compatible server. Provider changes are saved right away.">
        {providers.length === 0 && <Row label="No providers yet" description="Add one to start chatting." />}
        {providers.map((p) => (
          <Row key={p.id} className={`prov-row ${p.enabled === false ? 'off' : ''}`} label={p.name}
            description={<><span>{p.local ? 'local · ' : ''}{(p.models || []).length} model{(p.models || []).length === 1 ? '' : 's'}{p.needsKey && !p.hasKey ? ' · key missing' : ''}</span><code className="pref-code">{p.baseUrl}</code></>}
            below={isClaudeProxy(p) ? <div className="pref-row-extra"><ClaudeUsage /></div> : null}>
            <div className="pref-inline">
              <button type="button" className="pref-btn" onClick={() => setEdit(p)} aria-label={'Edit ' + p.name}>Edit…</button>
              <Switch checked={p.enabled !== false} onChange={() => toggle(p)} label={(p.enabled !== false ? 'Disable ' : 'Enable ') + p.name} />
            </div>
          </Row>
        ))}
        <Row>
          <button type="button" className="pref-btn add-prov" onClick={() => setEdit({ name: '', baseUrl: '', needsKey: false, local: false, models: [], enabled: true })}><Icon name="plus" size={13} /> Add provider…</button>
        </Row>
      </Group>
    </>
  );
}
