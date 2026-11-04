// Maps file names to the preview that suits them and to highlight.js languages.
const LANG = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', tsx: 'typescript',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', swift: 'swift', c: 'c', h: 'c',
  cpp: 'cpp', hpp: 'cpp', cc: 'cpp', cs: 'csharp', php: 'php', sh: 'bash', zsh: 'bash', bash: 'bash',
  yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', conf: 'ini', cfg: 'ini', env: 'bash', json: 'json', jsonl: 'json',
  xml: 'xml', html: 'xml', htm: 'xml', vue: 'xml', svelte: 'xml', svg: 'xml', css: 'css', scss: 'scss', sql: 'sql',
  md: 'markdown', markdown: 'markdown', diff: 'diff', patch: 'diff', tex: 'latex', r: 'r', lua: 'lua', pl: 'perl',
  txt: 'plaintext', log: 'plaintext', gitignore: 'plaintext'
};

export const extOf = (name) => {
  const base = String(name || '').split('/').pop();
  const i = base.lastIndexOf('.');
  return i < 0 ? (base.startsWith('.') ? base.slice(1).toLowerCase() : '') : base.slice(i + 1).toLowerCase();
};

export const languageOf = (name) => {
  const base = String(name || '').split('/').pop().toLowerCase();
  if (base === 'dockerfile') return 'dockerfile';
  if (base === 'makefile') return 'makefile';
  return LANG[extOf(name)] || '';
};

/** Which viewer a previewed file gets. */
export function viewKind(a) {
  if (a.kind === 'error') return 'error';
  if (a.kind === 'image') return 'image';
  if (a.kind === 'sheet') return 'sheet';
  const ext = extOf(a.name);
  if (ext === 'csv' || ext === 'tsv' || ext === 'tab') return 'table';
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (ext === 'html' || ext === 'htm') return 'html';
  if (ext === 'svg') return 'svg';
  if (a.kind === 'binary' || a.kind === 'archive' || a.kind === 'pdf' || a.kind === 'docx' || a.kind === 'pptx') return 'text';
  return 'code';
}
