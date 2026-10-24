import React, { useEffect, useState } from 'react';
import Select from '../Select.jsx';
import { Group, Row, Segmented } from './ui.jsx';
import { costOf, fmtUsd } from '../../lib/cost.js';
import { parseTokens, fmtTokens, parseUsd, fmtUsdInput } from '../../lib/amount.mjs';

export const startOf = (month) => { const d = new Date(); d.setHours(0, 0, 0, 0); if (month) d.setDate(1); return d.getTime(); };
const DAY = 864e5;
const PERIODS = [['1', 'Today'], ['7', '7 days'], ['30', '30 days'], ['all', 'All time']];
const PRESETS = [['off', 'Off', 0, 0], ['light', 'Light', 1, 20], ['normal', 'Normal', 5, 50], ['heavy', 'Heavy', 20, 200]];
const shortModel = (m) => String(m || 'Unknown').replace(/^prov:[^:]+:/, '');
// compact counts for the figures and chart (1.2M, 486k); limit choices keep fmtTokens (500k, 1M)
const short = (n) => (n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(Math.round(n || 0)));
const pct = (used, limit) => (limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0);

/** A limit as a popup button (Off, a few presets, or your own amount) with how much is used and a meter under it. */
export function LimitRow({ title, kind, value, used, onChange, presets }) {
  const usd = kind === 'usd';
  const label = (n) => (usd ? '$' + n : fmtTokens(n));
  const [custom, setCustom] = useState(false);
  const [text, setText] = useState('');
  const commit = () => { const n = usd ? parseUsd(text) : parseTokens(text); setCustom(false); if (n >= 0) onChange(n); };
  const p = pct(used, value);
  const choices = [0, ...presets];
  if (value > 0 && !choices.includes(value)) choices.push(value);
  return (
    <Row label={title} description={<>{usd ? fmtUsd(used) : short(used)} {value > 0 ? `of ${label(value)}` : 'used · no limit'}</>}
      below={value > 0 ? <div className="limit-meter" role="progressbar" aria-label={title + ' used'} aria-valuenow={p} aria-valuemin={0} aria-valuemax={100}><i className={p >= 100 ? 'bad' : p >= 80 ? 'warn' : ''} style={{ width: p + '%' }} /></div> : null}>
      {custom
        ? <input className="pref-input narrow" autoFocus value={text} aria-label={title + ' custom limit'} placeholder={usd ? 'e.g. 7.5' : 'e.g. 750k'}
            onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setCustom(false); }} />
        : <Select value={String(value || 0)} aria-label={title + ' limit'} onChange={(e) => { if (e.target.value === 'custom') { setText(value > 0 ? (usd ? fmtUsdInput(value) : fmtTokens(value)) : ''); setCustom(true); } else onChange(Number(e.target.value)); }}>
            {choices.map((n) => <option key={n} value={String(n)}>{n ? label(n) : 'Off'}</option>)}
            <option value="custom">Custom…</option>
          </Select>}
    </Row>
  );
}

export function LimitsTab({ s, setS }) {
  const [rows, setRows] = useState(null);
  const [period, setPeriod] = useState('30');
  useEffect(() => { window.api.usageGet().then((r) => setRows(Array.isArray(r) ? r : [])).catch(() => setRows([])); }, []);
  const all = rows || [];
  const sum = (list) => list.reduce((a, r) => ({ inp: a.inp + (r.prompt || 0), out: a.out + (r.completion || 0), usd: a.usd + costOf(r) }), { inp: 0, out: 0, usd: 0 });
  const since = period === 'all' ? 0 : period === '1' ? startOf(false) : Date.now() - Number(period) * DAY;
  const list = all.filter((r) => r.t >= since);
  const total = sum(list);
  const chats = new Set(list.map((r) => r.chat).filter(Boolean)).size;
  const day = sum(all.filter((r) => r.t >= startOf(false)));
  const month = sum(all.filter((r) => r.t >= startOf(true)));
  const monthLimit = Number(s.monthlyUsdLimit) || 0;

  // tokens per day, the last 14 days (always, whatever the period above)
  const days = [];
  for (let i = 13; i >= 0; i--) { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i); days.push({ start: d.getTime(), label: d.getDate(), tokens: 0 }); }
  for (const r of all) { const d = days.find((x) => r.t >= x.start && r.t < x.start + DAY); if (d) d.tokens += (r.prompt || 0) + (r.completion || 0); }
  const dayMax = Math.max(1, ...days.map((d) => d.tokens));
  const dayName = (t) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

  const byModel = [...list.reduce((m, r) => { const k = shortModel(r.model); const g = m.get(k) || { name: k, tok: 0, usd: 0 }; g.tok += (r.prompt || 0) + (r.completion || 0); g.usd += costOf(r); return m.set(k, g); }, new Map()).values()]
    .sort((a, b) => b.tok - a.tok).slice(0, 6);
  const modelMax = Math.max(1, ...byModel.map((g) => g.tok));

  const put = (k) => (n) => setS((x) => ({ ...x, [k]: n }));
  const preset = (PRESETS.find(([, , d, m]) => (Number(s.dailyUsdLimit) || 0) === d && (Number(s.monthlyUsdLimit) || 0) === m) || [])[0] || '';

  return (
    <>
      <div className="lim-period">
        <Segmented value={period} options={PERIODS} onChange={setPeriod} label="Period" />
      </div>
      <Group>
        <div className="lim-tiles">
          <div><span>Estimated cost</span><b>{fmtUsd(total.usd)}</b><small>{PERIODS.find(([id]) => id === period)[1]}</small></div>
          <div><span>Tokens</span><b>{short(total.inp + total.out) || '0'}</b><small>{short(total.inp) || '0'} in · {short(total.out) || '0'} out</small></div>
          <div><span>Requests</span><b>{list.length}</b><small>{chats ? `Across ${chats} chat${chats === 1 ? '' : 's'}` : 'No chats yet'}</small></div>
          <div><span>Monthly limit</span><b>{monthLimit ? pct(month.usd, monthLimit) + '%' : 'Off'}</b>
            {monthLimit ? <div className="limit-meter" role="progressbar" aria-label="Monthly spending used" aria-valuenow={pct(month.usd, monthLimit)} aria-valuemin={0} aria-valuemax={100}><i className={pct(month.usd, monthLimit) >= 80 ? 'warn' : ''} style={{ width: pct(month.usd, monthLimit) + '%' }} /></div> : <small>No spending limit</small>}
          </div>
        </div>
      </Group>

      <Group title="Tokens per day" footer="The last 14 days. Hover a bar for the exact number.">
        <div className="lim-chart" role="img" aria-label={`Tokens per day, last 14 days: ${days.map((d) => `${dayName(d.start)} ${short(d.tokens) || 0}`).join(', ')}`}>
          <div className="lim-axis"><span>{short(dayMax)}</span><span>Today: {short(days[13].tokens) || '0'}</span></div>
          <div className="lim-bars">
            {days.map((d, i) => <i key={d.start} className={i === 13 ? 'today' : ''} style={{ height: Math.max(2, (d.tokens / dayMax) * 100) + '%' }} title={`${dayName(d.start)}: ${short(d.tokens) || 0} tokens`} />)}
          </div>
          <div className="lim-days" aria-hidden="true">{days.map((d) => <span key={d.start}>{d.label}</span>)}</div>
        </div>
      </Group>

      <Group title="By model">
        {rows === null ? <div className="pref-block muted">Loading…</div> : byModel.length === 0 ? <div className="pref-block muted">Nothing used in this period.</div> : byModel.map((g) => (
          <div key={g.name} className="lim-model">
            <span className="nm" title={g.name}>{g.name}</span>
            <span className="tr" aria-hidden="true"><i style={{ width: (g.tok / modelMax) * 100 + '%' }} /></span>
            <span className="n">{short(g.tok)}</span>
            <span className="c">{g.usd ? fmtUsd(g.usd) : 'Free'}</span>
          </div>
        ))}
      </Group>

      <Group title="Limits" footer="Artemis pauses at a limit and warns at 80%. Costs are estimates from list prices; models without a price (local models, for example) count as free. Only token counts are stored, never message text.">
        <Row label="Preset" description="Sets both spending limits at once">
          <Segmented value={preset} options={PRESETS.map(([id, name]) => [id, name])} label="Spending preset"
            onChange={(id) => { const p = PRESETS.find(([x]) => x === id); setS((x) => ({ ...x, dailyUsdLimit: p[2], monthlyUsdLimit: p[3] })); }} />
        </Row>
        <LimitRow title="Spending today" kind="usd" value={Number(s.dailyUsdLimit) || 0} used={day.usd} onChange={put('dailyUsdLimit')} presets={[1, 2, 5, 10, 20]} />
        <LimitRow title="Spending this month" kind="usd" value={monthLimit} used={month.usd} onChange={put('monthlyUsdLimit')} presets={[20, 50, 100, 200]} />
        <LimitRow title="Tokens today" kind="tok" value={Number(s.dailyTokenLimit) || 0} used={day.inp + day.out} onChange={put('dailyTokenLimit')} presets={[500000, 1000000, 5000000, 20000000]} />
        <LimitRow title="Tokens this month" kind="tok" value={Number(s.monthlyTokenLimit) || 0} used={month.inp + month.out} onChange={put('monthlyTokenLimit')} presets={[5000000, 20000000, 100000000]} />
        <Row label="Longest answer" description="Longer answers cost more. 8k fits most replies.">
          <Select value={String(Number(s.maxTokens) || 8192)} onChange={(e) => setS((x) => ({ ...x, maxTokens: Number(e.target.value) }))}>
            {[...new Set([2048, 4096, 8192, 16384, 32768, Number(s.maxTokens) || 8192])].sort((a, b) => a - b).map((n) => <option key={n} value={String(n)}>{n % 1024 ? fmtTokens(n) : n / 1024 + 'k'} tokens</option>)}
          </Select>
        </Row>
      </Group>
    </>
  );
}
