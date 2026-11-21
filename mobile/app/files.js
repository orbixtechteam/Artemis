import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSession } from '../src/lib/session';
import { when } from '../src/lib/core';
import { PageHeader } from '../src/components/Page';
import { Empty, Group, Item } from '../src/components/ui';

const size = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n > 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

/** The server's Files folder (what the agent makes on the server): folders to browse, text files to read. */
export default function Files() {
  const { api, c } = useSession();
  const router = useRouter();
  const [dir, setDir] = useState('');
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { setEntries(null); api.get(`/v1/x/files?path=${encodeURIComponent(dir)}`).then((r) => setEntries(r.entries || [])).catch((e) => setError(e.message)); }, [dir]);
  const open = (e) => {
    const p = dir ? `${dir}/${e.name}` : e.name;
    if (e.dir) setDir(p); else router.push(`/file?path=${encodeURIComponent(p)}&name=${encodeURIComponent(e.name)}`);
  };
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <PageHeader title={dir ? dir.split('/').pop() : 'Files'} icon={dir ? 'chevron-left' : 'x'} onBack={dir ? () => setDir(dir.split('/').slice(0, -1).join('/')) : undefined} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 40 }}>
        {!!error && <Text style={{ color: c.danger, margin: 8 }}>{error}</Text>}
        {!entries && <ActivityIndicator color={c.muted} style={{ marginTop: 30 }} />}
        {entries && (
          <Group c={c} footer="Files on the server. Files on your computer stay there.">
            {dir ? <Item icon="corner-left-up" title="Up" onPress={() => setDir(dir.split('/').slice(0, -1).join('/'))} c={c} /> : null}
            {entries.map((e) => <Item key={e.name} icon={e.dir ? 'folder' : 'file'} title={e.name} subtitle={e.dir ? '' : `${size(e.size)} · ${when(e.mtime)}`} onPress={() => open(e)} c={c} />)}
          </Group>
        )}
        {entries && !entries.length && <Empty text="Empty." c={c} />}
      </ScrollView>
    </View>
  );
}
