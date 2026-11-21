import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSession } from '../src/lib/session';
import { newChatId, when } from '../src/lib/core';
import { PageHeader } from '../src/components/Page';
import { Empty, Group, Icon, Item, Pill } from '../src/components/ui';
import { fileKind } from '../src/lib/render';
import { ProjectActions } from '../src/components/ProjectActions';

/** Bytes of a picked file as base64 (phone: expo-file-system; web: FileReader). */
async function readPicked(a) {
  if (Platform.OS === 'web' && a.file) return new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = () => no(r.error); r.readAsDataURL(a.file); });
  const FS = await import('expo-file-system');
  if (FS.File) return new FS.File(a.uri).base64();
  const L = await import('expo-file-system/legacy'); return L.readAsStringAsync(a.uri, { encoding: 'base64' });
}
const ICON = { csv: 'grid', sheet: 'grid', pdf: 'file-text', doc: 'file-text', md: 'file-text', image: 'image', text: 'file' };
const kb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round((n || 0) / 1024))} KB`);

/** One project: its instructions, its files (knowledge), its chats, a new chat in it. */
export default function ProjectPage() {
  const { id } = useLocalSearchParams();
  const { api, c } = useSession();
  const router = useRouter();
  const [p, setP] = useState(null);
  const [chats, setChats] = useState(null);
  const [error, setError] = useState('');
  const [menu, setMenu] = useState(false);
  const [adding, setAdding] = useState('');
  const addFiles = async () => {
    try {
      const DP = await import('expo-document-picker');
      const r = await DP.getDocumentAsync({ multiple: true, copyToCacheDirectory: true, type: '*/*' });
      if (r.canceled) return;
      for (const a of r.assets || []) {
        if (a.size && a.size > 30 * 1024 * 1024) { setError(`${a.name} is larger than 30 MB.`); continue; }
        setAdding(a.name);
        const data = await readPicked(a);
        const res = await api.post(`/v1/x/projects/${encodeURIComponent(String(id))}/files`, { name: a.name, data });
        setP((o) => ({ ...o, files: [...(o.files || []), res.file] }));
      }
    } catch (e) { setError(e.message); } finally { setAdding(''); }
  };
  const removeFile = (f) => {
    const go = async () => { try { await api.del(`/v1/x/projects/${encodeURIComponent(String(id))}/files/${encodeURIComponent(f.id)}`); setP((o) => ({ ...o, files: (o.files || []).filter((x) => x.id !== f.id) })); } catch (e) { setError(e.message); } };
    if (Platform.OS === 'web') { if (globalThis.confirm(`Remove ${f.name} from the project?`)) go(); return; }
    Alert.alert('Remove file', `Remove ${f.name} from the project?`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: go }]);
  };
  useFocusEffect(useCallback(() => {
    api.get('/v1/x/projects').then((r) => setP(r.projects.find((x) => x.id === String(id)) || null)).catch((e) => setError(e.message));
    api.get(`/v1/sessions?limit=100&project_id=${encodeURIComponent(String(id))}`).then((r) => setChats(r.sessions)).catch((e) => setError(e.message));
  }, [id]));
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <PageHeader title={p ? p.name : 'Project'} icon="chevron-left" right={p ? <Text onPress={() => setMenu(true)} style={{ color: c.accent, fontSize: 15 }}>Edit</Text> : null} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 40 }}>
        {!!error && <Text style={{ color: c.danger, margin: 8 }}>{error}</Text>}
        {p && (
          <View style={{ backgroundColor: c.card, borderRadius: 18, borderWidth: 1, borderColor: c.line, padding: 14, marginBottom: 18 }}>
            <Text style={{ color: c.muted, fontSize: 13, marginBottom: 6 }}>Project instructions</Text>
            <Text style={{ color: p.instructions ? c.text : c.faint, fontSize: 15, lineHeight: 21 }} onPress={() => setMenu(true)}>{p.instructions || 'None yet. Tap Edit to add some: they go with every chat in this project.'}</Text>
          </View>
        )}
        {p && (
          <View style={{ backgroundColor: c.card, borderRadius: 18, borderWidth: 1, borderColor: c.line, paddingVertical: 10, marginBottom: 18 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingBottom: 4 }}>
              <Text style={{ flex: 1, color: c.muted, fontSize: 13 }}>Project files</Text>
              <Text onPress={adding ? undefined : addFiles} style={{ color: adding ? c.faint : c.accent, fontSize: 14 }}>{adding ? `Adding ${adding}…` : 'Add files'}</Text>
            </View>
            {!(p.files || []).length && <Text style={{ color: c.faint, fontSize: 15, paddingHorizontal: 14, paddingVertical: 6 }}>No files yet. Their text goes with every chat in this project, like the instructions.</Text>}
            {(p.files || []).map((f) => (
              <Pressable key={f.id} onPress={() => f.path && router.push(`/file?path=${encodeURIComponent(f.path)}&name=${encodeURIComponent(f.name)}`)} onLongPress={() => removeFile(f)}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: pressed ? c.fill : 'transparent' })}>
                <Icon name={ICON[fileKind(f.name)] || 'file'} size={18} color={c.muted} />
                <Text numberOfLines={1} style={{ flex: 1, color: c.text, fontSize: 15 }}>{f.name}</Text>
                <Text style={{ color: c.muted, fontSize: 13 }}>{kb(f.size)}</Text>
                <Pressable onPress={() => removeFile(f)} hitSlop={10}><Icon name="x" size={16} color={c.faint} /></Pressable>
              </Pressable>
            ))}
          </View>
        )}
        <View style={{ marginBottom: 22 }}><Pill title="New chat in this project" icon="plus" onPress={() => router.push(`/chat/${newChatId()}?fresh=1&project=${encodeURIComponent(String(id))}`)} c={c} /></View>
        {!chats && <ActivityIndicator color={c.muted} />}
        {chats && !chats.length && <Empty text="No chats in this project yet." c={c} />}
        {menu && p && <ProjectActions project={p} onClose={() => setMenu(false)} onChanged={(x) => (x === null ? router.back() : setP((o) => ({ ...o, ...x })))} />}
        {chats && chats.length > 0 && <Group title="Chats" c={c}>{chats.map((x) => <Item key={x.id} icon="message-circle" title={x.title} value={when(x.updatedAt)} onPress={() => router.push(`/chat/${encodeURIComponent(x.id)}`)} c={c} />)}</Group>}
      </ScrollView>
    </View>
  );
}
