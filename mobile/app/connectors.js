import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Platform, ScrollView, Switch, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSession } from '../src/lib/session';
import { PageHeader } from '../src/components/Page';
import { Empty, Group, Item, Pill } from '../src/components/ui';
import { F, FormSheet } from '../src/components/Form';

/** Opens the sign-in page. mode 'server': the provider sends the browser back to the server, which keeps the sign-in.
 *  mode 'native' (plain http on the home network): it comes back to the app (artemis://oauth), which hands the code to the server. */
async function openSignIn(url, mode) {
  if (Platform.OS === 'web') { window.open(url, '_blank', 'noopener'); return null; }
  let WB = null;
  try { WB = await import('expo-web-browser'); } catch {}
  if (!WB || !WB.openAuthSessionAsync) { await Linking.openURL(url); return null; }
  const r = await WB.openAuthSessionAsync(url, mode === 'native' ? 'artemis://oauth' : 'artemis://connectors');
  if (mode === 'native' && r.type === 'success' && r.url) {
    const q = r.url.split('?')[1] || '';
    const p = Object.fromEntries(q.split('&').filter(Boolean).map((kv) => kv.split('=').map((x) => decodeURIComponent(x.replace(/\+/g, ' ')))));
    return p;
  }
  return null;
}

/** The server's connectors (MCP): state, on/off, sign-in on the server, and the keys a connector still needs. */
export default function Connectors() {
  const { api, c } = useSession();
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);
  const [vals, setVals] = useState({});
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const load = useCallback(() => api.get('/v1/x/connectors').then((r) => { setList(r.connectors); setOpen((o) => (o ? r.connectors.find((x) => x.id === o.id) || null : o)); }).catch((e) => setError(e.message)), [api]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { const s = AppState.addEventListener('change', (st) => { if (st === 'active') load(); }); return () => s.remove(); }, [load]);
  const color = (s) => (s === 'connected' ? c.ok : s === 'error' ? c.danger : c.muted);

  const post = async (id, body, label) => {
    setBusy(label); setMsg('');
    try { await api.post(`/v1/x/connectors/${encodeURIComponent(id)}`, body); await new Promise((r) => setTimeout(r, 1200)); await load(); }
    catch (e) { setMsg(e.message); } finally { setBusy(''); }
  };
  const signIn = async (k) => {
    setBusy('signin'); setMsg('');
    try {
      const r = await api.post(`/v1/x/connectors/${encodeURIComponent(k.id)}/signin`, { base: api.base, native: Platform.OS !== 'web' });
      const back = await openSignIn(r.url, r.mode);
      if (back && (back.code || back.error)) await api.post('/v1/x/connectors/oauth/finish', { code: back.code || '', state: back.state || '', error: back.error_description || back.error || '' });
      for (let i = 0; i < 6; i++) { await new Promise((ok) => setTimeout(ok, 1500)); await load(); }
    } catch (e) { setMsg(e.message); } finally { setBusy(''); }
  };
  const saveKeys = async () => {
    const env = {}, headers = {};
    for (const n of open.env) if (vals['env.' + n]) env[n] = vals['env.' + n];
    for (const n of open.headers) if (vals['h.' + n]) headers[n] = vals['h.' + n];
    if (!Object.keys(env).length && !Object.keys(headers).length) { setMsg('Type a value first.'); return; }
    await post(open.id, { env, headers, enabled: true }, 'keys');
    setVals({});
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <PageHeader title="Connectors" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 40 }}>
        {!!error && <Text style={{ color: c.danger, margin: 8 }}>{error}</Text>}
        {!list && !error && <ActivityIndicator color={c.muted} style={{ marginTop: 30 }} />}
        {list && !list.length && <Empty text="No connectors on the server yet. The ones on your Mac come here on their own while it is linked." c={c} />}
        {list && list.length > 0 && (
          <Group c={c} footer="Tap a connector to sign in, give it its keys or switch it off.">
            {list.map((k) => <Item key={k.id} icon="link-2" title={k.name} subtitle={k.error ? k.error.slice(0, 120) : k.tools ? `${k.tools} tools` : k.type}
              onPress={() => { setOpen(k); setMsg(''); setVals({}); }}
              right={<Text style={{ color: color(k.enabled ? k.state : 'off'), fontSize: 14 }}>{k.enabled ? k.state : 'off'}</Text>} c={c} />)}
          </Group>
        )}
      </ScrollView>

      {open && (
        <FormSheet title={open.name} onClose={() => setOpen(null)} onSave={(open.env.length || open.headers.length) ? saveKeys : () => setOpen(null)} saving={busy === 'keys'} error={msg}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 18, marginHorizontal: 6 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.text, fontSize: 17 }}>On</Text>
              <Text style={{ color: color(open.enabled ? open.state : 'off'), fontSize: 14, marginTop: 2 }}>{open.enabled ? open.state : 'off'}{open.tools ? ` · ${open.tools} tools` : ''}</Text>
            </View>
            <Switch value={open.enabled} onValueChange={(v) => post(open.id, { enabled: v }, 'toggle')} trackColor={{ true: c.accent }} />
          </View>
          {!!open.error && <Text style={{ color: c.muted, fontSize: 14, marginBottom: 16, marginHorizontal: 6 }}>{open.error}</Text>}
          {open.canSignIn && (
            <View style={{ marginBottom: 18 }}>
              <Pill title={busy === 'signin' ? 'Waiting for the sign-in…' : open.signedIn ? 'Sign in again' : 'Sign in'} icon="log-in" tone={open.signedIn ? 'pill' : 'accent'} disabled={!!busy} onPress={() => signIn(open)} c={c} />
              <Text style={{ color: c.muted, fontSize: 13, marginTop: 8, marginHorizontal: 6 }}>The sign-in is kept on your Artemis server, so it works from every device.</Text>
              {open.signedIn && <Text onPress={() => post(open.id, { signOut: true }, 'out')} style={{ color: c.danger, fontSize: 15, marginTop: 12, marginHorizontal: 6 }}>Sign out</Text>}
            </View>
          )}
          {open.env.map((n) => <F key={'e' + n} label={`${n}${open.missing.includes(n) ? ' (missing)' : ' (set, type to replace)'}`} value={vals['env.' + n] || ''} onChange={(t) => setVals((v) => ({ ...v, ['env.' + n]: t }))} secureTextEntry autoCapitalize="none" autoCorrect={false} />)}
          {open.headers.map((n) => <F key={'h' + n} label={`${n} header${open.missing.includes(n) ? ' (missing)' : ' (set, type to replace)'}`} value={vals['h.' + n] || ''} onChange={(t) => setVals((v) => ({ ...v, ['h.' + n]: t }))} placeholder={/auth/i.test(n) ? 'Bearer …' : ''} secureTextEntry autoCapitalize="none" autoCorrect={false} />)}
        </FormSheet>
      )}
    </View>
  );
}
