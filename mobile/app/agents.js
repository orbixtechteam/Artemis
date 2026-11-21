import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSession } from '../src/lib/session';
import { when } from '../src/lib/core';
import { PageHeader } from '../src/components/Page';
import { Empty, Group, Item, Pill } from '../src/components/ui';
import { Choice, F, FormSheet } from '../src/components/Form';

const ask = (title, msg, ok) => { if (Platform.OS === 'web') { if (globalThis.confirm(`${title}\n\n${msg}`)) ok(); } else Alert.alert(title, msg, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: ok }]); };
const REPEAT = [['', 'No'], ['daily', 'Every day'], ['weekdays', 'Weekdays'], ['weekly', 'Weekly']];
const DAYS = [[1, 'Mo'], [2, 'Tu'], [3, 'We'], [4, 'Th'], [5, 'Fr'], [6, 'Sa'], [0, 'Su']];

function AgentEditor({ agent, onClose, onSaved }) {
  const { api } = useSession();
  const [a, setA] = useState({ name: '', role: '', description: '', body: '', ...(agent || {}) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (v) => setA((x) => ({ ...x, [k]: v }));
  const save = async () => { setBusy(true); setError(''); try { await api.post('/v1/x/agents', a); onSaved(); onClose(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const del = agent && !agent.builtin ? () => ask('Delete agent', `Delete ${agent.name}?`, async () => { try { await api.del(`/v1/x/agents/${encodeURIComponent(agent.name)}`); onSaved(); onClose(); } catch (e) { setError(e.message); } }) : null;
  return (
    <FormSheet title={agent ? agent.name : 'New agent'} onClose={onClose} onSave={save} onDelete={del} saving={busy} error={error}>
      <F label="Name" value={a.name} onChange={set('name')} placeholder="Athena" />
      <F label="Role" value={a.role} onChange={set('role')} placeholder="Researcher" />
      <F label="When to use it" value={a.description} onChange={set('description')} placeholder="Finds and checks facts…" />
      <F label="Instructions" value={a.body} onChange={set('body')} multiline placeholder="How this agent works, what it returns…" />
    </FormSheet>
  );
}

function TeamEditor({ team, agents, onClose, onSaved }) {
  const { api } = useSession();
  const [t, setT] = useState({ name: '', goal: '', members: [], rules: '', ...(team || {}) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const r = t.repeat || {};
  const save = async () => {
    setBusy(true); setError('');
    try { await api.post('/v1/teams', { ...t, members: (t.members || []).map((m) => (typeof m === 'string' ? { name: m } : m)) }); onSaved(); onClose(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const del = team ? () => ask('Delete team', `Delete ${team.name}?`, async () => { try { await api.del(`/v1/teams/${encodeURIComponent(team.id)}`); onSaved(); onClose(); } catch (e) { setError(e.message); } }) : null;
  return (
    <FormSheet title={team ? team.name : 'New team'} onClose={onClose} onSave={save} onDelete={del} saving={busy} error={error}>
      <F label="Name" value={t.name} onChange={(v) => setT({ ...t, name: v })} placeholder="Growth team" />
      <F label="Goal" value={t.goal} onChange={(v) => setT({ ...t, goal: v })} multiline placeholder="What the team should get done" />
      <Choice label="Members" multi value={(t.members || []).map((m) => (typeof m === 'string' ? m : m.name))} options={agents.map((a) => [a.name, a.name])} onChange={(names) => setT({ ...t, members: names.map((n) => ({ name: n })) })} />
      <F label="Rules (optional)" value={t.rules || ''} onChange={(v) => setT({ ...t, rules: v })} multiline placeholder="Anything every member must follow" />
      <Choice label="Runs again by itself" value={r.type || ''} options={REPEAT} onChange={(v) => setT({ ...t, repeat: v ? { type: v, at: r.at || '09:00', ...(v === 'weekly' ? { days: r.days || [1] } : {}) } : null })} />
      {!!r.type && <F label="At (HH:MM)" value={r.at || '09:00'} onChange={(v) => setT({ ...t, repeat: { ...r, at: v } })} placeholder="09:00" />}
      {r.type === 'weekly' && <Choice label="Days" multi value={r.days || []} options={DAYS} onChange={(v) => setT({ ...t, repeat: { ...r, days: v } })} />}
    </FormSheet>
  );
}

/** Helper agents and agent teams: run, make and change them. */
export default function Agents() {
  const { api, c } = useSession();
  const [agents, setAgents] = useState(null);
  const [teams, setTeams] = useState([]);
  const [error, setError] = useState('');
  const [edit, setEdit] = useState(null); // { kind: 'agent'|'team', item }
  const load = useCallback(() => {
    api.get('/v1/x/agents').then((r) => setAgents(r.agents)).catch((e) => setError(e.message));
    api.get('/v1/teams').then((r) => setTeams(r.teams || [])).catch(() => {});
  }, [api]);
  useEffect(() => { load(); const t = setInterval(load, 8000); return () => clearInterval(t); }, [load]);
  const act = async (id, what) => { try { await api.post(`/v1/teams/${encodeURIComponent(id)}/${what}`, {}); load(); } catch (e) { setError(e.message); } };
  const btn = (label, onPress, tone) => <Pressable onPress={onPress} hitSlop={6} style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, backgroundColor: tone === 'accent' ? c.accent : c.fill, marginLeft: 6 }}><Text style={{ color: tone === 'accent' ? c.accentText : c.text, fontSize: 14 }}>{label}</Text></Pressable>;
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <PageHeader title="Agents" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 40 }}>
        {!!error && <Text style={{ color: c.danger, margin: 8 }}>{error}</Text>}
        {!agents && !error && <ActivityIndicator color={c.muted} style={{ marginTop: 30 }} />}
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}>
          <View style={{ flex: 1 }}><Pill title="New agent" icon="user-plus" tone="quiet" onPress={() => setEdit({ kind: 'agent' })} c={c} /></View>
          <View style={{ flex: 1 }}><Pill title="New team" icon="users" tone="quiet" onPress={() => setEdit({ kind: 'team' })} c={c} /></View>
        </View>
        {teams.length > 0 && (
          <Group title="Teams" c={c}>
            {teams.map((t) => {
              const st = (t.run && t.run.status) || 'idle';
              return <Item key={t.id} icon="users" title={t.name} onPress={() => setEdit({ kind: 'team', item: t })} subtitle={`${st}${t.updatedAt ? ' · ' + when(t.updatedAt) : ''}${t.goal ? ' · ' + t.goal.slice(0, 60) : ''}`} c={c}
                right={<View style={{ flexDirection: 'row' }}>{st === 'working' ? btn('Pause', () => act(t.id, 'pause')) : st === 'paused' ? btn('Resume', () => act(t.id, 'resume'), 'accent') : btn('Start', () => act(t.id, 'start'), 'accent')}{st === 'working' || st === 'paused' ? btn('Stop', () => act(t.id, 'stop')) : null}</View>} />;
            })}
          </Group>
        )}
        {agents && (agents.length ? (
          <Group title="Agents" c={c} footer="Artemis hands parts of the work to these agents when Helper agents is on (composer +).">
            {agents.map((a) => <Item key={a.name} icon="user" title={a.name} subtitle={[a.role, a.description].filter(Boolean).join(' · ').slice(0, 120)} onPress={() => setEdit({ kind: 'agent', item: a })} c={c} />)}
          </Group>
        ) : <Empty text="No agents yet." c={c} />)}
      </ScrollView>
      {edit && edit.kind === 'agent' && <AgentEditor agent={edit.item} onClose={() => setEdit(null)} onSaved={load} />}
      {edit && edit.kind === 'team' && <TeamEditor team={edit.item} agents={agents || []} onClose={() => setEdit(null)} onSaved={load} />}
    </View>
  );
}
