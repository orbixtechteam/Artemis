import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { useSession } from '../src/lib/session';
import { when } from '../src/lib/core';
import { PageHeader } from '../src/components/Page';
import { Empty, Group, Item, Pill } from '../src/components/ui';
import { Choice, F, FormSheet } from '../src/components/Form';

const next = (t) => (t ? new Date(t).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' }) : '');
const ask = (title, msg, ok) => { if (Platform.OS === 'web') { if (globalThis.confirm(`${title}\n\n${msg}`)) ok(); } else Alert.alert(title, msg, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: ok }]); };
const TYPES = [['daily', 'Every day'], ['weekdays', 'Weekdays'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['interval', 'Every N minutes'], ['once', 'Once']];
const DAYS = [[1, 'Mo'], [2, 'Tu'], [3, 'We'], [4, 'Th'], [5, 'Fr'], [6, 'Sa'], [0, 'Su']];
const today = () => { const d = new Date(Date.now() + 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

function Editor({ job, projects, onClose, onSaved }) {
  const { api } = useSession();
  const [j, setJ] = useState({ name: '', prompt: '', enabled: true, notifyPhone: false, allowEdits: false, projectId: null, repeat: { type: 'daily', at: '08:00' }, ...(job || {}) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const r = j.repeat || {};
  const setR = (patch) => setJ({ ...j, repeat: { ...r, ...patch } });
  const save = async () => {
    setBusy(true); setError('');
    const repeat = { type: r.type, ...(r.type !== 'interval' ? { at: r.at || '08:00' } : {}), ...(r.type === 'interval' ? { every: Number(r.every) || 60 } : {}), ...(r.type === 'weekly' ? { days: r.days && r.days.length ? r.days : [1] } : {}), ...(r.type === 'monthly' ? { dayOfMonth: Number(r.dayOfMonth) || 1 } : {}), ...(r.type === 'once' ? { date: r.date || today() } : {}) };
    try { await api.post('/v1/x/schedules', { ...j, repeat }); onSaved(); onClose(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const del = job ? () => ask('Delete task', `Delete "${job.name}"?`, async () => { try { await api.del(`/v1/x/schedules/${encodeURIComponent(job.id)}`); onSaved(); onClose(); } catch (e) { setError(e.message); } }) : null;
  return (
    <FormSheet title={job ? job.name : 'New scheduled task'} onClose={onClose} onSave={save} onDelete={del} saving={busy} error={error}>
      <F label="Name" value={j.name} onChange={(v) => setJ({ ...j, name: v })} placeholder="Morning brief" />
      <F label="What Artemis should do" value={j.prompt} onChange={(v) => setJ({ ...j, prompt: v })} multiline placeholder="Summarize my new emails and today's calendar…" />
      <Choice label="How often" value={r.type} options={TYPES} onChange={(v) => setR({ type: v })} />
      {r.type === 'interval' ? <F label="Every (minutes)" value={String(r.every || 60)} onChange={(v) => setR({ every: v.replace(/\D/g, '') })} keyboardType="number-pad" />
        : <F label="At (HH:MM)" value={r.at || '08:00'} onChange={(v) => setR({ at: v })} placeholder="08:00" />}
      {r.type === 'weekly' && <Choice label="Days" multi value={r.days || []} options={DAYS} onChange={(v) => setR({ days: v })} />}
      {r.type === 'monthly' && <F label="Day of the month" value={String(r.dayOfMonth || 1)} onChange={(v) => setR({ dayOfMonth: v.replace(/\D/g, '') })} keyboardType="number-pad" />}
      {r.type === 'once' && <F label="Date (YYYY-MM-DD)" value={r.date || today()} onChange={(v) => setR({ date: v })} />}
      {projects.length > 0 && <Choice label="Project" value={j.projectId || ''} options={[['', 'None'], ...projects.map((p) => [p.id, p.name])]} onChange={(v) => setJ({ ...j, projectId: v || null })} />}
      <Choice label="Options" multi value={[j.notifyPhone && 'phone', j.allowEdits && 'edits'].filter(Boolean)} options={[['phone', 'Send the result to Telegram'], ['edits', 'May change files without asking']]} onChange={(v) => setJ({ ...j, notifyPhone: v.includes('phone'), allowEdits: v.includes('edits') })} />
    </FormSheet>
  );
}

/** Scheduled tasks on the server: make, change, switch on/off, run now. */
export default function Scheduled() {
  const { api, c } = useSession();
  const [list, setList] = useState(null);
  const [projects, setProjects] = useState([]);
  const [edit, setEdit] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api.get('/v1/x/schedules').then((r) => setList(r.schedules)).catch((e) => setError(e.message)), [api]);
  useEffect(() => { load(); api.get('/v1/x/projects').then((r) => setProjects(r.projects || [])).catch(() => {}); }, [load]);
  const toggle = async (j, on) => { setList((l) => l.map((x) => (x.id === j.id ? { ...x, enabled: on } : x))); try { await api.post(`/v1/x/schedules/${encodeURIComponent(j.id)}`, { enabled: on }); load(); } catch (e) { setError(e.message); load(); } };
  const runNow = async (j) => { try { await api.post(`/v1/x/schedules/${encodeURIComponent(j.id)}/run`, {}); setTimeout(load, 1500); } catch (e) { setError(e.message); } };
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <PageHeader title="Scheduled" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 40 }}>
        {!!error && <Text style={{ color: c.danger, margin: 8 }}>{error}</Text>}
        <View style={{ marginBottom: 20 }}><Pill title="New scheduled task" icon="plus" tone="quiet" onPress={() => setEdit({})} c={c} /></View>
        {!list && !error && <ActivityIndicator color={c.muted} style={{ marginTop: 30 }} />}
        {list && !list.length && <Empty text="No scheduled tasks yet." c={c} />}
        {list && list.length > 0 && (
          <Group c={c} footer="They run on the server, also while your phone and computer are off.">
            {list.map((j) => (
              <Item key={j.id} icon={j.teamId ? 'users' : 'clock'} title={j.name} onPress={j.teamId ? undefined : () => setEdit({ job: j })}
                subtitle={`${j.description || ''}${j.enabled && j.nextRun ? ' · next ' + next(j.nextRun) : ''}${j.lastRun ? ` · last ${when(j.lastRun)}${j.lastStatus === 'error' ? ' (failed)' : ''}` : ''}${j.running ? ' · running' : ''}`}
                right={<View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Pressable onPress={() => runNow(j)} hitSlop={6}><Text style={{ color: c.accent, fontSize: 14 }}>Run</Text></Pressable>
                  <Switch value={!!j.enabled} onValueChange={(v) => toggle(j, v)} trackColor={{ true: c.accent, false: c.fill }} />
                </View>} c={c} />
            ))}
          </Group>
        )}
      </ScrollView>
      {edit && <Editor job={edit.job} projects={projects} onClose={() => setEdit(null)} onSaved={load} />}
    </View>
  );
}
