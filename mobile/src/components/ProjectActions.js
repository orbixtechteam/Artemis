// What you can do with a project, as in the desktop's right-click menu: open, new chat in it, edit (name and
// instructions), pin, delete. Long press a project on the home page or the Projects page, or "Edit" on a project.
import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '../lib/session';
import { newChatId } from '../lib/core';
import { Icon, Pill } from './ui';

const confirm = (title, message, ok) => {
  if (Platform.OS === 'web') { if (globalThis.confirm(`${title}\n\n${message}`)) ok(); return; }
  Alert.alert(title, message, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: ok }]);
};

/** The project's name and instructions (also used to make a new one: project = null). onSaved(project). */
export function ProjectEditor({ project, onClose, onSaved }) {
  const { api, c } = useSession();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState(project ? project.name || '' : '');
  const [instr, setInstr] = useState(project ? project.instructions || '' : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true); setError('');
    try {
      const r = project ? await api.post(`/v1/x/projects/${encodeURIComponent(project.id)}`, { name: name.trim(), instructions: instr })
        : await api.post('/v1/x/projects', { name: name.trim(), instructions: instr });
      onSaved(r.project); onClose();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const field = { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: c.text, backgroundColor: c.card, borderWidth: 1, borderColor: c.line };
  return (
    <Modal animationType="slide" visible presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: c.side }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16 }}>
          <Text onPress={onClose} style={{ color: c.muted, fontSize: 16, width: 70 }}>Cancel</Text>
          <Text style={{ flex: 1, textAlign: 'center', color: c.text, fontSize: 18, fontWeight: '700' }}>{project ? 'Edit project' : 'New project'}</Text>
          <Text onPress={save} style={{ color: name.trim() ? c.accent : c.faint, fontSize: 16, fontWeight: '600', width: 70, textAlign: 'right' }}>{busy ? 'Saving…' : 'Save'}</Text>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: insets.bottom + 30 }}>
          <Text style={{ color: c.muted, fontSize: 14, marginBottom: 7, marginLeft: 6 }}>Name</Text>
          <TextInput value={name} onChangeText={setName} autoFocus={!project} placeholder="Project name" placeholderTextColor={c.faint} style={[field, { marginBottom: 18 }]} />
          <Text style={{ color: c.muted, fontSize: 14, marginBottom: 7, marginLeft: 6 }}>Project instructions</Text>
          <TextInput value={instr} onChangeText={setInstr} multiline textAlignVertical="top" placeholder="e.g. This project is for client reports. Write formally." placeholderTextColor={c.faint} style={[field, { minHeight: 180 }]} />
          <Text style={{ color: c.muted, fontSize: 13, marginTop: 8, marginLeft: 6 }}>Added to every chat in this project, here and on the desktop.</Text>
          {!!error && <Text style={{ color: c.danger, marginTop: 12, marginLeft: 6 }}>{error}</Text>}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** project: { id, name, pinned, ... }; onChanged(patch | null when deleted). */
export function ProjectActions({ project, onClose, onChanged }) {
  const { api, c } = useSession();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const patch = async (p) => { try { await api.post(`/v1/x/projects/${encodeURIComponent(project.id)}`, p); onChanged(p); onClose(); } catch (e) { setError(e.message); } };
  const remove = () => confirm('Delete project', `Delete "${project.name}"? Its chats stay, without a project.`, async () => {
    try { await api.del(`/v1/x/projects/${encodeURIComponent(project.id)}`); onChanged(null); onClose(); } catch (e) { setError(e.message); }
  });
  const go = (p) => { onClose(); router.push(p); };
  const row = (icon, label, onPress, danger) => (
    <Pressable onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 22, paddingVertical: 16, backgroundColor: pressed ? c.fill : 'transparent' })}>
      <View style={{ width: 36 }}><Icon name={icon} size={21} color={danger ? c.danger : c.text} /></View>
      <Text style={{ color: danger ? c.danger : c.text, fontSize: 17 }}>{label}</Text>
    </Pressable>
  );
  if (editing) return <ProjectEditor project={project} onClose={onClose} onSaved={(p) => onChanged(p)} />;
  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: c.scrim, justifyContent: 'flex-end' }}>
        <Pressable onPress={() => {}} style={{ backgroundColor: c.side, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 10, paddingBottom: insets.bottom + 12 }}>
          <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: c.line, marginBottom: 8 }} />
          <Text style={{ color: c.muted, fontSize: 15, textAlign: 'center', marginHorizontal: 24, marginBottom: 6 }} numberOfLines={1}>{project.name}</Text>
          {!!error && <Text style={{ color: c.danger, textAlign: 'center', marginBottom: 6 }}>{error}</Text>}
          {row('folder', 'Open', () => go(`/project?id=${encodeURIComponent(project.id)}`))}
          {row('plus', 'New chat in project', () => go(`/chat/${newChatId()}?fresh=1&project=${encodeURIComponent(project.id)}`))}
          {row('edit-2', 'Edit name and instructions', () => setEditing(true))}
          {row('bookmark', project.pinned ? 'Unpin' : 'Pin', () => patch({ pinned: !project.pinned }))}
          {row(project.sideHidden ? 'eye' : 'eye-off', project.sideHidden ? 'Show on home' : 'Hide from home', () => patch({ sideHidden: !project.sideHidden }))}
          {row('trash-2', 'Delete', remove, true)}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
