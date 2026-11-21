import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { useSession } from '../src/lib/session';
import { PageHeader } from '../src/components/Page';
import { Empty, Icon } from '../src/components/ui';

/** Long-term memory on the server: what Artemis knows (MEMORY.md), search over all memory, adding a fact. */
export default function Memory() {
  const { api, c } = useSession();
  const [entries, setEntries] = useState(null);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState(null);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');
  const load = useCallback(() => api.get('/v1/memory/list').then((r) => setEntries(r.entries)).catch((e) => { setEntries([]); setMsg(e.status === 404 ? 'Memory is off on the server.' : e.message); }), [api]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!q.trim()) { setHits(null); return; }
    const t = setTimeout(() => api.get(`/v1/memory?q=${encodeURIComponent(q)}&limit=12`).then((r) => setHits(r.hits)).catch(() => {}), 300);
    return () => clearTimeout(t);
  }, [q]);
  const add = async () => {
    if (!text.trim()) return;
    try { const r = await api.post('/v1/memory', { text: text.trim() }); setText(''); setMsg(r.entry && r.entry.duplicate ? 'Already remembered.' : 'Remembered.'); load(); } catch (e) { setMsg(e.message); }
  };
  const data = hits ? hits.map((h, i) => ({ id: 'h' + i, text: h.text, sub: `${h.path}:${h.from}` })) : (entries || []).map((e) => ({ id: e.id, text: e.text }));
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <PageHeader title="Memory" />
      <View style={{ paddingHorizontal: 18, gap: 10, marginBottom: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: c.round, borderRadius: 999, paddingHorizontal: 16, borderWidth: 1, borderColor: c.line }}>
          <Icon name="search" size={19} color={c.muted} />
          <TextInput value={q} onChangeText={setQ} placeholder="Search memory" placeholderTextColor={c.faint} style={{ flex: 1, paddingVertical: 13, paddingHorizontal: 10, fontSize: 17, color: c.text }} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: c.card, borderRadius: 999, paddingLeft: 18, padding: 6, borderWidth: 1, borderColor: c.line }}>
          <TextInput value={text} onChangeText={setText} placeholder="Something Artemis should remember" placeholderTextColor={c.faint} onSubmitEditing={add} style={{ flex: 1, fontSize: 16, color: c.text, paddingVertical: 8 }} />
          <Pressable onPress={add} disabled={!text.trim()} style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: text.trim() ? c.accent : c.fill, alignItems: 'center', justifyContent: 'center' }}><Icon name="plus" size={22} color={text.trim() ? c.accentText : c.muted} /></Pressable>
        </View>
        {!!msg && <Text style={{ color: c.muted, marginLeft: 8 }}>{msg}</Text>}
      </View>
      {!entries ? <ActivityIndicator color={c.muted} style={{ marginTop: 30 }} /> : (
        <FlatList data={data} keyExtractor={(x) => x.id} contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 40 }}
          ListEmptyComponent={<Empty text={hits ? 'Nothing found.' : 'Nothing remembered yet.'} c={c} />}
          renderItem={({ item }) => (
            <View style={{ backgroundColor: c.card, borderRadius: 18, padding: 16, marginTop: 10 }}>
              <Text selectable style={{ color: c.text, fontSize: 16, lineHeight: 22 }}>{item.text}</Text>
              {!!item.sub && <Text style={{ color: c.muted, fontSize: 13, marginTop: 4 }}>{item.sub}</Text>}
            </View>
          )} />
      )}
    </View>
  );
}
