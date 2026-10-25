// IPC: agent teams (electron/teams.js). Every call answers { ok, team } or { ok: false, error }; live changes come as teams:changed.
// While the background gateway runs (it owns the background jobs), the teams run there: these calls go to its API.
// A team with a repeat gets a scheduled task (job.teamId) that starts a new run of it.
// createTeamsClient() is the same thing as plain functions, for the chat tools (team_save, team_start …).

function createTeamsClient({ teams, scheduler, headlessActive, headlessFetch, logger }) {
  const remote = () => headlessActive();
  const H = {
    list: () => headlessFetch('/v1/teams').then((j) => j.teams),
    save: (def) => headlessFetch('/v1/teams', { method: 'POST', body: def }).then((j) => j.team),
    remove: (id) => headlessFetch(`/v1/teams/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(() => true),
    act: (id, what, body) => headlessFetch(`/v1/teams/${encodeURIComponent(id)}/${what}`, { method: 'POST', body: body || {} }).then((j) => j.team)
  };
  /** The scheduled task that starts this team, kept in step with its repeat. */
  function syncJob(t) {
    if (!t) return;
    const job = scheduler.list().find((j) => j.teamId === t.id);
    try {
      if (!t.repeat) { if (job) scheduler.remove(job.id); return; }
      scheduler.save({ id: job ? job.id : undefined, name: `Team: ${t.name}`.slice(0, 80), prompt: `Start a new run of the team "${t.name}".`, teamId: t.id, repeat: t.repeat, enabled: true });
    } catch (e) { logger.warn('teams', `Could not schedule "${t.name}": ${e.message}`); throw e; }
  }
  const c = {
    async list() { try { return remote() ? await H.list() : teams.list(); } catch { return teams.list(); } },
    async get(id) { return (await c.list()).find((t) => t.id === id || String(t.name).toLowerCase() === String(id).toLowerCase()) || null; },
    async save(def) { const t = remote() ? await H.save(def || {}) : teams.save(def || {}); syncJob(t); return t; },
    async remove(id) {
      const job = scheduler.list().find((j) => j.teamId === id);
      if (job) scheduler.remove(job.id);
      return remote() ? H.remove(id) : teams.remove(id);
    },
    act: (id, what) => (remote() ? H.act(id, what) : what === 'notebook-clear' ? teams.clearNotebook(id) : teams[what](id)),
    async say(id, text) {
      if (remote()) return H.act(id, 'say', { text });
      const t = teams.get(id);
      if (!t) throw new Error('That team no longer exists.');
      teams.say(id, text).catch((e) => logger.warn('teams', 'A message to the team failed: ' + e.message));
      return teams.get(id);
    }
  };
  return c;
}

module.exports = function registerTeamsIpc(deps) {
  const { ipcMain } = deps;
  const c = deps.client || createTeamsClient(deps);
  const wrap = (fn) => async (_e, ...a) => { try { return { ok: true, team: await fn(...a) }; } catch (e) { return { ok: false, error: e.message || String(e) }; } };
  ipcMain.handle('teams:list', () => c.list());
  ipcMain.handle('teams:save', wrap((def) => c.save(def)));
  ipcMain.handle('teams:delete', async (_e, id) => { try { return await c.remove(id); } catch { return false; } });
  for (const what of ['start', 'pause', 'resume', 'stop']) ipcMain.handle(`teams:${what}`, wrap((id) => c.act(id, what)));
  ipcMain.handle('teams:notebook-clear', wrap((id) => c.act(id, 'notebook-clear')));
  ipcMain.handle('teams:say', wrap((id, text) => c.say(id, text)));
};
module.exports.createTeamsClient = createTeamsClient;
