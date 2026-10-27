// Sandboxed run_command: commands run in a Docker container, on another machine over SSH, or on this computer inside the OS sandbox.
//   docker: one long-lived container per project folder, the folder mounted at /workspace, no extra capabilities,
//           memory/CPU/process limits, network on or off. The container is reused between commands (installed packages stay).
//   ssh:    commands run on another machine (`ssh host`), in a folder there. Files are not synced.
//   native: commands run here, under sandbox-exec (macOS) or bwrap (Linux): writes only to the project folder, temp and caches.
// Same result shape as shell.runCommand: { ok, text }.
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { blockedReason } = require('../shell');

const clip = (s, n) => (s.length > n ? s.slice(0, n) + `\n…[truncated, ${s.length} characters total]` : s);
const q = (s) => "'" + String(s).replace(/'/g, `'\\''`) + "'";

/** Runs a program; resolves { code, stdout, stderr, error }. Never rejects. */
function runProc(cmd, args, { timeoutMs = 0, signal, input, spawnImpl = spawn, onData, cwd, env, group = false } = {}) {
  return new Promise((resolve) => {
    let out = '', err = '', done = false, timer = null;
    let child;
    // group: the program gets its own process group, so a timeout or Stop kills everything it started
    try { child = spawnImpl(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], ...(cwd ? { cwd } : {}), ...(env ? { env } : {}), ...(group ? { detached: true } : {}) }); } catch (e) { return resolve({ code: 127, stdout: '', stderr: '', error: e.message }); }
    const kill = () => { try { if (group && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} } };
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); if (signal) signal.removeEventListener('abort', onAbort); resolve(r); };
    const onAbort = () => { kill(); finish({ code: 130, stdout: out, stderr: err, error: 'cancelled' }); };
    child.stdout.on('data', (d) => { if (out.length < 4e6) out += d; if (onData) { try { onData(String(d), 'out'); } catch {} } });
    child.stderr.on('data', (d) => { if (err.length < 1e6) err += d; if (onData) { try { onData(String(d), 'err'); } catch {} } });
    child.on('error', (e) => finish({ code: 127, stdout: out, stderr: err, error: e.code === 'ENOENT' ? `${cmd} is not installed or not on PATH` : e.message }));
    child.on('close', (code, sig) => finish({ code: code != null ? code : sig === 'SIGKILL' ? 137 : sig === 'SIGTERM' ? 143 : 1, stdout: out, stderr: err }));
    if (timeoutMs) timer = setTimeout(() => { kill(); finish({ code: 124, stdout: out, stderr: err, error: 'timeout' }); }, timeoutMs);
    if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }
    if (input != null) child.stdin.end(input); else child.stdin.end();
  });
}

// ---- native: this computer, inside the OS sandbox (macOS Seatbelt via sandbox-exec, Linux bubblewrap) ----
// Commands can read the disk but write only to the project folder, temp folders, package caches and the extra folders from
// Settings. Folders with keys and logins are hidden. Network on or off.
const SECRET_DIRS = ['.ssh', '.aws', '.gnupg', '.kube', '.docker', '.config/gh', '.config/gcloud', 'Library/Keychains'];
const CACHE_DIRS = ['.npm', '.cache', '.pnpm-store', '.yarn', '.local/share/pnpm', 'Library/pnpm', 'Library/Caches'];
const realOr = (p) => { try { return fs.realpathSync(p); } catch { return null; } };
const sbStr = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

/** The folders a native-sandboxed command may write to, and the ones it may not see. Only folders that exist are listed. */
function nativePaths(root, { platform = process.platform, home = os.homedir(), writable = [] } = {}) {
  const expand = (p) => (p === '~' ? home : p.startsWith('~/') ? path.join(home, p.slice(2)) : p);
  const w = [root, os.tmpdir(), '/tmp', ...(platform === 'darwin' ? ['/private/var/folders'] : []), ...CACHE_DIRS.map((d) => path.join(home, d)), ...writable.map(expand)];
  return { writable: [...new Set(w.map(realOr).filter(Boolean))], hidden: [...new Set(SECRET_DIRS.map((d) => realOr(path.join(home, d))).filter(Boolean))] };
}

/** Seatbelt profile: everything allowed except writes outside `writable`, anything inside `hidden`, and (optionally) the network. */
function seatbeltProfile({ writable, hidden, network }) {
  const sub = (list) => list.map((p) => `(subpath ${sbStr(p)})`).join(' ');
  return [
    '(version 1)',
    '(allow default)',
    '(deny file-write*)',
    `(allow file-write* ${sub(writable)} (literal "/dev/null") (literal "/dev/zero") (literal "/dev/tty") (literal "/dev/dtracehelper") (regex #"^/dev/fd/") (regex #"^/dev/ttys"))`,
    ...(hidden.length ? [`(deny file-read* file-write* ${sub(hidden)})`] : []),
    ...(network ? [] : ['(deny network-outbound (remote ip "*:*"))', '(deny network-inbound (local ip "*:*"))'])
  ].join('\n');
}

/** bubblewrap arguments: the whole disk read-only, `writable` mounted read-write, `hidden` covered by an empty folder. */
function bwrapArgs({ writable, hidden, network, cwd, command }) {
  return ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc',
    ...writable.flatMap((p) => ['--bind', p, p]),
    ...hidden.flatMap((p) => ['--tmpfs', p]),
    '--unshare-pid', '--die-with-parent', '--new-session', ...(network ? [] : ['--unshare-net']),
    '--chdir', cwd, '/bin/sh', '-c', command];
}

/**
 * cfg: { mode: 'docker' | 'ssh' | 'native', image, network (bool), memory ('2g'), cpus ('2'), sshHost, sshDir, docker ('docker' binary),
 *        writable (extra folders, native), platform/home/sandboxExec/bwrap (native, for tests), log? }
 */
function createSandbox(cfg, { run = runProc } = {}) {
  const mode = cfg.mode;
  const log = cfg.log || (() => {});
  const docker = cfg.docker || 'docker';
  const image = cfg.image || 'node:22-bookworm';
  const ready = new Map(); // container name -> Promise

  const rootTag = (root) => crypto.createHash('sha1').update(path.resolve(root)).digest('hex').slice(0, 12);
  const nameFor = (root) => 'artemis-sb-' + crypto.createHash('sha1').update(path.resolve(root) + '|' + image + '|' + (cfg.network === false ? 'nonet' : 'net')).digest('hex').slice(0, 12);

  /** Makes sure the project's container runs. say(line) reports each step (Settings → Test shows them live). */
  async function ensure(root, say = () => {}) {
    const name = nameFor(root);
    if (!ready.has(name)) {
      ready.set(name, (async () => {
        say(`Checking container ${name}…`);
        const st = await run(docker, ['inspect', '-f', '{{.State.Running}}', name], { timeoutMs: 20000 });
        if (st.error && /not installed/.test(st.error)) throw new Error('Docker is not installed (or not on PATH). Install Docker Desktop / OrbStack, or turn the sandbox off in Settings → Tools.');
        if (st.code !== 0 && /Cannot connect|daemon/i.test(st.stderr || '')) throw new Error('Docker is installed but not running. Start Docker Desktop / OrbStack and try again.');
        if (st.code === 0 && st.stdout.trim() === 'true') { say('Container is running.'); return name; }
        if (st.code === 0) {
          say('Container exists but is stopped: starting it…');
          const r = await run(docker, ['start', name], { timeoutMs: 60000 });
          if (r.code === 0) { say('Container started.'); return name; }
          say('It did not start (' + (r.stderr || r.error || '').trim().slice(0, 200) + '), so it is created again.');
          await run(docker, ['rm', '-f', name], { timeoutMs: 30000 });
        }
        // the image: pulled on its own first, so its progress can be shown
        const img = await run(docker, ['image', 'inspect', image, '--format', '{{.Id}}'], { timeoutMs: 20000 });
        if (img.code !== 0) {
          say(`Image ${image} is not on this computer yet: downloading it (only the first time; parts already downloaded are kept)…`);
          let last = '';
          const pull = await run(docker, ['pull', image], { timeoutMs: 30 * 60000, onData: (d) => {
            for (const line of String(d).split(/\r?\n|\r/)) { const l = line.trim(); if (l && l !== last) { last = l; say('  ' + l); } }
          } });
          if (pull.code !== 0) throw new Error('Could not download the image: ' + (pull.stderr || pull.error || '').trim().slice(-600));
          say('Image downloaded.');
        } else say(`Image ${image} is already here.`);
        const args = ['run', '-d', '--name', name, '--label', 'artemis.sandbox=1', '--label', `artemis.root=${rootTag(root)}`, '--init',
          '-v', `${path.resolve(root)}:/workspace`, '-w', '/workspace',
          '--memory', String(cfg.memory || '2g'), '--cpus', String(cfg.cpus || '2'), '--pids-limit', '512',
          '--cap-drop', 'ALL', '--cap-add', 'CHOWN', '--cap-add', 'DAC_OVERRIDE', '--cap-add', 'FOWNER', '--cap-add', 'SETUID', '--cap-add', 'SETGID',
          '--security-opt', 'no-new-privileges',
          ...(cfg.network === false ? ['--network', 'none'] : []),
          image, 'sleep', 'infinity'];
        // one container per project folder: one made with other settings (image, network) is removed first
        const old = await run(docker, ['ps', '-aq', '--filter', `label=artemis.root=${rootTag(root)}`], { timeoutMs: 20000 });
        const oldIds = (old.stdout || '').split(/\s+/).filter(Boolean);
        if (oldIds.length) { say(`Removing ${oldIds.length} older sandbox container(s) of this folder (made with other settings)…`); await run(docker, ['rm', '-f', ...oldIds], { timeoutMs: 60000 }); }
        say(`Starting container ${name} (${cfg.network === false ? 'no network' : 'network on'}, ${cfg.memory || '2g'} memory, ${cfg.cpus || '2'} CPUs), folder ${path.resolve(root)} → /workspace…`);
        log('info', `starting sandbox container ${name} (${image}) for ${root}`);
        let r = await run(docker, args, { timeoutMs: 10 * 60000 });
        if (r.code !== 0 && /already in use|Conflict/i.test(r.stderr || '')) { // left over from an earlier attempt that was cut off
          say('A container with that name was left from an earlier attempt: removing it and trying again…');
          await run(docker, ['rm', '-f', name], { timeoutMs: 30000 });
          r = await run(docker, args, { timeoutMs: 10 * 60000 });
        }
        if (r.code !== 0) throw new Error('Could not start the sandbox container: ' + (r.stderr || r.error || '').trim().slice(0, 600));
        say('Container is running.');
        return name;
      })().catch((e) => { ready.delete(name); throw e; }));
    }
    return ready.get(name);
  }

  async function runCommand({ command, cwd, timeout_seconds }, { signal, defaultCwd, onLog } = {}) {
    const say = typeof onLog === 'function' ? onLog : () => {};
    const cmd = String(command || '').trim();
    if (!cmd) return { ok: false, text: 'Error: command is empty' };
    const why = blockedReason(cmd);
    if (why) return { ok: false, text: `Error: blocked — ${why}.` };
    const timeout = Math.min(Math.max(Number(timeout_seconds) || 60, 1), 600);
    const id = crypto.randomBytes(4).toString('hex');
    // The script is fixed text: the folder and the command are passed as arguments ("$1", "$2"), never pasted into it.
    // The command gets its own process group (setsid) so a timeout or Stop kills everything it started.
    const pidf = `/tmp/artemis-run-${id}.pid`;
    const leader = `echo $$ > ${pidf}; exec timeout -s KILL ${timeout} sh -lc "$1"`;
    // Docker: the folder is given to docker exec (-w), so only the command reaches the script. SSH: the folder comes first.
    const RUN = `if setsid -w true 2>/dev/null; then exec setsid -w sh -c '${leader}' sh "$1"; else ${leader}; fi`;
    const SSH_SCRIPT = `cd "$1" 2>/dev/null || { echo "directory not found: $1" >&2; exit 2; }; shift; ${RUN}`;
    const killCmd = `p=$(cat ${pidf} 2>/dev/null) && { kill -KILL -- -$p 2>/dev/null || kill -KILL $p; }`;
    const t0 = Date.now();
    let res, where;
    if (mode === 'docker') {
      if (!defaultCwd) return { ok: false, text: 'Error: no project folder for the sandbox.' };
      const root = defaultCwd;
      let name;
      try { name = await ensure(root, say); } catch (e) { say('Error: ' + e.message); return { ok: false, text: 'Error: ' + e.message }; }
      const rel = cwd ? path.posix.normalize(String(cwd).replace(/\\/g, '/')) : '.';
      if (rel.startsWith('..') || (path.posix.isAbsolute(rel) && !rel.startsWith('/workspace') && !rel.startsWith('/tmp'))) return { ok: false, text: `Error: in the sandbox only /workspace (the project folder) and /tmp exist; "${cwd}" is outside.` };
      where = path.posix.isAbsolute(rel) ? rel : path.posix.join('/workspace', rel);
      const onAbort = () => { run(docker, ['exec', name, 'sh', '-c', killCmd], { timeoutMs: 10000 }); };
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      say(`Running: ${cmd}`);
      res = await run(docker, ['exec', '-w', where, '-e', 'TERM=dumb', '-e', 'NO_COLOR=1', name, 'sh', '-c', RUN, 'sh', cmd], { timeoutMs: (timeout + 15) * 1000, signal, onData: onLog ? (d) => { for (const l of String(d).split(/\r?\n/)) if (l.trim()) say('  ' + l); } : undefined });
      if (res.code !== 0 && /chdir to cwd|no such file or directory.*cwd|cwd.*no such file/i.test(res.stderr || '')) res = { ...res, stderr: `directory not found: ${where}` };
      say(`Finished with exit code ${res.code}.`);
      if (signal) signal.removeEventListener('abort', onAbort);
      where += ` (sandbox: docker ${image}${cfg.network === false ? ', no network' : ''})`;
    } else if (mode === 'ssh') {
      if (!cfg.sshHost) return { ok: false, text: 'Error: no SSH host is set for the sandbox (Settings → Tools).' };
      const base = cfg.sshDir || '~';
      const dir = cwd ? (String(cwd).startsWith('/') ? String(cwd) : `${base}/${cwd}`) : base;
      // ssh joins its arguments into one line for the remote shell, so each one is quoted; ~ becomes a path relative to the home folder
      const remoteDir = dir === '~' ? '.' : dir.replace(/^~\//, '');
      res = await run('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', String(cfg.sshHost), ['sh', '-c', SSH_SCRIPT, 'sh', remoteDir, cmd].map(q).join(' ')], { timeoutMs: (timeout + 20) * 1000, signal });
      where = `${dir} (on ${cfg.sshHost})`;
    } else if (mode === 'native') {
      const plat = cfg.platform || process.platform;
      if (plat !== 'darwin' && plat !== 'linux') return { ok: false, text: 'Error: the native sandbox works on macOS and Linux only. Use Docker or SSH (Settings → Tools).' };
      if (!defaultCwd) return { ok: false, text: 'Error: no project folder for the sandbox.' };
      const root = realOr(defaultCwd) || path.resolve(defaultCwd);
      const { writable, hidden } = nativePaths(root, { platform: plat, home: cfg.home, writable: cfg.writable || [] });
      where = cwd ? path.resolve(root, String(cwd)) : root;
      if (!writable.some((p) => where === p || where.startsWith(p + path.sep))) return { ok: false, text: `Error: commands start in the project folder, temp folders or the writable folders from Settings; "${cwd}" is outside.` };
      if (!fs.existsSync(where)) return { ok: false, text: `Error: directory not found: ${where}` };
      const network = cfg.network !== false;
      const opts = { cwd: where, env: { ...process.env, TERM: 'dumb', NO_COLOR: '1' }, group: true, timeoutMs: timeout * 1000, signal, onData: onLog ? (d) => { for (const l of String(d).split(/\r?\n/)) if (l.trim()) say('  ' + l); } : undefined };
      say(`Running: ${cmd}`);
      if (plat === 'darwin') res = await run(cfg.sandboxExec || '/usr/bin/sandbox-exec', ['-p', seatbeltProfile({ writable, hidden, network }), '/bin/sh', '-c', cmd], opts);
      else {
        res = await run(cfg.bwrap || 'bwrap', bwrapArgs({ writable, hidden, network, cwd: where, command: cmd }), opts);
        if (res.code === 127 && res.error) return { ok: false, text: 'Error: bubblewrap is not installed. Install it (sudo apt install bubblewrap, or sudo dnf install bubblewrap) or pick another sandbox in Settings → Tools.' };
      }
      say(`Finished with exit code ${res.code}.`);
      where += ` (sandbox: ${plat === 'darwin' ? 'macOS Seatbelt' : 'bubblewrap'}${network ? '' : ', no network'})`;
    } else return { ok: false, text: 'Error: unknown sandbox mode' };
    if (res.error === 'cancelled') return { ok: false, text: 'Error: command cancelled.' };
    if (res.error && res.code === 127) return { ok: false, text: 'Error: ' + res.error };
    const killed = res.error === 'timeout' || (res.code !== 0 && (res.code === 137 || Date.now() - t0 >= timeout * 1000 - 300));
    const note = killed ? `\n(timed out after ${timeout}s and was killed)` : '';
    return {
      ok: res.code === 0,
      text: `cwd: ${where}\nexit code: ${res.code}${note}\n--- stdout ---\n${clip(res.stdout || '', 24000) || '(empty)'}\n--- stderr ---\n${clip(res.stderr || '', 8000) || '(empty)'}`
    };
  }

  /** Stops and removes every sandbox container Artemis made. */
  async function cleanup() {
    if (mode !== 'docker') return 0;
    const r = await run(docker, ['ps', '-aq', '--filter', 'label=artemis.sandbox=1'], { timeoutMs: 20000 });
    const ids = (r.stdout || '').split(/\s+/).filter(Boolean);
    if (ids.length) await run(docker, ['rm', '-f', ...ids], { timeoutMs: 60000 });
    ready.clear();
    return ids.length;
  }

  const describe = () => (mode === 'docker' ? `Commands run in a Docker container (${image}${cfg.network === false ? ', no network' : ''}); the project folder is mounted at /workspace and is the only folder of this computer it can see. Use paths relative to the project or under /workspace.`
    : mode === 'native' ? `Commands run on this computer inside the OS sandbox (${(cfg.platform || process.platform) === 'darwin' ? 'macOS Seatbelt' : 'bubblewrap'}${cfg.network === false ? ', no network' : ''}): they can read files, but write only to the project folder, temp folders and package caches; ~/.ssh and other key folders are hidden. Use paths relative to the project.`
    : `Commands run on ${cfg.sshHost} over SSH, in ${cfg.sshDir || 'the home folder'} there; files of this computer are not available on that machine.`);

  return { mode, runCommand, ensure, cleanup, describe, nameFor };
}

/** The sandbox from settings, or null when it is off. */
function sandboxFromSettings(st, log) {
  const mode = ['docker', 'ssh', 'native'].includes(st.sandbox) ? st.sandbox : '';
  if (!mode) return null;
  const writable = String(st.sandboxWritable || '').split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
  return createSandbox({ mode, image: st.sandboxImage || 'node:22-bookworm', network: st.sandboxNetwork !== false, memory: st.sandboxMemory || '2g', cpus: st.sandboxCpus || '2', sshHost: st.sandboxSshHost || '', sshDir: st.sandboxSshDir || '', writable, log });
}

// With the sandbox on, connector tools that run shell commands on this computer (Artemis's own MCP server's terminal tools, a shell
// MCP server…) would be a way around it: they are left out of the run, so commands go through run_command and into the sandbox.
const HOST_SHELL_TOOL = /(terminal_run|terminal_read|run_command|exec_command|execute_command|shell_exec|run_shell|^bash$|_bash$|run_in_terminal)/i;
const hostShellTool = (fnName) => HOST_SHELL_TOOL.test(String(fnName || '').split('__').pop());
function hideHostShellTools(mcp) {
  if (!mcp) return mcp;
  return {
    ...mcp,
    definitions: (slugs) => mcp.definitions(slugs).filter((d) => !hostShellTool(d && d.function && d.function.name)),
    index: () => mcp.index().map((x) => ({ ...x, tools: (x.tools || []).filter((t) => !hostShellTool(t)) })),
    call: (name, ...rest) => (hostShellTool(name) ? Promise.reject(new Error('Commands run in the sandbox here: use run_command.')) : mcp.call(name, ...rest))
  };
}

module.exports = { createSandbox, sandboxFromSettings, runProc, hideHostShellTools, hostShellTool, nativePaths, seatbeltProfile, bwrapArgs };
