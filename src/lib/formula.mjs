// A small spreadsheet formula engine: arithmetic, comparisons, cell refs, ranges, cross-sheet refs and common functions.
export const colName = (j) => { let n = j, s = ''; do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0); return s; };
export const colIndex = (s) => { let n = 0; for (const ch of s.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
export const cellName = (r, c) => colName(c) + (r + 1);

class Err { constructor(code) { this.code = code; } toString() { return this.code; } }
export const isErr = (v) => v instanceof Err;
const E = (c) => new Err(c);

const ALL = 1048575; // whole column / row ranges (D:D, 2:2) end here; evaluation clamps to the data that exists

/** A cell (B3), whole-column range (D:D, A:C) or whole-row range (2:5) at the start of s, or null. */
function readRef(s, sheet) {
  let m = /^\$?([A-Za-z]{1,3}):\$?([A-Za-z]{1,3})(?![A-Za-z0-9_(!])/.exec(s);
  if (m) { const a = colIndex(m[1]), b = colIndex(m[2]); return { len: m[0].length, tok: { k: 'range', sheet, r1: 0, r2: ALL, c1: Math.min(a, b), c2: Math.max(a, b) } }; }
  m = /^\$?(\d+):\$?(\d+)(?![0-9A-Za-z.])/.exec(s);
  if (m && +m[1] > 0 && +m[2] > 0) { const a = +m[1] - 1, b = +m[2] - 1; return { len: m[0].length, tok: { k: 'range', sheet, r1: Math.min(a, b), r2: Math.max(a, b), c1: 0, c2: ALL } }; }
  m = /^\$?([A-Za-z]{1,3})\$?(\d+)(?![A-Za-z0-9_(!])/.exec(s);
  if (m) return { len: m[0].length, tok: { k: 'ref', sheet, c: colIndex(m[1]), r: +m[2] - 1 } };
  return null;
}

function tokenize(src) {
  const t = []; let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '"') { let j = i + 1, s = ''; while (j < src.length && !(src[j] === '"' && src[j + 1] !== '"')) { if (src[j] === '"') { s += '"'; j += 2; } else s += src[j++]; } t.push({ k: 'str', v: s }); i = j + 1; continue; }
    if (/[0-9.]/.test(ch)) { const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i)); if (!m) throw E('#VALUE!'); t.push({ k: 'num', v: parseFloat(m[0]) }); i += m[0].length; continue; }
    if (ch === "'") { const j = src.indexOf("'", i + 1); if (j < 0) throw E('#REF!'); const name = src.slice(i + 1, j); i = j + 1; if (src[i] === '!') { i++; const x = readRef(src.slice(i), name); if (!x) throw E('#REF!'); t.push(x.tok); i += x.len; continue; } throw E('#NAME?'); }
    if (/[0-9$A-Za-z]/.test(ch) && (t.length === 0 || t[t.length - 1].k === 'op')) { const x = readRef(src.slice(i)); if (x && (x.tok.k === 'range' || /[A-Za-z$]/.test(ch))) { t.push(x.tok); i += x.len; continue; } }
    if (/[A-Za-z_$]/.test(ch)) {
      const m = /^(\$?[A-Za-z]{1,3}\$?\d+)(?![A-Za-z0-9_(!])/.exec(src.slice(i));
      if (m) { const mm = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(m[1]); t.push({ k: 'ref', c: colIndex(mm[1]), r: +mm[2] - 1 }); i += m[0].length; continue; }
      const w = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(src.slice(i));
      if (!w) throw E('#NAME?');
      i += w[0].length;
      if (src[i] === '!') { i++; const x = readRef(src.slice(i), w[0]); if (!x) throw E('#REF!'); t.push(x.tok); i += x.len; continue; }
      t.push({ k: src[i] === '(' ? 'fn' : 'name', v: w[0].toUpperCase() }); continue;
    }
    const two = src.slice(i, i + 2);
    if (['<=', '>=', '<>'].includes(two)) { t.push({ k: 'op', v: two }); i += 2; continue; }
    if ('+-*/^&=<>(),:%'.includes(ch)) { t.push({ k: 'op', v: ch }); i++; continue; }
    throw E('#VALUE!');
  }
  return t;
}

function parse(tokens) {
  let p = 0;
  const peek = () => tokens[p], next = () => tokens[p++];
  const isOp = (v) => peek() && peek().k === 'op' && peek().v === v;
  function expr() { return cmp(); }
  function cmp() { let l = concat(); while (peek() && peek().k === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(peek().v)) { const op = next().v; l = { t: 'bin', op, l, r: concat() }; } return l; }
  function concat() { let l = add(); while (isOp('&')) { next(); l = { t: 'bin', op: '&', l, r: add() }; } return l; }
  function add() { let l = mul(); while (isOp('+') || isOp('-')) { const op = next().v; l = { t: 'bin', op, l, r: mul() }; } return l; }
  function mul() { let l = pow(); while (isOp('*') || isOp('/')) { const op = next().v; l = { t: 'bin', op, l, r: pow() }; } return l; }
  function pow() { let l = unary(); while (isOp('^')) { next(); l = { t: 'bin', op: '^', l, r: unary() }; } return l; }
  function unary() { if (isOp('-')) { next(); return { t: 'neg', e: unary() }; } if (isOp('+')) { next(); return unary(); } return pct(); }
  function pct() { let e = primary(); while (isOp('%')) { next(); e = { t: 'bin', op: '/', l: e, r: { t: 'num', v: 100 } }; } return e; }
  function primary() {
    const tk = next();
    if (!tk) throw E('#VALUE!');
    if (tk.k === 'num') return { t: 'num', v: tk.v };
    if (tk.k === 'str') return { t: 'str', v: tk.v };
    if (tk.k === 'range') return { t: 'range', sheet: tk.sheet, r1: tk.r1, c1: tk.c1, r2: tk.r2, c2: tk.c2 };
    if (tk.k === 'ref') {
      if (isOp(':')) { next(); const b = next(); if (!b || b.k !== 'ref') throw E('#REF!'); return { t: 'range', sheet: tk.sheet, r1: Math.min(tk.r, b.r), c1: Math.min(tk.c, b.c), r2: Math.max(tk.r, b.r), c2: Math.max(tk.c, b.c) }; }
      return { t: 'ref', sheet: tk.sheet, r: tk.r, c: tk.c };
    }
    if (tk.k === 'name') { if (tk.v === 'TRUE') return { t: 'num', v: true }; if (tk.v === 'FALSE') return { t: 'num', v: false }; throw E('#NAME?'); }
    if (tk.k === 'fn') {
      next(); // (
      const args = [];
      if (!isOp(')')) { for (;;) { args.push(expr()); if (isOp(',')) { next(); continue; } break; } }
      if (!isOp(')')) throw E('#VALUE!');
      next();
      return { t: 'fn', name: tk.v, args };
    }
    if (tk.k === 'op' && tk.v === '(') { const e = expr(); if (!isOp(')')) throw E('#VALUE!'); next(); return e; }
    throw E('#VALUE!');
  }
  const ast = expr();
  if (p < tokens.length) throw E('#VALUE!');
  return ast;
}

const num = (v) => {
  if (isErr(v)) throw v;
  if (v === '' || v == null) return 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return v;
  const n = Number(String(v).trim());
  if (Number.isNaN(n)) throw E('#VALUE!');
  return n;
};
const str = (v) => { if (isErr(v)) throw v; return v == null ? '' : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v); };
const bool = (v) => { if (isErr(v)) throw v; if (typeof v === 'string') return v.toUpperCase() === 'TRUE' || (v !== '' && Number(v) !== 0 && !Number.isNaN(Number(v))); return !!v; };

function criteriaFn(c) {
  if (typeof c === 'number') return (v) => typeof v === 'number' && v === c;
  const m = /^(<=|>=|<>|<|>|=)?(.*)$/.exec(String(c));
  const op = m[1] || '=', rhsRaw = m[2], rhs = Number(rhsRaw);
  const isNum = rhsRaw !== '' && !Number.isNaN(rhs);
  return (v) => {
    const a = isNum && (typeof v === 'number' || (v !== '' && !Number.isNaN(Number(v)))) ? Number(v) : String(v ?? '').toLowerCase();
    const b = isNum ? rhs : rhsRaw.toLowerCase();
    if (typeof a !== typeof b) return op === '<>';
    return { '=': a === b, '<>': a !== b, '<': a < b, '>': a > b, '<=': a <= b, '>=': a >= b }[op];
  };
}

/**
 * book: { sheets: [{ name, rows: [[raw...]] }], cache?: {} }  raw values are numbers/strings; strings starting with "=" are formulas.
 * Returns an evaluator: evalCell(sheetIndex, r, c) -> number | string | boolean | Err
 */
export function createEvaluator(sheets) {
  const memo = new Map(); const stack = new Set(); const asts = new Map();
  const byName = (n) => { const i = sheets.findIndex((s) => s.name.toLowerCase() === String(n).toLowerCase()); if (i < 0) throw E('#REF!'); return i; };
  const raw = (si, r, c) => { const row = sheets[si].rows[r]; return row ? row[c] : undefined; };

  const isFormula = (v) => typeof v === 'string' && v.length > 1 && v[0] === '=';
  const astOf = (v) => { let ast = asts.get(v); if (!ast) { ast = parse(tokenize(v.slice(1))); asts.set(v, ast); } return ast; };

  // Formula cells a formula refers to (refs and ranges), for dependency-first evaluation.
  const depCache = new Map();
  function depsOf(si, r, c) {
    const v = raw(si, r, c);
    let refs = depCache.get(v + '\u0000' + si);
    if (!refs) {
      refs = [];
      let ast; try { ast = astOf(v); } catch { ast = null; }
      const visit = (n) => {
        if (!n || typeof n !== 'object') return;
        if (n.t === 'ref' || n.t === 'range') { try { refs.push({ ...n, s: n.sheet ? byName(n.sheet) : si }); } catch {} return; }
        if (n.t === 'bin') { visit(n.l); visit(n.r); } else if (n.t === 'neg') visit(n.e); else if (n.t === 'fn') n.args.forEach(visit);
      };
      visit(ast);
      depCache.set(v + '\u0000' + si, refs);
    }
    const out = [];
    for (const n of refs) {
      if (n.t === 'ref') { if (isFormula(raw(n.s, n.r, n.c))) out.push([n.s, n.r, n.c]); continue; }
      const rows = sheets[n.s].rows, r2 = Math.min(n.r2, rows.length - 1);
      for (let rr = n.r1; rr <= r2; rr++) { const row = rows[rr]; if (!row) continue; const c2 = Math.min(n.c2, row.length - 1); for (let cc = n.c1; cc <= c2; cc++) if (isFormula(row[cc])) out.push([n.s, rr, cc]); }
    }
    return out;
  }

  // Evaluates the cells a formula depends on first, with an explicit stack, so long chains (A2=A1+1 ... A100000)
  // never recurse deeply. Cycles are left to the normal evaluation, which reports #CYCLE!.
  let priming = false;
  function prime(si, r, c) {
    priming = true;
    const onPath = new Set([si + ':' + r + ':' + c]);
    const st = [{ si, r, c, deps: null, i: 0 }];
    try {
      while (st.length) {
        const f = st[st.length - 1];
        if (!f.deps) f.deps = depsOf(f.si, f.r, f.c);
        let pushed = false;
        while (f.i < f.deps.length) {
          const [ds, dr, dc] = f.deps[f.i++];
          const k = ds + ':' + dr + ':' + dc;
          if (memo.has(k) || onPath.has(k)) continue;
          onPath.add(k); st.push({ si: ds, r: dr, c: dc, deps: null, i: 0 }); pushed = true; break;
        }
        if (pushed) continue;
        st.pop(); onPath.delete(f.si + ':' + f.r + ':' + f.c);
        if (st.length) cellValue(f.si, f.r, f.c);
      }
    } finally { priming = false; }
  }

  function cellValue(si, r, c) {
    const key = si + ':' + r + ':' + c;
    if (memo.has(key)) return memo.get(key);
    const v = raw(si, r, c);
    let out;
    if (isFormula(v)) {
      if (stack.has(key)) return E('#CYCLE!');
      if (!priming && !stack.size) prime(si, r, c);
      if (memo.has(key)) return memo.get(key);
      stack.add(key);
      try {
        out = evalAst(astOf(v), si);
        if (out && out.__range) out = out.values[0] ?? 0;
      } catch (e) { out = isErr(e) ? e : E('#VALUE!'); }
      stack.delete(key);
    } else if (v === undefined || v === null || v === '') out = '';
    else if (typeof v === 'number' || typeof v === 'boolean') out = v;
    else { const s = String(v); out = s.trim() !== '' && !Number.isNaN(Number(s)) && /^\s*-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?\s*$/i.test(s) ? Number(s) : s; }
    memo.set(key, out);
    return out;
  }

  function flat(args, si, numericOnly) {
    const out = [];
    for (const a of args) {
      const v = evalAst(a, si);
      if (v && v.__range) for (const x of v.values) { if (isErr(x)) throw x; if (numericOnly ? typeof x === 'number' : x !== '') out.push(x); }
      else { if (isErr(v)) throw v; out.push(numericOnly ? num(v) : v); }
    }
    return out;
  }

  const FN = {
    SUM: (a, si) => flat(a, si, true).reduce((x, y) => x + y, 0),
    AVERAGE: (a, si) => { const v = flat(a, si, true); if (!v.length) throw E('#DIV/0!'); return v.reduce((x, y) => x + y, 0) / v.length; },
    MIN: (a, si) => { const v = flat(a, si, true); return v.length ? v.reduce((x, y) => (y < x ? y : x)) : 0; },
    MAX: (a, si) => { const v = flat(a, si, true); return v.length ? v.reduce((x, y) => (y > x ? y : x)) : 0; },
    COUNT: (a, si) => flat(a, si, true).length,
    COUNTA: (a, si) => flat(a, si, false).length,
    PRODUCT: (a, si) => flat(a, si, true).reduce((x, y) => x * y, 1),
    MEDIAN: (a, si) => { const v = flat(a, si, true).sort((x, y) => x - y); if (!v.length) throw E('#NUM!'); const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; },
    ABS: (a, si) => Math.abs(num(evalAst(a[0], si))),
    SQRT: (a, si) => { const n = num(evalAst(a[0], si)); if (n < 0) throw E('#NUM!'); return Math.sqrt(n); },
    INT: (a, si) => Math.floor(num(evalAst(a[0], si))),
    ROUND: (a, si) => { // half away from zero, like Excel: ROUND(-2.5,0) = -3
      const n = num(evalAst(a[0], si)), d = Math.trunc(a[1] ? num(evalAst(a[1], si)) : 0); const f = 10 ** d;
      const x = Math.abs(n) * f;
      return (Math.sign(n) * Math.round(x * (1 + Number.EPSILON))) / f;
    },
    POWER: (a, si) => num(evalAst(a[0], si)) ** num(evalAst(a[1], si)),
    MOD: (a, si) => { const d = num(evalAst(a[1], si)); if (d === 0) throw E('#DIV/0!'); const n = num(evalAst(a[0], si)); return n - d * Math.floor(n / d); },
    LEN: (a, si) => str(evalAst(a[0], si)).length,
    UPPER: (a, si) => str(evalAst(a[0], si)).toUpperCase(),
    LOWER: (a, si) => str(evalAst(a[0], si)).toLowerCase(),
    TRIM: (a, si) => str(evalAst(a[0], si)).trim().replace(/\s+/g, ' '),
    CONCAT: (a, si) => flat(a, si, false).map(str).join(''),
    CONCATENATE: (a, si) => flat(a, si, false).map(str).join(''),
    IF: (a, si) => (bool(evalAst(a[0], si)) ? evalAst(a[1] || { t: 'num', v: true }, si) : a[2] ? evalAst(a[2], si) : false),
    IFERROR: (a, si) => { try { const v = evalAst(a[0], si); if (isErr(v)) throw v; return v; } catch (e) { if (isErr(e)) return evalAst(a[1], si); throw e; } },
    AND: (a, si) => flat(a, si, false).every(bool),
    OR: (a, si) => flat(a, si, false).some(bool),
    NOT: (a, si) => !bool(evalAst(a[0], si)),
    TODAY: () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }, // local date
    SUMIF: (a, si) => {
      const rng = evalAst(a[0], si); const test = criteriaFn(evalAst(a[1], si)); const sumR = a[2] ? evalAst(a[2], si) : rng;
      if (!rng.__range) throw E('#VALUE!');
      return rng.values.reduce((t, v, i) => (test(v) && typeof sumR.values[i] === 'number' ? t + sumR.values[i] : t), 0);
    },
    COUNTIF: (a, si) => { const rng = evalAst(a[0], si); const test = criteriaFn(evalAst(a[1], si)); if (!rng.__range) throw E('#VALUE!'); return rng.values.filter(test).length; }
  };

  function evalAst(n, si) {
    switch (n.t) {
      case 'num': case 'str': return n.v;
      case 'ref': { const s = n.sheet ? byName(n.sheet) : si; return cellValue(s, n.r, n.c); }
      case 'range': {
        const s = n.sheet ? byName(n.sheet) : si; const values = [];
        const rows = sheets[s].rows;
        const r2 = n.r2 >= ALL ? rows.length - 1 : n.r2; // a whole column covers the rows that exist
        let c2 = n.c2;
        if (c2 >= ALL) { c2 = -1; for (let r = n.r1; r <= Math.min(r2, rows.length - 1); r++) if (rows[r] && rows[r].length - 1 > c2) c2 = rows[r].length - 1; }
        for (let r = n.r1; r <= r2; r++) for (let c = n.c1; c <= c2; c++) values.push(cellValue(s, r, c));
        return { __range: true, values };
      }
      case 'neg': return -num(evalAst(n.e, si));
      case 'bin': {
        const l = evalAst(n.l, si), r = evalAst(n.r, si);
        if (isErr(l)) throw l; if (isErr(r)) throw r;
        const lv = l && l.__range ? l.values[0] : l, rv = r && r.__range ? r.values[0] : r;
        switch (n.op) {
          case '+': return num(lv) + num(rv);
          case '-': return num(lv) - num(rv);
          case '*': return num(lv) * num(rv);
          case '/': { const d = num(rv); if (d === 0) throw E('#DIV/0!'); return num(lv) / d; }
          case '^': return num(lv) ** num(rv);
          case '&': return str(lv) + str(rv);
          default: {
            const both = typeof lv === 'number' && typeof rv === 'number';
            const a = both ? lv : str(lv).toLowerCase(), b = both ? rv : str(rv).toLowerCase();
            return { '=': a === b, '<>': a !== b, '<': a < b, '>': a > b, '<=': a <= b, '>=': a >= b }[n.op];
          }
        }
      }
      case 'fn': { const f = FN[n.name]; if (!f) throw E('#NAME?'); return f(n.args, si); }
      default: throw E('#VALUE!');
    }
  }

  return (si, r, c) => cellValue(si, r, c);
}

export function formatValue(v) {
  if (isErr(v)) return v.code;
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') { if (Number.isInteger(v)) return String(v); const s = String(Number(v.toPrecision(12))); return s; }
  return v == null ? '' : String(v);
}
