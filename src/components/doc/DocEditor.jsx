import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { Placeholder } from '@tiptap/extension-placeholder';
import { Image } from '@tiptap/extension-image';
import { Markdown } from 'tiptap-markdown';
import { Icon } from '../Icons.jsx';
import Menu from '../ui/Menu.jsx';
import { useFileWatch } from '../../lib/use-file-watch.js';
import { headingsOf, imageSrc } from '../../lib/doc-outline.mjs';

const api = window.api;
const SAVE_MS = 800;

/** Images keep the path the author wrote in the Markdown; on screen a local path goes through artemis-file. */
const DocImage = Image.extend({
  addOptions() { return { ...this.parent?.(), docPath: '' }; },
  renderHTML({ HTMLAttributes }) { return ['img', { ...HTMLAttributes, src: imageSrc(HTMLAttributes.src, this.options.docPath), 'data-src': HTMLAttributes.src }]; }
});

/**
 * A Markdown or Word (.docx) file as an Artemis Doc (Claude Docs style): serif title, readable column, a floating toolbar, an outline,
 * Editing / Viewing, autosave. The file stays plain Markdown, so the assistant and every other tool can read and edit it;
 * when they change it on disk the open document reloads.
 */
export default function DocEditor({ path, name }) {
  const isDocx = /\.docx$/i.test(path || name || ''); // Word files: opened as HTML (mammoth), saved as .docx (electron/docx-write.js)
  const [state, setState] = useState({ loading: true });
  const [mode, setMode] = useState('edit');
  const [outline, setOutline] = useState(false);
  const [status, setStatus] = useState(null);
  const [menu, setMenu] = useState(null);
  const [, setTick] = useState(0); // re-render the toolbar when the selection changes
  const dirty = useRef(false), timer = useRef(0), lastText = useRef(''), loading = useRef(true), hooks = useRef({});

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4] }, link: { openOnClick: false, autolink: true } }), // StarterKit 3 includes Link
      Table.configure({ resizable: true }), TableRow, TableHeader, TableCell,
      TaskList, TaskItem.configure({ nested: true }),
      DocImage.configure({ inline: false, docPath: path }),
      Placeholder.configure({ placeholder: ({ node }) => (node.type.name === 'heading' && node.attrs.level === 1 ? 'Title' : 'Start writing…') }),
      ...(isDocx ? [] : [Markdown.configure({ html: false, tightLists: true, linkify: true, breaks: false, transformPastedText: true, transformCopiedText: false })])
    ],
    content: '',
    editorProps: { attributes: { class: 'docpage doc-editable', spellcheck: 'true' } },
    immediatelyRender: true, shouldRerenderOnTransaction: false,
    onUpdate: ({ editor: ed }) => { if (!loading.current) hooks.current.schedule(ed); },
    onSelectionUpdate: () => setTick((t) => t + 1),
    onTransaction: () => setTick((t) => t + 1)
  }, [path]);

  // one file format behind the same editor: Markdown text, or a Word file read as HTML and written from the document tree
  const readFile = async () => {
    if (!isDocx) { const r = await api.readTextFile(path); return r && r.ok ? { ok: true, content: r.text } : r; }
    const r = await api.docxHtml(path); return r && r.ok ? { ok: true, content: r.html } : r;
  };
  const snapshot = (ed) => (isDocx ? JSON.stringify(ed.getJSON()) : ed.storage.markdown.getMarkdown());
  const writeFile = (ed, snap) => (isDocx ? api.writeDocx(path, ed.getJSON()) : api.writeTextFile(path, snap.endsWith('\n') ? snap : snap + '\n'));
  const markSaved = useFileWatch(path, ({ gone }) => { // the assistant rewrote the file: show it (unsaved edits here win)
    if (gone || dirty.current || !editor) return;
    readFile().then((r) => { if (!r || !r.ok) return; editor.commands.setContent(r.content, { emitUpdate: false }); const snap = snapshot(editor); if (snap !== lastText.current) { lastText.current = snap; setStatus({ text: 'Updated' }); } });
  });
  const save = async (ed) => {
    if (!ed) return;
    const snap = snapshot(ed);
    if (snap === lastText.current) { dirty.current = false; return; }
    setStatus({ text: 'Saving…' }); markSaved();
    const r = await writeFile(ed, snap);
    if (r && r.ok) { lastText.current = snap; dirty.current = false; setStatus({ text: 'Saved' }); } else setStatus({ text: (r && r.error) || 'Could not save', kind: 'error' });
  };
  const schedule = (ed) => { dirty.current = true; setStatus({ text: 'Unsaved' }); clearTimeout(timer.current); timer.current = setTimeout(() => save(ed), SAVE_MS); };
  hooks.current = { schedule, save };
  useEffect(() => () => { clearTimeout(timer.current); if (dirty.current && editor) hooks.current.save(editor); }, [editor]);

  useEffect(() => {
    if (!editor) return;
    let off = false;
    setState({ loading: true }); loading.current = true;
    readFile().then((r) => {
      if (off) return;
      if (!r || !r.ok) { setState({ error: (r && r.error) || 'Could not open this document.' }); return; }
      const title = String(name || 'Untitled').replace(/\.(md|markdown|txt|docx)$/i, '');
      editor.commands.setContent(r.content || (isDocx ? `<h1>${title.replace(/[<&]/g, '')}</h1><p></p>` : `# ${title}\n\n`), { emitUpdate: false });
      lastText.current = r.content ? snapshot(editor) : '';
      loading.current = false; setState({ ok: true });
    });
    return () => { off = true; };
  }, [editor, path]);
  useEffect(() => { if (editor) editor.setEditable(mode === 'edit'); }, [editor, mode]);

  const heads = useMemo(() => (editor && outline ? headingsOf(editor.getJSON()) : []), [editor, outline, status]);
  if (state.error) return <div className="pdfv-msg">{state.error}</div>;
  if (!editor) return null;

  const run = (fn) => () => { fn(editor.chain().focus()).run(); };
  const is = (n, a) => editor.isActive(n, a);
  const styleLabel = is('heading', { level: 1 }) ? 'Title' : is('heading', { level: 2 }) ? 'Heading' : is('heading', { level: 3 }) ? 'Subheading' : 'Body';
  const open = (kind) => (e) => setMenu({ kind, rect: e.currentTarget.getBoundingClientRect() });
  const styleItems = [
    { label: 'Title', checked: styleLabel === 'Title', style: { fontFamily: 'var(--font-serif)', fontSize: 20 }, onClick: run((c) => c.setHeading({ level: 1 })) },
    { label: 'Heading', checked: styleLabel === 'Heading', style: { fontFamily: 'var(--font-serif)', fontSize: 17 }, onClick: run((c) => c.setHeading({ level: 2 })) },
    { label: 'Subheading', checked: styleLabel === 'Subheading', style: { fontFamily: 'var(--font-serif)', fontSize: 15 }, onClick: run((c) => c.setHeading({ level: 3 })) },
    { label: 'Body', checked: styleLabel === 'Body', onClick: run((c) => c.setParagraph()) },
    { sep: true },
    { label: 'Bold', hint: '⌘B', checked: is('bold'), onClick: run((c) => c.toggleBold()) },
    { label: 'Italic', hint: '⌘I', checked: is('italic'), onClick: run((c) => c.toggleItalic()) },
    { label: 'Underline', hint: '⌘U', checked: is('underline'), onClick: run((c) => c.toggleUnderline()) },
    { label: 'Strikethrough', hint: '⌘⇧X', checked: is('strike'), onClick: run((c) => c.toggleStrike()) },
    { label: 'Code', hint: '⌘E', checked: is('code'), onClick: run((c) => c.toggleCode()) }
  ];
  const moreItems = [
    { label: 'Bulleted list', checked: is('bulletList'), onClick: run((c) => c.toggleBulletList()) },
    { label: 'Numbered list', checked: is('orderedList'), onClick: run((c) => c.toggleOrderedList()) },
    { label: 'Quote', checked: is('blockquote'), onClick: run((c) => c.toggleBlockquote()) },
    { label: 'Code block', checked: is('codeBlock'), onClick: run((c) => c.toggleCodeBlock()) },
    { label: 'Divider', onClick: run((c) => c.setHorizontalRule()) },
    { sep: true },
    ...(is('table') ? [
      { label: 'Table', items: [
        { label: 'Row above', onClick: run((c) => c.addRowBefore()) }, { label: 'Row below', onClick: run((c) => c.addRowAfter()) },
        { label: 'Column left', onClick: run((c) => c.addColumnBefore()) }, { label: 'Column right', onClick: run((c) => c.addColumnAfter()) },
        { sep: true }, { label: 'Delete row', danger: true, onClick: run((c) => c.deleteRow()) }, { label: 'Delete column', danger: true, onClick: run((c) => c.deleteColumn()) },
        { label: 'Delete table', danger: true, onClick: run((c) => c.deleteTable()) }
      ] }, { sep: true }] : []),
    { label: 'Undo', hint: '⌘Z', disabled: !editor.can().undo(), onClick: run((c) => c.undo()) },
    { label: 'Redo', hint: '⌘⇧Z', disabled: !editor.can().redo(), onClick: run((c) => c.redo()) }
  ];
  const insertImage = async () => {
    const picked = await api.pickFiles();
    const img = (picked || []).find((x) => x && x.kind === 'image' && x.path);
    if (img) editor.chain().focus().setImage({ src: img.path, alt: img.name }).run();
  };
  const ask = () => {
    const { from, to } = editor.state.selection;
    const text = from === to ? editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n').slice(0, 4000) : editor.state.doc.textBetween(from, to, '\n');
    const whole = from === to;
    const short = whole ? (name || 'Document') : `“${text.replace(/\s+/g, ' ').trim().slice(0, 40)}${text.length > 40 ? '…' : ''}”`;
    window.dispatchEvent(new CustomEvent('artemis:ask-selection', { detail: { attachment: {
      kind: 'selection', icon: 'doc', name: short, title: whole ? `The document ${name || ''}` : `A passage of ${name || 'the document'}`,
      text: `${whole ? 'The document' : 'A passage selected in'} ${path || name}:\n${text}`, source: path || ''
    } } }));
  };
  const jumpTo = (pos) => { try { const dom = editor.view.nodeDOM(pos); if (dom && dom.scrollIntoView) dom.scrollIntoView({ block: 'start', behavior: 'smooth' }); editor.chain().focus().setTextSelection(pos + 1).run(); } catch {} };

  return (
    <div className="doc">
      <div className="doc-top">
        <button type="button" className={`doc-outline-btn${outline ? ' on' : ''}`} onClick={() => setOutline(!outline)} title="Outline" aria-label="Outline"><Icon name="list" size={17} /></button>
        <span className="doc-grow" />
        {status && <span className={`doc-status ${status.kind || ''}`} role="status">{status.text}</span>}
        <button type="button" className="doc-mode" onClick={open('mode')}><Icon name={mode === 'edit' ? 'edit' : 'eye'} size={14} /> {mode === 'edit' ? 'Editing' : 'Viewing'} <Icon name="chevronDown" size={12} /></button>
      </div>
      {outline && (
        <nav className="doc-outline" aria-label="Outline">
          {heads.length ? heads.map((h) => <button key={h.pos} type="button" className={`doc-outline-item l${h.level}`} onClick={() => jumpTo(h.pos)}>{h.text || 'Untitled'}</button>)
            : <div className="doc-outline-empty">Headings appear here.</div>}
        </nav>
      )}
      <div className="doc-scroll">
        {state.loading ? <div className="pdfv-msg">Opening…</div> : <EditorContent editor={editor} />}
      </div>
      {mode === 'edit' && (
        <div className="fbar doc-bar" role="toolbar" aria-label="Format text" onMouseDown={(e) => e.preventDefault()}>
          <button type="button" className="fbar-btn" title="Text style" onClick={open('style')}><span className="doc-tt">T<small>T</small></span></button>
          <span className="fbar-sep" />
          <button type="button" className={`fbar-btn fbar-b${is('bold') ? ' on' : ''}`} title="Bold (⌘B)" onClick={run((c) => c.toggleBold())}>B</button>
          <button type="button" className={`fbar-btn fbar-i${is('italic') ? ' on' : ''}`} title="Italic (⌘I)" onClick={run((c) => c.toggleItalic())}>I</button>
          <button type="button" className={`fbar-btn fbar-u${is('underline') ? ' on' : ''}`} title="Underline (⌘U)" onClick={run((c) => c.toggleUnderline())}>U</button>
          <span className="fbar-sep" />
          <button type="button" className="fbar-btn" title="Insert table" onClick={run((c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }))}><Icon name="sheet" size={17} /></button>
          <button type="button" className="fbar-btn" title="Insert image" onClick={insertImage}><Icon name="image" size={17} /></button>
          <button type="button" className={`fbar-btn${is('taskList') ? ' on' : ''}`} title="Checklist" onClick={run((c) => c.toggleTaskList())}><Icon name="check" size={17} /></button>
          <button type="button" className={`fbar-btn${is('bulletList') ? ' on' : ''}`} title="Bulleted list" onClick={run((c) => c.toggleBulletList())}><Icon name="list" size={17} /></button>
          <button type="button" className="fbar-btn" title="More" onClick={open('more')}><Icon name="dots" size={18} /></button>
          <button type="button" className="fbar-ask" onClick={ask} title="Ask Artemis about the selection">Ask Artemis</button>
        </div>
      )}
      {menu && <Menu anchor={menu.rect} placement={menu.kind === 'mode' ? 'below' : 'above'} align={menu.kind === 'mode' ? 'end' : 'start'} width={menu.kind === 'mode' ? 170 : 240} onClose={() => setMenu(null)}
        items={menu.kind === 'mode' ? [{ label: 'Editing', icon: 'edit', checked: mode === 'edit', onClick: () => setMode('edit') }, { label: 'Viewing', icon: 'eye', checked: mode === 'view', onClick: () => setMode('view') }]
          : menu.kind === 'style' ? styleItems : moreItems} />}
    </div>
  );
}
