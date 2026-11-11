// What a file is, for cards and viewers: an icon, a tint and a short "Table · CSV" style label.

const TYPES = [
  { exts: ['csv', 'tsv', 'tab'], kind: 'table', label: 'Table', icon: 'sheet', tint: 'green' },
  { exts: ['xlsx', 'xlsm', 'xls', 'xlsb', 'ods', 'numbers'], kind: 'sheet', label: 'Spreadsheet', icon: 'sheet', tint: 'green' },
  { exts: ['docx', 'doc', 'odt', 'rtf', 'pages'], kind: 'doc', label: 'Document', icon: 'doc', tint: 'blue' },
  { exts: ['md', 'markdown', 'txt'], kind: 'doc', label: 'Document', icon: 'doc', tint: 'blue' },
  { exts: ['pdf'], kind: 'pdf', label: 'PDF', icon: 'pdf', tint: 'red' },
  { exts: ['pptx', 'ppt', 'odp', 'key'], kind: 'slides', label: 'Presentation', icon: 'artifact', tint: 'amber' },
  { exts: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'heic'], kind: 'image', label: 'Image', icon: 'image', tint: 'neutral' },
  { exts: ['mp4', 'mov', 'webm', 'm4v'], kind: 'video', label: 'Video', icon: 'video', tint: 'neutral' },
  { exts: ['mp3', 'wav', 'm4a', 'ogg', 'flac'], kind: 'audio', label: 'Audio', icon: 'file', tint: 'neutral' },
  { exts: ['html', 'htm'], kind: 'html', label: 'Web page', icon: 'code', tint: 'violet' },
  { exts: ['excalidraw'], kind: 'board', label: 'Whiteboard', icon: 'artifact', tint: 'violet' },
  { exts: ['zip', 'tar', 'gz', 'tgz', '7z', 'rar'], kind: 'archive', label: 'Archive', icon: 'file', tint: 'neutral' },
  { exts: ['json', 'yaml', 'yml', 'xml', 'toml'], kind: 'data', label: 'Data', icon: 'code', tint: 'neutral' }
];
const BY_EXT = new Map(TYPES.flatMap((t) => t.exts.map((e) => [e, t])));
const CODE = { kind: 'code', label: 'Code', icon: 'code', tint: 'neutral' };
const OTHER = { kind: 'file', label: 'File', icon: 'file', tint: 'neutral' };

export const extOf = (name) => { const m = /\.([A-Za-z0-9]+)$/.exec(String(name || '')); return m ? m[1].toLowerCase() : ''; };
export const baseOf = (name) => String(name || '').replace(/\.[A-Za-z0-9]+$/, '');
const CODE_EXT = new Set(['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'cs', 'php', 'sh', 'sql', 'css', 'scss', 'vue', 'svelte']);

/** { kind, label, icon, tint } for a file name. */
export function fileType(name) {
  const e = extOf(name);
  return BY_EXT.get(e) || (CODE_EXT.has(e) ? CODE : OTHER);
}

/** "Table · CSV", "Document · DOCX", "PDF" */
export function typeLabel(name) {
  const t = fileType(name); const e = extOf(name).toUpperCase();
  return t.label === e || !e ? t.label : `${t.label} · ${e}`;
}

export function fmtSize(n) {
  if (!(n >= 0)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
