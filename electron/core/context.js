// Context management for one agent run, after DeepSeek Harness (compaction-basic, token-meter, spill-policy; MIT):
// when to compact, how full the context is (the provider's own prompt count plus an estimate of what was added since),
// the summary instruction, and moving huge tool results to a file. No Electron: scripts/test-context.js.
const fs = require('fs');
const path = require('path');

/** Tokens of text and messages, roughly (4 characters per token; an image ~1.5k). Real usage replaces this whenever it exists. */
const estTokens = (s) => Math.ceil(String(s || '').length / 4);
function estMessages(messages) {
  let chars = 0, images = 0;
  for (const m of messages || []) {
    if (!m) continue;
    if (typeof m.content === 'string') chars += m.content.length;
    else if (Array.isArray(m.content)) for (const p of m.content) { if (p && p.type === 'text') chars += String(p.text || '').length; else if (p) images++; }
    if (m.tool_calls) chars += JSON.stringify(m.tool_calls).length;
  }
  return Math.ceil(chars / 4) + images * 1500;
}

/**
 * Prompt size at which the history is compacted: floor(min(W × 0.8, W − output − headroom)), headroom = min(64k, W / 4),
 * never below 40% of the window. 200k window, 8k output: 142k. 128k: 88k. 32k: 16k.
 */
function thresholdFor(window, maxOut = 8192) {
  const W = Math.max(8000, Number(window) || 128000);
  const O = Math.min(Math.max(1024, Number(maxOut) || 8192), Math.floor(W / 4));
  const headroom = Math.min(65536, Math.floor(W / 4));
  return Math.max(Math.floor(W * 0.4), Math.floor(Math.min(W * 0.8, W - O - headroom)));
}

/**
 * How full the context is. observe() records the provider's prompt_tokens for a request made of the first `count`
 * history messages; measure() returns that number plus an estimate of the messages added after it. Without a matching
 * observation (first step, history rewritten) everything is estimated, including the system prompt and tool schemas.
 */
function createPressureMeter() {
  let anchor = null; // { prompt, count, fixed }
  return {
    observe(promptTokens, count, fixedTokens = 0) { if (promptTokens > 0) anchor = { prompt: promptTokens, count, fixed: fixedTokens }; },
    reset() { anchor = null; },
    measure(history, fixedTokens = 0) {
      if (anchor && history.length >= anchor.count) return anchor.prompt + estMessages(history.slice(anchor.count)) + Math.max(0, fixedTokens - anchor.fixed);
      return estMessages(history) + fixedTokens;
    },
    get anchored() { return !!anchor; }
  };
}

const SUMMARY_OPEN = '<compacted-summary>', SUMMARY_CLOSE = '</compacted-summary>';
/** The summary instruction: the last user message after the replayed conversation (so the provider's prompt cache is hit). */
const SUMMARY_INSTRUCTION = [
  'You are now acting as a compaction engine for this assistant. Condense the conversation ABOVE into a structured checkpoint that lets another model resume the work with no loss of essential context.',
  '',
  'Output EXACTLY the Markdown structure below: keep every section, in order. Use terse bullets, not prose paragraphs. Write "(none)" for an empty section — never drop a section.',
  '',
  '## Primary Request and Intent', '- [the user\'s original and evolving goals; quote verbatim where the exact wording matters]', '',
  '## Key Technical Concepts', '- [technologies, tools, conventions in play]', '',
  '## Files and Code', '- [exact path: why it matters, what changed or was found]', '',
  '## Errors and Fixes', '- [error: how it was resolved, plus related user feedback]', '',
  '## Pending Jobs', '- [explicitly requested work not yet done]', '',
  '## Current Work', '- [precisely what was in progress at this checkpoint]', '',
  '## Next Step', '- [the single next action in line with the latest request, or "(none)"]', '',
  '## Critical Context', '- [decisions and why, constraints, user preferences and corrections, open questions, data needed to continue]', '',
  'Rules:',
  '- Preserve exact file paths, commands, error strings, identifiers, numbers, URLs and names. Keep the user\'s language for quotes.',
  '- Capture user feedback and explicit instructions faithfully, especially corrections.',
  '- Do NOT mention this summarization request or that the context was compacted.',
  '- Output only the checkpoint text: do not call any tool or take any other action.',
  `- If the conversation already contains a ${SUMMARY_OPEN} block, it is a PRIOR checkpoint: keep still-true facts, drop stale ones, and merge newer information into one consolidated summary.`
].join('\n');
const CHECKPOINT_PREAMBLE = 'This is an automatically generated checkpoint condensing an earlier span of the conversation to free up context. Treat it as established background and build on it without restating it. Continue the task directly from the messages that follow, without acknowledging this checkpoint.';
/** The user message that replaces the condensed span. */
const frameSummary = (text) => `${CHECKPOINT_PREAMBLE}\n\n${SUMMARY_OPEN}\n${String(text || '').trim()}\n${SUMMARY_CLOSE}`;
const isCheckpoint = (m) => !!m && m.role === 'user' && typeof m.content === 'string' && m.content.includes(SUMMARY_OPEN);

// ---- spill: a tool result too big for the context goes to a file; the model gets the head, the tail and the path
const SPILL_CHARS = 50000, SPILL_HEAD = 20000, SPILL_TAIL = 6000;
/**
 * Returns text that fits: unchanged when short, else head + notice + tail with the full result saved under dir.
 * opts: { dir, owner (chat / run id), name (tool), id (call id) }. Without a dir, or when writing fails, it falls back to cutting.
 */
function spillText(text, { dir, owner = 'run', name = 'tool', id = '' } = {}) {
  const s = String(text == null ? '' : text);
  if (s.length <= SPILL_CHARS) return { text: s, file: '' };
  const head = s.slice(0, SPILL_HEAD), tail = s.slice(-SPILL_TAIL);
  const omitted = s.length - SPILL_HEAD - SPILL_TAIL;
  let file = '';
  if (dir) {
    try {
      const folder = path.join(dir, String(owner).replace(/[^\w.-]/g, '_').slice(0, 60));
      fs.mkdirSync(folder, { recursive: true });
      file = path.join(folder, `${Date.now().toString(36)}-${String(name).replace(/[^\w.-]/g, '_').slice(0, 40)}${id ? '-' + String(id).replace(/[^\w-]/g, '').slice(-12) : ''}.txt`);
      fs.writeFileSync(file, s);
    } catch { file = ''; }
  }
  const note = file
    ? `\n\n…[${omitted} characters omitted. The full result (${s.length} characters) is saved at: ${file}. Read parts of it with read_file (start_line / end_line) or search it with search_files instead of running the same call again.]\n\n`
    : `\n\n…[${omitted} characters omitted to save tokens]\n\n`;
  return { text: head + note + tail, file };
}
/** Deletes spill folders older than maxAgeMs (default 3 days). */
function cleanSpill(dir, maxAgeMs = 3 * 24 * 3600e3) {
  let n = 0;
  try {
    const now = Date.now();
    for (const d of fs.readdirSync(dir)) {
      const p = path.join(dir, d);
      try { if (now - fs.statSync(p).mtimeMs > maxAgeMs) { fs.rmSync(p, { recursive: true, force: true }); n++; } } catch {}
    }
  } catch {}
  return n;
}

module.exports = { estTokens, estMessages, thresholdFor, createPressureMeter, SUMMARY_INSTRUCTION, CHECKPOINT_PREAMBLE, frameSummary, isCheckpoint, spillText, cleanSpill, SPILL_CHARS, SUMMARY_OPEN };
