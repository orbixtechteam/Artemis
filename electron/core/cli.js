// `artemis` command line: run the headless gateway, or talk to a running one (desktop or headless).
// No dependencies; needs Node.js 22.13+ for the gateway (node:sqlite), any Node 18+ for the client commands.
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const readline = require('readline');
const { defaultDataDir } = require('./paths');

const HELP = `Artemis command line

  artemis gateway [--port 8789] [--host 127.0.0.1] [--allow-shell] [--no-keychain]
                  [--no-scheduler] [--no-telegram] [--no-connectors] [--no-browser] [--no-computer]
        Run Artemis headless: the agent, chats, memory, scheduled tasks, Telegram and connectors behind the
        gateway API. Can run next to the app on the same data folder (it then takes over the background jobs).
        run_command uses the sandbox from Settings (Docker/SSH); --allow-shell lets it run on this machine.
  artemis status                         Is a gateway running? Which model?
  artemis chat [message] [-s id] [-m model] [--project id] [--json]
        Send a message (or start an interactive chat when no message is given).
  artemis sessions [-n 20]               Recent chats
  artemis show <id> [-n 20]              Last turns of a chat
  artemis search <words>                 Full-text search over saved chats
  artemis memory search <words>          Search long-term memory (MEMORY.md, USER.md, daily notes)
  artemis memory list | add <text> | note <text>
  artemis token                          Print the gateway address and token

Options: --data <folder> (default: the desktop app's data folder, or $ARTEMIS_HOME)
Remote gateway: set ARTEMIS_GATEWAY_URL and ARTEMIS_GATEWAY_TOKEN.
Provider keys for the headless gateway: read from the desktop app's saved keys (macOS keychain),
or ARTEMIS_KEY_<PROVIDER_ID>=..., or <data>/headless.json { "keys": { "<providerId>": "..." } }.`;

function parseArgs(argv) {
  const out = { _: [] };
  const alias = { s: 'session', m: 'model', n: 'limit', h: 'help' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { out._.push(...argv.slice(i + 1)); break; }
    const m = /^--?([a-z][\w-]*)(?:=(.*))?$/i.exec(a);
    if (!m) { out._.push(a); continue; }
    let k = alias[m[1]] || m[1];
    if (k.startsWith('no-')) { out[k.slice(3)] = false; continue; }
    if (['allow-shell', 'json', 'help'].includes(k)) { out[k] = true; continue; }
    out[k] = m[2] !== undefined ? m[2] : argv[++i];
  }
  return out;
}

const c = process.stderr.isTTY ? { dim: (s) => `\x1b[2m${s}\x1b[0m`, red: (s) => `\x1b[31m${s}\x1b[0m`, yel: (s) => `\x1b[33m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m` } : { dim: (s) => s, red: (s) => s, yel: (s) => s, bold: (s) => s };
const die = (msg, code = 1) => { process.stderr.write(c.red(msg) + '\n'); process.exit(code); };

function endpoint(opts) {
  if (process.env.ARTEMIS_GATEWAY_URL) return { base: process.env.ARTEMIS_GATEWAY_URL.replace(/\/+$/, ''), token: process.env.ARTEMIS_GATEWAY_TOKEN || '' };
  const dataDir = opts.data ? path.resolve(opts.data) : defaultDataDir();
  const { readDiscovery } = require('./gateway');
  const d = readDiscovery(path.join(dataDir, 'gateway.json'));
  if (!d) die(`No Artemis gateway is running for ${dataDir}.\nStart one with "artemis gateway", or turn on Settings → Access → Gateway in the desktop app.`);
  return { base: `http://${d.host || '127.0.0.1'}:${d.port}`, token: d.token, mode: d.mode };
}

function request(ep, method, p, body, { onEvent } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(ep.base + p);
    const lib = u.protocol === 'https:' ? https : http;
    const data = body ? JSON.stringify(body) : null;
    const req = lib.request(u, { method, headers: { authorization: `Bearer ${ep.token}`, ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}) } }, (res) => {
      if (onEvent && /event-stream/.test(res.headers['content-type'] || '')) {
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          buf += chunk;
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, i); buf = buf.slice(i + 2);
            let ev = 'message', d = '';
            for (const line of block.split('\n')) { if (line.startsWith('event: ')) ev = line.slice(7); else if (line.startsWith('data: ')) d += line.slice(6); }
            if (!d) continue;
            try { onEvent(ev, JSON.parse(d)); } catch {}
          }
        });
        res.on('end', () => resolve({ ok: true }));
        return;
      }
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (x) => { raw += x; });
      res.on('end', () => { let j = null; try { j = JSON.parse(raw); } catch {} if (res.statusCode >= 400) reject(new Error((j && j.error) || `HTTP ${res.statusCode}`)); else resolve(j); });
    });
    req.on('error', (e) => reject(new Error(e.code === 'ECONNREFUSED' ? 'The gateway is not answering (is it still running?)' : e.message)));
    if (data) req.write(data);
    req.end();
  });
}

/** Sends one message and prints the answer as it streams. Approvals are asked on the terminal. */
async function chatOnce(ep, { message, session, model, project, json, ask, onRun }) {
  let result = null, runId = null, printed = false, lastAgent = '';
  await request(ep, 'POST', '/v1/chat', { message, session_id: session || undefined, model: model || undefined, project_id: project || undefined }, {
    onEvent: async (ev, d) => {
      if (json) { process.stdout.write(JSON.stringify({ event: ev, ...d }) + '\n'); if (ev === 'done') result = d; if (ev === 'run') runId = d.run_id; return; }
      switch (ev) {
        case 'run': runId = d.run_id; if (onRun) onRun(runId); break;
        case 'chunk': if (d.agent) { const n = (d.agent && d.agent.name) || 'agent'; if (n !== lastAgent) { process.stderr.write(c.dim(`\n[${n}] `)); lastAgent = n; } break; } process.stdout.write(d.text); printed = true; break;
        case 'step:new': if (printed) process.stdout.write('\n'); break;
        case 'tool:call': process.stderr.write(c.dim(`\n· ${d.name}${d.args && d.args.path ? ' ' + d.args.path : d.args && d.args.query ? ' ' + d.args.query : d.args && d.args.command ? ' ' + String(d.args.command).slice(0, 80) : ''}\n`)); break;
        case 'notice': process.stderr.write(c.yel(`\n${d.text}\n`)); break;
        case 'error': process.stderr.write(c.red(`\nError: ${d.message}\n`)); break;
        case 'tool:approval': {
          const ok = ask ? await ask(`${d.session ? 'Allow for this task' : 'Allow'}: ${d.summary || d.category}? [y/N] `) : false;
          try { await request(ep, 'POST', `/v1/approvals/${encodeURIComponent(d.id)}`, { approve: ok }); } catch (e) { process.stderr.write(c.red(e.message + '\n')); }
          break;
        }
        case 'done': result = d; break;
        default:
      }
    }
  });
  if (!json && printed) process.stdout.write('\n');
  return { result, runId };
}

function prompter() {
  if (!process.stdin.isTTY) return null;
  return (q) => new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    rl.question(c.bold(q), (a) => { rl.close(); resolve(/^y(es)?$/i.test(a.trim())); });
  });
}

async function repl(ep, opts) {
  let session = opts.session || '';
  process.stderr.write(c.dim('Artemis chat. /new starts a new chat, /exit quits, Ctrl+C stops a running answer.\n'));
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: true });
  let running = null;
  rl.on('SIGINT', async () => { if (running) { try { await request(ep, 'POST', `/v1/runs/${running}/abort`); } catch {} process.stderr.write(c.yel('\n(stopped)\n')); } else { rl.close(); } });
  const ask = (q) => new Promise((resolve) => rl.question(c.bold(q), (a) => resolve(/^y(es)?$/i.test(a.trim()))));
  const next = () => rl.question(c.bold('\n› '), async (line) => {
    const text = line.trim();
    if (!text) return next();
    if (text === '/exit' || text === '/quit') return rl.close();
    if (text === '/new') { session = ''; process.stderr.write(c.dim('New chat.\n')); return next(); }
    try {
      const { result } = await chatOnce(ep, { message: text, session, model: opts.model, project: opts.project, ask, onRun: (id) => { running = id; } });
      if (result && result.session_id) session = result.session_id;
    } catch (e) { process.stderr.write(c.red(e.message + '\n')); }
    running = null;
    next();
  });
  next();
  await new Promise((r) => rl.on('close', r));
}

async function main(argv) {
  const opts = parseArgs(argv);
  const [cmd, ...rest] = opts._;
  if (!cmd || opts.help || cmd === 'help') { process.stdout.write(HELP + '\n'); return; }

  if (cmd === 'gateway') {
    const { createHeadless } = require('./headless');
    const dataDir = opts.data ? path.resolve(opts.data) : defaultDataDir();
    fs.mkdirSync(dataDir, { recursive: true });
    const host = opts.host || '127.0.0.1';
    if (host !== '127.0.0.1' && host !== 'localhost') process.stderr.write(c.yel(`Listening on ${host}: anyone who can reach this address and has the token can use your agent. Put it behind TLS (a tunnel or reverse proxy).\n`));
    let h;
    try { h = createHeadless({ dataDir, host, port: opts.port, allowShell: !!opts['allow-shell'], keychain: opts.keychain !== false, scheduler: opts.scheduler !== false, telegram: opts.telegram !== false, connectors: opts.connectors !== false, browser: opts.browser !== false, computer: opts.computer !== false, log: (lv, area, m) => { if (lv !== 'debug' || process.env.ARTEMIS_DEBUG) process.stderr.write(c.dim(`[${area}] `) + m + '\n'); } }); }
    catch (e) { die(e.message); }
    let addr;
    try { addr = await h.start(); } catch (e) { die(e.code === 'EADDRINUSE' ? `Port ${opts.port || 8789} is in use. Use --port.` : e.message); }
    process.stderr.write(`${c.bold('Artemis gateway')} on http://${addr.host}:${addr.port} · data ${dataDir}\n`);
    const sb = h.sandbox();
    process.stderr.write(c.dim(`model ${h.pickModel('') || '(none: add a provider in the desktop app)'} · commands ${sb ? 'in ' + sb.mode + ' sandbox' : opts['allow-shell'] ? 'ON this machine' : 'off'} · browser ${opts.browser !== false && h.browserAvailable() ? 'on' : 'off (needs playwright-core)'} · scheduler ${opts.scheduler !== false ? 'on' : 'off'} · memory ${h.workspace ? h.workspace.dir : 'off'}\n`));
    if (addr.appRunning) process.stderr.write(c.dim('The desktop app is running on this folder: it hands over scheduled tasks, Telegram and the gateway API to this process.\n'));
    let stopping = false;
    const stop = async () => { if (stopping) return; stopping = true; process.stderr.write('\nStopping…\n'); try { await h.stop(); } catch {} process.exit(0); };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
    return;
  }

  const ep = endpoint(opts);
  switch (cmd) {
    case 'status': {
      const i = await request(ep, 'GET', '/v1/health');
      const r = await request(ep, 'GET', '/v1/runs');
      const yn = (v) => (v ? (v === true ? 'yes' : v) : 'no');
      process.stdout.write(`${i.mode} gateway v${i.version} at ${ep.base}\nmodel: ${i.model || '-'}\nsqlite: ${yn(i.sqlite)} · memory workspace: ${yn(i.memory)}${i.shell !== undefined ? ' · commands: ' + yn(i.shell) : ''}${i.browser !== undefined ? ' · browser: ' + yn(i.browser) : ''}${i.telegram !== undefined ? ' · telegram: ' + yn(i.telegram) : ''}\nrunning tasks: ${r.runs.length}\n`);
      return;
    }
    case 'token': process.stdout.write(`${ep.base}\n${ep.token}\n`); return;
    case 'chat': {
      const message = rest.join(' ').trim() || (!process.stdin.isTTY ? fs.readFileSync(0, 'utf8').trim() : '');
      if (!message) return repl(ep, opts);
      const { result } = await chatOnce(ep, { message, session: opts.session, model: opts.model, project: opts.project, json: !!opts.json, ask: prompter() });
      if (result && !opts.json) process.stderr.write(c.dim(`session ${result.session_id}  (continue with: artemis chat -s ${result.session_id} "...")\n`));
      return;
    }
    case 'sessions': {
      const r = await request(ep, 'GET', `/v1/sessions?limit=${Number(opts.limit) || 20}`);
      if (opts.json) return process.stdout.write(JSON.stringify(r.sessions, null, 2) + '\n');
      for (const s of r.sessions) process.stdout.write(`${s.id.padEnd(22)} ${s.date}  ${s.title}${s.project ? c.dim(' · ' + s.project) : ''}\n`);
      return;
    }
    case 'show': {
      if (!rest[0]) die('Usage: artemis show <id>');
      const r = await request(ep, 'GET', `/v1/sessions/${encodeURIComponent(rest[0])}?last=${Number(opts.limit) || 20}`);
      process.stdout.write(c.bold(r.title || r.id) + '\n\n');
      for (const t of r.turns) process.stdout.write(`${t.role === 'user' ? c.bold('You') : c.bold('Artemis')}: ${t.content}\n\n`);
      return;
    }
    case 'search': {
      const q = rest.join(' ');
      if (!q) die('Usage: artemis search <words>');
      const r = await request(ep, 'GET', `/v1/search?q=${encodeURIComponent(q)}&limit=${Number(opts.limit) || 10}`);
      if (!r.hits.length) return process.stdout.write('No saved chat matches.\n');
      for (const h of r.hits) process.stdout.write(`${c.bold(h.title)} ${c.dim(h.id + ' · ' + h.date)}\n  ${h.snippet}\n`);
      return;
    }
    case 'memory': {
      const [sub, ...words] = rest;
      const text = words.join(' ');
      if (sub === 'search') { const r = await request(ep, 'GET', `/v1/memory?q=${encodeURIComponent(text)}&limit=${Number(opts.limit) || 6}`); if (!r.hits.length) return process.stdout.write('Nothing found.\n'); for (const h of r.hits) process.stdout.write(`${c.bold(h.path + ':' + h.from + '-' + h.to)} ${c.dim(String(h.score))}\n${h.text}\n\n`); return; }
      if (sub === 'list') { const r = await request(ep, 'GET', '/v1/memory/list'); for (const e of r.entries) process.stdout.write(`${c.dim(e.id)}  ${e.text}\n`); return; }
      if (sub === 'add') { if (!text) die('Usage: artemis memory add <text>'); const r = await request(ep, 'POST', '/v1/memory', { text }); process.stdout.write(r.entry.duplicate ? `Already saved (${r.entry.id}).\n` : `Saved (${r.entry.id}).\n`); return; }
      if (sub === 'note') { if (!text) die('Usage: artemis memory note <text>'); const r = await request(ep, 'POST', '/v1/memory/note', { text }); process.stdout.write(`Added to ${r.path}.\n`); return; }
      die('Usage: artemis memory search|list|add|note ...');
      return;
    }
    default: die(`Unknown command "${cmd}". Run "artemis help".`);
  }
}

module.exports = { main, parseArgs };
