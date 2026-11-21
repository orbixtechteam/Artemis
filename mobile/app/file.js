import React from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSession } from '../src/lib/session';
import { PageHeader } from '../src/components/Page';
import { FileView } from '../src/components/Preview';

/** A file on the server, opened from a chat's file card or the Files page. */
export default function FilePage() {
  const { path, name } = useLocalSearchParams();
  const { c } = useSession();
  const p = String(path || '');
  const n = String(name || p.split('/').pop());
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <PageHeader title={n} icon="chevron-left" />
      <FileView path={p} name={n} />
    </View>
  );
}
