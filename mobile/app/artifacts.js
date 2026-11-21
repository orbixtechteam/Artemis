import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSession } from '../src/lib/session';
import { when } from '../src/lib/core';
import { PageHeader } from '../src/components/Page';
import { Empty, Group, Item, Pill } from '../src/components/ui';

const KIND = { html: 'Web page', svg: 'SVG', markdown: 'Document', spreadsheet: 'Spreadsheet', code: 'Code' };
const ICON = { html: 'globe', svg: 'image', markdown: 'file-text', spreadsheet: 'grid', code: 'code' };

/** Artifacts from the server's chats; one opened shows its latest version. */
export default function Artifacts() {
  const { api, c } = useSession();
  const router = useRouter();
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api.get('/v1/x/artifacts').then((r) => setList(r.artifacts)).catch((e) => setError(e.message)); }, [api]);
  const show = (a) => router.push(`/artifact?id=${encodeURIComponent(a.id)}`);
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <PageHeader title="Artifacts" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 40 }}>
        {!!error && <Text style={{ color: c.danger, margin: 8 }}>{error}</Text>}
        {!list && !error && <ActivityIndicator color={c.muted} style={{ marginTop: 30 }} />}
        {list && !list.length && <Empty text="No artifacts yet. Documents, pages and code Artemis makes in chats show up here." c={c} />}
        {list && list.length > 0 && <Group c={c}>{list.map((a) => <Item key={a.chatId + a.id} icon={ICON[a.type] || 'file'} title={a.title} subtitle={`${KIND[a.type] || a.type} · ${a.chatTitle} · ${when(a.updatedAt)}`} onPress={() => show(a)} c={c} />)}</Group>}
      </ScrollView>
    </View>
  );
}
