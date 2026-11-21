import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, Image, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '../../src/lib/session';
import { applyEvent, finishAssistant, messageText, newAssistant, newMessageId } from '../../src/lib/core';
import { Mic } from '../../src/components/Mic';
import { Message } from '../../src/components/Message';
import { LocalFileView } from '../../src/components/Preview';
import { Icon, Logo, RoundButton, serif } from '../../src/components/ui';
import { OptionsSheet, DEFAULT_OPTS } from '../../src/components/ChatOptions';
import { ChatActions } from '../../src/components/ChatActions';

const greeting = (name) => {
  const h = new Date().getHours();
  const part = h < 5 ? 'Late night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  return name ? `${part}, ${name.split(/\s+/)[0]}` : part;
};

/** Picks one of the server's models (Default = the server's own choice). */
function ModelSheet({ models, value, onPick, onClose, c }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: c.scrim, justifyContent: 'flex-end' }}>
        <Pressable onPress={() => {}} style={{ backgroundColor: c.side, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '70%', paddingTop: 10, paddingBottom: insets.bottom + 10 }}>
          <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: c.line, marginBottom: 10 }} />
          <Text style={{ color: c.muted, fontSize: 15, marginLeft: 24, marginBottom: 6 }}>Model</Text>
          <FlatList data={[['', 'Default model'], ...models]} keyExtractor={(x) => x[0] || 'default'} renderItem={({ item }) => (
            <Pressable onPress={() => onPick(item[0])} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 15, backgroundColor: pressed ? c.fill : 'transparent' })}>
              <Text style={{ flex: 1, color: c.text, fontSize: 17 }} numberOfLines={1}>{item[1]}</Text>
              {item[0] === value ? <Icon name="check" size={20} color={c.accent} /> : null}
            </Pressable>
          )} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default function Chat() {
  const { id: rawId, project } = useLocalSearchParams();
  const id = decodeURIComponent(String(rawId));
  const incognito = id.startsWith('incog-'); // nothing is saved, memory is off; the app keeps the conversation
  const { api, c } = useSession();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  /** Back to the home page; the keyboard goes away first. */
  const home = () => { Keyboard.dismiss(); if (router.canGoBack()) router.back(); else router.replace('/'); };
  const [chat, setChat] = useState(null);
  const [input, setInput] = useState('');
  const [pics, setPics] = useState([]);
  const [preview, setPreview] = useState(null); // an attachment opened before sending
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [models, setModels] = useState([]);
  const [model, setModel] = useState('');
  const [picker, setPicker] = useState(false);
  const [name, setName] = useState('');
  const [listKey, setListKey] = useState(0);
  const [opts, setOpts] = useState({ ...DEFAULT_OPTS, projectId: project ? String(project) : null });
  const [sheet, setSheet] = useState(false);
  const [actions, setActions] = useState(false);
  const [brains, setBrains] = useState([]);
  const [projects, setProjects] = useState([]);
  const [editing, setEditing] = useState(null); // the user message being edited (sent again from there)
  const [mentionItems, setMentionItems] = useState([]);
  const [picked, setPicked] = useState([]); // "@" choices: connectors, skills, agents, Make
  const [toast, setToast] = useState('');
  const flash = (t) => { setToast(t); setTimeout(() => setToast(''), 1800); };
  const optsOf = (ch) => ({ brain: ch.brain || '', tools: ch.tools || 'on', agents: ch.agents || 'on', effort: ch.effort || 'auto', perm: ch.perm || 'ask', projectId: ch.projectId || null });
  /** A switch changed: kept with the chat (on the server once the chat exists there). */
  const setOpt = (patch) => {
    setOpts((o) => ({ ...o, ...patch }));
    if (chat && chat.messages && chat.messages.length) api.post(`/v1/x/sessions/${encodeURIComponent(id)}`, patch).catch(() => {});
  };
  /** A new project made from the "+" sheet: saved on the server and picked for this chat. */
  const newProject = async (name) => {
    const r = await api.post('/v1/x/projects', { name });
    setProjects((l) => [...l, r.project]);
    setOpt({ projectId: r.project.id });
    flash(`Project “${r.project.name}” made`);
  };
  const run = useRef(null);
  const listRef = useRef(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; Keyboard.dismiss(); if (run.current && run.current.ctl) run.current.ctl.abort(); }; }, []);

  const patchAssistant = (fn) => setChat((ch) => (!ch || !run.current ? ch : { ...ch, messages: ch.messages.map((m) => (m.id === run.current.msgId ? fn(m) : m)) }));
  const onEvent = (ev) => {
    if (!run.current) return;
    if (ev.seq) run.current.seq = Math.max(run.current.seq, ev.seq);
    if (ev.type === 'run') { run.current.runId = ev.data.run_id; return; }
    if (ev.type === 'snapshot') { const msg = ev.data && ev.data.message; if (msg) patchAssistant(() => ({ ...msg, id: run.current.msgId })); return; }
    if (ev.type === 'done') { run.current.done = true; patchAssistant(finishAssistant); return; }
    if (ev.type === 'error') { run.current.done = true; patchAssistant((m) => finishAssistant({ ...m, error: (ev.data && ev.data.message) || 'Failed' })); return; }
    patchAssistant((m) => applyEvent(m, ev.data));
  };

  const reload = useCallback(async (quiet) => {
    if (incognito) { setChat((x) => x || { id, title: 'Incognito chat', messages: [], incognito: true }); return; }
    try {
      const r = await api.get(`/v1/sessions/${encodeURIComponent(id)}?full=1`);
      const ch = r.chat;
      if (r.run && !r.run.ended && !(run.current && run.current.live)) { // a run is going on (started elsewhere, or before the app slept)
        const msgs = [...ch.messages];
        const last = msgs[msgs.length - 1];
        const a = last && last.role === 'assistant' ? msgs.pop() : null;
        const asst = newAssistant(a ? a.id : undefined);
        run.current = { runId: r.run.run_id, seq: 0, msgId: asst.id };
        setChat({ ...ch, messages: [...msgs, asst] });
        setRunning(true);
        follow();
        return;
      }
      if (!(run.current && run.current.live)) { setChat(ch); setOpts(optsOf(ch)); }
    } catch (e) {
      if (e.status === 404) setChat((x) => x || { id, title: 'New chat', messages: [], projectId: project ? String(project) : null });
      else if (!quiet) { setError(e.message); setChat((x) => x || { id, title: 'New chat', messages: [] }); }
    }
  }, [api, id]);

  const follow = async () => {
    const r = run.current;
    if (!r || r.live) return;
    r.live = true;
    let tries = 0;
    while (alive.current && run.current === r && !r.done) {
      const ctl = new AbortController(); r.ctl = ctl;
      try {
        await api.stream(`/v1/runs/${encodeURIComponent(r.runId)}/events?after=${r.seq}`, { onEvent, signal: ctl.signal });
        tries = 0;
        if (!r.done) await new Promise((res) => setTimeout(res, 500));
      } catch (e) {
        if (e.status === 404) { r.done = true; break; }
        if (AppState.currentState !== 'active') break;
        await new Promise((res) => setTimeout(res, Math.min(15000, 1000 * 2 ** tries++)));
      }
    }
    r.live = false;
    if (run.current === r && r.done && alive.current) { setRunning(false); run.current = null; setListKey((k) => k + 1); reload(true); }
  };

  useEffect(() => {
    setChat(null); setError(''); setRunning(false); run.current = null;
    reload();
    api.get('/v1/x/models').then((r) => setModels(r.models || [])).catch(() => {});
    api.get('/v1/x/settings').then((r) => setName((r.settings && r.settings.profileName) || '')).catch(() => {});
    api.get('/v1/x/brains').then((r) => setBrains(r.brains || [])).catch(() => {});
    api.get('/v1/x/projects').then((r) => setProjects(r.projects || [])).catch(() => {});
    api.get('/v1/x/mentions').then((r) => setMentionItems(r.items || [])).catch(() => {});
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') { if (run.current && !run.current.live && !run.current.done) follow(); else if (!run.current) reload(true); } });
    return () => sub.remove();
  }, [id]);

  const send = async (override) => {
    const text = (override && override.text != null ? override.text : input).trim();
    if ((!text && !pics.length) || running) return;
    setError('');
    const from = override && override.from ? override.from : editing; // edit / regenerate: start again from that message
    if (from) {
      if (!incognito) { try { await api.post(`/v1/x/sessions/${encodeURIComponent(id)}/truncate`, { from }); } catch (e) { setError(e.message); return; } }
      setChat((ch) => { const i = ch.messages.findIndex((m) => m.id === from); return i < 0 ? ch : { ...ch, messages: ch.messages.slice(0, i) }; });
      setEditing(null);
    }
    const mentions = picked.filter((m) => text.includes('@' + m.name));
    const history = incognito ? ((chat && chat.messages) || []).filter((m) => !from || true).slice(0, from ? Math.max(0, (chat.messages.findIndex((m) => m.id === from))) : undefined) : null;
    const user = { id: newMessageId(), role: 'user', content: text, createdAt: Date.now(), ...(mentions.length ? { mentions } : {}), ...(pics.length ? { attachments: pics.map((p) => (p.kind === 'file' ? { kind: 'file', name: p.name, text: '', data: p.data, size: p.size } : { kind: 'image', name: p.name, dataUrl: p.dataUrl })) } : {}) };
    const upload = pics.map((p) => (p.kind === 'file' ? { kind: 'file', name: p.name, data: p.data } : { kind: 'image', name: p.name, dataUrl: p.dataUrl }));
    const asst = newAssistant();
    setChat((ch) => ({ ...(ch || { id, title: text.slice(0, 48), messages: [] }), messages: [...((ch && ch.messages) || []), user, asst] }));
    setInput(''); setPics([]); setPicked([]); setRunning(true);
    const r = { runId: '', seq: 0, msgId: asst.id, live: true, done: false };
    run.current = r;
    const ctl = new AbortController(); r.ctl = ctl;
    try {
      const files = upload.filter((a) => a.kind === 'file' || a.dataUrl);
      let sent = !files.length;
      if (!sent) setToast(`Sending ${files.length === 1 ? files[0].name : files.length + ' files'}…`);
      const onFirst = (ev) => { if (!sent) { sent = true; setToast(''); } onEvent(ev); };
      await api.stream('/v1/chat', { method: 'POST', body: { message: text, session_id: id, detach: true, client_message_id: user.id, ...(model ? { model } : {}), ...(opts.projectId ? { project_id: opts.projectId } : {}), options: { brain: opts.brain, tools: opts.tools, agents: opts.agents, effort: opts.effort, perm: opts.perm, mentions, ...(incognito ? { incognito: true, history: (history || []).map(({ id: _i, ...m }) => m) } : {}) }, ...(upload.length ? { attachments: upload } : {}) }, onEvent: onFirst, signal: ctl.signal });
      r.live = false;
      if (!r.done && r.runId) return follow();
    } catch (e) {
      r.live = false; setToast('');
      if (r.runId && e.code === 'OFFLINE') return follow();
      setError(e.message);
      patchAssistant((m) => finishAssistant({ ...m, error: e.message }));
      r.done = true;
    }
    if (run.current === r && r.done) { setRunning(false); run.current = null; setListKey((k) => k + 1); if (!incognito) reload(true); }
  };
  const copy = async (m) => { try { const C = await import('expo-clipboard'); await C.setStringAsync(messageText(m)); flash('Copied'); } catch (e) { setError(e.message); } };
  const speak = async (m) => { try { const S = await import('expo-speech'); if (await S.isSpeakingAsync()) { S.stop(); return; } S.speak(messageText(m).replace(/[#*_`>|]/g, ' ').slice(0, 4000)); } catch (e) { setError(e.message); } };
  const regenerate = () => {
    const msgs = (chat && chat.messages) || [];
    let i = msgs.length - 1; while (i >= 0 && msgs[i].role !== 'user') i--;
    if (i < 0) return;
    send({ text: msgs[i].content || '', from: msgs[i].id });
  };
  const edit = (m) => { setEditing(m.id); setInput(m.content || ''); };
  const compact = async () => { try { flash('Compacting…'); await api.post(`/v1/x/sessions/${encodeURIComponent(id)}/compact`, {}); flash('Compacted'); reload(true); } catch (e) { setError(e.message); } };
  // "@": the word being typed after an @ picks a connector, skill, agent or Make
  const atWord = (/(^|\s)@([^\s@]*)$/.exec(input) || [])[2];
  const suggestions = atWord != null ? mentionItems.filter((m) => m.name.toLowerCase().includes(atWord.toLowerCase())).slice(0, 8) : [];
  const pickMention = (m) => { setInput(input.replace(/@([^\s@]*)$/, '@' + m.name + ' ')); setPicked((l) => (l.some((x) => x.kind === m.kind && x.name === m.name) ? l : [...l, m])); };
  const stop = () => { if (run.current && run.current.runId) api.post(`/v1/runs/${encodeURIComponent(run.current.runId)}/abort`).catch(() => {}); };
  const decide = (toolId, ok) => {
    patchAssistant((m) => ({ ...m, steps: m.steps.map((s) => ({ ...s, toolCalls: s.toolCalls.map((t) => (t.id === toolId ? { ...t, status: ok ? 'running' : 'denied' } : t)) })) }));
    api.post(`/v1/approvals/${encodeURIComponent(toolId)}`, { approve: ok }).catch((e) => setError(e.message));
  };
  const attach = async () => {
    try {
      const IP = await import('expo-image-picker');
      const res = await IP.launchImageLibraryAsync({ mediaTypes: ['images'], base64: true, quality: 0.7, allowsMultipleSelection: true, selectionLimit: 4 });
      if (res.canceled) return;
      setPics((p) => [...p, ...res.assets.filter((a) => a.base64).map((a, i) => ({ name: a.fileName || `photo-${i + 1}.jpg`, dataUrl: `data:${a.mimeType || 'image/jpeg'};base64,${a.base64}` }))].slice(0, 4));
    } catch (e) { setError('Could not open the photos: ' + e.message); }
  };
  // any file (PDF, Word, Excel, CSV, text, code...): sent as bytes, read on the server like the desktop reads an attached file
  const attachFiles = async () => {
    try {
      const DP = await import('expo-document-picker');
      const res = await DP.getDocumentAsync({ multiple: true, copyToCacheDirectory: true, type: '*/*' });
      if (res.canceled) return;
      const out = [];
      for (const a of res.assets || []) {
        if (a.size && a.size > 25 * 1024 * 1024) { setError(`${a.name} is larger than 25 MB.`); continue; }
        let data = '';
        if (Platform.OS === 'web' && a.file) {
          data = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = () => no(r.error); r.readAsDataURL(a.file); });
        } else {
          const FS = await import('expo-file-system');
          if (FS.File) data = await new FS.File(a.uri).base64();
          else { const L = await import('expo-file-system/legacy'); data = await L.readAsStringAsync(a.uri, { encoding: 'base64' }); }
        }
        const img = /^image\/(png|jpeg|gif|webp)$/i.test(a.mimeType || '');
        out.push(img ? { kind: 'image', name: a.name, dataUrl: `data:${a.mimeType};base64,${data}` } : { kind: 'file', name: a.name, data, size: a.size || 0 });
      }
      setPics((p) => [...p, ...out].slice(0, 10));
    } catch (e) { setError('Could not open the file: ' + e.message); }
  };

  const msgs = chat ? chat.messages : [];
  const empty = chat && !msgs.length;
  const canSend = !!(input.trim() || pics.length);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: c.bg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingTop: insets.top + 6, paddingBottom: 8, gap: 12 }}>
          <RoundButton icon="chevron-left" label="Home" onPress={home} c={c} size={52} />
          <View style={{ flex: 1 }}>
            {!empty && chat ? <Pressable onPress={() => { if (incognito) return; Keyboard.dismiss(); setActions(true); }} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 }}><Text style={{ color: c.text, fontSize: 17, fontWeight: '600', textAlign: 'center', flexShrink: 1 }} numberOfLines={1}>{chat.title || 'Chat'}</Text><Icon name="chevron-down" size={16} color={c.muted} /></Pressable> : null}
          </View>
          <RoundButton icon="cpu" label="Model" onPress={() => { Keyboard.dismiss(); setPicker(true); }} c={c} size={52} />
        </View>

        {!chat && <ActivityIndicator style={{ marginTop: 60 }} color={c.muted} />}
        {empty && (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 }}>
            <Logo size={58} color={c.accent} />
            <Text style={{ color: c.text, opacity: 0.9, fontSize: 34, fontFamily: serif, marginTop: 18, textAlign: 'center' }}>{greeting(name)}</Text>
            {model ? <Text style={{ color: c.muted, marginTop: 10 }}>{(models.find((m) => m[0] === model) || [])[1] || model}</Text> : null}
          </View>
        )}
        {chat && !empty && (
          <FlatList ref={listRef} data={msgs} keyExtractor={(m, i) => m.id || String(i)} style={{ flex: 1 }}
            contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 12, maxWidth: 820, width: '100%', alignSelf: 'center' }}
            onContentSizeChange={() => listRef.current && listRef.current.scrollToEnd({ animated: false })} keyboardDismissMode="interactive"
            renderItem={({ item, index }) => <Message m={item} api={api} c={c} chatId={id} artifacts={chat.artifacts} onDecide={running ? decide : null} running={running && index === msgs.length - 1}
              onCopy={copy} onSpeak={speak} onEdit={!running && item.role === 'user' && !item.compacted ? edit : null} onRegenerate={!running && item.role === 'assistant' && index === msgs.length - 1 ? regenerate : null} />} />
        )}

        {!!error && <Text style={{ color: c.danger, paddingHorizontal: 24, paddingBottom: 6 }}>{error}</Text>}
        {pics.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 22, paddingTop: 6, paddingBottom: 8 }}>
            {pics.map((p, i) => (
              <View key={i}>
                <Pressable onPress={() => { Keyboard.dismiss(); setPreview(p); }} accessibilityLabel={`Open ${p.name}`}>{p.kind === 'file'
                  ? <View style={{ width: 130, height: 58, borderRadius: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.line, paddingHorizontal: 10, justifyContent: 'center' }}><Icon name="file-text" size={16} color={c.muted} /><Text numberOfLines={1} style={{ color: c.text, fontSize: 13, marginTop: 3 }}>{p.name}</Text></View>
                  : <Image source={{ uri: p.dataUrl }} style={{ width: 58, height: 58, borderRadius: 14 }} />}</Pressable>
                <Pressable onPress={() => setPics((l) => l.filter((_, k) => k !== i))} hitSlop={10} accessibilityLabel={`Remove ${p.name}`}
                  style={{ position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: c.pill, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: c.bg }}>
                  <Icon name="x" size={12} color={c.pillText} />
                </Pressable>
              </View>
            ))}
          </View>
        )}
        {suggestions.length > 0 && (
          <View style={{ marginHorizontal: 14, marginBottom: 8, backgroundColor: c.card, borderRadius: 18, borderWidth: 1, borderColor: c.line, overflow: 'hidden' }}>
            {suggestions.map((m) => (
              <Pressable key={m.kind + m.name} onPress={() => pickMention(m)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11, backgroundColor: pressed ? c.fill : 'transparent' })}>
                <Icon name={{ connector: 'link-2', skill: 'star', agent: 'user', make: 'zap' }[m.kind] || 'at-sign'} size={17} color={c.accent} />
                <Text style={{ flex: 1, color: c.text, fontSize: 16 }} numberOfLines={1}>{m.name}</Text>
                <Text style={{ color: c.muted, fontSize: 13 }}>{m.kind}</Text>
              </Pressable>
            ))}
          </View>
        )}
        {editing && <Pressable onPress={() => { setEditing(null); setInput(''); }} style={{ marginHorizontal: 22, marginBottom: 6 }}><Text style={{ color: c.accent, fontSize: 14 }}>Editing a message: it is sent again from there. Tap to cancel.</Text></Pressable>}
        {incognito && <Text style={{ color: c.muted, fontSize: 13, textAlign: 'center', marginBottom: 6 }}>Incognito: not saved, no memory.</Text>}
        {!!toast && <Text style={{ color: c.muted, fontSize: 14, textAlign: 'center', marginBottom: 6 }}>{toast}</Text>}
        <View style={{ paddingHorizontal: 14, paddingBottom: Math.max(insets.bottom, 10) + 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', backgroundColor: c.round, borderRadius: 26, borderWidth: 1, borderColor: c.line, padding: 5, gap: 4, maxWidth: 820, width: '100%', alignSelf: 'center' }}>
            <Pressable onPress={() => { Keyboard.dismiss(); setSheet(true); }} disabled={running} accessibilityLabel="Add photos, brain, tools, project"
              style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 20, backgroundColor: c.fill, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
              <Icon name="plus" size={20} color={c.text} />
            </Pressable>
            <TextInput value={input} onChangeText={setInput} placeholder="Message Artemis" placeholderTextColor={c.faint} multiline
              onKeyPress={Platform.OS === 'web' ? (e) => { if (e.nativeEvent.key === 'Enter' && !e.nativeEvent.shiftKey) { e.preventDefault(); send(); } } : undefined}
              style={{ flex: 1, maxHeight: 140, minHeight: 40, paddingHorizontal: 6, paddingTop: 10, paddingBottom: 10, fontSize: 16, lineHeight: 21, color: c.text }} />
            {!running && !input.trim() ? <Mic onText={(t) => setInput((x) => (x && !/\s$/.test(x) ? x + ' ' : x) + t)} onError={setError} /> : null}
            {running
              ? <Pressable onPress={stop} accessibilityLabel="Stop" style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.pill, alignItems: 'center', justifyContent: 'center' }}><View style={{ width: 13, height: 13, borderRadius: 3, backgroundColor: c.pillText }} /></Pressable>
              : <Pressable onPress={() => send()} disabled={!canSend} accessibilityLabel="Send" style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: canSend ? c.accent : c.pill, alignItems: 'center', justifyContent: 'center' }}><Icon name="arrow-up" size={20} color={canSend ? c.accentText : c.pillText} /></Pressable>}
          </View>
        </View>
      </KeyboardAvoidingView>
      {actions && chat && <ChatActions chat={{ ...chat, projectId: opts.projectId }} onClose={() => setActions(false)} onChanged={(p) => { if (p === null) home(); else { setChat((x) => ({ ...x, ...p })); if (p.projectId !== undefined) setOpts((o) => ({ ...o, projectId: p.projectId })); } }} />}
      {preview && (
        <Modal animationType="slide" visible presentationStyle="pageSheet" onRequestClose={() => setPreview(null)}>
          <View style={{ flex: 1, backgroundColor: c.bg }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 }}>
              <RoundButton icon="x" label="Close" onPress={() => setPreview(null)} c={c} size={44} />
              <Text style={{ flex: 1, textAlign: 'center', color: c.text, fontSize: 17, fontWeight: '600' }} numberOfLines={1}>{preview.name}</Text>
              <RoundButton icon="trash-2" label="Remove" onPress={() => { setPics((l) => l.filter((x) => x !== preview)); setPreview(null); }} c={c} size={44} />
            </View>
            <LocalFileView file={preview} />
          </View>
        </Modal>
      )}
      {sheet && <OptionsSheet opts={opts} set={setOpt} brains={brains} projects={projects} onPhotos={attach} onFiles={attachFiles} onNewProject={newProject} onCompact={!incognito && msgs.length > 4 ? compact : null} onClose={() => setSheet(false)} c={c} />}
      {picker && <ModelSheet models={models} value={model} c={c} onClose={() => setPicker(false)} onPick={(m) => { setModel(m); setPicker(false); }} />}
    </View>
  );
}
