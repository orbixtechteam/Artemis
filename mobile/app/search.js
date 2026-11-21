import React, { useEffect, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSession } from '../src/lib/session';
import { when } from '../src/lib/core';
import { PageHeader } from '../src/components/Page';
import { Empty, Icon } from '../src/components/ui';

/** Full-text search over the server's chats. */
export default function Search() {
  const { api, c } = useSession();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState(null);
  useEffect(() => {
    const t = setTimeout(() => {
      const p = q.trim() ? `/v1/search?q=${encodeURIComponent(q)}&limit=40` : '/v1/sessions?limit=40';
      api.get(p).then((r) => setHits(r.hits || r.sessions)).catch(() => setHits([]));
    }, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <PageHeader title="Search" sheet />
      <View style={{ marginHorizontal: 18, marginBottom: 10, flexDirection: 'row', alignItems: 'center', backgroundColor: c.round, borderRadius: 999, paddingHorizontal: 16, borderWidth: 1, borderColor: c.line }}>
        <Icon name="search" size={19} color={c.muted} />
        <TextInput value={q} onChangeText={setQ} autoFocus placeholder="Search chats" placeholderTextColor={c.faint} style={{ flex: 1, paddingVertical: 13, paddingHorizontal: 10, fontSize: 17, color: c.text }} />
      </View>
      <FlatList data={hits || []} keyExtractor={(x) => x.id} contentContainerStyle={{ paddingBottom: 40 }}
        ListEmptyComponent={hits ? <Empty text={q ? 'No chat matches.' : 'No chats yet.'} c={c} /> : null}
        renderItem={({ item }) => (
          <Pressable onPress={() => { router.back(); setTimeout(() => router.push(`/chat/${encodeURIComponent(item.id)}`), 10); }}
            style={({ pressed }) => ({ paddingHorizontal: 24, paddingVertical: 13, backgroundColor: pressed ? c.fill : 'transparent' })}>
            <View style={{ flexDirection: 'row' }}>
              <Text style={{ flex: 1, color: c.text, fontSize: 17 }} numberOfLines={1}>{item.title || 'Untitled'}</Text>
              <Text style={{ color: c.muted, fontSize: 14, marginLeft: 8 }}>{when(item.updatedAt)}</Text>
            </View>
            {!!item.snippet && <Text style={{ color: c.muted, fontSize: 14, marginTop: 3 }} numberOfLines={2}>{item.snippet}</Text>}
          </Pressable>
        )} />
    </View>
  );
}
