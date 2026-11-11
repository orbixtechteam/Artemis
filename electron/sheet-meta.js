// Look and layout of a spreadsheet that the file itself cannot hold (CSV has no styles; the bundled SheetJS build does not
// write them): cell formats, column widths, row heights, frozen header, zoom. One JSON per file in <userData>/sheet-meta,
// named by a hash of the file's path, so the user's folders get no extra files.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_BYTES = 8 * 1024 * 1024;

function createSheetMeta({ dir }) {
  const fileFor = (abs) => path.join(dir, crypto.createHash('sha1').update(path.resolve(String(abs))).digest('hex') + '.json');
  function load(abs) {
    try { const j = JSON.parse(fs.readFileSync(fileFor(abs), 'utf8')); return j && typeof j === 'object' ? j : {}; } catch { return {}; }
  }
  function save(abs, meta) {
    const text = JSON.stringify({ ...(meta || {}), path: path.resolve(String(abs)), savedAt: Date.now() });
    if (text.length > MAX_BYTES) throw new Error('The formatting of this sheet is too large to save.');
    fs.mkdirSync(dir, { recursive: true });
    const f = fileFor(abs), tmp = f + '.tmp-' + process.pid;
    fs.writeFileSync(tmp, text); fs.renameSync(tmp, f);
    return true;
  }
  /** Keeps the formatting when a sheet is saved under a new name (Save as). */
  function copy(from, to) { const m = load(from); if (Object.keys(m).length) save(to, m); }
  return { load, save, copy, fileFor };
}

module.exports = { createSheetMeta };
