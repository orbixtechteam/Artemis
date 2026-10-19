import React, { useEffect, useState } from 'react';
import { Group, Row, SwitchRow, Buttons } from './ui.jsx';

// Settings → General → Updates: the state comes from the main process (electron/updater.js) and arrives as it changes.
const ago = (t) => {
  if (!t) return '';
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

export function UpdatesGroup({ s, put }) {
  const api = window.api;
  const [st, setSt] = useState({ phase: 'idle', current: '', latest: '', pct: 0, error: '', checkedAt: 0, canInstall: false });
  const [, tick] = useState(0);
  useEffect(() => {
    if (!api.updateStatus) return undefined;
    api.updateStatus().then((x) => x && setSt(x)).catch(() => {});
    const off = api.onUpdateStatus && api.onUpdateStatus((x) => x && setSt((p) => ({ ...p, ...x })));
    const t = setInterval(() => tick((n) => n + 1), 30000); // "checked 2 min ago" keeps up
    return () => { off && off(); clearInterval(t); };
  }, []);
  if (!api.updateStatus) return null;

  const text = st.phase === 'checking' ? 'Checking for updates…'
    : st.phase === 'downloading' ? `Downloading ${st.latest}… ${st.pct}%`
    : st.phase === 'ready' ? `Artemis ${st.latest} is ready. ${st.canInstall ? 'It installs when you quit, or restart now.' : 'Open the release page to install it.'}`
    : st.phase === 'available' ? `Artemis ${st.latest} is available.`
    : st.phase === 'uptodate' ? `You have the latest version${st.checkedAt ? ` · checked ${ago(st.checkedAt)}` : ''}.`
    : st.phase === 'error' ? st.error
    : 'Not checked yet.';
  const busy = st.phase === 'checking' || st.phase === 'downloading';

  return (
    <Group title="Updates" footer="Updates come from this project's GitHub Releases. The only request Artemis makes is asking GitHub for the latest release; turn the first switch off and it makes none.">
      <Row label={`Artemis ${st.current || ''}`} description={text}>
        <Buttons end>
          {st.phase === 'ready' && st.canInstall && <button type="button" className="pref-btn primary" onClick={() => api.updateInstall()}>Restart and update</button>}
          {st.phase === 'available' && st.asset && <button type="button" className="pref-btn primary" onClick={() => api.updateDownload()}>Download</button>}
          {(st.phase === 'available' || st.phase === 'ready' || st.phase === 'error') && <button type="button" className="pref-btn" onClick={() => api.updateOpenRelease()}>Release notes</button>}
          <button type="button" className="pref-btn" disabled={busy} onClick={() => api.updateCheck()}>{st.phase === 'checking' ? 'Checking…' : 'Check now'}</button>
        </Buttons>
      </Row>
      <SwitchRow label="Check for updates automatically" description="In the background, shortly after start and every few hours."
        checked={s.updateAuto !== false} onChange={put('updateAuto')} />
      <SwitchRow label="Download updates automatically" description="The new version is downloaded as soon as it is found, and checked against its checksum."
        checked={s.updateDownload !== false} onChange={put('updateDownload')} />
      <SwitchRow label="Install when I quit Artemis" description="A downloaded update replaces the app when you quit it (⌘Q). Your chats and settings stay as they are."
        checked={s.updateInstall !== false} onChange={put('updateInstall')} />
    </Group>
  );
}
