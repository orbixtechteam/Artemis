import React, { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useSession } from '../src/lib/session';
import { when } from '../src/lib/core';
import { PageHeader } from '../src/components/Page';
import { Empty, Group, Item } from '../src/components/ui';

/** Notes on the server: the list, and a note to read and edit. */
export default function Notes() {
  const { api, c } = useSession();
  const router = useRouter();
  const [list, setList] = useState(null);
  const [msg, setMsg] = useState('');
  useFocusEffect(useCallback(() => { api.get('/v1/x/notes').then((r) => setList(r.notes)).catch((e) => setMsg(e.message)); }, [api]));
  const show = (n) => router.push(`/note?path=${encodeURIComponent(n.path)}`);
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <PageHeader title="Notes" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 40 }}>
        {!!msg && <Text style={{ color: c.danger, margin: 8 }}>{msg}</Text>}
        {!list && !msg && <ActivityIndicator color={c.muted} style={{ marginTop: 30 }} />}
        {list && !list.length && <Empty text="No notes on the server yet. Ask Artemis to write one." c={c} />}
        {list && list.length > 0 && <Group c={c}>{list.map((n) => <Item key={n.path} icon="file-text" title={n.name.replace(/\.md$/, '')} subtitle={`${n.path.includes('/') ? n.path.split('/').slice(0, -1).join('/') + ' · ' : ''}${when(n.mtime)}`} onPress={() => show(n)} c={c} />)}</Group>}
      </ScrollView>
    </View>
  );
}
