import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useSession } from '../src/lib/session';
import { PageHeader } from '../src/components/Page';
import { Group, Item } from '../src/components/ui';

const tok = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n || 0));
const usd = (n) => `$${(n || 0).toFixed(n >= 10 ? 0 : 2)}`;

/** What the server's Artemis has used today and this month (all apps together), and the limits. */
export default function Usage() {
  const { api, c } = useSession();
  const [u, setU] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api.get('/v1/x/usage').then(setU).catch((e) => setError(e.message)); }, [api]);
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <PageHeader title="Usage" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 40 }}>
        {!!error && <Text style={{ color: c.danger, margin: 8 }}>{error}</Text>}
        {!u && !error && <ActivityIndicator color={c.muted} style={{ marginTop: 30 }} />}
        {u && (
          <>
            <Group title="Today" c={c}><Item icon="hash" title="Tokens" value={tok(u.today.tokens)} c={c} /><Item icon="dollar-sign" title="Cost" value={usd(u.today.cost)} c={c} /><Item icon="message-square" title="Requests" value={String(u.today.requests)} c={c} /></Group>
            <Group title="This month" c={c}><Item icon="hash" title="Tokens" value={tok(u.month.tokens)} c={c} /><Item icon="dollar-sign" title="Cost" value={usd(u.month.cost)} c={c} /><Item icon="message-square" title="Requests" value={String(u.month.requests)} c={c} /></Group>
            {u.limits && u.limits.blocked ? <Text style={{ color: c.danger, marginHorizontal: 8 }}>{u.limits.blocked}</Text> : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}
