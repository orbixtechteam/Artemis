// Markdown in chat messages, drawn with native views (no web view, no extra packages): headings, paragraphs,
// bold / italic / code / links, lists (nested, with tasks), code blocks, quotes, tables and rules. Uses marked's lexer.
import React from 'react';
import { Linking, ScrollView, Text, View } from 'react-native';
import { marked } from 'marked';
import { mono, serif } from './ui';

function inline(tokens, c, key = 'i') {
  return (tokens || []).map((t, i) => {
    const k = `${key}${i}`;
    switch (t.type) {
      case 'strong': return <Text key={k} style={{ fontWeight: '700' }}>{inline(t.tokens, c, k)}</Text>;
      case 'em': return <Text key={k} style={{ fontStyle: 'italic' }}>{inline(t.tokens, c, k)}</Text>;
      case 'del': return <Text key={k} style={{ textDecorationLine: 'line-through' }}>{inline(t.tokens, c, k)}</Text>;
      case 'codespan': return <Text key={k} style={{ fontFamily: mono, fontSize: 14, backgroundColor: c.code, color: c.text }}>{` ${unescape(t.text)} `}</Text>;
      case 'link': return <Text key={k} style={{ color: c.accent, textDecorationLine: 'underline' }} onPress={() => /^https?:/i.test(t.href) && Linking.openURL(t.href)}>{inline(t.tokens, c, k)}</Text>;
      case 'image': return <Text key={k} style={{ color: c.muted }}>[{t.text || 'image'}]</Text>;
      case 'br': return <Text key={k}>{'\n'}</Text>;
      case 'text': case 'escape': return t.tokens ? <Text key={k}>{inline(t.tokens, c, k)}</Text> : <Text key={k}>{unescape(t.text)}</Text>;
      default: return <Text key={k}>{unescape(t.raw || t.text || '')}</Text>;
    }
  });
}
const unescape = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

function block(t, c, k, depth = 0) {
  const body = { color: c.text, fontSize: 16, lineHeight: 24 };
  switch (t.type) {
    case 'heading': return <Text key={k} selectable style={{ ...body, fontFamily: t.depth <= 2 ? serif : undefined, fontSize: [0, 24, 21, 18, 17, 16, 16][t.depth], fontWeight: t.depth <= 2 ? '600' : '700', lineHeight: [0, 32, 28, 25, 24, 24, 24][t.depth], marginTop: 12, marginBottom: 4 }}>{inline(t.tokens, c, k)}</Text>;
    case 'paragraph': return <Text key={k} selectable style={{ ...body, marginVertical: 5 }}>{inline(t.tokens, c, k)}</Text>;
    case 'text': return <Text key={k} selectable style={body}>{t.tokens ? inline(t.tokens, c, k) : unescape(t.text)}</Text>;
    case 'space': return null;
    case 'hr': return <View key={k} style={{ height: 1, backgroundColor: c.line, marginVertical: 14 }} />;
    case 'code': return (
      <ScrollView key={k} horizontal style={{ backgroundColor: c.code, borderRadius: 12, marginVertical: 8 }} contentContainerStyle={{ padding: 12 }}>
        <Text selectable style={{ fontFamily: mono, fontSize: 13, lineHeight: 19, color: c.text }}>{t.text}</Text>
      </ScrollView>
    );
    case 'blockquote': return <View key={k} style={{ borderLeftWidth: 3, borderLeftColor: c.accent, paddingLeft: 12, marginVertical: 6 }}>{(t.tokens || []).map((x, i) => block(x, { ...c, text: c.muted }, `${k}q${i}`, depth))}</View>;
    case 'list': return (
      <View key={k} style={{ marginVertical: 4 }}>
        {t.items.map((it, i) => (
          <View key={`${k}l${i}`} style={{ flexDirection: 'row', paddingLeft: depth * 14, marginVertical: 2 }}>
            <Text style={{ ...body, width: t.ordered ? 26 : 18, color: c.muted }}>{it.task ? (it.checked ? '☑' : '☐') : t.ordered ? `${(Number(t.start) || 1) + i}.` : '•'}</Text>
            <View style={{ flex: 1 }}>{(it.tokens || []).map((x, j) => block(x, c, `${k}l${i}b${j}`, x.type === 'list' ? depth + 1 : depth))}</View>
          </View>
        ))}
      </View>
    );
    case 'table': return (
      <ScrollView key={k} horizontal style={{ marginVertical: 8 }}>
        <View style={{ borderWidth: 1, borderColor: c.line, borderRadius: 10, overflow: 'hidden' }}>
          <View style={{ flexDirection: 'row', backgroundColor: c.card }}>
            {t.header.map((h, i) => <Text key={i} style={{ ...body, fontSize: 14, fontWeight: '700', paddingVertical: 7, paddingHorizontal: 10, minWidth: 90, maxWidth: 260, borderRightWidth: i < t.header.length - 1 ? 1 : 0, borderRightColor: c.line }}>{inline(h.tokens, c, `${k}h${i}`)}</Text>)}
          </View>
          {t.rows.map((r, ri) => (
            <View key={ri} style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: c.line }}>
              {r.map((cell, i) => <Text key={i} selectable style={{ ...body, fontSize: 14, paddingVertical: 7, paddingHorizontal: 10, minWidth: 90, maxWidth: 260, textAlign: t.align[i] === 'right' ? 'right' : t.align[i] === 'center' ? 'center' : 'left', borderRightWidth: i < r.length - 1 ? 1 : 0, borderRightColor: c.line }}>{inline(cell.tokens, c, `${k}r${ri}c${i}`)}</Text>)}
            </View>
          ))}
        </View>
      </ScrollView>
    );
    case 'html': return <Text key={k} selectable style={{ ...body, fontFamily: mono, fontSize: 13, color: c.muted }}>{t.text}</Text>;
    default: return t.raw ? <Text key={k} selectable style={body}>{t.raw}</Text> : null;
  }
}

export function Markdown({ text, c }) {
  let tokens = [];
  try { tokens = marked.lexer(String(text || ''), { gfm: true }); } catch { return <Text selectable style={{ color: c.text, fontSize: 16, lineHeight: 24 }}>{text}</Text>; }
  return <View>{tokens.map((t, i) => block(t, c, 'b' + i))}</View>;
}
