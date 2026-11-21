import React, { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSession } from '../src/lib/session';
import { PageHeader } from '../src/components/Page';
import { Pill } from '../src/components/ui';

/** One note on the server: read and edit it. */
export default function NotePage() {
  const { path } = useLocalSearchParams();
  const { api, c } = useSession();
  const [note, setNote] = useState(null);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => { api.get(`/v1/x/notes/read?path=${encodeURIComponent(String(path))}`).then((r) => { setNote(r); setText(r.text || ''); }).catch((e) => setMsg(e.message)); }, [path]);
  const save = async () => { try { await api.post('/v1/x/notes/write', { path: note.path, text }); setNote({ ...note, text }); setMsg('Saved.'); } catch (e) { setMsg(e.message); } };
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: c.bg }}>
      <PageHeader title={String(path).split('/').pop().replace(/\.md$/, '')} icon="chevron-left" />
      {!note && !msg && <ActivityIndicator color={c.muted} style={{ marginTop: 40 }} />}
      {note && <TextInput value={text} onChangeText={(t) => { setText(t); setMsg(''); }} multiline textAlignVertical="top" editable={!note.truncated} style={{ flex: 1, color: c.text, fontSize: 16, lineHeight: 23, paddingHorizontal: 22, paddingTop: 6 }} />}
      <View style={{ padding: 16, gap: 8 }}>
        {!!msg && <Text style={{ color: c.muted, textAlign: 'center' }}>{msg}</Text>}
        {note && (note.truncated ? <Text style={{ color: c.muted, textAlign: 'center' }}>This note is long: edit it on the desktop.</Text> : <Pill title="Save" tone="accent" onPress={save} disabled={text === note.text} c={c} />)}
      </View>
    </KeyboardAvoidingView>
  );
}
