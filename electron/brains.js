// "Brains": named personalities (Lancelot, Galahad, Percival by default) that can each use their own model.
// You can talk to one brain, or let the council (all brains) vote on who answers and which skills/agents to use.
// Brain files: <userData>/brains/<slug>.md with frontmatter (name, role, description, model) and the personality as the body.
const fs = require('fs');
const { headersFor, routingBody } = require('./providers');
const path = require('path');
const { parseAgent, slugOf } = require('./subagents');

const MAX_BODY = 6000;
const MAX_VOTERS = 5;

const BUILTIN = [
  {
    name: 'Lancelot', role: 'The Architect', description: 'Logical, fast and decisive. Gets to the point and picks the most efficient way to do the job.', model: '',
    body: 'You are Lancelot, the architect. You think in facts, numbers and trade-offs. You are direct and decisive: give the answer first, then the reasoning in a few lines. You prefer the most efficient path and say plainly when something is a bad idea. No small talk.'
  },
  {
    name: 'Galahad', role: 'The Guardian', description: 'Careful and thorough. Protects the user from mistakes, checks facts, thinks about risks and side effects.', model: '',
    body: 'You are Galahad, the guardian. You are careful, precise and protective of the user\'s interests. Check facts before stating them, point out risks, costs and side effects, and ask before doing anything hard to undo. Calm, steady tone. Thoroughness matters more to you than speed.'
  },
  {
    name: 'Percival', role: 'The Unbound', description: 'Warm, creative and intuitive. Good for writing, ideas, explaining things simply and talking things through.', model: '',
    body: 'You are Percival, the unbound. You are warm, curious and creative. Explain things in simple human words, offer fresh ideas and angles, and pay attention to how the user feels about the task. Friendly and a little playful, never wordy.'
  }
];

const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();

function createBrains(deps) {
  const fromFile = (f) => {
    let text; try { text = fs.readFileSync(path.join(deps.userDir, f), 'utf8'); } catch { return null; }
    const { meta, body } = parseAgent(text);
    const slug = f.replace(/\.md$/i, '');
    return { name: meta.name || slug, slug, role: meta.role || '', description: meta.description || '', model: meta.model || '', body, builtin: false, order: Number(meta.order) || 0 };
  };

  function list() {
    const out = [];
    let entries = []; try { entries = fs.readdirSync(deps.userDir); } catch {}
    for (const f of entries.sort()) { if (!/\.md$/i.test(f)) continue; const b = fromFile(f); if (b) out.push(b); }
    BUILTIN.forEach((b, i) => {
      const slug = slugOf(b.name);
      const mine = out.find((x) => x.slug === slug);
      if (mine) { mine.builtin = true; mine.overrides = true; mine.order = mine.order || i + 1; } else out.push({ ...b, slug, builtin: true, order: i + 1 });
    });
    return out.sort((a, b) => (a.order || 99) - (b.order || 99) || a.name.localeCompare(b.name));
  }

  const find = (name) => {
    const q = String(name || '').trim().toLowerCase();
    if (!q) return null;
    return list().find((b) => b.slug === slugOf(q) || b.name.toLowerCase() === q) || null;
  };

  function save(b) {
    const name = oneLine(b && b.name).slice(0, 30);
    const slug = slugOf(name);
    if (!slug) return { ok: false, error: 'Give the brain a name.' };
    const body = String((b && b.body) || '').trim();
    if (!body) return { ok: false, error: 'Describe the personality.' };
    if (body.length > MAX_BODY) return { ok: false, error: `The personality is too long (max ${MAX_BODY} characters).` };
    const existing = find(slug);
    const order = existing ? existing.order : list().length + 1;
    fs.mkdirSync(deps.userDir, { recursive: true });
    const fm = [`name: ${name}`, `role: ${oneLine(b.role).slice(0, 40)}`, `description: ${oneLine(b.description).slice(0, 300)}`, `model: ${oneLine(b.model)}`, `order: ${order}`];
    fs.writeFileSync(path.join(deps.userDir, slug + '.md'), `---\n${fm.join('\n')}\n---\n\n${body}\n`, 'utf8');
    deps.notify?.();
    return { ok: true, slug, name };
  }

  function remove(name) {
    const f = path.join(deps.userDir, slugOf(name) + '.md');
    if (!fs.existsSync(f)) return { ok: false };
    fs.unlinkSync(f); deps.notify?.();
    return { ok: true };
  }

  return { list, find, save, remove, dir: deps.userDir };
}

/** The text added to the system prompt when a brain answers. */
const personaText = (b) => `You are talking as the brain "${b.name}"${b.role ? ` (${b.role})` : ''}. Stay in this character in tone and style, but keep every other rule and tool the same.\n${b.body}`;

/** One short, tool-free model call that returns parsed JSON (or null). */
async function askJson({ url, key, model, system, user, signal, onUsage, fetchImpl = fetch, complete }) {
  if (complete) { const m = /\{[\s\S]*\}/.exec(String(await complete(system, user) || '')); if (!m) return null; try { return JSON.parse(m[0]); } catch { return null; } } // Claude Code / Codex
  const res = await fetchImpl(url, {
    method: 'POST', signal,
    headers: { ...headersFor(url), 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ model, stream: false, max_tokens: 1500, temperature: 0.4, ...routingBody(url), messages: [{ role: 'system', content: system }, { role: 'user', content: user }] })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  if (j.usage && onUsage) { try { onUsage({ model, prompt: j.usage.prompt_tokens || 0, completion: j.usage.completion_tokens || 0, estimated: false }); } catch {} }
  const ch = j.choices && j.choices[0];
  // reasoning models may put their thinking in the text: drop it so a brace inside it is not mistaken for the answer
  const text = String((ch && ch.message && ch.message.content) || '').replace(/<think>[\s\S]*?(<\/think>|$)/gi, '');
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) { if (ch && ch.finish_reason === 'length') throw new Error('The reply was cut off (token limit). Try a model without long reasoning.'); return null; }
  try { return JSON.parse(m[0]); } catch { return null; }
}

/** What each voter is told. */
const voterSystem = (b, brains, skillsIndex, agentsIndex) => `${personaText(b)}

You are one voter in a council of ${brains.length} brains (${brains.map((x) => x.name).join(', ')}). Read the conversation end and decide how the user's latest message should be handled.
Reply with JSON only, no other text. Example of the shape (use real names from the lists, never copy the example values):
{"answerer":"${brains[0].name}","skills":[],"agents":[],"reason":"A short factual question, no tools needed."}
- answerer: the brain whose personality fits this message best (you may pick yourself).
- skills: only skills from the list below that clearly match the task, otherwise [].
- agents: only helper agents from the list below that are really needed (research, coding, writing, review), otherwise [] when the answerer can do it alone.
Skills:
${skillsIndex || '(none)'}
Agents:
${agentsIndex || '(none)'}`;

/** Count the votes. Majority decides the answerer; skills and agents need at least two votes (or the only voter's vote). */
function tally(votes, brains) {
  const ok = votes.filter((v) => v.ok);
  const names = brains.map((b) => b.name);
  const count = {};
  for (const v of ok) { const a = names.find((n) => n.toLowerCase() === String(v.answerer || '').toLowerCase()) || names.find((n) => n === v.brain); if (a) count[a] = (count[a] || 0) + 1; } // an unreadable answerer counts as the voter's own pick
  let answerer = null; let best = 0;
  for (const n of names) if ((count[n] || 0) > best) { best = count[n]; answerer = n; }
  const need = ok.length >= 2 ? 2 : 1;
  const pick = (key) => {
    const c = {};
    for (const v of ok) for (const x of new Set((Array.isArray(v[key]) ? v[key] : []).map((s) => String(s).trim()).filter(Boolean))) c[x] = (c[x] || 0) + 1;
    return Object.keys(c).filter((x) => c[x] >= need);
  };
  return { answerer: answerer || (brains[0] && brains[0].name) || '', skills: pick('skills'), agents: pick('agents'), unanimous: ok.length > 1 && best === ok.length, voters: ok.length };
}

/** Run the council. Returns { votes, verdict }. */
async function deliberate({ brains, conversation, skillsIndex, agentsIndex, call }) {
  const voters = brains.slice(0, MAX_VOTERS);
  const votes = await Promise.all(voters.map(async (b) => {
    try {
      const r = await call(b, voterSystem(b, voters, skillsIndex, agentsIndex), conversation);
      if (!r) return { brain: b.name, ok: false, reason: 'No clear answer.' };
      return { brain: b.name, ok: true, answerer: String(r.answerer || ''), skills: Array.isArray(r.skills) ? r.skills.map(String) : [], agents: Array.isArray(r.agents) ? r.agents.map(String) : [], reason: String(r.reason || '').slice(0, 160) };
    } catch (e) { return { brain: b.name, ok: false, reason: String((e && e.message) || e).slice(0, 120) }; }
  }));
  return { votes, verdict: tally(votes, voters) };
}

/** Extra instruction for the answering brain after the vote. */
function verdictHint(verdict) {
  const bits = [];
  if (verdict.skills.length) bits.push(`load these skills with use_skill before you start: ${verdict.skills.join(', ')}`);
  if (verdict.agents.length) bits.push(`delegate the matching work to these helper agents with the delegate tool: ${verdict.agents.join(', ')}`);
  return bits.length ? `The council of brains voted on how to handle the user's last message. Follow their decision exactly: ${bits.join('; and ')}. Do not answer from your own knowledge for the parts they assigned to skills or helper agents; call the tool first, then write the answer from its result.` : '';
}

module.exports = { createBrains, personaText, askJson, deliberate, tally, verdictHint, voterSystem, BUILTIN, MAX_VOTERS };
