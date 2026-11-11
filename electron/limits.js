// Usage limits: sums recorded tokens for today / this month and compares them with the user's limits (0 = off).
/** USD for one usage record, from the prices set per model in Settings → Providers ($ per 1M tokens). Unknown models count as 0.
 *  Cache reads (`cached`) are billed at 10% of the input price, cache writes (`cacheWrite`) at 125%; both are part of `prompt`. */
const costOf = (r, extra) => {
  if (typeof r.usd === 'number' && r.usd >= 0) return r.usd; // the provider's own bill, when it sent one
  const p = extra && extra[r.model]; if (!p) return 0;
  const prompt = r.prompt || 0, c = Math.min(r.cached || 0, prompt), w = Math.min(r.cacheWrite || 0, prompt - c);
  return ((prompt - c - w) * p[0] + c * p[0] * 0.1 + w * p[0] * 1.25 + (r.completion || 0) * p[1]) / 1e6;
};
const startOfDay = (now) => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime(); };
const startOfMonth = (now) => { const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(1); return d.getTime(); };
const usd = (n) => '$' + (n >= 10 ? n.toFixed(1) : n.toFixed(2));
const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(Math.round(n)));

function checkLimits(list, settings, now = Date.now(), extra = null) {
  const dayLimit = Math.max(0, Number(settings.dailyTokenLimit) || 0);
  const monthLimit = Math.max(0, Number(settings.monthlyTokenLimit) || 0);
  const d0 = startOfDay(now), m0 = startOfMonth(now);
  const dayUsdLimit = Math.max(0, Number(settings.dailyUsdLimit) || 0);
  const monthUsdLimit = Math.max(0, Number(settings.monthlyUsdLimit) || 0);
  let day = 0, month = 0, dayUsd = 0, monthUsd = 0;
  for (const r of list || []) {
    if (!r || r.t < m0) continue;
    const t = (r.prompt || 0) + (r.completion || 0);
    const c = costOf(r, extra);
    month += t; monthUsd += c;
    if (r.t >= d0) { day += t; dayUsd += c; }
  }
  let blocked = null, warn = null;
  const test = (used, limit, label, unit = 'token', f = fmt) => {
    if (!limit) return;
    if (used >= limit) blocked = blocked || `${label} ${unit} limit reached (${f(used)} of ${f(limit)}). Raise or turn it off in Settings → Usage limits.`;
    else if (used >= limit * 0.8) warn = warn || `You have used ${Math.round((used / limit) * 100)}% of your ${label.toLowerCase()} ${unit} limit (${f(used)} of ${f(limit)}).`;
  };
  test(day, dayLimit, 'Daily');
  test(month, monthLimit, 'Monthly');
  test(dayUsd, dayUsdLimit, 'Daily', 'spending', usd);
  test(monthUsd, monthUsdLimit, 'Monthly', 'spending', usd);
  return { day, month, dayUsd, monthUsd, dayLimit, monthLimit, blocked, warn };
}

module.exports = { checkLimits, costOf };
