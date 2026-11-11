/** Estimated USD for one usage record from the prices set per model in Settings → Providers ($ per 1M tokens; unknown models = 0).
 *  Cache reads (`cached`) cost 10% of the input price, cache writes (`cacheWrite`) 125%; both are part of `prompt`. */
let EXTRA = {};
/** Prices of models from user-added providers ({ id: [in, out] }). */
export const setExtraPrices = (m) => { EXTRA = m || {}; };
const priceOf = (model) => EXTRA[model];
export const costOf = (r) => {
  if (typeof r.usd === 'number' && r.usd >= 0) return r.usd; // the provider's own bill for the request (OpenRouter usage.cost)
  const p = priceOf(r.model); if (!p) return 0;
  const prompt = r.prompt || 0, c = Math.min(r.cached || 0, prompt), w = Math.min(r.cacheWrite || 0, prompt - c);
  return ((prompt - c - w) * p[0] + c * p[0] * 0.1 + w * p[0] * 1.25 + (r.completion || 0) * p[1]) / 1e6;
};
export const hasPrice = (model) => !!priceOf(model);
export const fmtUsd = (n) => (n < 0.005 && n > 0 ? '<$0.01' : '$' + (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)));
const num = (n) => (n >= 10 ? String(Math.round(n * 10) / 10) : String(Math.round(n * 100) / 100));
/** "$2 / $10 per 1M" or "free" for the picker. */
export const priceTag = (model) => { const p = priceOf(model); return p ? (p[0] === 0 && p[1] === 0 ? 'free' : `$${num(p[0])} in / $${num(p[1])} out per 1M`) : ''; };
