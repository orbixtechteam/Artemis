// Shows a page made by lib/render.js: a web view on the phone, an iframe in the web app. Links open in the browser.
// Web pages (html artifacts) run their scripts in their own sandbox; documents, tables and code are shown without scripts.
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Linking, Platform, Text, View } from 'react-native';
import { useSession } from '../lib/session';
import { utf8Decoder } from '../lib/core';
import { artifactPage, codeHtml, docHtml, fileKind, markdownHtml, page, plainHtml, sheetGridHtml, splitSheets } from '../lib/render';

const isPlain = (name) => /\.(txt|log|text|rtf)$/i.test(String(name || ''));

let WebView = null;
if (Platform.OS !== 'web') { try { WebView = require('react-native-webview').WebView; } catch {} }

export function HtmlView({ html, scripts = false, style }) {
  const { c } = useSession();
  if (Platform.OS === 'web') {
    return React.createElement('iframe', { srcDoc: html, sandbox: scripts ? 'allow-scripts allow-popups' : 'allow-popups', style: { flex: 1, width: '100%', height: '100%', border: 0, background: c.bg, ...(style || {}) } });
  }
  if (!WebView) return <Text style={{ color: c.danger, padding: 20 }}>The viewer is missing: install react-native-webview (npx expo install react-native-webview).</Text>;
  return (
    <WebView source={{ html, baseUrl: '' }} originWhitelist={['*']} javaScriptEnabled={scripts} domStorageEnabled={scripts}
      style={[{ flex: 1, backgroundColor: c.bg }, style]} containerStyle={{ backgroundColor: c.bg }} setSupportMultipleWindows={false}
      onShouldStartLoadWithRequest={(r) => { if (/^https?:/i.test(r.url) && r.navigationType === 'click') { Linking.openURL(r.url); return false; } return true; }} />
  );
}

/** An artifact (from a chat) drawn like on the desktop. */
export function ArtifactView({ artifact }) {
  const { c } = useSession();
  return <HtmlView html={artifactPage(artifact, c)} scripts={artifact.type === 'html' || artifact.type === 'spreadsheet'} />;
}

/** A file on the server: tables for CSV and spreadsheets, rendered Markdown, pictures, PDF, text. path: absolute or in Files. */
export function FileView({ path, name }) {
  const { api, c } = useSession();
  const kind = fileKind(name || path);
  const [state, setState] = useState({ loading: true });
  const raw = `${api.base}/v1/x/files/raw?path=${encodeURIComponent(path)}`;
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (kind === 'image' || kind === 'media' || kind === 'binary' || (kind === 'pdf' && Platform.OS !== 'android')) { setState({}); return; }
        // the desktop's viewers: Word as a document page, sheets as the sheet editor, Markdown as a document, text and code
        if (/\.docx$/i.test(name || path)) {
          const d = await api.get(`/v1/x/files/docx?path=${encodeURIComponent(path)}`);
          if (alive) setState({ html: page(docHtml(d.html || ''), c, { title: name }), scripts: false });
          return;
        }
        const ep = kind === 'sheet' || kind === 'doc' || kind === 'pdf' ? 'sheet' : 'text';
        const r = await api.get(`/v1/x/files/${ep}?path=${encodeURIComponent(path)}`);
        if (!alive) return;
        const t = r.text || '';
        const body = kind === 'csv' || kind === 'sheet' ? sheetGridHtml(splitSheets(t, name || path)) : kind === 'md' ? markdownHtml(t) : kind === 'svg' ? `<div style="display:flex;justify-content:center">${t}</div>` : kind === 'doc' || kind === 'pdf' || isPlain(name || path) ? plainHtml(t) : codeHtml(t);
        setState({ html: kind === 'html' ? t : page(body, c, { title: name }), scripts: kind === 'html' || kind === 'csv' || kind === 'sheet' });
      } catch (e) { if (alive) setState({ error: e.message }); }
    })();
    return () => { alive = false; };
  }, [path, c]);
  if (state.error) return <Text style={{ color: c.danger, padding: 20 }}>{state.error}</Text>;
  if (kind === 'image') return <View style={{ flex: 1, backgroundColor: c.bg, padding: 12 }}><Image source={{ uri: raw, headers: { authorization: `Bearer ${api.token}` } }} style={{ flex: 1 }} resizeMode="contain" /></View>;
  if (kind === 'pdf' && Platform.OS === 'ios' && WebView) return <WebView source={{ uri: raw, headers: { authorization: `Bearer ${api.token}` } }} style={{ flex: 1, backgroundColor: c.bg }} />;
  if (kind === 'media' || kind === 'binary' || (kind === 'pdf' && Platform.OS === 'web')) return <Text style={{ color: c.muted, padding: 24, textAlign: 'center' }}>This file is on the server. Open it on the desktop, or ask Artemis about it in a chat.</Text>;
  if (state.loading || !state.html) return <ActivityIndicator color={c.muted} style={{ marginTop: 40 }} />;
  return <HtmlView html={state.html} scripts={state.scripts} />;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function b64Bytes(s) {
  const t = String(s || '').replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((t.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < t.length; i += 4) {
    const n = (B64.indexOf(t[i]) << 18) | (B64.indexOf(t[i + 1]) << 12) | ((B64.indexOf(t[i + 2]) & 63) << 6) | (B64.indexOf(t[i + 3]) & 63);
    out[o++] = (n >> 16) & 255; if (t[i + 2] !== undefined) out[o++] = (n >> 8) & 255; if (t[i + 3] !== undefined) out[o++] = n & 255;
  }
  return out.subarray(0, o);
}

/** A file picked in the composer, before it is sent: pictures, PDF (phone), CSV and spreadsheets as text tables, Markdown, text and code. */
export function LocalFileView({ file }) {
  const { c } = useSession();
  const kind = file.kind === 'image' ? 'image' : fileKind(file.name);
  if (kind === 'image') return <View style={{ flex: 1, backgroundColor: c.bg, padding: 12 }}><Image source={{ uri: file.dataUrl }} style={{ flex: 1 }} resizeMode="contain" /></View>;
  if (kind === 'pdf') {
    if (Platform.OS === 'web') return React.createElement('iframe', { src: `data:application/pdf;base64,${file.data}`, style: { flex: 1, width: '100%', height: '100%', border: 0 } });
    if (WebView) return <WebView source={{ uri: `data:application/pdf;base64,${file.data}` }} originWhitelist={['*']} style={{ flex: 1, backgroundColor: c.bg }} />;
  }
  if (['csv', 'md', 'text', 'svg', 'html'].includes(kind)) {
    let t = '';
    try { t = utf8Decoder()(b64Bytes(file.data), true); } catch {}
    const body = kind === 'csv' ? sheetGridHtml(splitSheets(t, file.name)) : kind === 'md' ? markdownHtml(t) : kind === 'svg' ? `<div style="display:flex;justify-content:center">${t}</div>` : isPlain(file.name) ? plainHtml(t) : codeHtml(t);
    return <HtmlView html={page(body, c, { title: file.name })} scripts={kind === 'csv'} />;
  }
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 }}>
      <Text style={{ color: c.text, fontSize: 17, textAlign: 'center' }}>{file.name}</Text>
      <Text style={{ color: c.muted, fontSize: 14, marginTop: 8, textAlign: 'center' }}>{file.size ? `${Math.max(1, Math.round(file.size / 1024))} KB · ` : ''}Artemis reads it when you send the message. After that, open it from the chat to see it.</Text>
    </View>
  );
}

/** A file's text (what Artemis read from it), drawn like its kind: tables for CSV and spreadsheets, Markdown, code. */
export function TextFileView({ name, text }) {
  const { c } = useSession();
  const kind = fileKind(name);
  const body = kind === 'csv' || kind === 'sheet' ? sheetGridHtml(splitSheets(text, name)) : kind === 'md' ? markdownHtml(text) : kind === 'doc' || kind === 'pdf' || isPlain(name) ? plainHtml(text) : codeHtml(text);
  return <HtmlView html={page(body, c, { title: name })} scripts={kind === 'csv' || kind === 'sheet'} />;
}
