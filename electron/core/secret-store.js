// Secrets of a server (provider keys, bot tokens, connector secrets) where the OS encryption the desktop uses (macOS
// keychain) is not there: AES-256-GCM in <data>/secrets.enc.json. The key comes from ARTEMIS_MASTER_KEY (recommended:
// keep it out of the data folder, e.g. a Docker secret, so a copy of the data or a backup alone does not reveal the keys),
// otherwise from <data>/master.key (made once, readable by this user only).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function loadKey({ dataDir, env = process.env }) {
  if (env.ARTEMIS_MASTER_KEY) return { key: crypto.createHash('sha256').update(String(env.ARTEMIS_MASTER_KEY)).digest(), source: 'env' };
  const f = path.join(dataDir, 'master.key');
  try { const b = Buffer.from(fs.readFileSync(f, 'utf8').trim(), 'base64'); if (b.length === 32) return { key: b, source: 'file' }; } catch {}
  const k = crypto.randomBytes(32);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(f, k.toString('base64') + '\n', { mode: 0o600 });
  return { key: k, source: 'file' };
}

function createSecretStore({ dataDir, env = process.env, log = () => {} }) {
  const file = path.join(dataDir, 'secrets.enc.json');
  let keyInfo = null;
  const key = () => (keyInfo || (keyInfo = loadKey({ dataDir, env }))).key;
  const read = () => { try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); return d && typeof d.items === 'object' ? d : { v: 1, items: {} }; } catch { return { v: 1, items: {} }; } };
  const write = (d) => { const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(d, null, 2), { mode: 0o600 }); fs.renameSync(tmp, file); try { fs.chmodSync(file, 0o600); } catch {} };
  const enc = (plain) => {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
    const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
    return [iv, c.getAuthTag(), ct].map((b) => b.toString('base64')).join('.');
  };
  const dec = (s) => {
    const [iv, tag, ct] = String(s).split('.').map((x) => Buffer.from(x, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', key(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
  };
  const validName = (n) => /^[\w:.@-]{1,200}$/.test(String(n));

  function get(name) {
    const v = read().items[name];
    if (!v) return '';
    try { return dec(v); } catch { log('warn', `secret "${name}" could not be decrypted (wrong ARTEMIS_MASTER_KEY?)`); return ''; }
  }
  function set(name, value) {
    if (!validName(name)) throw new Error('Bad secret name');
    const d = read();
    if (value == null || value === '') delete d.items[name]; else d.items[name] = enc(value);
    write(d);
  }
  function setMany(obj) {
    const d = read();
    for (const [n, v] of Object.entries(obj || {})) {
      if (!validName(n)) continue;
      if (v == null || v === '') delete d.items[n]; else d.items[n] = enc(v);
    }
    write(d);
  }
  const names = () => Object.keys(read().items).sort();
  return { get, set, setMany, names, keySource: () => { key(); return keyInfo.source; } };
}

module.exports = { createSecretStore };
