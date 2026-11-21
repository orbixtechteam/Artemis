import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '../src/lib/session';
import { pair } from '../src/lib/api';
import { parsePairLink } from '../src/lib/core';
import { Button, Field, Logo, Pill, serif } from '../src/components/ui';

const defaultName = () => (Platform.OS === 'ios' ? 'iPhone' : Platform.OS === 'android' ? 'Android phone' : 'Web browser');

/** QR scanner (phone only): the code shown by the server or the desktop app. */
function Scanner({ onCode, onClose, c }) {
  const [Cam, setCam] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    (async () => {
      try {
        const mod = await import('expo-camera');
        const perm = await mod.Camera.requestCameraPermissionsAsync();
        if (!perm.granted) { setError('Camera access was not allowed.'); return; }
        setCam(() => mod.CameraView);
      } catch (e) { setError('The camera is not available.'); }
    })();
  }, []);
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        {Cam && <Cam style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={({ data }) => { const p = parsePairLink(data); if (p) onCode(p); }} />}
        {!!error && <Text style={{ color: '#fff', padding: 24 }}>{error}</Text>}
        <View style={{ position: 'absolute', bottom: 48, left: 24, right: 24 }}><Button title="Cancel" onPress={onClose} c={c} /></View>
      </View>
    </Modal>
  );
}

export default function Connect() {
  const { c, setServer } = useSession();
  const router = useRouter();
  const params = useLocalSearchParams(); // artemis://connect?url=…&code=… (a link or a scanned QR code)
  const insets = useSafeAreaInsets();
  const sameOrigin = Platform.OS === 'web' && globalThis.location && /^https?:/.test(globalThis.location.origin) && !/localhost:8081|:19006/.test(globalThis.location.origin) ? globalThis.location.origin : '';
  const [url, setUrl] = useState(String(params.url || sameOrigin || ''));
  const [code, setCode] = useState(String(params.code || ''));
  const [name, setName] = useState(defaultName());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [scan, setScan] = useState(false);

  const go = async (u = url, k = code) => {
    setBusy(true); setError('');
    try {
      const s = await pair(u, k, name.trim() || defaultName(), Platform.OS === 'web' ? 'web' : 'mobile');
      await setServer(s);
      router.replace('/');
    } catch (e) { setError(e.message || String(e)); }
    finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ padding: 24, paddingTop: insets.top + 48, maxWidth: 520, width: '100%', alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
        <Logo size={56} color={c.accent} />
        <Text style={{ fontSize: 40, fontFamily: serif, color: c.text, marginTop: 14 }}>Artemis</Text>
        <Text style={{ fontSize: 16, lineHeight: 23, color: c.muted, marginTop: 8, marginBottom: 30 }}>Connect to your Artemis server. On the server, run <Text style={{ fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) }}>artemis pair</Text>, or open Settings → Server & devices → New code in the desktop app.</Text>
        <Field label="Server address" value={url} onChangeText={setUrl} placeholder="https://artemis.example.com" autoCapitalize="none" autoCorrect={false} keyboardType="url" c={c} />
        <Field label="Pairing code" value={code} onChangeText={(t) => setCode(t.toUpperCase())} placeholder="XXXX-XXXX" autoCapitalize="characters" autoCorrect={false} maxLength={12} c={c} mono onSubmitEditing={() => url && code && go()} />
        <Field label="This device's name" value={name} onChangeText={setName} c={c} />
        {!!error && <Text style={{ color: c.danger, marginBottom: 12 }}>{error}</Text>}
        <Pill title={busy ? 'Connecting…' : 'Connect'} tone="accent" onPress={() => go()} disabled={busy || !url.trim() || !code.trim()} c={c} />
        {Platform.OS !== 'web' && <View style={{ height: 12 }} />}
        {Platform.OS !== 'web' && <Pill title="Scan a QR code" icon="camera" tone="quiet" onPress={() => setScan(true)} c={c} />}
        <Text style={{ color: c.muted, fontSize: 14, lineHeight: 20, marginTop: 24, textAlign: 'center' }}>The code works once and for 10 minutes. After that this device has its own access, which you can take away on the server at any time.</Text>
      </ScrollView>
      {scan && <Scanner c={c} onClose={() => setScan(false)} onCode={(p) => { setScan(false); if (p.url) setUrl(p.url); if (p.code) setCode(p.code); if (p.url && p.code) go(p.url, p.code); }} />}
    </KeyboardAvoidingView>
  );
}
