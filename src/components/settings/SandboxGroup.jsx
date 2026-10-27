import React, { useEffect, useRef, useState } from 'react';
import Select from '../Select.jsx';
import { Group, Row, SwitchRow } from './ui.jsx';

const IS_MAC = window.api?.platform === 'darwin';
const NATIVE = IS_MAC || window.api?.platform === 'linux';

/** Settings → Tools: where run_command runs (this computer, this computer in the OS sandbox, a Docker container, or another machine over SSH). */
export function SandboxGroup({ s, setS, put }) {
  const [out, setOut] = useState('');
  const [busy, setBusy] = useState(false);
  const mode = s.sandbox || '';
  const val = (k) => (e) => setS((x) => ({ ...x, [k]: e.target.value }));
  const logRef = useRef(null);
  // live log: every step of the test (container, image download, the command and its output) as it happens
  useEffect(() => (window.api.onSandboxLog ? window.api.onSandboxLog((line) => setOut((o) => (o ? o + '\n' : '') + line)) : undefined), []);
  useEffect(() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight; }, [out]);
  const test = async () => {
    setBusy(true); setOut('');
    const r = await window.api.sandboxTest();
    setOut((o) => (o ? o + '\n\n' : '') + (r.ok ? '✓ Sandbox works.\n\n' + r.text : '✗ ' + (r.error || r.text)));
    setBusy(false);
  };
  const cleanup = async () => { const r = await window.api.sandboxCleanup(); setOut(r.ok ? `Removed ${r.removed} sandbox container(s).` : r.error); };
  return (
    <Group title="Sandbox for terminal commands" footer={mode ? <>Save the settings before you test. With the sandbox on, the terminal panel is not offered to Artemis, scheduled tasks may run commands in the sandbox without asking, and the headless gateway can run commands without <code>--allow-shell</code>.</> : null}>
      <Row label="Where commands run" description="This computer: run_command uses your real shell (asks once per task). Isolated: this computer, but the OS sandbox lets commands write only to the project folder, temp folders and package caches (macOS Seatbelt, Linux bubblewrap; no Docker needed). Docker: a container per project folder that sees only that folder (at /workspace). SSH: another machine you can reach with ssh, for example a small server.">
        <Select value={mode} onChange={val('sandbox')}>
          <option value="">This computer (no sandbox)</option>
          {NATIVE && <option value="native">This computer, isolated ({IS_MAC ? 'macOS Seatbelt' : 'bubblewrap'})</option>}
          <option value="docker">Docker container</option>
          <option value="ssh">Another machine (SSH)</option>
        </Select>
      </Row>
      {mode === 'native' && (
        <>
          <SwitchRow label="Network" description="Off: commands cannot reach the internet (no package installs)." checked={s.sandboxNetwork !== false} onChange={put('sandboxNetwork')} />
          <Row label="Extra writable folders" description={`One per line. Commands can always write to the project folder, temp folders and package caches; ~/.ssh, ~/.aws, ~/.gnupg and similar key folders are hidden.${IS_MAC ? '' : ' Needs bubblewrap: sudo apt install bubblewrap.'}`}>
            <textarea className="pref-input mono" rows={3} value={s.sandboxWritable || ''} onChange={val('sandboxWritable')} spellCheck={false} placeholder="~/projects/shared" />
          </Row>
        </>
      )}
      {mode === 'docker' && (
        <>
          <Row label="Image" description="Any Docker image with sh. Default: node:22-bookworm (Node.js, Python 3, git, curl).">
            <input className="pref-input" value={s.sandboxImage ?? 'node:22-bookworm'} onChange={val('sandboxImage')} spellCheck={false} placeholder="node:22-bookworm" />
          </Row>
          <SwitchRow label="Network in the container" description="Off: commands cannot reach the internet (no package installs)." checked={s.sandboxNetwork !== false} onChange={put('sandboxNetwork')} />
          <Row label="Limits" description="Memory and CPUs for each container.">
            <div className="pref-inline">
              <input className="pref-input narrow" value={s.sandboxMemory ?? '2g'} onChange={val('sandboxMemory')} placeholder="2g" aria-label="Memory" />
              <input className="pref-input narrow" value={s.sandboxCpus ?? '2'} onChange={val('sandboxCpus')} placeholder="2" aria-label="CPUs" />
            </div>
          </Row>
        </>
      )}
      {mode === 'ssh' && (
        <>
          <Row label="Host" description="As you would type it after ssh (user@host, or a name from ~/.ssh/config). Needs key login, no password prompt.">
            <input className="pref-input" value={s.sandboxSshHost || ''} onChange={val('sandboxSshHost')} spellCheck={false} placeholder="me@server" />
          </Row>
          <Row label="Folder there" description="Commands start in this folder. Empty = the home folder.">
            <input className="pref-input" value={s.sandboxSshDir || ''} onChange={val('sandboxSshDir')} spellCheck={false} placeholder="~/artemis" />
          </Row>
        </>
      )}
      {mode && (
        <Row stacked label="Check it">
          <div className="pref-inline">
            <button type="button" className="pref-btn" disabled={busy} onClick={test}>Test</button>
            {mode === 'docker' && <button type="button" className="pref-btn" onClick={cleanup}>Remove sandbox containers</button>}
          </div>
          {out && <textarea ref={logRef} readOnly rows={10} className="mono" value={out} />}
          {busy && <span className="muted">Working… the first run downloads the image and can take a few minutes.</span>}
        </Row>
      )}
    </Group>
  );
}
