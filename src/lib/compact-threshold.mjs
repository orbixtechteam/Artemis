// When a chat should be compacted before the next message. Same formula as electron/core/context.js thresholdFor
// (scripts/test-context.js checks they agree), capped by the user's "compact at" percentage.
export function thresholdFor(window, maxOut = 8192) {
  const W = Math.max(8000, Number(window) || 128000);
  const O = Math.min(Math.max(1024, Number(maxOut) || 8192), Math.floor(W / 4));
  const headroom = Math.min(65536, Math.floor(W / 4));
  return Math.max(Math.floor(W * 0.4), Math.floor(Math.min(W * 0.8, W - O - headroom)));
}
export const compactLimit = (window, percent = 80, maxOut) => Math.min(Math.floor((Number(percent) || 80) / 100 * (Number(window) || 128000)), thresholdFor(window, maxOut));
