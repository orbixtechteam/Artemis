// run_command: runs a shell command on the user's machine. Not a sandbox: the blocklist only catches common destructive
// mistakes; the user's approval is the real guard. The blocklist is the user's (Settings → Advanced): each rule can be
// switched off, own rules can be added, or the whole list turned off. setPolicy() takes { off, disabled: [ids], extra: [{ pattern, why }] }.
const { exec } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

const INTERP = '(?:sh|bash|zsh|dash|ksh|fish|python[0-9.]*|perl|ruby|node|php|osascript)';
const BLOCKED = [
  ['sudo', /\b(sudo|doas)\b/, 'sudo is not allowed'],
  ['mkfs', /\bmkfs(\.|\b)/, 'formatting disks is not allowed'],
  ['dd-device', /\bdd\s+[^|;&]*\bof=\/dev\//, 'writing to devices is not allowed'],
  ['fork-bomb', /:\(\)\s*\{/, 'fork bombs are not allowed'],
  ['shutdown', /\b(shutdown|reboot|halt)\b/, 'shutdown/reboot is not allowed'],
  ['curl-pipe', new RegExp('\\b(curl|wget)\\b[^;&]*\\|\\s*(env\\s+)?' + INTERP + '\\b'), 'piping downloads into a shell or interpreter is not allowed'],
  ['curl-subst', new RegExp('\\b(' + INTERP.slice(3, -1) + '|source|\\.)\\s+(-\\S+\\s+)*<\\(\\s*(curl|wget)\\b'), 'running a download through process substitution is not allowed'],
  ['eval-download', /(\beval|\s-c)\s+\$\(\s*(curl|wget)\b/, 'running a download is not allowed'],
  ['decode-pipe', new RegExp('\\b(base64|base32|xxd|openssl)\\b[^;&]*\\s(-d|-D|--decode|-r)\\b[^;&]*\\|\\s*(env\\s+)?' + INTERP + '\\b'), 'piping decoded content into a shell or interpreter is not allowed']
];
const SHELLS = /^(sh|bash|zsh|dash|ksh|fish)$/;

// Protected targets for recursive delete / find -delete: /, ~, and top-level system folders.
const PROTECTED = /^(\/|~\/?|\/\*|~\/\*|\/\.|~\/\.)$|^\/(Users|home|System|Applications|Library|bin|sbin|usr|etc|var|private|opt|Volumes)\/?\*?$|^~\/(Documents|Desktop|Downloads|Library|Pictures|Movies|Music)\/?\*?$/;

/** Flattens quoting and spellings of home so the checks see one form: "$HOME" / ${HOME} / /Users/me -> ~, --recursive -> -r. */
function normalize(cmd) {
  const home = os.homedir();
  let s = String(cmd).replace(/\\\n/g, ' ').replace(/["'`\\]/g, '');
  s = s.replace(/\$\{HOME\}|\$HOME\b/g, '~');
  if (home && home.length > 1) s = s.split(home).join('~');
  s = s.replace(/(^|[\s=])\/(Users|home)\/[^\s/;&|]+(?=\/|\s|$|[;&|])/g, '$1~');
  s = s.replace(/--recursive\b/g, '-r').replace(/--force\b/g, '-f').replace(/--dir\b/g, '-d').replace(/--no-preserve-root\b/g, '-f');
  s = s.replace(/~\/+/g, '~/').replace(/\/{2,}/g, '/');
  return s;
}

// the checks below the list, with their ids, so they can be switched off one by one
const CHECKS = [
  ['rm-protected', 'recursive delete of / or ~ is not allowed'],
  ['chmod-protected', 'recursive chmod/chown of / or ~ is not allowed'],
  ['find-home', 'find over the whole home folder, ~/Library or / (without -maxdepth)'],
  ['find-delete', 'deleting with find in / or ~ is not allowed']
];
/** Every built-in rule, for Settings: { id, why }. */
const RULES = [...BLOCKED.map(([id, , why]) => ({ id, why })), ...CHECKS.map(([id, why]) => ({ id, why }))];

let policy = { off: false, disabled: new Set(), extra: [] };
function setPolicy(p) {
  const o = p && typeof p === 'object' ? p : {};
  const extra = [];
  for (const x of Array.isArray(o.extra) ? o.extra : []) {
    const pat = String((x && x.pattern) || '').trim();
    if (!pat) continue;
    try { extra.push([new RegExp(pat, 'i'), String((x && x.why) || '').trim() || `blocked by your rule "${pat}"`]); } catch {} // a broken pattern is skipped
  }
  policy = { off: !!o.off, disabled: new Set(Array.isArray(o.disabled) ? o.disabled.map(String) : []), extra };
}

// where the policy comes from (the settings file); read at most every 2 s
let source = null, readAt = 0, lastJson = '';
function setSource(fn) { source = fn; readAt = 0; }
function refresh() { readAt = 0; }
function current() {
  if (source && Date.now() - readAt > 2000) {
    readAt = Date.now();
    try { const p = source() || {}; const j = JSON.stringify(p); if (j !== lastJson) { lastJson = j; setPolicy(p); } } catch {}
  }
  return policy;
}

/** Why a command is blocked, or '' if it is not. */
function blockedReason(command) {
  const policy = current();
  if (policy.off) return '';
  const on = (id) => !policy.disabled.has(id);
  const s = normalize(command);
  for (const [re, why] of policy.extra) if (re.test(s) || re.test(String(command))) return why;
  for (const [id, re, why] of BLOCKED) if (on(id) && (re.test(s) || re.test(String(command)))) return why;
  for (const seg of s.split(/;|&&|\|\||\||&|\n|\$\(|`/)) {
    let t = seg.trim().split(/\s+/).filter(Boolean);
    for (;;) {
      if (t.length && /^(\w+=\S*|command|builtin|exec|nohup|time|xargs|env|nice)$/.test(t[0])) { t = t.slice(1); continue; }
      // "bash -c rm -rf /" (quotes already stripped): check the wrapped command itself
      const sh = t.length && SHELLS.test(t[0].replace(/^.*\//, '')) ? t.slice(1).findIndex((x) => /^-\w*c\w*$/.test(x)) : -1;
      if (sh >= 0) { t = t.slice(sh + 2); continue; }
      break;
    }
    if (!t.length) continue;
    const cmd = t[0].replace(/^.*\//, '');
    const flags = t.slice(1).filter((x) => /^-[^-]/.test(x)).join('');
    const targets = t.slice(1).filter((x) => !x.startsWith('-'));
    if (on('rm-protected') && cmd === 'rm' && /[rR]/.test(flags) && targets.some((x) => PROTECTED.test(x))) return 'recursive delete of / or ~ is not allowed';
    if (on('chmod-protected') && (cmd === 'chmod' || cmd === 'chown') && /R/.test(flags) && targets.some((x) => PROTECTED.test(x))) return 'recursive chmod/chown of / or ~ is not allowed';
    if (on('find-home') && cmd === 'find' && !t.includes('-maxdepth') && /^(~\/?|\$HOME\/?|~\/Library\/?|\$HOME\/Library\/?|\/Users\/[^/]+\/?|\/Users\/[^/]+\/Library\/?|\/)$/.test(targets[0] || '')) return 'find over the whole home folder, ~/Library or / takes minutes and hangs; search a specific folder or add -maxdepth (for Artemis Files use the folder shown by library_list)';
    if (on('find-delete') && cmd === 'find' && (t.includes('-delete') || /-exec(dir)?\s+rm\b/.test(t.join(' '))) && targets.some((x) => PROTECTED.test(x))) return 'deleting with find in / or ~ is not allowed';
  }
  return '';
}

const clip = (s, n) => (s.length > n ? s.slice(0, n) + `\n…[truncated, ${s.length} characters total]` : s);

function runCommand({ command, cwd, timeout_seconds }, { signal, defaultCwd } = {}) {
  return new Promise((resolve) => {
    const cmd = String(command || '').trim();
    if (!cmd) return resolve({ ok: false, text: 'Error: command is empty' });
    const why = blockedReason(cmd);
    if (why) return resolve({ ok: false, text: `Error: blocked — ${why}.` });

    const dir = cwd ? path.resolve(defaultCwd || os.homedir(), cwd) : (defaultCwd || os.homedir());
    if (!fs.existsSync(dir)) return resolve({ ok: false, text: `Error: directory not found: ${dir}` });
    const timeout = Math.min(Math.max(Number(timeout_seconds) || 60, 1), 300) * 1000;

    // The command runs in its own process group so a timeout or cancel kills its children too (a hung find / python), not only the shell.
    const group = process.platform !== 'win32';
    let timedOut = false, timer = null;
    const killTree = (sig = 'SIGKILL') => { try { if (group && child.pid) process.kill(-child.pid, sig); else child.kill(sig); } catch { try { child.kill(sig); } catch {} } };
    // if a grandchild still holds the output pipes after the kill, close them so the call returns instead of waiting for it
    const killTree2 = () => { killTree(); setTimeout(() => { try { child.stdout && child.stdout.destroy(); child.stderr && child.stderr.destroy(); } catch {} }, 400); };
    const onAbort = () => killTree2();
    const child = exec(cmd, {
      cwd: dir, maxBuffer: 10 * 1024 * 1024, detached: group,
      shell: process.env.SHELL || '/bin/sh', env: { ...process.env, TERM: 'dumb', NO_COLOR: '1' }
    }, (err, stdout, stderr) => {
      clearTimeout(timer); if (signal) signal.removeEventListener('abort', onAbort);
      let code = 0, note = '';
      if (err) {
        if (signal?.aborted) return resolve({ ok: false, text: 'Error: command cancelled.' });
        if (timedOut) note = `\n(timed out after ${timeout / 1000}s and was killed)`;
        code = typeof err.code === 'number' ? err.code : 1;
      }
      const out = clip(stdout || '', 24000), er = clip(stderr || '', 8000);
      resolve({
        ok: code === 0 && !note,
        text: `cwd: ${dir}\nexit code: ${code}${note}\n--- stdout ---\n${out || '(empty)'}\n--- stderr ---\n${er || '(empty)'}`
      });
    });
    timer = setTimeout(() => { timedOut = true; killTree2(); }, timeout);
    if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }
  });
}

module.exports = { runCommand, BLOCKED, RULES, blockedReason, normalize, setPolicy, setSource, refresh, policy: () => current() };
