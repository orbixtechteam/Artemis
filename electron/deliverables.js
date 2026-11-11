// Files the assistant hands to the user: the present_files tool, and cards made automatically for deliverable files
// written by write_file / write_spreadsheet. A card is { path (absolute), name, size, ext }; the chat renders it as a file card.
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_PER_CALL = 4;
// written files that become a card on their own; source code and config never do (the tool row already shows them)
const DELIVERABLE_EXT = new Set(['csv', 'tsv', 'xlsx', 'xls', 'ods', 'docx', 'doc', 'odt', 'pdf', 'pptx', 'ppt', 'key', 'md', 'txt', 'html', 'htm', 'svg',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'mp4', 'mov', 'webm', 'mp3', 'wav', 'm4a', 'zip', 'json', 'excalidraw', 'ics', 'vcf', 'epub']);

const extOf = (p) => path.extname(String(p || '')).slice(1).toLowerCase();
const isDeliverable = (p) => DELIVERABLE_EXT.has(extOf(p));

/** One file as a card, or throws with a message the model can act on. */
function cardFor(abs) {
  const st = fs.statSync(abs);
  if (!st.isFile()) throw new Error(`${abs} is not a file.`);
  return { path: abs, name: path.basename(abs), size: st.size, ext: extOf(abs) };
}

/**
 * Resolves the paths given to present_files. Relative paths: the project folder (ctx.root), then the Files library.
 * deps: { resolveSafe(root, p), isSensitive(real), library }
 */
function resolveForPresent(paths, ctx, { resolveSafe, isSensitive }) {
  const list = (Array.isArray(paths) ? paths : [paths]).map((p) => (p && typeof p === 'object' ? p.path : p)).filter(Boolean).map(String);
  if (!list.length) throw new Error('files must list at least one path.');
  if (list.length > MAX_PER_CALL) throw new Error(`At most ${MAX_PER_CALL} files per call: pick the main deliverables.`);
  const out = [];
  for (const p of list) {
    let abs = '';
    const home = p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p;
    if (path.isAbsolute(home)) abs = home;
    else {
      try { if (ctx.root) { const a = resolveSafe(ctx.root, home); if (fs.existsSync(a)) abs = a; } } catch {}
      if (!abs && ctx.library) { try { const a = ctx.library.abs(home); if (fs.existsSync(a)) abs = a; } catch {} }
    }
    if (!abs || !fs.existsSync(abs)) throw new Error(`File not found: ${p}. Create it first, then present it.`);
    const real = fs.realpathSync(abs);
    if (isSensitive(real)) throw new Error(`${p} is in a protected location and cannot be shared.`);
    out.push(cardFor(real));
  }
  return out;
}

/** A card for a file a write tool just made, when it is a deliverable kind (not source code). */
function autoCard(abs) {
  try { return isDeliverable(abs) ? cardFor(fs.realpathSync(abs)) : null; } catch { return null; }
}

const PROMPT = 'Files you made for the user: when the work produced a file they asked for (a spreadsheet, document, PDF, image, export, report), '
  + 'call present_files with it once it is final, so it appears as a file card they can open, download or drag out. Do not present source files you only edited. '
  + 'In your reply link files as [name](<path>) and show images inline as ![description](<path>); paths are relative to the project folder or absolute, and the angle brackets keep spaces safe. '
  + 'Do not paste a file\'s whole content into the reply when the card shows it. '
  + 'Formats Artemis opens as live, editable views: a document is a .md file (opens as a Doc; edit it with edit_file and the open doc updates; a .docx also opens as an editable Doc when the user needs Word), '
  + 'a table is .csv or .xlsx (opens as a Sheet), and a whiteboard, diagram or flowchart is an .excalidraw file: Excalidraw JSON '
  + '{"type":"excalidraw","version":2,"source":"artemis","elements":[...],"appState":{},"files":{}} where each element has id, type '
  + '(rectangle, ellipse, diamond, arrow, line, text), x, y, width, height, strokeColor, backgroundColor, fillStyle "solid", roughness 1, '
  + 'version 1, versionNonce, seed (any integers); text elements also need text, fontSize, fontFamily 5, textAlign, verticalAlign, '
  + 'and arrows need points [[0,0],[dx,dy]] plus startBinding / endBinding {elementId, focus 0, gap 4} when they connect shapes.';

module.exports = { resolveForPresent, autoCard, isDeliverable, cardFor, PROMPT, MAX_PER_CALL, DELIVERABLE_EXT };
