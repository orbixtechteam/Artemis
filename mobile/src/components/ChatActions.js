// What you can do with a chat, as in the desktop's right-click menu: rename, pin, move to a project, delete.
// Long press a chat on the home page, or tap the title inside a chat.
import React, { useEffect, useState } from 'react';
import { Alert, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '../lib/session';
import { Icon, Pill } from './ui';

const confirm = (title, message, ok) => {
  if (Platform.OS === 'web') { if (globalThis.confirm(`${title}\n\n${message}`)) ok(); return; }
  Alert.alert(title, message, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: ok }]);
};

/** chat: { id, title, pinned, projectId }; onChanged(patch | null when deleted). */
export function ChatActions({ chat, onClose, onChanged }) {
  const { api, c } = useSession();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState('');
  const [title, setTitle] = useState(chat.title || '');
  const [projects, setProjects] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => { api.get('/v1/x/projects').then((r) => setProjects(r.projects || [])).catch(() => {}); }, []);
  const patch = async (p) => { try { await api.post(`/v1/x/sessions/${encodeURIComponent(chat.id)}`, p); onChanged(p); onClose(); } catch (e) { setError(e.message); } };
  const remove = () => confirm('Delete chat', `Delete "${chat.title || 'this chat'}"? It is removed for every device.`, async () => {
    try { await api.del(`/v1/x/sessions/${encodeURIComponent(chat.id)}`); onChanged(null); onClose(); } catch (e) { setError(e.message); }
  });
  const row = (icon, label, onPress, danger) => (
    <Pressable onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 22, paddingVertical: 16, backgroundColor: pressed ? c.fill : 'transparent' })}>
      <View style={{ width: 36 }}><Icon name={icon} size={21} color={danger ? c.danger : c.text} /></View>
      <Text style={{ color: danger ? c.danger : c.text, fontSize: 17 }}>{label}</Text>
    </Pressable>
  );
  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: c.scrim, justifyContent: 'flex-end' }}>
        <Pressable onPress={() => {}} style={{ backgroundColor: c.side, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 10, paddingBottom: insets.bottom + 12, maxHeight: '80%' }}>
          <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: c.line, marginBottom: 8 }} />
          <Text style={{ color: c.muted, fontSize: 15, textAlign: 'center', marginHorizontal: 24, marginBottom: 6 }} numberOfLines={1}>{chat.title || 'Untitled'}</Text>
          {!!error && <Text style={{ color: c.danger, textAlign: 'center', marginBottom: 6 }}>{error}</Text>}
          {mode === 'rename' ? (
            <View style={{ padding: 18, gap: 12 }}>
              <TextInput value={title} onChangeText={setTitle} autoFocus selectTextOnFocus onSubmitEditing={() => title.trim() && patch({ title: title.trim() })}
                style={{ borderRadius: 16, padding: 14, fontSize: 17, color: c.text, backgroundColor: c.card, borderWidth: 1, borderColor: c.line }} />
              <Pill title="Save" tone="accent" disabled={!title.trim()} onPress={() => patch({ title: title.trim() })} c={c} />
            </View>
          ) : mode === 'move' ? (
            <ScrollView>
              {row(chat.projectId ? 'x' : 'check', 'No project', () => patch({ projectId: null }))}
              {projects.map((p) => <View key={p.id}>{row(p.id === chat.projectId ? 'check' : 'folder', p.name, () => patch({ projectId: p.id }))}</View>)}
            </ScrollView>
          ) : (
            <View>
              {row('edit-2', 'Rename', () => setMode('rename'))}
              {row('bookmark', chat.pinned ? 'Unpin' : 'Pin', () => patch({ pinned: !chat.pinned }))}
              {row('folder', chat.projectId ? 'Move to another project' : 'Add to a project', () => setMode('move'))}
              {row('trash-2', 'Delete', remove, true)}
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
