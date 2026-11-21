// One message in the chat: the user's text and pictures, or the assistant's steps (thinking, text, tool cards,
// files), with approve / deny on a tool that waits for the user.
import React, { useEffect, useState } from 'react';
import { Image, Modal, Platform, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Markdown } from './Markdown';
import { messageText } from '../lib/core';
import { Icon, RoundButton, mono } from './ui';
import { LocalFileView, TextFileView } from './Preview';
import { fileKind } from '../lib/render';

const MEDIA = /^artemis-media:\/\/([a-f0-9]{32}\.(png|jpg|gif|webp))$/;

/** An image behind the server's token: headers on the phone, a blob URL in the browser. */
export function ServerImage({ name, api, style, contain }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    if (Platform.OS !== 'web') { setSrc({ uri: api.mediaUrl(name), headers: { authorization: `Bearer ${api.token}` } }); return; }
    let url = '', alive = true;
    globalThis.fetch(api.mediaUrl(name), { headers: { authorization: `Bearer ${api.token}` } }).then((r) => r.blob()).then((b) => { url = URL.createObjectURL(b); if (alive) setSrc({ uri: url }); }).catch(() => {});
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [name]);
  return src ? <Image source={src} style={style} resizeMode={contain ? 'contain' : 'cover'} /> : <View style={[style, { backgroundColor: '#8882' }]} />;
}

/** Markdown as on the desktop (components/Markdown.js). */
const Rich = ({ text, c }) => <Markdown text={text} c={c} />;

/** A card for a file or an artifact the answer made; opens the viewer. */
function Card({ icon, title, sub, onPress, c }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: c.line, backgroundColor: pressed ? c.fill : c.card, borderRadius: 14, padding: 12, marginVertical: 5 })}>
      <View style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: c.fill, alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={19} color={c.accent} /></View>
      <View style={{ flex: 1 }}><Text style={{ color: c.text, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{title}</Text><Text style={{ color: c.muted, fontSize: 13 }} numberOfLines={1}>{sub}</Text></View>
      <Icon name="chevron-right" size={18} color={c.faint} />
    </Pressable>
  );
}
const FILE_ICON = { csv: 'grid', sheet: 'grid', md: 'file-text', html: 'globe', image: 'image', svg: 'image', pdf: 'file', doc: 'file-text', media: 'film', binary: 'archive', text: 'file-text' };
const FILE_SUB = { csv: 'Table · CSV', sheet: 'Spreadsheet', md: 'Document', html: 'Web page', image: 'Image', svg: 'SVG', pdf: 'PDF', doc: 'Document', media: 'Media', binary: 'File', text: 'Text' };

const STATUS = { running: '…', awaiting: 'waiting for you', question: 'has a question', done: '✓', error: 'failed', denied: 'denied', cancelled: 'stopped' };

function ToolCard({ t, c, onDecide }) {
  const [open, setOpen] = useState(false);
  const label = t.summary || `${t.name}${t.args && (t.args.path || t.args.query || t.args.url) ? ' · ' + (t.args.path || t.args.query || t.args.url) : ''}`;
  return (
    <View style={{ borderWidth: 1, borderColor: t.status === 'awaiting' ? c.accent : c.line, borderRadius: 10, marginVertical: 4, overflow: 'hidden' }}>
      <Pressable onPress={() => setOpen(!open)} style={{ paddingHorizontal: 10, paddingVertical: 8, flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ flex: 1, color: c.text, fontSize: 14 }} numberOfLines={open ? 6 : 1}>{label}</Text>
        <Text style={{ color: t.status === 'error' || t.status === 'denied' ? c.danger : c.muted, fontSize: 13, marginLeft: 8 }}>{STATUS[t.status] || t.status}</Text>
      </Pressable>
      {t.status === 'awaiting' && onDecide && (
        <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 10, paddingBottom: 10 }}>
          <Pressable onPress={() => onDecide(t.id, true)} style={{ backgroundColor: c.accent, borderRadius: 8, paddingVertical: 7, paddingHorizontal: 14 }}><Text style={{ color: c.accentText, fontWeight: '600' }}>Allow</Text></Pressable>
          <Pressable onPress={() => onDecide(t.id, false)} style={{ borderWidth: 1, borderColor: c.line, borderRadius: 8, paddingVertical: 7, paddingHorizontal: 14 }}><Text style={{ color: c.text }}>Deny</Text></Pressable>
        </View>
      )}
      {t.status === 'question' && <Text style={{ color: c.muted, fontSize: 13, paddingHorizontal: 10, paddingBottom: 8 }}>{(t.questions || []).map((q) => q.question || q).join('\n')}{'\n'}Answer in the desktop app.</Text>}
      {open && t.result != null && <Text selectable style={{ fontFamily: mono, fontSize: 12, color: c.muted, paddingHorizontal: 10, paddingBottom: 10 }} numberOfLines={30}>{String(t.result).slice(0, 4000)}</Text>}
      {open && (t.agents || []).filter(Boolean).map((a, i) => <Text key={i} style={{ color: c.muted, fontSize: 13, paddingHorizontal: 10, paddingBottom: 6 }}>{a.name || 'Agent'}: {a.status} {a.task ? '· ' + a.task : ''}</Text>)}
    </View>
  );
}

const KIND_ICON = { csv: 'grid', sheet: 'grid', pdf: 'file-text', doc: 'file-text', md: 'file-text', text: 'code', html: 'globe', svg: 'image', image: 'image', media: 'film', binary: 'archive' };
/** A file sent with a message, as on the desktop: icon and name in a small chip; tap opens it. */
function AttachmentChip({ a, c, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: 260, paddingVertical: 5, paddingHorizontal: 9, borderRadius: 10, backgroundColor: c.fill, borderWidth: 1, borderColor: pressed ? c.accent : c.line })}>
      <Icon name={KIND_ICON[fileKind(a.name)] || 'file'} size={15} color={c.muted} />
      <Text numberOfLines={1} style={{ color: c.text, fontSize: 13, flexShrink: 1 }}>{a.name}</Text>
      {a.truncated ? <Text style={{ color: c.muted, fontSize: 11 }}>truncated</Text> : null}
    </Pressable>
  );
}
/** A picture or a file's text (when it has no copy on the server to open), full screen. */
function AttachmentSheet({ a, api, c, onClose }) {
  const mm = MEDIA.exec(a.url || '');
  return (
    <Modal animationType="slide" visible presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 }}>
          <RoundButton icon="x" label="Close" onPress={onClose} c={c} size={44} />
          <Text style={{ flex: 1, textAlign: 'center', color: c.text, fontSize: 17, fontWeight: '600' }} numberOfLines={1}>{a.name || 'Attachment'}</Text>
          <View style={{ width: 44 }} />
        </View>
        {a.kind === 'image'
          ? <View style={{ flex: 1, padding: 12 }}>{mm ? <ServerImage name={mm[1]} api={api} style={{ flex: 1 }} contain /> : <Image source={{ uri: a.dataUrl }} style={{ flex: 1 }} resizeMode="contain" />}</View>
          : a.data ? <LocalFileView file={a} /> : <TextFileView name={a.name} text={String(a.text || '').replace(/^\(saved on the server at [^)]*\)\n/, '')} />}
      </View>
    </Modal>
  );
}

/** The model's thinking, folded like on the desktop: "Thought for 3 s ›"; tap to read it. */
function Thinking({ t, c }) {
  const [open, setOpen] = React.useState(false);
  const live = typeof t.ms !== 'number';
  return (
    <View style={{ marginBottom: 6 }}>
      <Pressable onPress={() => setOpen((x) => !x)} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingVertical: 3 }}>
        <Text style={{ color: c.muted, fontSize: 13 }}>{live ? 'Thinking…' : `Thought for ${Math.max(1, Math.round(t.ms / 1000))} s`}</Text>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} color={c.muted} />
      </Pressable>
      {open && <Text selectable style={{ color: c.muted, fontSize: 13, lineHeight: 19, borderLeftWidth: 2, borderLeftColor: c.line, paddingLeft: 10, marginTop: 4 }}>{t.text}</Text>}
    </View>
  );
}

export function Message({ m, api, c, onDecide, running, chatId, artifacts, onCopy, onSpeak, onEdit, onRegenerate }) {
  const router = useRouter();
  const [shown, setShown] = useState(null); // an attachment opened from the message
  if (m.role === 'user') {
    if (m.compacted) return <Text style={{ color: c.muted, fontSize: 13, textAlign: 'center', marginVertical: 10 }}>Earlier messages were summarized</Text>;
    const pics = (m.attachments || []).filter((a) => a.kind === 'image');
    const files = (m.attachments || []).filter((a) => a.kind !== 'image');
    return (
      <View style={{ alignSelf: 'flex-end', maxWidth: '86%', marginVertical: 6 }}>
        {pics.map((a, i) => { const mm = MEDIA.exec(a.url || ''); const st = { width: 180, height: 180, borderRadius: 12 }; return <Pressable key={i} onPress={() => setShown(a)} style={{ marginBottom: 6, alignSelf: 'flex-end' }}>{mm ? <ServerImage name={mm[1]} api={api} style={st} /> : a.dataUrl ? <Image source={{ uri: a.dataUrl }} style={st} /> : null}</Pressable>; })}
        {files.length > 0 && <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 6, marginBottom: 6 }}>{files.map((a, i) => <AttachmentChip key={'f' + i} a={a} c={c} onPress={() => (a.path ? router.push(`/file?path=${encodeURIComponent(a.path)}&name=${encodeURIComponent(a.name || '')}`) : setShown(a))} />)}</View>}
        {shown && <AttachmentSheet a={shown} api={api} c={c} onClose={() => setShown(null)} />}
        {!!m.content && <View style={{ backgroundColor: c.user, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 }}><Text selectable style={{ color: c.text, fontSize: 16, lineHeight: 22 }}>{m.content}</Text></View>}
        {(onCopy || onEdit) && (
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 16, marginTop: 6, marginRight: 6 }}>
            {onCopy && <Pressable hitSlop={8} onPress={() => onCopy(m)}><Icon name="copy" size={16} color={c.muted} /></Pressable>}
            {onEdit && <Pressable hitSlop={8} onPress={() => onEdit(m)}><Icon name="edit-2" size={16} color={c.muted} /></Pressable>}
          </View>
        )}
      </View>
    );
  }
  const steps = m.steps || [];
  const empty = !messageText(m) && !steps.some((s) => (s.toolCalls || []).length);
  return (
    <View style={{ marginVertical: 8 }}>
      {m.env === 'local' && <Text style={{ color: c.muted, fontSize: 12, marginBottom: 4 }}>Ran on the computer</Text>}
      {m.council && m.council.pending && !m.brain ? <Text style={{ color: c.muted, fontSize: 13, marginBottom: 4 }}>The council is voting…</Text> : null}
      {m.brain ? <Text style={{ color: c.accent, fontSize: 13, fontWeight: '600', marginBottom: 4 }}>{m.brain.name}{m.brain.role ? ` · ${m.brain.role}` : ''}{m.council && m.council.verdict ? ' · chosen by the council' : ''}</Text> : null}
      {steps.map((s, i) => (
        <View key={i}>
          {s.thinking && s.thinking.text ? <Thinking t={s.thinking} c={c} /> : null}
          {!!String(s.text || '').trim() && <Rich text={String(s.text).replace(/<think(ing)?>[\s\S]*?(<\/think(ing)?>|$)/gi, '')} c={c} />}
          {(s.toolCalls || []).map((t) => <ToolCard key={t.id} t={t} c={c} onDecide={onDecide} />)}
          {(s.artifactRefs || []).filter((x, k, arr) => arr.indexOf(x) === k).map((id) => { const a = (artifacts || {})[id] || {}; return <Card key={'a' + id} icon={{ html: 'globe', svg: 'image', spreadsheet: 'grid', code: 'code' }[a.type] || 'file-text'} title={a.title || 'Artifact'} sub={{ html: 'Web page', svg: 'SVG', markdown: 'Document', spreadsheet: 'Spreadsheet', code: a.language || 'Code' }[a.type] || 'Artifact'} onPress={() => router.push(`/artifact?id=${encodeURIComponent(id)}&chat=${encodeURIComponent(chatId || '')}`)} c={c} />; })}
          {(s.files || []).map((f) => { const k = fileKind(f.name || f.path); return f.env === 'local'
            ? <Card key={f.path} icon={FILE_ICON[k] || 'file'} title={f.name} sub={`${FILE_SUB[k] || 'File'} · on the computer`} onPress={() => {}} c={c} />
            : <Card key={f.path} icon={FILE_ICON[k] || 'file'} title={f.name} sub={`${FILE_SUB[k] || 'File'} · on the server`} onPress={() => router.push(`/file?path=${encodeURIComponent(f.path)}&name=${encodeURIComponent(f.name || '')}`)} c={c} />; })}
          {(s.media || []).map((x, k) => <Text key={k} style={{ color: c.muted, fontSize: 13 }}>🖼 {x.kind} made on the server</Text>)}
        </View>
      ))}
      {running && empty && <Text style={{ color: c.muted }}>…</Text>}
      {!!m.error && <Text style={{ color: c.danger, marginTop: 4 }}>{m.error}</Text>}
      {(m.notices || []).map((n, i) => <Text key={i} style={{ color: c.muted, fontSize: 13, marginTop: 4 }}>{n}</Text>)}
      {!running && !empty && (onCopy || onSpeak || onRegenerate) && (
        <View style={{ flexDirection: 'row', gap: 20, marginTop: 8 }}>
          {onCopy && <Pressable hitSlop={8} onPress={() => onCopy(m)} accessibilityLabel="Copy"><Icon name="copy" size={17} color={c.muted} /></Pressable>}
          {onSpeak && <Pressable hitSlop={8} onPress={() => onSpeak(m)} accessibilityLabel="Read aloud"><Icon name="volume-2" size={17} color={c.muted} /></Pressable>}
          {onRegenerate && <Pressable hitSlop={8} onPress={onRegenerate} accessibilityLabel="Regenerate"><Icon name="refresh-cw" size={17} color={c.muted} /></Pressable>}
        </View>
      )}
    </View>
  );
}
