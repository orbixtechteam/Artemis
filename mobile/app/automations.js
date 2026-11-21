import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSession } from '../src/lib/session';
import { when } from '../src/lib/core';
import { PageHeader } from '../src/components/Page';
import { Empty, Group, Item } from '../src/components/ui';

/** Heartbeats and webhooks on the server (scheduled tasks have their own page). */
export default function Automations() {
  const { api, c } = useSession();
  const router = useRouter();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api.get('/v1/x/automations').then(setData).catch((e) => setError(e.message)); }, [api]);
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <PageHeader title="Automations" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 40 }}>
        {!!error && <Text style={{ color: c.danger, margin: 8 }}>{error}</Text>}
        {!data && !error && <ActivityIndicator color={c.muted} style={{ marginTop: 30 }} />}
        {data && (
          <>
            <Group title="Scheduled tasks" c={c}><Item icon="clock" title="Scheduled tasks" onPress={() => router.replace('/scheduled')} c={c} /></Group>
            <Group title="Heartbeats" c={c} footer="Artemis checks a list at set times and tells you only when something needs you.">
              {(data.heartbeats || []).map((h) => <Item key={h.id} icon="activity" title={h.name} subtitle={`${h.enabled ? `every ${h.every} min` : 'off'}${h.lastRun ? ` · last ${when(h.lastRun)}` : ''}${h.items ? ` · ${h.items} items` : ''}`} c={c} />)}
            </Group>
            {(data.hooks || []).length > 0 ? (
              <Group title="Webhooks" c={c}>{data.hooks.map((h) => <Item key={h.id || h.name} icon="zap" title={h.name} subtitle={(h.urls && (h.urls.public || h.urls.local)) || ''} c={c} />)}</Group>
            ) : <Empty text="No webhooks." c={c} />}
          </>
        )}
      </ScrollView>
    </View>
  );
}
