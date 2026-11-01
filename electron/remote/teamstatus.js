// Plain-text views of the agent teams for Telegram: what is running, who does what, and what the room said last.

const short = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const clock = (ms) => (ms ? new Date(ms).toTimeString().slice(0, 5) : '');
const lives = (t) => Object.values(t.run?.live || {});

function taskCounts(t) {
  const tasks = t.run?.tasks || [];
  const done = tasks.filter((k) => k.status === 'done').length;
  return tasks.length ? `${done}/${tasks.length} tasks` : 'no tasks';
}

/** One line per team, then the agents that are in no team. */
function overview(teams, agents = []) {
  const lines = [];
  for (const t of teams) {
    const r = t.run || {};
    const who = [...new Set(lives(t).map((l) => l.name))];
    const when = r.endedAt ? `, ended ${clock(r.endedAt)}` : r.startedAt ? `, started ${clock(r.startedAt)}` : '';
    lines.push(`${t.name}: ${r.status || 'idle'}, ${taskCounts(t)}${when}${who.length ? `\nNow: ${who.join(', ')}` : ''}`);
  }
  const inTeam = new Set(teams.flatMap((t) => (t.members || []).map((m) => String(m.name).toLowerCase())));
  const solo = agents.filter((a) => !inTeam.has(String(a.name).toLowerCase())).map((a) => a.name);
  if (solo.length) lines.push(`Agents without a team: ${solo.join(', ')}`);
  return lines.length ? lines.join('\n\n') : 'No teams or agents yet.';
}

/** A team's tasks, live steps and latest room messages. */
function detail(t, roomSize = 8) {
  const r = t.run || {};
  const parts = [`${t.name}: ${r.status || 'idle'}${r.reason ? ` (${short(r.reason, 200)})` : ''}, ${taskCounts(t)}, spent $${Number(r.spent?.usd || 0).toFixed(2)}`];
  if (r.tasks?.length) parts.push('Tasks:\n' + r.tasks.map((k) => `[${k.status}] ${k.assignee}: ${short(k.title, 120)}`).join('\n'));
  const now = lives(t).map((l) => {
    const step = (l.steps || []).filter((s) => s.status === 'running').pop();
    return `${l.name}: ${short(step ? step.name : l.what || 'working', 100)}`;
  });
  if (now.length) parts.push('Working now:\n' + now.join('\n'));
  const room = (r.messages || []).slice(-roomSize);
  if (room.length) parts.push('Room:\n' + room.map((m) => `${clock(m.t)} ${m.from}: ${short(m.text, 300)}`).join('\n'));
  return parts.join('\n\n');
}

module.exports = { overview, detail };
