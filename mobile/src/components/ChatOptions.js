// The composer's "+" menu and the pills above the composer, as in the desktop: photos, brain (or the council),
// tools, helper agents, thinking level, ask-before-acting and the project. They belong to the chat (saved on the server).
import React, { useState } from 'react';
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from './ui';

export const DEFAULT_OPTS = { brain: '', tools: 'on', agents: 'on', effort: 'auto', perm: 'ask' };

function Chips({ value, options, onPick, c }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 18, paddingBottom: 6 }}>
      {options.map(([k, label]) => (
        <Pressable key={k} onPress={() => onPick(k)} style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: value === k ? c.accent : c.fill, borderWidth: 1, borderColor: value === k ? c.accent : c.line }}>
          <Text style={{ color: value === k ? c.accentText : c.text, fontSize: 15 }}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}
const Head = ({ children, c }) => <Text style={{ color: c.muted, fontSize: 14, marginTop: 18, marginBottom: 8, marginLeft: 20 }}>{children}</Text>;

/** The "+" sheet. opts: { brain, tools, agents, effort, perm, projectId }; set(patch). */
export function OptionsSheet({ opts, set, brains = [], projects = [], onPhotos, onFiles, onNewProject, onCompact, onClose, c }) {
  const insets = useSafeAreaInsets();
  const [naming, setNaming] = useState(null); // the new project's name while it is typed
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const create = async () => {
    const name = (naming || '').trim();
    if (!name || busy) return;
    setBusy(true); setErr('');
    try { await onNewProject(name); setNaming(null); Keyboard.dismiss(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const row = (icon, title, sub, onPress, right) => (
    <Pressable onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, backgroundColor: pressed ? c.fill : 'transparent' })}>
      <View style={{ width: 34 }}><Icon name={icon} size={21} color={c.text} /></View>
      <View style={{ flex: 1 }}><Text style={{ color: c.text, fontSize: 17 }}>{title}</Text>{sub ? <Text style={{ color: c.muted, fontSize: 13, marginTop: 2 }}>{sub}</Text> : null}</View>
      {right}
    </Pressable>
  );
  const toggle = (on) => <View style={{ width: 50, height: 30, borderRadius: 15, backgroundColor: on ? c.accent : c.fill, padding: 3, alignItems: on ? 'flex-end' : 'flex-start' }}><View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: on ? c.accentText : c.muted }} /></View>;
  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: c.scrim, justifyContent: 'flex-end' }}>
        <Pressable onPress={() => {}} style={{ backgroundColor: c.side, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '85%', paddingTop: 10, paddingBottom: insets.bottom + 12 }}>
          <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: c.line, marginBottom: 6 }} />
          <ScrollView keyboardShouldPersistTaps="handled">
            {onFiles ? row('paperclip', 'Add files', 'PDF, Word, Excel, CSV, text, code…', () => { onClose(); setTimeout(onFiles, 250); }) : null}
            {row('image', 'Add photos', '', () => { onClose(); setTimeout(onPhotos, 250); })}
            {onCompact ? row('minimize-2', 'Compact chat', 'Summarize the earlier messages to save tokens', () => { onClose(); onCompact(); }) : null}
            <View style={{ height: 1, backgroundColor: c.line, marginHorizontal: 20, marginVertical: 4 }} />
            {row('tool', 'Tools', 'Files, memory, notes, web, terminal and the rest', () => set({ tools: opts.tools === 'off' ? 'on' : 'off' }), toggle(opts.tools !== 'off'))}
            {row('users', 'Helper agents', 'Hand parts of the work to your agents', () => set({ agents: opts.agents === 'off' ? 'on' : 'off' }), toggle(opts.agents !== 'off'))}
            {row('shield', 'Ask before acting', 'Off: edits, commands and connectors run without asking', () => set({ perm: opts.perm === 'auto' ? 'ask' : 'auto' }), toggle(opts.perm !== 'auto'))}
            {brains.length > 0 && <Head c={c}>Brain</Head>}
            {brains.length > 0 && <Chips c={c} value={opts.brain || ''} onPick={(k) => set({ brain: k })} options={[['', 'No brain'], ['council', 'Council (vote)'], ...brains.map((b) => [b.slug, b.name])]} />}
            <Head c={c}>Thinking</Head>
            <Chips c={c} value={opts.effort || 'auto'} onPick={(k) => set({ effort: k })} options={[['auto', 'Auto'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']]} />
            {(projects.length > 0 || onNewProject) && <Head c={c}>Project</Head>}
            <Chips c={c} value={opts.projectId || ''} onPick={(k) => (k === '__new' ? setNaming('') : set({ projectId: k || null }))} options={[['', 'No project'], ...projects.map((p) => [p.id, p.name]), ...(onNewProject ? [['__new', '+ New project']] : [])]} />
            {naming !== null && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 18, marginTop: 8 }}>
                <TextInput autoFocus value={naming} onChangeText={setNaming} onSubmitEditing={create} placeholder="Project name" placeholderTextColor={c.muted} returnKeyType="done"
                  style={{ flex: 1, color: c.text, fontSize: 16, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, backgroundColor: c.fill, borderWidth: 1, borderColor: c.line }} />
                <Pressable onPress={create} disabled={!naming.trim() || busy} style={{ paddingHorizontal: 16, paddingVertical: 11, borderRadius: 14, backgroundColor: c.accent, opacity: naming.trim() ? 1 : 0.5 }}>
                  {busy ? <ActivityIndicator color={c.accentText} /> : <Text style={{ color: c.accentText, fontSize: 15, fontWeight: '600' }}>Create</Text>}
                </Pressable>
              </View>
            )}
            {!!err && <Text style={{ color: c.danger, marginHorizontal: 20, marginTop: 6 }}>{err}</Text>}
          </ScrollView>
        </Pressable>
      </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Pills above the composer for what is not the default (tap: the "+" sheet), like the desktop's chat pills. */
export function OptionPills({ opts, brains = [], projects = [], onPress, c }) {
  const pills = [];
  if (opts.brain) pills.push(opts.brain === 'council' ? 'Council' : ((brains.find((b) => b.slug === opts.brain) || {}).name || opts.brain));
  if (opts.projectId) { const p = projects.find((x) => x.id === opts.projectId); if (p) pills.push(p.name); }
  if (opts.tools === 'off') pills.push('No tools');
  if (opts.agents === 'off') pills.push('No agents');
  if (opts.effort && opts.effort !== 'auto') pills.push(`Think: ${opts.effort}`);
  if (opts.perm === 'auto') pills.push('Auto-allow');
  if (!pills.length) return null;
  return (
    <View style={{ flexGrow: 0, flexShrink: 0, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingHorizontal: 18, paddingBottom: 8 }}>
      {pills.map((p) => (
        <Pressable key={p} onPress={onPress} style={{ alignSelf: 'center', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, backgroundColor: c.fill, borderWidth: 1, borderColor: c.line }}>
          <Text style={{ color: c.text, fontSize: 14 }}>{p}</Text>
        </Pressable>
      ))}
    </View>
  );
}
