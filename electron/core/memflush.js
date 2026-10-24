// Pre-compaction memory flush: before older messages are summarized away, a cheap model call pulls out
// what is worth keeping (durable facts about the user -> MEMORY.md, notable events/decisions -> today's daily note).
const SYSTEM = `You maintain an assistant's long-term memory. You get a part of a conversation that is about to be compressed.
Extract only what is worth keeping after this conversation ends. Reply with JSON only:
{"facts": ["..."], "notes": ["..."]}
- facts: lasting facts the USER stated about themselves, their work, preferences or decisions (one short sentence each, max 5). Not task details, not things the assistant said or did, not guesses.
- notes: notable events, decisions, results or open items from this part, worth a line in today's journal (one short line each, max 6).
- Never include passwords, API keys, tokens, card or account numbers, health details or other sensitive data.
- Skip anything already listed under "Already in memory". Empty lists are fine and common.`;

const clean = (a, max, len) => (Array.isArray(a) ? a : []).map((x) => String(x || '').replace(/\s+/g, ' ').trim()).filter((x) => x.length > 3).slice(0, max).map((x) => x.slice(0, len));
const SECRETISH = /(api[_ -]?key|secret|password|passwd|token|bearer\s|sk-[a-z0-9]{8,}|\b\d{13,19}\b)/i;

/**
 * transcript: text of the messages being compacted. ask(system, user) -> parsed JSON (brains.askJson).
 * workspace: from workspace.js. Returns { facts: n, notes: n }.
 */
async function flushMemory({ transcript, ask, workspace, log = () => {} }) {
  const text = String(transcript || '').trim();
  if (text.length < 400) return { facts: 0, notes: 0 };
  const existing = workspace.list().map((m) => `- ${m.text}`).slice(-80).join('\n');
  const out = await ask(SYSTEM, `Already in memory:\n${existing || '(nothing)'}\n\nConversation part:\n${text.slice(-60000)}`);
  if (!out || typeof out !== 'object') return { facts: 0, notes: 0 };
  let facts = 0, notes = 0;
  for (const f of clean(out.facts, 5, 300)) {
    if (SECRETISH.test(f)) continue;
    try { const r = workspace.add(f); if (!r.duplicate) facts++; } catch {}
  }
  const ns = clean(out.notes, 6, 300).filter((n) => !SECRETISH.test(n));
  for (const n of ns) { try { workspace.note(n); notes++; } catch {} }
  if (facts || notes) log('info', `memory flush: ${facts} fact(s), ${notes} note line(s) saved before compaction`);
  return { facts, notes };
}

module.exports = { flushMemory, FLUSH_SYSTEM: SYSTEM };
