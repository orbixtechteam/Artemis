// The home page, with everything the desktop sidebar has: Search, Agents, Scheduled, Artifacts, Connectors; Workspace
// (Projects, Notes, Files, Skills, Automations, Memory); Pinned (every project with its latest chats, then pinned chats);
// the other chats by day; the avatar (settings, usage) and "New chat".
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, PanResponder, Pressable, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '../lib/session';
import { newChatId } from '../lib/core';
import { Icon, Pill, RoundButton, initials, serif } from './ui';
import { ChatActions } from './ChatActions';
import { ProjectActions } from './ProjectActions';
import { useLive } from '../lib/live';

const PROJECT_ROWS = 4; // chats under each project before "View all", as on the desktop

function dayGroup(t) {
  const d = new Date(t); const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (t >= start) return 'Today';
  if (t >= start - 86400000) return 'Yesterday';
  if (t >= start - 6 * 86400000) return 'Previous 7 days';
  if (t >= start - 29 * 86400000) return 'Previous 30 days';
  return d.toLocaleDateString([], { month: 'long', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

function Row({ icon, title, onPress, onLongPress, onPressOut, c, active, dot, count, indent, right, muted, drop }) {
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} onPressOut={onPressOut} delayLongPress={350} style={({ pressed }) => ({ borderWidth: drop ? 1.5 : 0, borderColor: c.accent, flexDirection: 'row', alignItems: 'center', paddingVertical: indent ? 10 : 12, paddingLeft: indent ? 52 : 14, paddingRight: 14, marginHorizontal: 10, borderRadius: 14, backgroundColor: drop || active || pressed ? c.fill : 'transparent' })}>
      {icon && !indent ? <View style={{ width: 34 }}><Icon name={icon} size={21} color={c.text} /></View> : null}
      <Text style={{ flex: 1, color: muted ? c.muted : c.text, fontSize: indent ? 16 : 18 }} numberOfLines={1}>{title}</Text>
      {count ? <Text style={{ color: c.muted, fontSize: 14, marginLeft: 6 }}>{count}</Text> : null}
      {dot ? <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: c.accent, marginLeft: 6 }} /> : null}
      {right}
    </Pressable>
  );
}
function Head({ label, open, onToggle, c }) {
  return (
    <Pressable onPress={onToggle} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 20, marginBottom: 4, marginLeft: 24, paddingVertical: 4 }}>
      <Text style={{ color: c.muted, fontSize: 15 }}>{label}</Text>
      {onToggle ? <Icon name={open ? 'chevron-down' : 'chevron-right'} size={15} color={c.muted} /> : null}
    </Pressable>
  );
}

export function Home() {
  const currentId = '';
  const [running, setRunning] = useState([]); // chats with an answer running (on any device)
  const { api, c, server } = useSession();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [chats, setChats] = useState(null);
  const [projects, setProjects] = useState([]);
  const [me, setMe] = useState('');
  const [counts, setCounts] = useState({});
  const [shut, setShut] = useState({ workspace: false, pinned: false });
  const [closedProjects, setClosedProjects] = useState({});
  const [menu, setMenu] = useState(null); // the chat whose actions are open (long press)
  const [pmenu, setPmenu] = useState(null); // the project whose actions are open (long press)
  // drag and drop, as in the desktop sidebar: hold a chat, move it onto a project to put it there, or anywhere else
  // to take it out of its project; hold and let go without moving opens its menu
  const [drag, setDrag] = useState(null); // { chat, x, y, over: project id | '-' (no project) | '' }
  const dragRef = useRef(null);
  const groups = useRef({}); // project id -> the View around its row and its chats (a drop target)
  const targets = useRef([]);
  const hit = (x, y) => { const t = targets.current.find((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h); return t ? t.id : '-'; };
  const startDrag = (chat) => {
    dragRef.current = { chat, moving: false };
    targets.current = [];
    for (const [id, v] of Object.entries(groups.current)) if (v && v.measureInWindow) v.measureInWindow((x, y, w, h) => { targets.current.push({ id, x, y, w, h }); });
    setDrag({ chat, x: 0, y: 0, over: '' });
  };
  const endDrag = async (drop) => {
    const d = dragRef.current; dragRef.current = null; setDrag(null);
    if (!d || !drop) return;
    const to = drop === '-' ? null : drop;
    if ((d.chat.projectId || null) === to) return;
    setChats((l) => l.map((x) => (x.id === d.chat.id ? { ...x, projectId: to } : x)));
    try { await api.post(`/v1/x/sessions/${encodeURIComponent(d.chat.id)}`, { projectId: to }); } catch { load(); }
  };
  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponderCapture: () => { if (!dragRef.current) return false; dragRef.current.moving = true; return true; },
    onPanResponderMove: (_e, g) => { const over = hit(g.moveX, g.moveY); setDrag((d) => (d ? { ...d, x: g.moveX, y: g.moveY, over } : d)); },
    onPanResponderRelease: (_e, g) => { endDrag(hit(g.moveX, g.moveY)); },
    onPanResponderTerminate: () => endDrag(null),
    onPanResponderTerminationRequest: () => false,
  })).current;

  const load = useCallback(() => {
    if (!api) return;
    api.get('/v1/sessions?limit=300').then((r) => setChats(r.sessions)).catch(() => setChats((x) => x || []));
    api.get('/v1/x/projects').then((r) => setProjects(r.projects || [])).catch(() => {});
    api.get('/v1/x/agents').then((r) => setCounts((x) => ({ ...x, agents: (r.agents || []).length }))).catch(() => {});
    api.get('/v1/x/connectors').then((r) => setCounts((x) => ({ ...x, connectors: (r.connectors || []).filter((k) => k.state === 'connected').length }))).catch(() => {});
    api.get('/v1/memory/list').then((r) => setCounts((x) => ({ ...x, memory: (r.entries || []).length }))).catch(() => {});
  }, [api]);
  useFocusEffect(useCallback(() => { load(); }, [load])); // fresh every time you come back to it
  // live: a chat made, answered, renamed or deleted elsewhere shows up at once
  const soon = useRef(null);
  useLive(api, (ev) => {
    if (ev.type === 'runs') setRunning((ev.data && ev.data.sessions) || []);
    if (ev.type === 'sessions' || ev.type === 'resume') { clearTimeout(soon.current); soon.current = setTimeout(load, 400); }
  });
  useEffect(() => { if (api) api.get('/v1/x/settings').then((r) => setMe((r.settings && r.settings.profileName) || '')).catch(() => {}); }, [api]);

  const go = (p) => router.push(p);
  const open = (id) => router.push(`/chat/${encodeURIComponent(id)}`);
  const newChat = () => router.push(`/chat/${newChatId()}?fresh=1`);
  const toggle = (k) => setShut((s) => ({ ...s, [k]: !s[k] }));
  const list = [...(chats || [])].sort((a, b) => b.updatedAt - a.updatedAt);
  const pinnedChats = list.filter((x) => x.pinned);
  const unassigned = list.filter((x) => !x.pinned && !x.projectId);
  const projectList = [...projects.filter((p) => p.pinned), ...projects.filter((p) => !p.pinned)].filter((p) => !p.sideHidden);
  const chatRow = (x, indent) => <Row key={x.id} icon="message-circle" title={x.title || 'Untitled'} onPress={() => open(x.id)} onLongPress={() => startDrag(x)}
    onPressOut={() => { const d = dragRef.current; if (d && d.chat.id === x.id && !d.moving) { dragRef.current = null; setDrag(null); setMenu(x); } }} c={c} active={x.id === currentId} dot={running.includes(x.id)} indent={indent} />;

  const rows = [];
  if (projectList.length || pinnedChats.length) rows.push(<Head key="ph" label="Pinned" open={!shut.pinned} onToggle={() => toggle('pinned')} c={c} />);
  if (!shut.pinned) {
    for (const p of projectList) {
      const items = list.filter((x) => !x.pinned && x.projectId === p.id);
      const isOpen = closedProjects[p.id] !== true;
      const shown = items.filter((x, i) => i < PROJECT_ROWS || x.id === currentId || running.includes(x.id));
      rows.push(
        <View key={'pg' + p.id} ref={(v) => { if (v) groups.current[p.id] = v; else delete groups.current[p.id]; }} collapsable={false}>
          <Row icon="folder" title={p.name} c={c} drop={drag && drag.over === p.id} onPress={() => setClosedProjects((s) => ({ ...s, [p.id]: isOpen }))} onLongPress={() => setPmenu(p)}
            right={<View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>{p.pinned ? <Icon name="bookmark" size={14} color={c.accent} /> : null}<Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={17} color={c.muted} /></View>} />
          {isOpen && shown.map((x) => chatRow(x, true))}
          {isOpen && shown.length < items.length && <Row title="View all" indent muted onPress={() => go(`/project?id=${encodeURIComponent(p.id)}`)} c={c} />}
        </View>
      );
    }
    for (const x of pinnedChats) rows.push(chatRow(x, false));
  }
  let last = '';
  for (const x of unassigned) {
    const g = dayGroup(x.updatedAt);
    if (g !== last) { rows.push(<Head key={'g' + g} label={g} c={c} />); last = g; }
    rows.push(chatRow(x, false));
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }} {...pan.panHandlers}>
      <ScrollView scrollEnabled={!drag} contentContainerStyle={{ paddingBottom: 120 + insets.bottom }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 22, paddingTop: insets.top + 10, paddingBottom: 14 }}>
          <Text style={{ flex: 1, color: c.text, fontSize: 34, fontFamily: serif }}>Artemis</Text>
          <RoundButton icon="eye-off" label="Incognito chat: not saved, no memory" onPress={() => router.push(`/chat/incog-${newChatId().slice(2)}`)} c={c} />
          <RoundButton icon="edit" label="New chat" onPress={newChat} c={c} />
        </View>
        <Row icon="search" title="Search" onPress={() => go('/search')} c={c} />
        <Row icon="user" title="Agents" count={counts.agents} onPress={() => go('/agents')} c={c} />
        <Row icon="clock" title="Scheduled" onPress={() => go('/scheduled')} c={c} />
        <Row icon="layers" title="Artifacts" onPress={() => go('/artifacts')} c={c} />
        <Row icon="link-2" title="Connectors" count={counts.connectors} onPress={() => go('/connectors')} c={c} />
        <Head label="Workspace" open={!shut.workspace} onToggle={() => toggle('workspace')} c={c} />
        {!shut.workspace && (
          <>
            <Row icon="folder" title="Projects" onPress={() => go('/projects')} c={c} />
            <Row icon="file-text" title="Notes" onPress={() => go('/notes')} c={c} />
            <Row icon="hard-drive" title="Files" onPress={() => go('/files')} c={c} />
            <Row icon="star" title="Skills" onPress={() => go('/skills')} c={c} />
            <Row icon="zap" title="Automations" onPress={() => go('/automations')} c={c} />
            <Row icon="book-open" title="Memory" count={counts.memory} onPress={() => go('/memory')} c={c} />
          </>
        )}
        {!chats && <ActivityIndicator color={c.muted} style={{ marginTop: 18 }} />}
        {rows}
        {chats && !list.length && <Text style={{ color: c.muted, marginLeft: 24, marginTop: 16 }}>No chats</Text>}
      </ScrollView>
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingBottom: insets.bottom + 14, paddingTop: 14, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: c.bg, borderTopWidth: 1, borderTopColor: c.line }}>
        <Pressable onPress={() => go('/settings')} accessibilityLabel="Settings, usage and more"
          style={({ pressed }) => ({ width: 56, height: 56, borderRadius: 28, backgroundColor: c.round, borderWidth: 1, borderColor: c.line, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}>
          <Text style={{ color: c.text, fontSize: 19, fontWeight: '700' }}>{initials(me || (server && server.name))}</Text>
        </Pressable>
        <View style={{ flex: 1 }}><Pill title="New chat" icon="plus" onPress={newChat} c={c} /></View>
      </View>
      {drag && dragRef.current && dragRef.current.moving && (
        <View pointerEvents="none" style={{ position: 'absolute', left: Math.max(10, drag.x - 120), top: drag.y - 28, width: 240, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 14, backgroundColor: c.round, borderWidth: 1, borderColor: c.accent, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 10, elevation: 8 }}>
          <Text numberOfLines={1} style={{ color: c.text, fontSize: 15 }}>{drag.chat.title || 'Untitled'}</Text>
          <Text numberOfLines={1} style={{ color: c.muted, fontSize: 12, marginTop: 2 }}>{drag.over && drag.over !== '-' ? `Move to ${(projects.find((p) => p.id === drag.over) || {}).name || 'project'}` : drag.chat.projectId ? 'Take out of its project' : 'Drop on a project'}</Text>
        </View>
      )}
      {pmenu && <ProjectActions project={pmenu} onClose={() => setPmenu(null)} onChanged={(p) => (p === null ? load() : setProjects((l) => l.map((x) => (x.id === pmenu.id ? { ...x, ...p } : x))))} />}
      {menu && <ChatActions chat={menu} onClose={() => setMenu(null)} onChanged={(p) => setChats((l) => (p === null ? l.filter((x) => x.id !== menu.id) : l.map((x) => (x.id === menu.id ? { ...x, ...p } : x))))} />}
    </View>
  );
}
