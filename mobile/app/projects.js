import React, { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSession } from '../src/lib/session';
import { PageHeader } from '../src/components/Page';
import { Empty, Group, Item } from '../src/components/ui';
import { ProjectActions, ProjectEditor } from '../src/components/ProjectActions';

/** Projects on the server (the same list as the desktop): open one, make one, long press for edit, pin, delete. */
export default function Projects() {
  const { api, c } = useSession();
  const router = useRouter();
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const [making, setMaking] = useState(false);
  const [menu, setMenu] = useState(null);
  const load = useCallback(() => api.get('/v1/x/projects').then((r) => setList(r.projects)).catch((e) => setError(e.message)), [api]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const show = (p) => router.push(`/project?id=${encodeURIComponent(p.id)}`);
  const sorted = list ? [...list.filter((p) => p.pinned), ...list.filter((p) => !p.pinned)] : null;
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <PageHeader title="Projects" right={<Text onPress={() => setMaking(true)} style={{ color: c.accent, fontSize: 15 }}>New</Text>} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 40 }}>
        {!!error && <Text style={{ color: c.danger, margin: 8 }}>{error}</Text>}
        {!list && !error && <ActivityIndicator color={c.muted} style={{ marginTop: 30 }} />}
        {list && !list.length && <Empty text="No projects yet. Tap New to make one." c={c} />}
        {sorted && sorted.length > 0 && (
          <Group c={c} footer="Long press a project to edit, pin or delete it.">
            {sorted.map((p) => <Item key={p.id} icon={p.pinned ? 'bookmark' : 'folder'} title={p.name} subtitle={p.instructions ? p.instructions.slice(0, 80) : ''} onPress={() => show(p)} onLongPress={() => setMenu(p)} c={c} />)}
          </Group>
        )}
      </ScrollView>
      {making && <ProjectEditor project={null} onClose={() => setMaking(false)} onSaved={(p) => { setList((l) => [...(l || []), p]); show(p); }} />}
      {menu && <ProjectActions project={menu} onClose={() => setMenu(null)} onChanged={(p) => (p === null ? setList((l) => l.filter((x) => x.id !== menu.id)) : setList((l) => l.map((x) => (x.id === menu.id ? { ...x, ...p } : x))))} />}
    </View>
  );
}
