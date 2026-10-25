// run_command sandbox: Docker arguments, the in-container script (timeout, Stop, cwd checks) and SSH, with a fake docker/ssh.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSandbox, runProc } = require('../electron/core/sandbox');

(async () => {
  // ---- argument shapes with a scripted runner ----
  const calls = [];
  let inspect = { code: 1, stdout: '', stderr: 'No such object' };
  const fake = async (cmd, args) => { calls.push([cmd, ...args]); if (args[0] === 'inspect') return inspect; if (args[0] === 'exec') return { code: 0, stdout: 'hi\n', stderr: '' }; return { code: 0, stdout: 'id\n', stderr: '' }; };
  const sb = createSandbox({ mode: 'docker', image: 'node:22-bookworm', network: false }, { run: fake });
  let r = await sb.runCommand({ command: 'echo hi' }, { defaultCwd: '/tmp/proj' });
  assert.ok(r.ok && r.text.includes('hi') && r.text.includes('/workspace') && r.text.includes('no network'), r.text);
  const runCall = calls.find((c) => c[1] === 'run');
  assert.ok(runCall.includes('--network') && runCall.includes('none'), 'network off');
  assert.ok(runCall.includes('/tmp/proj:/workspace'));
  assert.ok(runCall.includes('no-new-privileges') && runCall.includes('ALL'));
  assert.strictEqual(runCall[runCall.length - 2], 'sleep');
  const n0 = calls.length;
  await sb.runCommand({ command: 'ls' }, { defaultCwd: '/tmp/proj' });
  assert.strictEqual(calls.length, n0 + 1, 'container reused: only exec');
  assert.ok(sb.nameFor('/tmp/proj') !== sb.nameFor('/tmp/other'));
  r = await sb.runCommand({ command: 'ls', cwd: '../../etc' }, { defaultCwd: '/tmp/proj' });
  assert.ok(!r.ok && /outside/.test(r.text));
  r = await sb.runCommand({ command: 'sudo rm -rf /' }, { defaultCwd: '/tmp/proj' });
  assert.ok(!r.ok && /blocked/.test(r.text));
  r = await sb.runCommand({ command: '' }, {});
  assert.ok(!r.ok);
  assert.ok(/Docker container/.test(sb.describe()));
  // docker missing
  const none = createSandbox({ mode: 'docker' }, { run: async () => ({ code: 127, stdout: '', stderr: '', error: 'docker is not installed or not on PATH' }) });
  r = await none.runCommand({ command: 'ls' }, { defaultCwd: '/tmp' });
  assert.ok(!r.ok && /Docker is not installed/.test(r.text));
  // ssh
  const sshCalls = [];
  const ssh = createSandbox({ mode: 'ssh', sshHost: 'me@box', sshDir: '~/work' }, { run: async (cmd, args) => { sshCalls.push([cmd, ...args]); return { code: 0, stdout: 'ok', stderr: '' }; } });
  r = await ssh.runCommand({ command: "echo 'quoted'" }, {});
  assert.ok(r.ok && r.text.includes('on me@box'));
  assert.strictEqual(sshCalls[0][0], 'ssh'); assert.ok(sshCalls[0].includes('BatchMode=yes') && sshCalls[0].includes('me@box'));
  const line = sshCalls[0][sshCalls[0].length - 1];
  assert.ok(line.startsWith("'sh' '-c' ") && line.includes(" 'work' ") && line.endsWith(`'echo '\\''quoted'\\'''`), line);
  assert.ok(!(await createSandbox({ mode: 'ssh' }, { run: fake }).runCommand({ command: 'ls' }, {})).ok);

  // ---- the real in-container script, run by a fake docker that executes it on this machine ----
  if (process.platform === 'win32') { console.log('test-sandbox: ok (script part skipped on Windows)'); return; }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'artemis-sb-'));
  const proj = path.join(tmp, 'proj'); fs.mkdirSync(path.join(proj, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'sub', 'a.txt'), 'inside');
  // The in-container script uses timeout(1). macOS has no GNU coreutils: a tiny Perl stand-in keeps the test running there.
  if (require('child_process').spawnSync('sh', ['-c', 'command -v timeout']).status !== 0) {
    const shim = path.join(tmp, 'shim'); fs.mkdirSync(shim);
    fs.writeFileSync(path.join(shim, 'timeout'), `#!/bin/sh
[ "$1" = "-s" ] && shift 2
n="$1"; shift
exec perl -e 'my $n = shift; my $pid = fork; if (!$pid) { exec @ARGV or exit 127 } $SIG{ALRM} = sub { kill "KILL", $pid; exit 137 }; alarm $n; waitpid($pid, 0); exit($? >> 8)' "$n" "$@"
`, { mode: 0o755 });
    process.env.PATH = shim + path.delimiter + process.env.PATH;
  }
  const bin = path.join(tmp, 'docker');
  fs.writeFileSync(bin, `#!/bin/sh
case "$1" in
  inspect) echo true; exit 0 ;;
  exec) shift; dir=''; while [ "$1" = "-e" ] || [ "$1" = "-w" ]; do [ "$1" = "-w" ] && dir="$2"; shift 2; done; shift; shift; shift   # name, sh, -c
        script="$1"; d=$(printf '%s' "$dir" | sed "s#^/workspace#${proj}#"); cd "$d" 2>/dev/null || { echo "OCI runtime exec failed: chdir to cwd (\"$dir\") set in config.json failed: no such file or directory" >&2; exit 126; }
        exec sh -c "$script" sh "$3" ;;
  *) exit 0 ;;
esac
`, { mode: 0o755 });
  const real = createSandbox({ mode: 'docker', docker: bin });
  r = await real.runCommand({ command: 'cat a.txt && pwd', cwd: 'sub' }, { defaultCwd: proj });
  assert.ok(r.ok && r.text.includes('inside') && r.text.includes('exit code: 0'), r.text);
  r = await real.runCommand({ command: "echo \"it's\" fine; exit 3" }, { defaultCwd: proj });
  // a folder name full of shell characters is an argument, never code
  fs.mkdirSync(path.join(proj, 'we;ird $(x)'));
  const odd = await real.runCommand({ command: 'pwd', cwd: 'we;ird $(x)' }, { defaultCwd: proj });
  assert.ok(odd.ok && odd.text.includes('we;ird $(x)'), odd.text);
  assert.ok(!r.ok && r.text.includes("it's fine") && r.text.includes('exit code: 3'), r.text);
  r = await real.runCommand({ command: 'ls', cwd: 'missing' }, { defaultCwd: proj });
  assert.ok(!r.ok && /directory not found/.test(r.text), r.text);
  const t0 = Date.now();
  r = await real.runCommand({ command: 'sleep 30', timeout_seconds: 1 }, { defaultCwd: proj });
  assert.ok(!r.ok && /timed out/.test(r.text) && Date.now() - t0 < 10000, r.text);
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 500);
  r = await real.runCommand({ command: 'sleep 30' }, { defaultCwd: proj, signal: ac.signal });
  assert.ok(!r.ok && /cancelled/.test(r.text), r.text);
  // runProc basics
  const p = await runProc('sh', ['-c', 'echo out; echo err >&2; exit 4']);
  assert.deepStrictEqual([p.code, p.stdout.trim(), p.stderr.trim()], [4, 'out', 'err']);
  assert.ok(/not installed/.test((await runProc('artemis-no-such-binary', [])).error));
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('test-sandbox: ok');
})().catch((e) => { console.error(e); process.exit(1); });

// connector tools that would run commands on this computer are hidden while the sandbox is on
{
  const { hideHostShellTools, hostShellTool } = require('../electron/core/sandbox');
  const fake = { definitions: () => [{ function: { name: 'mcp__artemis__artemis_terminal_run' } }, { function: { name: 'mcp__artemis__artemis_notes_read' } }, { function: { name: 'mcp__sh__bash' } }],
    index: () => [{ slug: 'artemis', tools: ['artemis_terminal_run', 'artemis_fs_read_file'] }], call: async (n) => 'called ' + n, resolveSlug: () => 'artemis' };
  const w = hideHostShellTools(fake);
  if (JSON.stringify(w.definitions().map((d) => d.function.name)) !== JSON.stringify(['mcp__artemis__artemis_notes_read'])) throw new Error('definitions not filtered');
  if (JSON.stringify(w.index()[0].tools) !== JSON.stringify(['artemis_fs_read_file'])) throw new Error('index not filtered');
  if (w.resolveSlug() !== 'artemis') throw new Error('other methods kept');
  w.call('mcp__artemis__artemis_terminal_run').then(() => { throw new Error('call not blocked'); }, () => {});
  w.call('mcp__artemis__artemis_notes_read').then((r) => { if (r !== 'called mcp__artemis__artemis_notes_read') throw new Error('call'); });
  if (!hostShellTool('mcp__x__run_command') || hostShellTool('mcp__x__read_file')) throw new Error('hostShellTool');
  console.log('test-sandbox: connector filter ok');
}
