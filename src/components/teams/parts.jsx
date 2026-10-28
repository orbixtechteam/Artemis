import React from 'react';
import logoUrl from '../../assets/artemis-logo.png';

// Small pieces shared by the Agents page, the team room and the deploy sheet.

export const LEAD = 'Artemis';
export const CLI_CLAUDE = 'cli:claude', CLI_CODEX = 'cli:codex';
export const isCli = (model) => /^cli:/.test(String(model || ''));
const CLI_SHORT = { 'claude-opus-5-5': 'Opus 5.5', 'claude-sonnet-5-5': 'Sonnet 5.5', 'claude-haiku-5-5': 'Haiku 5.5', 'claude-fable-5-1': 'Fable 5.1' };
/** A member's model as a short name: Claude Code / Codex, a model from the providers, or "Chat model". */
export function modelLabel(id, groups = []) {
  if (!id) return 'Chat model';
  if (id === CLI_CLAUDE) return 'Claude Code';
  if (id === CLI_CODEX) return 'Codex';
  const sub = /^cli:(claude|codex):(.+)$/.exec(String(id));
  if (sub) return `${sub[1] === 'claude' ? 'Claude Code' : 'Codex'} · ${CLI_SHORT[sub[2]] || sub[2]}`;
  for (const g of groups) for (const [mid, n] of g.items) if (mid === id) return n;
  return String(id).replace(/^(prov|cli):[^:]+:/, '');
}

const FIXED = { athena: 1, calliope: 2, hephaestus: 3, themis: 4 }; // the built-in agents never share a colour
/** A stable tint per agent name (the lead uses the accent). */
export function tintOf(name) {
  if (!name || name === LEAD) return 0;
  if (FIXED[String(name).toLowerCase()]) return FIXED[String(name).toLowerCase()];
  let h = 0;
  for (const ch of String(name).toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return 1 + (h % 6);
}

export function Avatar({ name, size = '', you = false, src = null }) {
  if (you && src) return <img className={`tm-av you ${size}`} src={src} alt="" aria-hidden="true" />; // your profile picture
  if (you) return <span className={`tm-av you ${size}`} aria-hidden="true">{(name || 'Y').slice(0, 1).toUpperCase()}</span>;
  if (name === LEAD) return <img className={`tm-av lead ${size}`} src={logoUrl} alt="" title={LEAD} aria-hidden="true" />;
  return <span className={`tm-av t${tintOf(name)} ${size}`} title={name} aria-hidden="true">{String(name || '?').slice(0, 1).toUpperCase()}</span>;
}

export const Stack = ({ names, size = 'sm' }) => (
  <span className="tm-stack" aria-label={names.join(', ')}>{names.map((n) => <Avatar key={n} name={n} size={size} />)}</span>
);

export const pendingAsks = (t) => ((t.run && t.run.messages) || []).filter((m) => m.kind === 'approval' && m.decided == null);

/** What a team is doing, as a dot style and a short label. */
export function teamState(t) {
  const r = t.run || {};
  if (r.status === 'working' && pendingAsks(t).length) return { dot: 'wait', label: 'Needs you' };
  switch (r.status) {
    case 'working': return { dot: 'work', label: 'Working' };
    case 'paused': return { dot: 'wait', label: r.reason === 'budget' ? 'Paused · budget reached' : r.reason === 'time' ? 'Paused · time limit' : r.reason === 'restart' ? 'Paused · app restarted' : 'Paused' };
    case 'done': return { dot: 'done', label: 'Done' };
    case 'failed': return { dot: 'err', label: 'Stopped on an error' };
    case 'stopped': return { dot: '', label: 'Stopped' };
    default: return { dot: '', label: 'Not started' };
  }
}

export const usd = (n) => '$' + (Number(n) || 0).toFixed((Number(n) || 0) >= 10 ? 1 : 2);
export const tokens = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n || 0));
export function elapsed(t) {
  const r = t.run || {};
  const ms = (r.workMs || 0) + (r.resumedAt ? Date.now() - r.resumedAt : 0);
  const m = Math.round(ms / 60000);
  return m < 1 ? 'under a minute' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

export const MODES = [
  ['lead', 'Lead assigns', 'Artemis splits the goal into tasks and hands them out. Agents can ask each other and pass work along; the reviewer signs off on each task.'],
  ['pipeline', 'Pipeline', 'Tasks run one after another, each building on the one before. Good for draft → edit → check.'],
  ['open', 'Open floor', 'Every member takes the goal from their own angle at the same time and coordinates in the room. Artemis merges the results.']
];
