import React, { useCallback, useEffect, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession, ACCENTS } from '../src/lib/session';
import { when } from '../src/lib/core';
import { PageHeader } from '../src/components/Page';
import { Group, Icon, Item, Logo, Pill, initials, mono } from '../src/components/ui';

const KIND = { desktop: 'Desktop', mobile: 'Phone', web: 'Web app', cli: 'Command line', other: 'Other' };

/** A bottom sheet with a list or a small form. */
function Sheet({ title, onClose, c, children }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: c.scrim, justifyContent: 'flex-end' }}>
        <Pressable onPress={() => {}} style={{ backgroundColor: c.side, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '80%', paddingTop: 10, paddingBottom: insets.bottom + 16 }}>
          <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: c.line, marginBottom: 12 }} />
          <Text style={{ color: c.text, fontSize: 19, fontWeight: '700', textAlign: 'center', marginBottom: 12 }}>{title}</Text>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 18 }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** The desktop's Appearance: Automatic / Light / Dark (drawn in the chosen palette), the palettes and the accent. */
function Look({ c, look, setLook, families }) {
  const fam = families.find((f) => f.id === (look.palette || 'artemis')) || families[0];
  const mode = look.theme === 'light' || look.theme === 'dark' ? look.theme : look.appearance || 'system';
  const tv = (t, k, d) => (t && t.vars && t.vars['--theme-' + k]) || d;
  const thumb = (k, label) => {
    const on = mode === k;
    const L = fam && fam.light, D = fam && fam.dark;
    const bgOf = (t, d) => tv(t, 'bg', d);
    const acc = tv(k === 'light' ? L : D, 'accent', c.accent);
    return (
      <Pressable key={k} onPress={() => setLook({ appearance: k })} style={{ flex: 1, alignItems: 'center' }} accessibilityRole="radio" accessibilityState={{ selected: on }}>
        <View style={{ width: '100%', aspectRatio: 1.45, borderRadius: 18, padding: 5, borderWidth: 2.5, borderColor: on ? c.accent : 'transparent', backgroundColor: on ? 'transparent' : c.fill }}>
          <View style={{ flex: 1, borderRadius: 12, overflow: 'hidden', backgroundColor: k === 'dark' ? bgOf(D, '#121316') : bgOf(L, '#FBF8F2'), borderWidth: 1, borderColor: c.line }}>
            {k === 'system' && <View style={{ position: 'absolute', right: 0, bottom: 0, width: '100%', height: '100%', backgroundColor: bgOf(D, '#121316'), transform: [{ skewX: '-40deg' }, { translateX: 50 }] }} />}
            <View style={{ margin: 10, height: 4, width: '50%', borderRadius: 2, backgroundColor: 'rgba(128,128,128,0.55)' }} />
            <View style={{ marginHorizontal: 10, height: 4, width: '35%', borderRadius: 2, backgroundColor: 'rgba(128,128,128,0.55)' }} />
            <View style={{ position: 'absolute', right: 10, bottom: 10, width: 14, height: 14, borderRadius: 7, backgroundColor: acc }} />
          </View>
        </View>
        <Text style={{ color: on ? c.accent : c.text, fontSize: 14, marginTop: 8 }}>{label}</Text>
      </Pressable>
    );
  };
  return (
    <View style={{ padding: 14 }}>
      <View style={{ flexDirection: 'row', gap: 10 }}>{thumb('system', 'Automatic')}{thumb('light', 'Light')}{thumb('dark', 'Dark')}</View>
      {families.length > 0 && <Text style={{ color: c.muted, fontSize: 13, marginTop: 18, marginBottom: 8, marginLeft: 4 }}>Palette</Text>}
      {families.map((f) => {
        const t = f.dark || f.light; const on = fam && f.id === fam.id && !(look.theme && !['system', 'light', 'dark'].includes(look.theme));
        const p = (t && t.preview) || [];
        return (
          <Pressable key={f.id} onPress={() => setLook({ palette: f.id })} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 6, borderRadius: 12, backgroundColor: pressed ? c.fill : 'transparent' })}>
            <View style={{ flexDirection: 'row', width: 54, height: 30, borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: c.line }}>
              {p.slice(0, 3).map((col, i) => <View key={i} style={{ flex: 1, backgroundColor: col }} />)}
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={{ color: c.text, fontSize: 16 }}>{f.name}</Text>
              {!!f.about && <Text style={{ color: c.muted, fontSize: 13 }}>{f.about}</Text>}
            </View>
            {on && <Icon name="check" size={18} color={c.accent} />}
          </Pressable>
        );
      })}
      <Text style={{ color: c.muted, fontSize: 13, marginTop: 14, marginBottom: 10, marginLeft: 4 }}>Accent</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: 4 }}>
        {[['', 'Palette', null, null], ...ACCENTS].map(([id, name, d, l]) => {
          const on = (look.accent || '') === id;
          const col = id ? (c.dark === false ? l : d) : tv(c.dark === false ? fam && fam.light : fam && fam.dark, 'accent', c.accent);
          return (
            <Pressable key={id || 'none'} onPress={() => setLook({ accent: id })} accessibilityLabel={name} style={{ alignItems: 'center', width: 52 }}>
              <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: col, borderWidth: on ? 3 : 0, borderColor: c.text, alignItems: 'center', justifyContent: 'center' }}>{!id && <Icon name="droplet" size={14} color="#fff" />}</View>
              <Text style={{ color: on ? c.text : c.muted, fontSize: 11, marginTop: 4 }} numberOfLines={1}>{name}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function Settings() {
  const { api, server, c, look, setLook, families, forget } = useSession();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [health, setHealth] = useState(null);
  const [clients, setClients] = useState([]);
  const [providers, setProviders] = useState([]);
  const [models, setModels] = useState([]);
  const [st, setSt] = useState(null);
  const [sheet, setSheet] = useState('');
  const [code, setCode] = useState(null);
  const [keyFor, setKeyFor] = useState(null);
  const [keyText, setKeyText] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try { setHealth(await api.get('/v1/health')); } catch (e) { setHealth(null); setError(e.status === 401 ? 'The server no longer accepts this device. Log out and pair it again.' : e.message); return; }
    api.get('/v1/clients').then((r) => setClients(r.clients)).catch(() => {});
    api.get('/v1/x/providers').then((r) => setProviders(r.providers)).catch(() => {});
    api.get('/v1/x/models').then((r) => setModels(r.models)).catch(() => {});
    api.get('/v1/x/settings').then(setSt).catch(() => {});
  }, [api]);
  useEffect(() => { load(); }, [load]);

  const current = st && (st.settings.model || st.defaultModel);
  const modelName = current ? ((models.find((m) => m[0] === current) || [])[1] || current.split(':').pop()) : 'Default';
  const name = (st && st.settings.profileName) || server.name;
  const missing = providers.filter((p) => p.needsKey && p.enabled && !p.hasKey).length;
  const active = clients.filter((x) => !x.revoked);

  const setDefault = async (m) => { try { setSt(await api.post('/v1/x/settings', { model: m })); setSheet(''); } catch (e) { setError(e.message); } };
  const saveKey = async () => { try { await api.post('/v1/x/secrets', { providerKeys: { [keyFor.id]: keyText.trim() } }); setKeyFor(null); setKeyText(''); load(); } catch (e) { setError(e.message); } };
  const newCode = async () => { try { setCode(await api.post('/v1/pairing', { label: `from ${server.name}` })); } catch (e) { setError(e.message); } };
  const revoke = async (id) => { try { await api.post(`/v1/clients/${id}/revoke`); load(); } catch (e) { setError(e.message); } };
  const logout = async () => { try { await api.post(`/v1/clients/${server.clientId}/revoke`); } catch {} await forget(); router.replace('/connect'); };

  return (
    <View style={{ flex: 1, backgroundColor: c.side }}>
      <PageHeader title="Settings" sheet={Platform.OS === 'ios'} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 8, paddingBottom: insets.bottom + 40, maxWidth: 720, width: '100%', alignSelf: 'center' }}>
        {!!error && <Text style={{ color: c.danger, marginBottom: 14, marginHorizontal: 8 }}>{error}</Text>}

        <View style={{ backgroundColor: c.card, borderRadius: 24, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 28 }}>
          <View style={{ width: 58, height: 58, borderRadius: 29, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: c.text, fontSize: 20, fontWeight: '700' }}>{initials(name)}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.text, fontSize: 20 }} numberOfLines={1}>{server.serverName || 'Artemis server'}</Text>
            <Text style={{ color: c.muted, fontSize: 15, marginTop: 3 }} numberOfLines={1}>{server.url.replace(/^https?:\/\//, '')} · <Text style={{ color: health ? c.ok : c.danger }}>{health ? 'online' : 'offline'}</Text></Text>
          </View>
          <Logo size={30} color={c.accent} />
        </View>

        <Group title="Artemis" c={c}>
          <Item icon="cpu" title="Default model" value={modelName} onPress={() => setSheet('model')} c={c} />
          <Item icon="key" title="Provider keys" value={missing ? `${missing} missing` : providers.length ? 'Set' : ''} onPress={() => setSheet('keys')} c={c} />
          <Item icon="folder" title="Projects" onPress={() => router.push('/projects')} c={c} />
          <Item icon="book-open" title="Memory" onPress={() => router.push('/memory')} c={c} />
          <Item icon="bar-chart-2" title="Usage" onPress={() => router.push('/usage')} c={c} />
        </Group>

        <Group title="Devices" c={c} footer="Each device pairs once and has its own access. Revoke one and it stops working at once.">
          <Item icon="smartphone" title="This device" value={server.name} c={c} />
          <Item icon="monitor" title="Paired devices" value={String(active.length)} onPress={() => setSheet('devices')} c={c} />
          <Item icon="plus-circle" title="Pair another device" onPress={() => { setCode(null); setSheet('pair'); newCode(); }} c={c} />
        </Group>

        <Group title="Appearance" c={c} footer="The same look as Artemis on your Mac: changing it here changes it for the phone and the web app."><Look c={c} look={look} setLook={setLook} families={families} /></Group>

        <Group c={c} footer={health ? `Artemis ${health.version} · ${health.mode}` : ''}>
          <Item icon="log-out" title="Log out" danger onPress={logout} chevron={false} c={c} />
        </Group>
      </ScrollView>

      {sheet === 'model' && (
        <Sheet title="Default model" onClose={() => setSheet('')} c={c}>
          <Group c={c}>{models.map(([id, label]) => <Item key={id} title={label} onPress={() => setDefault(id)} right={current === id ? <Icon name="check" size={20} color={c.accent} /> : null} c={c} />)}</Group>
          {!models.length && <Text style={{ color: c.muted, textAlign: 'center' }}>No models yet: add a provider key first.</Text>}
        </Sheet>
      )}
      {sheet === 'keys' && (
        <Sheet title="Provider keys" onClose={() => { setSheet(''); setKeyFor(null); }} c={c}>
          {keyFor ? (
            <View>
              <Text style={{ color: c.muted, marginBottom: 10, marginHorizontal: 6 }}>{keyFor.name}: stored encrypted on the server and never shown again.</Text>
              <TextInput value={keyText} onChangeText={setKeyText} placeholder="Paste the API key" placeholderTextColor={c.faint} secureTextEntry autoCapitalize="none" autoCorrect={false} autoFocus
                style={{ borderRadius: 16, padding: 14, fontSize: 17, color: c.text, backgroundColor: c.card, borderWidth: 1, borderColor: c.line, marginBottom: 14 }} />
              <Pill title="Save key" tone="accent" onPress={saveKey} disabled={!keyText.trim()} c={c} />
            </View>
          ) : (
            <Group c={c}>{providers.map((p) => <Item key={p.id} title={p.name} value={!p.needsKey ? 'No key needed' : p.hasKey ? 'Set' : 'Missing'} onPress={p.needsKey ? () => setKeyFor(p) : undefined} c={c} />)}</Group>
          )}
        </Sheet>
      )}
      {sheet === 'devices' && (
        <Sheet title="Paired devices" onClose={() => setSheet('')} c={c}>
          <Group c={c}>{active.map((x) => (
            <Item key={x.id} title={`${x.name}${x.id === server.clientId ? ' (this one)' : ''}`} subtitle={`${KIND[x.kind] || x.kind} · last seen ${when(x.lastSeenAt)}`}
              right={x.id !== server.clientId ? <Pressable onPress={() => revoke(x.id)} hitSlop={8}><Text style={{ color: c.danger, fontSize: 16 }}>Revoke</Text></Pressable> : null} c={c} />
          ))}</Group>
        </Sheet>
      )}
      {sheet === 'pair' && (
        <Sheet title="Pair another device" onClose={() => setSheet('')} c={c}>
          <Text style={{ color: c.muted, textAlign: 'center', marginBottom: 14, lineHeight: 21 }}>On the other device open Artemis → Connect, enter this server's address and the code:</Text>
          <Text selectable style={{ color: c.text, fontFamily: mono, fontSize: 34, letterSpacing: 4, textAlign: 'center', marginBottom: 8 }}>{code ? code.code : '…'}</Text>
          <Text selectable style={{ color: c.muted, textAlign: 'center', marginBottom: 6 }}>{server.url}</Text>
          {code && <Text style={{ color: c.faint, textAlign: 'center' }}>Works once, until {new Date(code.expiresAt).toLocaleTimeString()}.</Text>}
        </Sheet>
      )}
    </View>
  );
}
