// Cron expressions for scheduled tasks: "minute hour day-of-month month day-of-week", in the user's local time.
//   *  any        5  exact        1-5  range        */15  step        1,15,30  list        mon-fri / jan-dec  names
//   @hourly @daily @weekly @monthly @yearly  shortcuts
// Like classic cron, when both day-of-month and day-of-week are restricted, a day matches when either one does.
const MACROS = { '@yearly': '0 0 1 1 *', '@annually': '0 0 1 1 *', '@monthly': '0 0 1 * *', '@weekly': '0 0 * * 0', '@daily': '0 0 * * *', '@midnight': '0 0 * * *', '@hourly': '0 * * * *' };
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day of month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12, names: MONTHS, base: 1 },
  { name: 'day of week', min: 0, max: 7, names: DAYS, base: 0 }
];

function parseField(text, f) {
  const out = new Set();
  const num = (s) => {
    const low = s.toLowerCase();
    if (f.names) { const i = f.names.indexOf(low); if (i >= 0) return i + f.base; }
    if (!/^\d+$/.test(s)) throw new Error(`"${s}" is not a valid ${f.name}`);
    const n = Number(s);
    if (n < f.min || n > f.max) throw new Error(`${f.name} must be ${f.min}-${f.max}, not ${n}`);
    return n;
  };
  for (const part of text.split(',')) {
    if (!part) throw new Error(`Empty item in the ${f.name} field`);
    const [range, stepText, extra] = part.split('/');
    if (extra !== undefined) throw new Error(`"${part}" has more than one "/"`);
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) throw new Error(`Bad step "${stepText}" in the ${f.name} field`);
    let lo, hi;
    if (range === '*') { lo = f.min; hi = f.max; }
    else if (range.includes('-')) { const [a, b] = range.split('-'); lo = num(a); hi = num(b); if (lo > hi) throw new Error(`Range ${range} in the ${f.name} field goes backwards`); }
    else { lo = num(range); hi = stepText === undefined ? lo : f.max; }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

/** Parses an expression; throws an Error with a readable message when it is wrong. */
function parseCron(expr) {
  const raw = String(expr || '').trim().replace(/\s+/g, ' ');
  const text = MACROS[raw.toLowerCase()] || raw;
  const parts = text.split(' ');
  if (parts.length !== 5) throw new Error('A cron expression has 5 fields: minute hour day-of-month month day-of-week (for example "0 9 * * 1-5").');
  const sets = parts.map((p, i) => parseField(p, FIELDS[i]));
  if (sets[4].has(7)) { sets[4].delete(7); sets[4].add(0); } // 7 is Sunday too
  return { minute: sets[0], hour: sets[1], dom: sets[2], month: sets[3], dow: sets[4], domAny: parts[2] === '*', dowAny: parts[4] === '*', text };
}

function dayMatches(c, d) {
  const dom = c.dom.has(d.getDate()), dow = c.dow.has(d.getDay());
  if (c.domAny && c.dowAny) return true;
  if (c.domAny) return dow;
  if (c.dowAny) return dom;
  return dom || dow;
}

/** Next time (ms) strictly after `from` that matches, or null when there is none in the next 5 years (e.g. "0 0 31 2 *"). */
function nextCron(expr, from = Date.now()) {
  const c = typeof expr === 'string' ? parseCron(expr) : expr;
  const d = new Date(from);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  const limit = from + 5 * 366 * 86400000;
  for (let i = 0; i < 200000 && d.getTime() <= limit; i++) {
    if (!c.month.has(d.getMonth() + 1)) { d.setMonth(d.getMonth() + 1, 1); d.setHours(0, 0, 0, 0); continue; }
    if (!dayMatches(c, d)) { d.setDate(d.getDate() + 1); d.setHours(0, 0, 0, 0); continue; }
    if (!c.hour.has(d.getHours())) { d.setHours(d.getHours() + 1, 0, 0, 0); continue; }
    if (!c.minute.has(d.getMinutes())) { d.setMinutes(d.getMinutes() + 1, 0, 0); continue; }
    return d.getTime();
  }
  return null;
}

/** Shortest gap between the next few runs, in minutes (to refuse expressions that would run every minute). */
function minGapMinutes(expr, from = Date.now(), samples = 30) {
  const c = parseCron(expr);
  let prev = nextCron(c, from), gap = Infinity;
  for (let i = 0; i < samples && prev; i++) { const n = nextCron(c, prev); if (!n) break; gap = Math.min(gap, (n - prev) / 60000); prev = n; }
  return gap;
}

const pad = (n) => String(n).padStart(2, '0');
/** A short description in words for the common shapes; the expression itself otherwise. */
function describeCron(expr) {
  let c;
  try { c = parseCron(expr); } catch { return `Cron ${expr}`; }
  const [mi, h, dom, mon, dow] = c.text.split(' ');
  const times = /^\d+$/.test(mi) && /^\d+(,\d+)*$/.test(h) ? h.split(',').map((x) => `${pad(x)}:${pad(mi)}`).join(', ') : null;
  const dayName = (n) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][n];
  let days = null;
  if (dom === '*' && mon === '*') {
    if (dow === '*') days = 'Every day';
    else if ([...c.dow].sort().join() === '1,2,3,4,5') days = 'Weekdays';
    else if ([...c.dow].sort().join() === '0,6') days = 'Weekends';
    else days = [...c.dow].sort().map(dayName).join(', ');
  } else if (/^\d+$/.test(dom) && mon === '*' && dow === '*') days = `Monthly on day ${dom}`;
  if (times && days) return `${days} at ${times}`;
  if (/^\*\/\d+$/.test(mi) && h === '*' && days === 'Every day') return `Every ${mi.slice(2)} min`;
  if (mi === '0' && /^\*\/\d+$/.test(h) && days === 'Every day') return `Every ${h.slice(2)} hours`;
  return `Cron ${c.text}`;
}

module.exports = { parseCron, nextCron, describeCron, minGapMinutes };
