import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Switch, Text, View } from 'react-native';
import { useSession } from '../src/lib/session';
import { PageHeader } from '../src/components/Page';
import { Empty, Group, Item } from '../src/components/ui';

/** Skills on the server, switched on and off. */
export default function Skills() {
  const { api, c } = useSession();
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api.get('/v1/x/skills').then((r) => setList(r.skills)).catch((e) => setError(e.message)); }, [api]);
  const toggle = async (s, on) => { setList((l) => l.map((x) => (x.name === s.name ? { ...x, enabled: on } : x))); try { await api.post(`/v1/x/skills/${encodeURIComponent(s.name)}`, { enabled: on }); } catch (e) { setError(e.message); } };
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <PageHeader title="Skills" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 40 }}>
        {!!error && <Text style={{ color: c.danger, margin: 8 }}>{error}</Text>}
        {!list && !error && <ActivityIndicator color={c.muted} style={{ marginTop: 30 }} />}
        {list && !list.length && <Empty text="No skills on the server yet." c={c} />}
        {list && list.length > 0 && <Group c={c}>{list.map((s) => <Item key={s.name} icon="star" title={s.name} subtitle={s.description.slice(0, 120)} right={<Switch value={s.enabled} onValueChange={(v) => toggle(s, v)} trackColor={{ true: c.accent, false: c.fill }} />} c={c} />)}</Group>}
      </ScrollView>
    </View>
  );
}
