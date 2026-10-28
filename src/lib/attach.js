// Shared attachment helpers (main composer + quick chat).
export function readImage(file) {
  return new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = async () => {
      const att = { name: file.name || 'image.png', kind: 'image', size: file.size };
      // stored as a file in the media folder; the chat keeps only its link
      let url = '';
      try { url = window.api.mediaPut ? await window.api.mediaPut(fr.result) : ''; } catch {}
      resolve(url && url.startsWith('artemis-media://') ? { ...att, url } : { ...att, dataUrl: fr.result });
    };
    fr.readAsDataURL(file);
  });
}

/** Turns File objects (drop / paste / input) into attachments. Files with a disk path are parsed by the main process. */
export async function filesToAttachments(list) {
  const parsed = [];
  const paths = [];
  for (const f of list) {
    let p = '';
    try { p = window.api.pathForFile(f); } catch {}
    if (p) paths.push(p);
    else if (f.type && f.type.startsWith('image/')) parsed.push(await readImage(f));
    else if (f.size > 150 * 1024 * 1024) parsed.push({ name: f.name || 'file', kind: 'error', error: 'Too large to attach without a file path (150 MB limit). Drag it from Finder instead.' });
    else { // any other file without a disk path (pasted, dragged from an app): hand its bytes to the main process
      try { parsed.push(await window.api.parseBuffer(f.name || 'file', new Uint8Array(await f.arrayBuffer()))); }
      catch (e) { parsed.push({ name: f.name || 'file', kind: 'error', error: (e && e.message) || 'Could not read this file.' }); }
    }
  }
  if (paths.length) parsed.push(...(await window.api.parseFiles(paths)));
  return parsed;
}

const hasFiles = (e) => !!(e.dataTransfer && Array.prototype.includes.call(e.dataTransfer.types || [], 'Files'));
/** A file dropped anywhere in the window must never navigate the page to that file. Drops outside the message box go to the first composer that listens ("artemis:drop"). */
export function installDropGuard() {
  const over = (e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } };
  const drop = (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    window.dispatchEvent(new CustomEvent('artemis:drop', { detail: { files: [...e.dataTransfer.files], handled: false } }));
  };
  window.addEventListener('dragover', over);
  window.addEventListener('drop', drop);
  return () => { window.removeEventListener('dragover', over); window.removeEventListener('drop', drop); };
}
/** For a composer: receive files dropped outside it. */
export function onWindowDrop(handler) {
  const f = (e) => { const d = e.detail; if (!d || d.handled) return; d.handled = true; handler(d.files); };
  window.addEventListener('artemis:drop', f);
  return () => window.removeEventListener('artemis:drop', f);
}
