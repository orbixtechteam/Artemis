import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icons.jsx';
import { highlight, rank } from '../lib/fuzzy.mjs';

const RECENT_KEY = 'artemis.palette.recent';
const MAX_RESULTS = 50;
const loadRecent = () => { try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; } };
const saveRecent = (key) => { try { const v = [key, ...loadRecent().filter((x) => x !== key)].slice(0, 12); localStorage.setItem(RECENT_KEY, JSON.stringify(v)); } catch {} };
const dir = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

/** One result row. Memoized: moving the selection only re-renders the two rows that change. */
const Row = memo(function Row({ r, i, on, onHover, onPick }) {
  const parts = r.idx && r.idx.length ? highlight(r.label, r.idx) : null;
  return (
    <button type="button" data-i={i} className={'cmdk-item' + (on ? ' on' : '')} onMouseMove={(e) => onHover(i, e)} onClick={(e) => onPick(r, e.metaKey || e.ctrlKey)}>
      <span className="cmdk-ic"><Icon name={r.icon || 'chat'} size={15} /></span>
      <span className="cmdk-label">{parts ? parts.map((p, k) => (p.m ? <mark key={k} className="cmdk-m">{p.t}</mark> : <React.Fragment key={k}>{p.t}</React.Fragment>)) : r.label}</span>
      {r.swatch ? <span className="cmdk-sw">{r.swatch.map((c, k) => <i key={k} style={{ background: c }} />)}</span> : null}
      {r.current ? <span className="cmdk-cur"><Icon name="check" size={13} /></span> : null}
      {r.hint ? (/^[⌘⇧⌥⌃`]/.test(r.hint) ? <kbd className="cmdk-kbd">{r.hint}</kbd> : <span className="cmdk-hint">{r.hint}</span>) : null}
    </button>
  );
});

/**
 * Search everything (actions, chats, notes, files, settings pages) with fuzzy matching. Used inside the app (⌘K) and by the
 * floating palette window. actions: [{id,label,icon,hint?,group?,swatch?,words?,current?,onlyTyped?,run}]
 * ↵ runs the selected item, ⌘↵ opens a chat or note in a new tab.
 */
export default function CommandPalette({ open, onClose, chats = [], actions = [], onOpenChat, onOpenNote, onOpenFile, onOpenChatTab, onOpenNoteTab, embedded }) {
  const [q, setQ] = useState('');
  const [notes, setNotes] = useState([]);
  const [hits, setHits] = useState([]);
  const [files, setFiles] = useState([]);
  const [fhits, setFhits] = useState([]);
  const [idx, setIdx] = useState(0);
  const [recent, setRecent] = useState([]);
  const input = useRef(null);
  const list = useRef(null);
  const mouse = useRef({ x: -1, y: -1 });
  // the latest callbacks and actions, so the memoized item lists do not depend on their identity (the app re-renders often)
  const cb = useRef({}); cb.current = { onClose, onOpenChat, onOpenNote, onOpenFile, onOpenChatTab, onOpenNoteTab, actions };

  useEffect(() => {
    if (!open) return;
    setQ(''); setIdx(0); setHits([]); setFhits([]); setRecent(loadRecent());
    window.api.libList().then((r) => setFiles(r && r.ok ? r.items || [] : [])).catch(() => {});
    window.api.notesList().then((r) => setNotes(r && r.ok ? r.items.filter((i) => !i.dir) : [])).catch(() => {});
    requestAnimationFrame(() => input.current && input.current.focus());
  }, [open]);

  // full-text matches inside notes and files come from the main process (debounced; late answers for an older query are dropped)
  useEffect(() => {
    if (!open || q.trim().length < 3) { setHits([]); setFhits([]); return undefined; }
    let live = true;
    const t = setTimeout(async () => {
      const r = await window.api.notesSearch(q).catch(() => null); if (!live) return; setHits(r && r.ok ? r.results.slice(0, 6) : []);
      const f = await window.api.libSearch(q).catch(() => null); if (!live) return; setFhits(f && f.ok ? (f.results || []).slice(0, 6) : []);
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [q, open]);

  const actSig = actions.map((a) => [a.id, a.label, a.group, a.hint, a.current ? 1 : 0, a.onlyTyped ? 1 : 0, a.words, a.icon, (a.swatch || []).join()].join('\u0001')).join('\u0002');
  const actionItems = useMemo(() => cb.current.actions.map((a) => ({
    key: 'a' + a.id, section: a.group || 'Actions', icon: a.icon, label: a.label, hint: a.hint, swatch: a.swatch, current: a.current, onlyTyped: a.onlyTyped,
    extra: [a.group, a.words].filter(Boolean).join(' '),
    run: () => { const x = cb.current.actions.find((y) => y.id === a.id); if (x) x.run(); }
  })), [actSig]);
  const chatSig = chats.map((c) => (c.incognito ? '' : c.id + '\u0001' + (c.title || ''))).join('\u0002');
  const chatItems = useMemo(() => chats.filter((c) => !c.incognito).map((c) => ({
    key: 'c' + c.id, section: 'Chats', icon: 'chat', label: c.title || 'New chat',
    run: () => cb.current.onOpenChat && cb.current.onOpenChat(c.id),
    runTab: () => (cb.current.onOpenChatTab || cb.current.onOpenChat)(c.id)
  })), [chatSig]);
  const noteItems = useMemo(() => notes.map((n) => ({
    key: 'n' + n.path, section: 'Notes', icon: 'file', label: n.name, hint: dir(n.path), extra: n.path,
    run: () => cb.current.onOpenNote && cb.current.onOpenNote(n.path),
    runTab: () => (cb.current.onOpenNoteTab || cb.current.onOpenNote)(n.path)
  })), [notes]);
  const fileItems = useMemo(() => files.map((f) => ({
    key: 'f' + f.path, section: 'Files', icon: 'file', label: f.name, hint: dir(f.path), extra: f.path,
    run: () => cb.current.onOpenFile && cb.current.onOpenFile(f.path)
  })), [files]);

  const results = useMemo(() => {
    const s = q.trim();
    const out = [];
    if (!s) {
      // empty: what you used last, then recent chats, a few notes and files, then the actions
      const byKey = new Map();
      for (const it of [...actionItems, ...chatItems, ...noteItems, ...fileItems]) byKey.set(it.key, it);
      const rec = recent.map((k) => byKey.get(k)).filter(Boolean).slice(0, 6);
      const used = new Set(rec.map((r) => r.key));
      out.push(...rec.map((r) => ({ ...r, section: 'Recent' })));
      out.push(...chatItems.filter((r) => !used.has(r.key)).slice(0, 5));
      out.push(...noteItems.filter((r) => !used.has(r.key)).slice(0, 4));
      out.push(...fileItems.filter((r) => !used.has(r.key)).slice(0, 3));
      out.push(...actionItems.filter((r) => !r.onlyTyped && !used.has(r.key)));
    } else {
      const boost = new Map(recent.map((k, i) => [k, 6 - Math.min(i, 5)]));
      const scored = [];
      const add = (items, limit) => {
        let n = 0;
        for (const h of rank(s, items, (x) => ({ label: x.label, extra: x.extra }))) {
          if (n++ >= limit) break;
          scored.push({ ...h.item, idx: h.idx, score: h.score + (boost.get(h.item.key) || 0) });
        }
      };
      add(actionItems, 40); add(chatItems, 8); add(noteItems, 8); add(fileItems, 6);
      const seen = new Set(scored.map((r) => r.key));
      // content hits keep the main process's order, after the name matches
      for (const h of hits) if (!seen.has('n' + h.path)) scored.push({ key: 'h' + h.path, recentKey: 'n' + h.path, section: 'Inside notes', icon: 'search', label: h.name, hint: h.snippet, score: -1e6, run: () => cb.current.onOpenNote && cb.current.onOpenNote(h.path), runTab: () => (cb.current.onOpenNoteTab || cb.current.onOpenNote)(h.path) });
      for (const h of fhits) if (!seen.has('f' + h.path)) scored.push({ key: 'fh' + h.path, recentKey: 'f' + h.path, section: 'Inside files', icon: 'search', label: h.name, hint: h.snippet, score: -1e6 - 1, run: () => cb.current.onOpenFile && cb.current.onOpenFile(h.path) });
      // each section sorted by score; sections ordered by their best hit
      const by = new Map();
      for (const r of scored) { if (!by.has(r.section)) by.set(r.section, []); by.get(r.section).push(r); }
      const secs = [...by.entries()].map(([name, rs]) => { rs.sort((a, b) => b.score - a.score); return { name, rs, top: rs[0].score }; });
      secs.sort((a, b) => b.top - a.top);
      for (const sec of secs) out.push(...sec.rs);
    }
    // group by section (keeps first-seen order) and cap what is rendered
    const order = []; const groups = new Map();
    for (const r of out) { if (!groups.has(r.section)) { groups.set(r.section, []); order.push(r.section); } groups.get(r.section).push(r); }
    return order.flatMap((sec) => groups.get(sec)).slice(0, MAX_RESULTS);
  }, [q, actionItems, chatItems, noteItems, fileItems, hits, fhits, recent]);

  useEffect(() => { setIdx(0); }, [q]);
  useEffect(() => { if (idx >= results.length && results.length) setIdx(results.length - 1); }, [results.length, idx]);
  useEffect(() => { const el = list.current && list.current.querySelector('[data-i="' + idx + '"]'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }); }, [idx, results]);

  const go = useCallback((r, newTab) => {
    if (!r) return;
    saveRecent(r.recentKey || r.key);
    cb.current.onClose();
    setTimeout(() => { if (newTab && r.runTab) r.runTab(); else r.run(); }, 0);
  }, []);
  // the pointer only moves the selection when it really moved (not when the list scrolls under it after an arrow key)
  const hover = useCallback((i, e) => {
    const m = mouse.current;
    if (e.clientX === m.x && e.clientY === m.y) return;
    mouse.current = { x: e.clientX, y: e.clientY };
    setIdx((cur) => (cur === i ? cur : i));
  }, []);

  if (!open) return null;
  const onKey = (e) => {
    const n = results.length;
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => (n ? (i + 1) % n : 0)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => (n ? (i - 1 + n) % n : 0)); }
    else if (e.key === 'PageDown') { e.preventDefault(); setIdx((i) => Math.min(n - 1, i + 8)); }
    else if (e.key === 'PageUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 8)); }
    else if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); go(results[idx], e.metaKey || e.ctrlKey); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
  };
  let lastSec = '';
  return (
    <div className={embedded ? 'cmdk-embed' : 'cmdk-back'} onMouseDown={embedded ? undefined : onClose}>
      <div className="cmdk" role="dialog" aria-label="Command palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="cmdk-bar">
          <Icon name="search" size={16} />
          <input ref={input} className="cmdk-input" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="Search actions, chats, notes, files, settings…" spellCheck={false} aria-label="Search" />
          <kbd className="cmdk-esc">esc</kbd>
        </div>
        <div className="cmdk-list" ref={list} role="listbox">
          {results.length === 0 ? <div className="cmdk-empty">{q.trim() ? <>No matches for “{q}”</> : 'Nothing here yet'}</div> : results.map((r, i) => {
            const head = r.section !== lastSec ? <div key={'h-' + r.section} className="cmdk-head">{r.section}</div> : null;
            lastSec = r.section;
            return (
              <React.Fragment key={r.key}>
                {head}
                <Row r={r} i={i} on={i === idx} onHover={hover} onPick={go} />
              </React.Fragment>
            );
          })}
        </div>
        <div className="cmdk-foot"><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> open</span><span><kbd>⌘↵</kbd> new tab</span><span><kbd>esc</kbd> close</span></div>
      </div>
    </div>
  );
}
