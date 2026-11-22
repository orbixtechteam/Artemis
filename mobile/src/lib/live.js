// Live changes from the server (GET /v1/events), like the Claude and ChatGPT apps: a chat made, answered, renamed or
// deleted on another device shows up here at once. One connection for the whole app, shared by every screen that
// listens; it pauses while the app is in the background and says "resume" when it comes back (screens then reload).
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

const subs = new Set();
let current = null; // { api, alive, ctl }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const emit = (ev) => { for (const f of [...subs]) { try { f(ev); } catch {} } };

function stop() {
  if (!current) return;
  current.alive = false;
  try { if (current.ctl) current.ctl.abort(); } catch {}
  current = null;
}

function connect(api) {
  if (current && current.api === api) return;
  stop();
  const st = { api, alive: true, ctl: null };
  current = st;
  (async () => {
    let tries = 0;
    while (st.alive) {
      if (AppState.currentState !== 'active') { await sleep(1000); continue; }
      st.ctl = new AbortController();
      try { await api.stream('/v1/events', { onEvent: (ev) => { tries = 0; emit(ev); }, signal: st.ctl.signal }); } catch {}
      if (!st.alive) break;
      await sleep(Math.min(15000, 1000 * 2 ** Math.min(tries++, 4)));
    }
  })();
}

let wasActive = AppState.currentState === 'active';
AppState.addEventListener('change', (s) => {
  const active = s === 'active';
  if (!active && current && current.ctl) { try { current.ctl.abort(); } catch {} } // no connection held in the background
  if (active && !wasActive) emit({ type: 'resume', data: {} });
  wasActive = active;
});

/** Calls fn({ type: 'sessions' | 'runs' | 'resume' | 'hello', data }) for every live change while the screen is mounted. */
export function useLive(api, fn) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!api) return undefined;
    const h = (ev) => ref.current(ev);
    subs.add(h);
    connect(api);
    return () => { subs.delete(h); if (!subs.size) stop(); };
  }, [api]);
}
