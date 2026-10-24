// Sandboxed run_command: commands run in a Docker container (or on another machine over SSH) instead of on this computer.
//   docker: one long-lived container per project folder, the folder mounted at /workspace, no extra capabilities,
//           memory/CPU/process limits, network on or off. The container is reused between commands (installed packages stay).
//   ssh:    commands run on another machine (`ssh host`), in a folder there. Files are not synced.
// Same result shape as shell.runCommand: { ok, text }.
const { spawn } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const { blockedReason } = require('../shell');

const clip = (s, n) => (s.length > n ? s.slice(0, n) + `\n…[truncated, ${s.length} characters total]` : s);
const q = (s) => "'" + String(s).replace(/'/g, `'\\''`) + "'";

/** Runs a program; resolves { code, stdout, stderr, error }. Never rejects. */
function runProc(cmd, args, { timeoutMs = 0, signal, input, spawnImpl = spawn } = {}) {
  return new Promise((resolve) => {
    let out = '', err = '', done = false, timer = null;
    let child;
    try { child = spawnImpl(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] }); } catch (e) { return resolve({ code: 127, stdout: '', stderr: '', error: e.message }); }
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); if (signal) signal.removeEventListener('abort', onAbort); resolve(r); };
    const onAbort = () => { try { child.kill('SIGKILL'); } catch {} finish({ code: 130, stdout: out, stderr: err, error: 'cancelled' }); };
    child.stdout.on('data', (d) => { if (out.length < 4e6) out += d; });
    child.stderr.on('data', (d) => { if (err.length < 1e6) err += d; });
    child.on('error', (e) => finish({ code: 127, stdout: out, stderr: err, error: e.code === 'ENOENT' ? `${cmd} is not installed or not on PATH` : e.message }));
    child.on('close', (code, sig) => finish({ code: code != null ? code : sig === 'SIGKILL' ? 137 : sig === 'SIGTERM' ? 143 : 1, stdout: out, stderr: err }));
    if (timeoutMs) timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} finish({ code: 124, stdout: out, stderr: err, error: 'timeout' }); }, timeoutMs);
    if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }
    if (input != null) child.stdin.end(input); else child.stdin.end();
  });
}

/**
 * cfg: { mode: 'docker' | 'ssh', image, network (bool), memory ('2g'), cpus ('2'), sshHost, sshDir, docker ('docker' binary), log? }
 */
function createSandbox(cfg, { run = runProc } = {}) {
  const mode = cfg.mode;
  const log = cfg.log || (() => {});
  const docker = cfg.docker || 'docker';
  const image = cfg.image || 'node:22-bookworm';
  const ready = new Map(); // container name -> Promise

  const nameFor = (root) => 'artemis-sb-' + crypto.createHash('sha1').update(path.resolve(root) + '|' + image + '|' + (cfg.network === false ? 'nonet' : 'net')).digest('hex').slice(0, 12);

  async function ensure(root) {
    const name = nameFor(root);
    if (!ready.has(name)) {
      ready.set(name, (async () => {
        const st = await run(docker, ['inspect', '-f', '{{.State.Running}}', name], { timeoutMs: 20000 });
        if (st.error && /not installed/.test(st.error)) throw new Error('Docker is not installed (or not on PATH). Install Docker Desktop / OrbStack, or turn the sandbox off in Settings → Tools.');
        if (st.code === 0 && st.stdout.trim() === 'true') return name;
        if (st.code === 0) { const r = await run(docker, ['start', name], { timeoutMs: 60000 }); if (r.code === 0) return name; }
        const args = ['run', '-d', '--name', name, '--label', 'artemis.sandbox=1', '--init',
          '-v', `${path.resolve(root)}:/workspace`, '-w', '/workspace',
          '--memory', String(cfg.memory || '2g'), '--cpus', String(cfg.cpus || '2'), '--pids-limit', '512',
          '--cap-drop', 'ALL', '--cap-add', 'CHOWN', '--cap-add', 'DAC_OVERRIDE', '--cap-add', 'FOWNER', '--cap-add', 'SETUID', '--cap-add', 'SETGID',
          '--security-opt', 'no-new-privileges',
          ...(cfg.network === false ? ['--network', 'none'] : []),
          image, 'sleep', 'infinity'];
        log('info', `starting sandbox container ${name} (${image}) for ${root}`);
        const r = await run(docker, args, { timeoutMs: 10 * 60000 }); // the first run may pull the image
        if (r.code !== 0) throw new Error('Could not start the sandbox container: ' + (r.stderr || r.error || '').trim().slice(0, 600));
        return name;
      })().catch((e) => { ready.delete(name); throw e; }));
    }
    return ready.get(name);
  }

  async function runCommand({ command, cwd, timeout_seconds }, { signal, defaultCwd } = {}) {
    const cmd = String(command || '').trim();
    if (!cmd) return { ok: false, text: 'Error: command is empty' };
    const why = blockedReason(cmd);
    if (why) return { ok: false, text: `Error: blocked — ${why}.` };
    const timeout = Math.min(Math.max(Number(timeout_seconds) || 60, 1), 600);
    const id = crypto.randomBytes(4).toString('hex');
    // the command gets its own process group (setsid) so a timeout or Stop kills everything it started
    const pidf = `/tmp/artemis-run-${id}.pid`;
    const leader = `echo $$ > ${pidf}; exec timeout -s KILL ${timeout} sh -lc "$1"`;
    const inner = (dir) => `cd ${q(dir)} 2>/dev/null || { echo "directory not found: ${dir.replace(/"/g, '')}" >&2; exit 2; }; ` +
      `if setsid -w true 2>/dev/null; then exec setsid -w sh -c ${q(leader)} sh ${q(cmd)}; else set -- ${q(cmd)}; ${leader}; fi`;
    const killCmd = `p=$(cat ${pidf} 2>/dev/null) && { kill -KILL -- -$p 2>/dev/null || kill -KILL $p; }`;
    const t0 = Date.now();
    let res, where;
    if (mode === 'docker') {
      const root = defaultCwd || process.cwd();
      let name;
      try { name = await ensure(root); } catch (e) { return { ok: false, text: 'Error: ' + e.message }; }
      const rel = cwd ? path.posix.normalize(String(cwd).replace(/\\/g, '/')) : '.';
      if (rel.startsWith('..') || (path.posix.isAbsolute(rel) && !rel.startsWith('/workspace') && !rel.startsWith('/tmp'))) return { ok: false, text: `Error: in the sandbox only /workspace (the project folder) and /tmp exist; "${cwd}" is outside.` };
      where = path.posix.isAbsolute(rel) ? rel : path.posix.join('/workspace', rel);
      const onAbort = () => { run(docker, ['exec', name, 'sh', '-c', killCmd], { timeoutMs: 10000 }); };
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      res = await run(docker, ['exec', '-e', 'TERM=dumb', '-e', 'NO_COLOR=1', name, 'sh', '-c', inner(where)], { timeoutMs: (timeout + 15) * 1000, signal });
      if (signal) signal.removeEventListener('abort', onAbort);
      where += ` (sandbox: docker ${image}${cfg.network === false ? ', no network' : ''})`;
    } else if (mode === 'ssh') {
      if (!cfg.sshHost) return { ok: false, text: 'Error: no SSH host is set for the sandbox (Settings → Tools).' };
      const base = cfg.sshDir || '~';
      const dir = cwd ? (String(cwd).startsWith('/') ? String(cwd) : `${base}/${cwd}`) : base;
      const remote = inner(dir).replace(`cd ${q(dir)}`, `cd ${dir.startsWith('~') ? dir.replace(/^~/, '"$HOME"') : q(dir)}`);
      res = await run('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', String(cfg.sshHost), 'sh -c ' + q(remote)], { timeoutMs: (timeout + 20) * 1000, signal });
      where = `${dir} (on ${cfg.sshHost})`;
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

  const describe = () => (mode === 'docker' ? `Commands run in a Docker container (${image}${cfg.network === false ? ', no network' : ''}); the project folder is mounted at /workspace and is the only folder of this computer it can see. Use paths relative to the project or under /workspace.` : `Commands run on ${cfg.sshHost} over SSH, in ${cfg.sshDir || 'the home folder'} there; files of this computer are not available on that machine.`);

  return { mode, runCommand, ensure, cleanup, describe, nameFor };
}

/** The sandbox from settings, or null when it is off. */
function sandboxFromSettings(st, log) {
  const mode = st.sandbox === 'docker' || st.sandbox === 'ssh' ? st.sandbox : '';
  if (!mode) return null;
  return createSandbox({ mode, image: st.sandboxImage || 'node:22-bookworm', network: st.sandboxNetwork !== false, memory: st.sandboxMemory || '2g', cpus: st.sandboxCpus || '2', sshHost: st.sandboxSshHost || '', sshDir: st.sandboxSshDir || '', log });
}

module.exports = { createSandbox, sandboxFromSettings, runProc };
