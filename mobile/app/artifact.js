import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSession } from '../src/lib/session';
import { PageHeader } from '../src/components/Page';
import { ArtifactView } from '../src/components/Preview';

const KIND = { html: 'Web page', svg: 'SVG', markdown: 'Document', spreadsheet: 'Spreadsheet', code: 'Code' };

/** One artifact, drawn like on the desktop. Its own page, so Back returns to where it was opened from. */
export default function ArtifactPage() {
  const { id, chat } = useLocalSearchParams();
  const { api, c } = useSession();
  const router = useRouter();
  const [a, setA] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.get(`/v1/x/artifacts/${encodeURIComponent(String(id))}`)
      .then((r) => { const x = r.artifacts.find((y) => !chat || y.chatId === String(chat)) || r.artifacts[0]; if (x) setA(x); else setError('This artifact is not saved yet (it is saved when the answer ends).'); })
      .catch((e) => setError(e.message));
  }, [id]);
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <PageHeader title={a ? a.title : 'Artifact'} icon="chevron-left" right={a && !chat ? <Text onPress={() => router.push(`/chat/${encodeURIComponent(a.chatId)}`)} style={{ color: c.accent, fontSize: 15 }}>Chat</Text> : null} />
      {!!a && <Text style={{ color: c.muted, marginHorizontal: 22, marginBottom: 8 }}>{KIND[a.type] || a.type} · {a.chatTitle}</Text>}
      {!a && !error && <ActivityIndicator color={c.muted} style={{ marginTop: 40 }} />}
      {!!error && <Text style={{ color: c.danger, padding: 22 }}>{error}</Text>}
      {!!a && <ArtifactView artifact={a} />}
    </View>
  );
}
