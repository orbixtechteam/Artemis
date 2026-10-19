// Spoken commands for Sentinel mode: "Artemis, disable agents", "Artemis, new chat", "Artemis, brain off" ...
// Pure functions (no DOM), so they can be tested in Node. A sentence that is not a command returns null and goes to the chat as usual.

export const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const NUMS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const digitWords = (t) => String(t || '').replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/g, (w) => NUMS[w]);
const OFF = /\b(off|disable|disabled|deactivate|turn off|switch off|shut off|without)\b/;
const ON = /\b(on|enable|enabled|activate|turn on|switch on)\b/;
const AGENTS = /\b(agents?|sub ?agents?)\b/;
const BRAIN = /\b(brains?|council)\b/;
const PERM = /\b(auto ?approv\w*|auto ?accept|auto mode)\b/;
const ASK_FIRST = /\b(ask (me )?(first|before))\b/;
const NEW = /\b(new|fresh|another|clean)\b/;
const CHAT = /\b(chat|conversation)\b/;
const INCOG = /\b(incognito|private)\b/;
const STOPS = new Set(['stop', 'cancel', 'never mind', 'nevermind', 'quiet', 'shut up', 'be quiet', 'skip', 'skip it', 'stop it', 'stop talking', 'enough', 'that s enough']);
const PAGES = [
  [/\b(settings?)\b/, 'settings', 'Settings'],
  [/\b(logs?)\b/, 'logs', 'Logs'],
  [/\b(automations?)\b/, 'automations', 'Automations'],
  [/\b(skills?)\b/, 'skills', 'Skills'],
  [/\b(projects?)\b/, 'projects', 'Projects'],
  [/\b(scheduled|schedules?)\b/, 'schedule', 'Scheduled'],
  [/\b(memory|memories)\b/, 'memory', 'Memory'],
  [/\b(usage|costs?)\b/, 'usage', 'Usage'],
  [/\b(connectors?)\b/, 'connectors', 'Connectors'],
  [/\b(terminal)\b/, 'terminal', 'the terminal'],
  [/\b(browser)\b/, 'browser', 'the browser'],
  [/\b(files|library)\b/, 'files', 'Files'],
  [/\b(agents? page|agents)\b/, 'agents', 'Agents'],
  [/\b(home( page)?)\b/, 'home', 'Home']
];
const W_NOUN = '(?: (?:the )?(?:widget|window|pill|card|it|this))?';
const EXPAND = new RegExp('^(?:expand|bigger|make it bigger|grow|enlarge|open up)' + W_NOUN + '$');
const COLLAPSE = new RegExp('^(?:collapse|smaller|make it smaller|shrink|minimi[sz]e|hide|close)' + W_NOUN + '$');
const PIN_W = /^(pin|unpin|keep open|keep it open)(?: (?:the )?(?:widget|window|pill|card))?$|^(pin|unpin) (?:the )?(?:widget|window|pill|card)$|^keep (?:the )?(?:widget|window|pill|card) open$/;
const MOVE_W = /^move (?:the )?(?:widget|window|pill|card|it|yourself)(?: to)?(?: the)? (left|right|top|bottom|up|down|center|centre|middle)(?: side| corner| edge)?$/;
const SHOW_APP = /^(?:(?:open|show|bring up|bring back|switch to|go to)(?: me)? (?:the )?(?:app|artemis|application|main window)|show me(?: (?:it|that|this|the answer))?(?: in the app)?|(?:open|show) (?:it|that|this) in the app|open in (?:the )?app)$/;
const TLD = '(com|org|net|io|ai|dev|co|edu|gov|app|tv|me|uk|de|fr)';
const SITE = new RegExp('^(?:open|go to|visit|browse to|navigate to|take me to)(?: the)? ([a-z0-9 -]+?)(?: dot)? ' + TLD + '(?: website| site| page)?$');
const BROWSE = /^(?:open|show) (.+?) in (?:the )?browser$/;
const ORD = { one: 1, first: 1, '1': 1, two: 2, second: 2, '2': 2, three: 3, third: 3, '3': 3, four: 4, fourth: 4, '4': 4, five: 5, fifth: 5, '5': 5, last: -2 };

/** Picking one of a list that was read out ("the second one", "number 3"). Returns the 0-based index, -1 for "none / cancel", or null. */
export function parseChoice(text, count = 5) {
  const t = norm(text);
  if (!t || t.split(' ').length > 6) return null;
  if (/^(none|neither|none of them|cancel|never mind|nevermind|no)$/.test(t)) return -1;
  const w = t.replace(/^(the|number|open|pick|choose|select|go to|take)\s+/g, '').replace(/^(the|number)\s+/, '').replace(/\s+(one|chat|please|it)$/g, '').trim();
  const k = ORD[w] !== undefined ? ORD[w] : ORD[w.split(' ')[0]] !== undefined && w.split(' ').length <= 2 ? ORD[w.split(' ')[0]] : undefined;
  if (k === undefined) return null;
  const i = k === -2 ? count - 1 : k - 1;
  return i >= 0 && i < count ? i : null;
}
/** Chats whose title matches the spoken words best ("the chat about the tax report"). */
export function findChats(chats, query, max = 3) {
  const q = norm(query).split(' ').filter((w) => w.length > 1 && !/^(the|a|an|about|on|my|of|for|with|and|chat|conversation)$/.test(w));
  if (!q.length) return [];
  return (chats || []).map((c) => {
    const tw = norm(c.title).split(' ');
    let score = 0;
    for (const w of q) if (tw.includes(w)) score += 2; else if (tw.some((x) => x.startsWith(w.slice(0, Math.max(3, w.length - 2))))) score += 1;
    return { c, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score || (b.c.updatedAt || 0) - (a.c.updatedAt || 0)).slice(0, max).map((x) => x.c);
}
function matchModel(t, models) {
  const q = digitWords(t);
  let best = null;
  for (const mo of models) {
    const n = digitWords(norm(mo.name)); const id = digitWords(norm(String(mo.id).replace(/^prov:[^:]*:/, '')));
    for (const cand of [n, id]) {
      if (cand && new RegExp('\\b' + cand + '\\b').test(q) && (!best || cand.length > best.len)) best = { len: cand.length, mo };
    }
  }
  return best ? best.mo : null;
}
const OPEN = /\b(open|show|go to|goto)\b/;

const lev = (a, b) => {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
};
/** Best item whose name sounds like the spoken words ("use brain galahat", "project tax report"), or null. Speech recognition misspells names, so small typos count. */
export function fuzzyPick(list, query, nameOf = (x) => x.name) {
  const q = norm(query).replace(/^(the|my|a)\s+/, '').replace(/\s+(brain|project|one|please)$/, '').trim();
  if (!q) return null;
  const qs = q.replace(/ /g, '');
  let best = null;
  for (const it of list || []) {
    const n = norm(nameOf(it)); if (!n) continue;
    const ns = n.replace(/ /g, '');
    let score = 0;
    if (n === q || ns === qs) score = 100;
    else if (ns.startsWith(qs) && qs.length >= 3) score = 80;
    else if (new RegExp('\\b' + q + '\\b').test(n) && q.length >= 3) score = 70;
    else if (q.split(' ').every((w) => n.split(' ').some((x) => x.startsWith(w))) && qs.length >= 3) score = 60;
    else {
      const d = lev(qs, ns); const tol = Math.max(1, Math.floor(ns.length / 4));
      if (d <= tol) score = 50 - d;
      else { const ws = n.split(' '); const hit = q.split(' ').filter((w) => w.length >= 4 && ws.some((x) => lev(w, x) <= Math.max(1, Math.floor(x.length / 4)))).length; if (hit && hit >= Math.ceil(q.split(' ').length / 2)) score = 30 + hit; }
    }
    if (score && (!best || score > best.score)) best = { score, it };
  }
  return best ? best.it : null;
}
const spokenTokens = (n) => (n < 1000 ? String(Math.round(n)) : n < 1e6 ? `${Math.round(n / 100) / 10} thousand` : `${Math.round(n / 1e5) / 10} million`);
const spokenUsd = (c) => (!c ? '' : c < 0.01 ? 'less than a cent' : `$${c.toFixed(2)}`);
/** What Sentinel says for "what's my usage": today's and this chat's tokens and estimated cost ({ t: tokens, c: usd }), the same numbers as the Usage button. */
export function usageText(today, chat) {
  const part = (v) => { const u = spokenUsd(v.c); return `${spokenTokens(v.t || 0)} tokens${u ? `, about ${u}` : ''}`; };
  return `Today: ${part(today || {})}. This chat: ${part(chat || {})}.`;
}
/** One short sentence with the chat's controls: model, brain, project, think, tools, agents, permissions. */
export function statusText({ model, brain, project, think, tools, agents, perm }) {
  return `Model ${model || 'not set'}, ${brain ? (brain === 'Council' ? 'council on' : `brain ${brain}`) : 'no brain'}, ${project ? `project ${project}` : 'no project'}, think ${think || 'auto'}, tools ${tools === 'off' ? 'off' : 'on'}, agents ${agents === 'off' ? 'off' : 'on'}, ${perm === 'auto' ? 'auto-allow everything' : 'ask first'}.`;
}
const THINK_V = { off: 'low', none: 'low', low: 'low', medium: 'medium', normal: 'medium', high: 'high', max: 'high', auto: 'auto', automatic: 'auto', default: 'auto' };

/** The chat controls panel by voice: brain, tools, think, agents, permissions, project, usage, status. */
function parseControls(t, { brains = [], projects = [] } = {}) {
  if (/^(?:status|chat status|current settings|(?:what are|tell me) (?:my|the|the chat s|this chat s) settings|(?:what s|whats|what is) (?:the |my )?(?:status|setup|settings))$/.test(t)) return { type: 'status' };
  if (/^(?:usage|my usage|show (?:me )?(?:my )?usage|(?:what s|whats|what is) (?:my |the )?(?:usage|cost|spend|spending)(?: today| so far)?|how much (?:did i|have i|do i) (?:spend|spent|use|used)(?: so far)?(?: today)?|how much (?:did|has|does) (?:this|it|today) cost(?: me)?(?: so far)?(?: today)?|today s (?:usage|cost)|cost today|usage today)$/.test(t)) return { type: 'usage' };
  // permissions: the panel has "Ask first" (ask) and "Auto-allow" (auto, everything)
  if (/^(?:(?:set |switch |change )?(?:the )?permissions?(?: mode)?(?: to)? (?:ask|ask first|ask me|ask me first)|always ask(?: me)?(?: first)?)$/.test(t)) return { type: 'perm', value: 'ask' };
  if (/^(?:(?:set |switch |change )?(?:the )?permissions?(?: mode)?(?: to)? )?(?:auto ?allow (?:all|everything)|full access|auto|everything|auto ?allow)$/.test(t) && /\b(allow|access|permissions?)\b/.test(t)) return { type: 'perm', value: 'auto' };
  if (/^(?:give (?:it |yourself |artemis )?)?full access$/.test(t)) return { type: 'perm', value: 'auto' };
  if (/^(?:(?:set |switch |change )?(?:the )?permissions?(?: mode)?(?: to)? )?auto ?(?:allow|approve) (?:the )?(?:file )?edits$/.test(t)) return { type: 'permEdits' };
  // think level: auto / low / medium / high ("off" is the lowest level, low)
  { const m = /^(?:set |switch |change )?(?:the )?(?:think|thinking|reasoning)(?: level| mode| effort)?(?: to)? (off|none|low|medium|normal|high|max|auto|automatic|default)$/.exec(t);
    if (m) return { type: 'think', value: THINK_V[m[1]], ...(m[1] === 'off' || m[1] === 'none' ? { off: true } : {}) }; }
  if (/^(?:think (?:harder|more|deeper)|(?:more|harder|deeper) thinking|(?:turn|step) (?:the )?thinking up)$/.test(t)) return { type: 'thinkStep', value: 'up' };
  if (/^(?:think less|less thinking|think faster|(?:turn|step) (?:the )?thinking down)$/.test(t)) return { type: 'thinkStep', value: 'down' };
  // tools and agents
  if (/^(?:no tools|without tools)$/.test(t)) return { type: 'tools', value: 'off' };
  if (/^(?:no agents|without agents|no sub ?agents)$/.test(t)) return { type: 'agents', value: 'off' };
  // brain
  if (/^(?:no brain|brain none|without (?:a )?brain|(?:turn|switch) off (?:the )?brain|(?:set |switch |change )?(?:the )?brain to none)$/.test(t)) return { type: 'brain', value: '', label: '' };
  if (/^(?:which|what) brain(?: (?:am i (?:using|talking to)|is (?:on|active|this|it|being used)|are you|are we using))?$|^(?:who am i talking to)$/.test(t)) return { type: 'brainWhich' };
  { const m = /^(?:(?:use|switch to|change to|set|pick|select)(?: the)? brain(?: to)?|(?:switch|change|set) (?:the )?brain to|talk to (?:the )?brain|brain) (.+)$/.exec(t);
    if (m && !/^(?:on|off|enabled?|disabled?)$/.test(m[1])) {
      if (/^(?:the )?council$/.test(m[1])) return { type: 'brain', value: 'council', label: 'Council' };
      if (/^(?:none|nothing)$/.test(m[1])) return { type: 'brain', value: '', label: '' };
      const b = fuzzyPick(brains, m[1]);
      return b ? { type: 'brain', value: b.slug, label: b.name } : { type: 'brainAsk', value: m[1] };
    } }
  // project
  if (/^(?:no project|project none|without (?:a )?project|(?:remove|take) (?:this chat |the chat |it )?(?:out of|from) (?:the |this |its )?project|(?:set |switch |change )?(?:the )?project to none)$/.test(t)) return { type: 'project', value: null, label: '' };
  if (/^(?:which|what) project(?: (?:am i in|is this|is it|is this chat in|is this in|are we in|is on))?$/.test(t)) return { type: 'projectWhich' };
  { const m = /^(?:(?:switch|move|change|go|put)(?: this chat| the chat| it)? (?:in)?to(?: the)? project|(?:use|set|pick|select)(?: the)? project(?: to)?|(?:set|change|switch) (?:the )?project to|project) (.+)$/.exec(t)
      || /^(?:switch|move|put)(?: this chat| the chat| it)? (?:in)?to (?:the |my )?(.+?) project$/.exec(t);
    if (m && !/^(?:page|list|settings)$/.test(m[1])) {
      if (/^(?:none|nothing)$/.test(m[1])) return { type: 'project', value: null, label: '' };
      const p = fuzzyPick(projects, m[1]);
      return p ? { type: 'project', value: p.id, label: p.name } : { type: 'projectAsk', value: m[1] };
    } }
  return null;
}

/**
 * Turns a spoken sentence into a command, or null when it is an ordinary message.
 * brains: [{ slug, name }] so a brain can be picked by name ("talk to Galahad").
 * Returns { type, value?, label?, page? }.
 */
const YES = /^(yes|yeah|yep|yup|sure|ok|okay|approve|approved|allow|allowed|go ahead|do it|go on|proceed|confirm|sounds good|allow it|approve it|yes please|please do|yes allow it|yes allow|yes approve it|yes go ahead|yes do it)$/;
const NO = /^(no|nope|nah|deny|denied|decline|reject|do not|dont|don t|do not do it|dont do it|stop|cancel|never mind|nevermind|no thanks|no don t|no deny it|no deny|no do not do it|no dont do it)$/;

/** While an approval is waiting: "yes / approve / allow" or "no / deny / cancel". */
export function parseApproval(text) {
  const t = norm(text);
  if (!t || t.split(' ').length > 5) return null;
  if (YES.test(t)) return { type: 'approve' };
  if (NO.test(t)) return { type: 'deny' };
  return null;
}

export function parseCommand(text, { brains = [], models = [], projects = [], awaiting = false } = {}) {
  // push-to-talk sentences are not stripped of the name: "Artemis, lock" is the command "lock"
  const t = norm(text).replace(/^(?:(?:hey|hi|ok|okay|yo) )?(?:artemis|artemus|artemas|artemes|artimis) (?=\S)/, '');
  if (!t) return null;
  if (awaiting) { const a = parseApproval(text); if (a) return a; }
  const words = t.split(' ');
  if (words.length > 10) return null; // long sentences are questions, not commands
  const out = (o) => o;
  const off = OFF.test(t);
  const on = !off && ON.test(t);

  if (words.length <= 4 && /^(bye bye|bye|goodbye|good bye|see you|see you later|see ya)\b/.test(t)) return out({ type: 'bye' });
  if (STOPS.has(t)) return out({ type: 'stop' });
  if (/\bsentinel\b/.test(t) && (OFF.test(t) || /\b(stop|exit|quit|close)\b/.test(t))) return out({ type: 'sentinelOff' });
  if (/^(stop listening|go to sleep)$/.test(t)) return out({ type: 'sentinelOff' });
  if (/^(mute|mute (the )?(mic|microphone)|turn off (the )?(mic|microphone)|(mic|microphone) off)$/.test(t)) return out({ type: 'mute' });
  // lock the app (Settings → Security)
  if (/^(?:please )?(?:lock|locke|locks|lok|secure)(?: (?:the )?(?:app|artemis|screen|computer|mac|it))?(?: now| please)?$/.test(t)) return out({ type: 'lock' });
  // the app itself, only when asked
  if (SHOW_APP.test(t)) return out({ type: 'showApp' });
  // the floating widget
  if (EXPAND.test(t)) return out({ type: 'widget', value: 'expand' });
  if (COLLAPSE.test(t)) return out({ type: 'widget', value: 'collapse' });
  if (PIN_W.test(t)) return out({ type: 'widget', value: /^unpin/.test(t) ? 'unpin' : 'pin' });
  { const m = MOVE_W.exec(t); if (m) return out({ type: 'widget', value: { centre: 'center', middle: 'center' }[m[1]] || m[1] }); }
  // the answer
  if (/^(continue|keep going|go on|carry on|continue (the )?(answer|that|it)|finish (the answer|it))$/.test(t)) return out({ type: 'continue' });
  if (/^(regenerate|retry|try again|redo( that| it)?|regenerate (the )?(answer|response|reply|that|it)|another answer|give me another answer)$/.test(t)) return out({ type: 'regenerate' });
  if (/^(repeat|repeat (that|it|this|the answer|the last answer|your answer|yourself)|say (that|it) again|read (that|it) again|what did you say|come again|once more)$/.test(t)) return out({ type: 'repeat' });
  { const m = /^(?:(?:can you |please )?(?:read|speak|talk|say)(?: (?:it|that|this))?(?: again)? )?(?:a bit |a little |much |even )?(slower|more slowly|faster|quicker|more quickly)(?: please)?$|^(slow down|speed up)$/.exec(t);
    if (m) { const w = m[1] || m[2] || m[3]; return out({ type: 'rate', value: /slow/.test(w) ? 'slower' : 'faster', again: /\b(read|say)\b/.test(t) }); } }
  if (/^(normal|regular|default) (speed|speech speed|voice speed|reading speed)$|^(read|speak|talk) (at )?normal speed$/.test(t)) return out({ type: 'rate', value: 'normal' });
  if (/^(?:louder|quieter|softer|(?:speak|talk|turn it|turn) (?:up|down|louder|quieter|softer)|(?:turn )?(?:the )?volume (?:up|down)|(?:increase|decrease|raise|lower) (?:the )?volume)$/.test(t)) return out({ type: 'volume' });
  { const m = /^(?:please )?copy(?: (that|it|this|the answer|the last answer|the response|your answer|the reply|the code|the last code block|the code block))?(?: to (?:the )?clipboard)?$/.exec(t);
    if (m) return out({ type: 'copy', value: m[1] && /code/.test(m[1]) ? 'code' : 'answer' }); }
  if (/^(read|say) (the )?(last )?code( block)?$/.test(t)) return out({ type: 'readCode' });
  // screen
  if (words.length <= 12 && (/\b(look at|see|check|read|whats on|what s on|what is on|describe)\b.*\b(my|the) screen\b/.test(t))) return out({ type: 'screen' });
  // chats
  if (/^(?:go (?:back )?to |open |switch to |back to )?(?:the )?(previous|prior|older|last) (?:chat|conversation)$/.test(t)) return out({ type: 'prevChat' });
  if (/^(?:go to |open |switch to )?(?:the )?next (?:chat|conversation)$/.test(t)) return out({ type: 'nextChat' });
  if (/^(delete|remove|trash) (this |the |current )?(chat|conversation)$/.test(t)) return out({ type: 'deleteChat' });
  if (/^(pin|unpin) (this |the |current )?(chat|conversation)$/.test(t)) return out({ type: 'pinChat', value: t.startsWith('unpin') ? 'unpin' : 'pin' });
  { const raw = String(text || '').trim().replace(/[.!?]+$/, '');
    const m = /^(?:please\s+)?(?:rename|call|name)\s+(?:this|the|current)?\s*(?:chat|conversation)\s+(?:to\s+|as\s+)?(.+)$/i.exec(raw) || /^(?:please\s+)?rename\s+(?:it|this)\s+(?:to\s+|as\s+)(.+)$/i.exec(raw);
    if (m && m[1].trim()) return out({ type: 'renameChat', value: m[1].trim().replace(/^["'“]|["'”]$/g, '').slice(0, 80) }); }
  { const m = /^(?:find|search for|search|look for|open|go to|switch to)(?: (?:the|my))? (?:chat|conversation)s? (?:about|on|called|named|titled|with|for) (.+)$/.exec(t) || /^(?:find|search)(?: (?:my|the))? (?:chats|conversations) (?:for|about) (.+)$/.exec(t);
    if (m) return out({ type: 'findChat', value: m[1] }); }
  if (INCOG.test(t) && (NEW.test(t) || ON.test(t) || CHAT.test(t) || /\bopen\b/.test(t))) return out({ type: 'incognito' });
  if (NEW.test(t) && CHAT.test(t) && words.length <= 5 && words.findIndex((w) => NEW.test(w)) <= 3) return out({ type: 'newChat' });
  if (/^(start over)$/.test(t)) return out({ type: 'newChat' });
  if (/\b(compact)\b/.test(t) && words.length <= 5) return out({ type: 'compact' });

  { const c = parseControls(t, { brains, projects }); if (c) return out(c); }
  if (PERM.test(t) && (off || on)) return out({ type: 'perm', value: off ? 'ask' : 'auto' });
  if (ASK_FIRST.test(t)) return out({ type: 'perm', value: 'ask' });

  // "switch model to GPT 5 mini", "use model Claude"
  if (/\bmodel\w*\b/.test(t) && /\b(change|switch|use|set|select|pick|swap)\b/.test(t) && words.length <= 9) {
    const best = matchModel(t, models);
    if (best) return out({ type: 'model', value: best.id, label: best.name });
    return out({ type: 'modelAsk' });
  }

  if (AGENTS.test(t) && !BRAIN.test(t) && (off || on)) return out({ type: 'agents', value: off ? 'off' : 'on' });

  if (BRAIN.test(t) || /\b(use|switch to|talk to|ask|call)\b/.test(t)) {
    const named = brains.find((b) => {
      const n = norm(b.name); return n && new RegExp('\\b' + n + '\\w*\\b').test(t);
    });
    if (named && (BRAIN.test(t) || words.length <= 5)) return out({ type: 'brain', value: named.slug, label: named.name });
    if (BRAIN.test(t) && /\b(council)\b/.test(t) && !off) return out({ type: 'brain', value: 'council', label: 'Council' });
    if (BRAIN.test(t) && off) return out({ type: 'brain', value: '', label: '' });
    if (BRAIN.test(t) && on) return out({ type: 'brain', value: 'council', label: 'Council' });
  }

  // "browser open github dot com", "open the browser and go to the weather": the agent browser, not the Browser page
  { const m = /^(?:browser open|(?:open|use) (?:the )?browser (?:and )?(?:go to|open|search(?: for)?|to|at|look up)?) ?(.+)$/.exec(t);
    if (m && m[1] && !/^(?:page|tab|window|panel)$/.test(m[1])) { const v = m[1].replace(/^the /, ''); const s = new RegExp('^([a-z0-9 -]+?)(?: dot)? ' + TLD + '$').exec(v); return out({ type: 'browse', value: s ? s[1].replace(/\s+/g, '') + '.' + s[2] : v }); } }
  if (OPEN.test(t) && words.length <= 5 && !/\bin (the )?browser\b/.test(t)) {
    for (const [re, page, en] of PAGES) if (re.test(t)) return out({ type: 'open', page, label: en });
  }
  if (/^(?:use|switch to|change to)\s/.test(t) && words.length <= 6) { const mo = matchModel(t, models); if (mo) return out({ type: 'model', value: mo.id, label: mo.name }); }
  if (/^(?:think (?:harder|more|less|deeper|faster)|(?:turn|switch|set) (?:on|off) (?:the )?(?:thinking|reasoning)|(?:thinking|reasoning)(?: mode| level)? (?:on|off|high|low|medium|normal|auto|automatic|default)|(?:turn|switch) (?:the )?(?:thinking|reasoning)(?: mode)? (?:on|off|up|down)|(?:enable|disable|activate|deactivate) (?:the )?(?:thinking|reasoning)|no thinking|stop thinking)$/.test(t)) {
    if (/\b(harder|more|high|deep|deeper|up)\b/.test(t) || (on && !off)) return out({ type: 'think', value: 'high' });
    if (/\b(less|low|no|stop|fast|faster|down)\b/.test(t) || off) return out({ type: 'think', value: 'low' });
    if (/\b(auto|automatic|default)\b/.test(t)) return out({ type: 'think', value: 'auto' });
    if (/\b(medium|normal)\b/.test(t)) return out({ type: 'think', value: 'medium' });
  }
  if (/\btools?\b/.test(t) && !AGENTS.test(t) && (off || on) && words.length <= 6) return out({ type: 'tools', value: off ? 'off' : 'on' });
  { const m = SITE.exec(t); if (m) return out({ type: 'browse', value: m[1].replace(/\s+/g, '') + '.' + m[2] }); }
  { const m = BROWSE.exec(t); if (m) return out({ type: 'browse', value: m[1] }); }
  return null;
}

/** What Artemis says back (short). */
export function confirmText(cmd) {
  switch (cmd.type) {
    case 'agents': return cmd.value === 'on' ? 'Agents are on.' : 'Agents are off.';
    case 'brain':
      if (!cmd.value) return 'Brain is off.';
      if (cmd.value === 'council') return 'Council is on.';
      return `Talking to ${cmd.label}.`;
    case 'perm': return cmd.value === 'auto' ? 'Auto-allow is on. Edits, the terminal and computer control will run without asking. Deleting still asks.' : 'I will ask first.';
    case 'permEdits': return 'This chat has two modes: ask first, or auto-allow everything. Say auto-allow everything to turn it on.';
    case 'brainAsk': return `I do not know a brain called ${cmd.value}.`;
    case 'project': return cmd.value ? `Moved to ${cmd.label}.` : 'Removed from the project.';
    case 'projectAsk': return `I found no project called ${cmd.value}.`;
    case 'thinkStep': return cmd.value === 'up' ? 'Thinking harder.' : 'Thinking less.';
    case 'brainWhich': case 'projectWhich': case 'usage': case 'status': return '';
    case 'model': return `Model: ${cmd.label}.`;
    case 'modelAsk': return 'Which model? Say “switch model to” and its name.';
    case 'bye': return 'Bye.';
    case 'newChat': return 'New chat.';
    case 'incognito': return 'Incognito chat.';
    case 'compact': return 'Compacting.';
    case 'approve': return 'Allowed.';
    case 'deny': return 'Not allowed.';
    case 'open': return `I opened ${cmd.label} in the app.`;
    case 'showApp': return 'I opened the app.';
    case 'lock': return 'Locked.';
    case 'mute': return 'Microphone muted. Click the mic on the widget to turn it back on.';
    case 'widget': return { expand: 'Expanded.', collapse: 'Minimized.', pin: 'The widget stays open.', unpin: 'The widget closes by itself again.' }[cmd.value] || 'Moved.';
    case 'continue': return 'Continuing.';
    case 'regenerate': return 'Trying again.';
    case 'repeat': return '';
    case 'rate': return cmd.value === 'slower' ? 'Speaking slower.' : cmd.value === 'faster' ? 'Speaking faster.' : 'Normal speed.';
    case 'volume': return 'I cannot change the volume. Use your computer’s volume keys.';
    case 'copy': return cmd.value === 'code' ? 'Copied the code.' : 'Copied.';
    case 'readCode': return 'I do not read code aloud. It is on the widget.';
    case 'screen': return '';
    case 'prevChat': return 'Previous chat.';
    case 'nextChat': return 'Next chat.';
    case 'deleteChat': return 'Delete this chat? Say yes or no.';
    case 'pinChat': return cmd.value === 'unpin' ? 'Chat unpinned.' : 'Chat pinned.';
    case 'renameChat': return `Renamed to ${cmd.value}.`;
    case 'findChat': return '';
    case 'think': return cmd.off ? 'Thinking set to low, the lowest level.' : ({ high: 'Thinking high.', low: 'Thinking low, answering faster.', medium: 'Medium thinking.', auto: 'Thinking is automatic.' }[cmd.value] || '');
    case 'tools': return cmd.value === 'on' ? 'Tools are on.' : 'Tools are off.';
    case 'browse': return `Opening ${cmd.value}.`;
    default: return '';
  }
}
