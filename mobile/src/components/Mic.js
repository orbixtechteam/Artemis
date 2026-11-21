// Dictation, like the desktop's microphone button: record, the server turns it into text (the speech-to-text
// provider from Settings → Voice), the text goes into the composer. Tap to start, tap again to stop.
import React, { useState } from 'react';
import { ActivityIndicator, Pressable } from 'react-native';
import { useAudioRecorder, RecordingPresets, AudioModule, setAudioModeAsync } from 'expo-audio';
import { useSession } from '../lib/session';
import { Icon } from './ui';

const toBase64 = async (uri) => {
  const blob = await (await fetch(uri)).blob();
  return await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1] || ''); r.onerror = reject; r.readAsDataURL(blob); });
};

export function Mic({ onText, onError, disabled }) {
  const { api, c } = useSession();
  const rec = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [state, setState] = useState('idle'); // idle | recording | working
  const start = async () => {
    try {
      const p = await AudioModule.requestRecordingPermissionsAsync();
      if (!p.granted) { onError('Microphone access was not allowed.'); return; }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await rec.prepareToRecordAsync();
      rec.record();
      setState('recording');
    } catch (e) { onError('Could not start the microphone: ' + e.message); setState('idle'); }
  };
  const stop = async () => {
    setState('working');
    try {
      await rec.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      const audio = await toBase64(rec.uri);
      const r = await api.post('/v1/x/transcribe', { audio, mime: 'audio/mp4' });
      if (r.text) onText(r.text);
    } catch (e) { onError(e.message); }
    finally { setState('idle'); }
  };
  const on = state === 'recording';
  return (
    <Pressable onPress={on ? stop : start} disabled={disabled || state === 'working'} accessibilityLabel={on ? 'Stop dictation' : 'Dictate'}
      style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.danger : c.fill, opacity: pressed ? 0.7 : 1 })}>
      {state === 'working' ? <ActivityIndicator color={c.muted} /> : <Icon name={on ? 'square' : 'mic'} size={19} color={on ? '#fff' : c.text} />}
    </Pressable>
  );
}
