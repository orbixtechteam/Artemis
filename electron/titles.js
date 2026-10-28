// Automatic chat titles: the prompt, the one-off request and the cleanup of what the model answers.
// Pure (fetch is injectable) so scripts/test-titles.js can run it against a mock server.

const MAX_TITLE = 60;
const TITLE_SYSTEM = 'You name chat conversations. Reply with only a short title of 3 to 6 words that says what the conversation is about, '
  + 'written in the same language as the conversation. No quotes, no emoji, no markdown, no trailing period, no "Title:" prefix, nothing else. '
  + 'Do not think out loud, explain or analyse: your whole reply is the title.';

// Reasoning that some models write into the answer itself: <think>, <thinking>, <thought>, <reasoning> blocks (also unfinished ones)
// and the gpt-oss style channel markers. Only what comes after it is the answer.
const stripThink = (s) => String(s == null ? '' : s)
  .replace(/<\|channel\|>\s*analysis\s*<\|message\|>[\s\S]*?(?:<\|end\|>|$)/gi, '')
  .replace(/<\|start\|>\s*assistant/gi, '')
  .replace(/<\|[a-z_]+\|>(?:\s*final\s*(?=<\|message\|>))?/gi, '')
  .replace(/<(think|thinking|thought|reasoning)>[\s\S]*?<\/\1>/gi, '').replace(/<(?:think|thinking|thought|reasoning)>[\s\S]*$/i, '');
const oneLine = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

/** The old behaviour, used when there is no usable model answer: the first message, cut. */
function fallbackTitle(text, max = 48) {
  return oneLine(text).slice(0, max).trim() || 'New chat';
}

// What a model that "thinks out loud" writes instead of a title. A line like that is never a title.
const REASONING = /^(?:thinking(?:\s+(?:process|about|through))?\s*(?:[:.…]|$)|thought\s+process\b|(?:my\s+)?reasoning\s*[:.]|analysis\s*[:.]|let me\b|let['’]s\b|the user\b|(?:this\s+)?user\s+(?:is|asks|wants|said|message)\b|i\s+(?:need|should|will|must|think|am\s+going|have\s+to|can)\b|i['’](?:ll|m|ve)\b|we\s+(?:need|should|must|have)\b|okay\b[,.!:]|ok\b[,.!:]|alright\b[,.!:]|hmm\b|so\s*,|first\s*,|sure\s*[,!.:]|here\s+(?:is|are)\b|here['’]s\b|(?:step|stage)\s*\d|\d+[.)]\s*\*\*|<\||\[thinking\])/i;
const looksLikeReasoning = (line) => REASONING.test(String(line || '').replace(/^[\s*_#>"'`“”-]+/, ''));
const TITLE_LINE = /^[\s*_#>]*(?:(?:chat|conversation|suggested|final)\s+)?(?:title|name)\s*\**\s*[:：]\s*\S/i;

const QUOTES = /^["'`“”„‘’‚«»‹›「」『』]+|["'`“”„‘’‚«»‹›「」『』]+$/g;
const PREFIX = /^(?:(?:chat|conversation|suggested)\s+)?(?:title|name|topic)\s*[:：\-–—]\s*/i;

/**
 * Turns a raw model answer into a title: first non-empty line, no thinking, markdown, quotes, "Title:" prefix, emoji or
 * trailing period, at most 60 characters (cut at a word). An unusable answer gives fallbackTitle(fallback), or '' when
 * no fallback text is given (the caller then keeps the title it has).
 */
function cleanTitle(raw, fallback) {
  let t = stripThink(raw);
  const lines = t.split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !/^```/.test(s));
  // a model that wrote its reasoning in the answer usually still ends with "Title: …": take the last such line
  const titled = lines.filter((l) => TITLE_LINE.test(l));
  t = (titled.length ? titled[titled.length - 1] : lines[0]) || '';
  t = t.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/, '').replace(/^(?:[-*+>]|\d+[.)])\s+/, '')
    .replace(/\*\*|__|[*`~]/g, '');
  for (let i = 0; i < 3; i++) t = t.trim().replace(QUOTES, '').trim().replace(PREFIX, '');
  t = t.replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}]/gu, '');
  for (let i = 0; i < 3; i++) t = oneLine(t).replace(QUOTES, '').trim().replace(/[.。．,;:，；：…]+$/u, '').trim();
  if (t.length > MAX_TITLE) {
    const cut = t.slice(0, MAX_TITLE);
    const sp = cut.lastIndexOf(' ');
    t = (sp > MAX_TITLE / 2 ? cut.slice(0, sp) : cut).replace(/[\s.,;:\-–—]+$/u, '');
  }
  if (!t || !/[\p{L}\p{N}]/u.test(t) || looksLikeReasoning(t)) return fallback == null || fallback === '' ? '' : fallbackTitle(fallback);
  return t;
}

/** The request messages: the first user message, the start of the first reply and (when re-titling) the latest turns. */
function buildTitleMessages({ first = '', reply = '', recent = [] } = {}) {
  let user = `User: ${oneLine(first).slice(0, 1500)}\nAssistant: ${oneLine(stripThink(reply)).slice(0, 600)}`;
  const tail = (Array.isArray(recent) ? recent : []).filter((m) => m && m.text).slice(-4)
    .map((m) => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${oneLine(stripThink(m.text)).slice(0, 400)}`);
  if (tail.length) user = `Start of the conversation:\n${user}\n\nLatest messages (the title should fit what the conversation is about now):\n${tail.join('\n')}`;
  return [{ role: 'system', content: TITLE_SYSTEM }, { role: 'user', content: `${user}\n\nTitle:` }];
}

/**
 * One non-streaming /chat/completions call. Returns { title, usage } (title '' when the answer was unusable).
 * Throws on HTTP errors and timeouts. A 400 is retried once without max_tokens / temperature (strict endpoints).
 */
async function requestTitle({ url, key, model, headers = {}, extraBody = {}, first, reply, recent, signal, timeoutMs = 15000, fetchImpl = fetch, complete } = {}) {
  const messages = buildTitleMessages({ first, reply, recent });
  if (complete) return { title: cleanTitle(await complete(messages[0].content, messages[1].content), ''), usage: null }; // Claude Code / Codex: one plain answer
  const sig = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  const post = (extra) => fetchImpl(url, {
    method: 'POST', signal: sig,
    headers: { ...headers, 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ model, stream: false, ...extra, ...extraBody, messages })
  });
  let res = await post({ max_tokens: 60, temperature: 0.3 });
  if (res.status === 400) res = await post({});
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  const choice = (j && j.choices && j.choices[0]) || {};
  const msg = choice.message || {};
  const content = Array.isArray(msg.content) ? msg.content.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('') : msg.content;
  const usage = j && j.usage ? { prompt: j.usage.prompt_tokens || 0, completion: j.usage.completion_tokens || 0 } : null;
  // cut off by the token limit: a title is a few words, so this is reasoning that never reached its end
  const title = choice.finish_reason === 'length' ? '' : cleanTitle(content, '');
  return { title, usage };
}

module.exports = { MAX_TITLE, TITLE_SYSTEM, looksLikeReasoning, cleanTitle, fallbackTitle, buildTitleMessages, requestTitle };
