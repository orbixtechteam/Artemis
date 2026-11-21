// A full-screen editor sheet (agent, team, scheduled task): fields, chips, Save and Delete.
import React from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '../lib/session';
import { Pill, RoundButton } from './ui';

export function FormSheet({ title, onClose, onSave, onDelete, saving, error, children }) {
  const { c } = useSession();
  const insets = useSafeAreaInsets();
  return (
    <Modal animationType="slide" visible presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: c.side }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16 }}>
          <RoundButton icon="x" label="Close" onPress={onClose} c={c} size={48} />
          <Text style={{ flex: 1, textAlign: 'center', color: c.text, fontSize: 19, fontWeight: '700' }} numberOfLines={1}>{title}</Text>
          <View style={{ width: 48 }} />
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: insets.bottom + 30 }} keyboardShouldPersistTaps="handled">
          {children}
          {!!error && <Text style={{ color: c.danger, marginVertical: 10, marginHorizontal: 6 }}>{error}</Text>}
          <View style={{ height: 8 }} />
          <Pill title={saving ? 'Saving…' : 'Save'} tone="accent" onPress={onSave} disabled={saving} c={c} />
          {onDelete && <View style={{ height: 10 }} />}
          {onDelete && <Pressable onPress={onDelete} style={{ alignItems: 'center', padding: 14 }}><Text style={{ color: c.danger, fontSize: 17 }}>Delete</Text></Pressable>}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function F({ label, value, onChange, multiline, placeholder, hint, ...rest }) {
  const { c } = useSession();
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={{ color: c.muted, fontSize: 14, marginBottom: 7, marginLeft: 6 }}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} multiline={multiline} placeholder={placeholder} placeholderTextColor={c.faint} textAlignVertical={multiline ? 'top' : 'center'} {...rest}
        style={{ borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: c.text, backgroundColor: c.card, borderWidth: 1, borderColor: c.line, minHeight: multiline ? 120 : undefined }} />
      {!!hint && <Text style={{ color: c.muted, fontSize: 13, marginTop: 6, marginHorizontal: 6 }}>{hint}</Text>}
    </View>
  );
}

/** Chips: one choice, or several (multi). */
export function Choice({ label, value, options, onChange, multi }) {
  const { c } = useSession();
  const on = (k) => (multi ? (value || []).includes(k) : value === k);
  const tap = (k) => (multi ? onChange(on(k) ? value.filter((x) => x !== k) : [...(value || []), k]) : onChange(k));
  return (
    <View style={{ marginBottom: 16 }}>
      {!!label && <Text style={{ color: c.muted, fontSize: 14, marginBottom: 8, marginLeft: 6 }}>{label}</Text>}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {options.map(([k, l]) => (
          <Pressable key={String(k)} onPress={() => tap(k)} style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: on(k) ? c.accent : c.card, borderWidth: 1, borderColor: on(k) ? c.accent : c.line }}>
            <Text style={{ color: on(k) ? c.accentText : c.text, fontSize: 15 }}>{l}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
