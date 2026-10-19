// Text for the clipboard: a copied answer should be paste-ready, so the ``` lines of fenced code blocks are dropped (the code stays).

/** Markdown -> the same text without the opening / closing fence lines of code blocks. */
export function stripFences(md) {
  return String(md || '').replace(/^[ \t]*(`{3,}|~{3,})[^\n`]*\n([\s\S]*?)\n?[ \t]*\1[ \t]*$/gm, (_m, _f, code) => code);
}

/** The text of one code block: if the model wrapped the code in a fence of its own (``` inside the block), take that fence off too. */
export function codeOnly(text) {
  const t = String(text || '').replace(/\s+$/, '');
  const m = t.match(/^[ \t]*(`{3,}|~{3,})[^\n`]*\n([\s\S]*?)\n?[ \t]*\1$/);
  return m ? m[2] : text;
}
