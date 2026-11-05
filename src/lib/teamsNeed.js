import { useEffect, useState } from 'react';

// How many teams wait on you (an approval, or a pause or error to look at), for the Agents item in the sidebar.
const waits = (t) => {
  const r = (t && t.run) || {};
  return (r.messages || []).some((m) => m.kind === 'approval' && m.decided == null) || r.status === 'paused' || r.status === 'failed';
};
/** Tells the sidebar that the list changed in a way teams:changed does not report (a team was deleted). */
export const teamsListChanged = () => { try { window.dispatchEvent(new Event('artemis:teams-list')); } catch {} };

export function useTeamsNeed() {
  const [map, setMap] = useState({});
  useEffect(() => {
    const api = window.api;
    if (!api || !api.teamsList) return undefined;
    let on = true;
    const load = () => api.teamsList().then((l) => { if (on && Array.isArray(l)) setMap(Object.fromEntries(l.map((t) => [t.id, waits(t)]))); }).catch(() => {});
    load();
    const off = api.onTeamsChanged && api.onTeamsChanged((t) => setMap((m) => (m[t.id] === waits(t) ? m : { ...m, [t.id]: waits(t) })));
    window.addEventListener('artemis:teams-list', load);
    return () => { on = false; off && off(); window.removeEventListener('artemis:teams-list', load); };
  }, []);
  return Object.values(map).filter(Boolean).length;
}
