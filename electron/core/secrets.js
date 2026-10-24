// Reads secrets that the desktop app stored with Electron safeStorage, from plain Node (headless gateway, CLI).
// Order: environment variable, <data>/headless.json, then the safeStorage value itself:
//   "plain:<value>"  stored as is (no OS encryption available)
//   "v10..." on macOS  AES-128-CBC with a key from the "<App> Safe Storage" keychain item (macOS may ask once to allow it)
//   "v10..." on Linux  Chromium's fixed fallback key ("peanuts"); "v11" (libsecret) is not supported, use an env variable
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const APP_NAMES = ['Artemis', 'artemis', 'Zero', 'AI Desktop', 'Ares', 'Electron'];

function aesDecrypt(buf, password, iterations) {
  const key = crypto.pbkdf2Sync(password, 'saltysalt', iterations, 16, 'sha1');
  const d = crypto.createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20));
  return Buffer.concat([d.update(buf), d.final()]).toString('utf8');
}

function createSecretReader({ platform = process.platform, keychain = true, exec = execFileSync, log = () => {} } = {}) {
  let macPasswords = null; // [name, password] found in the keychain
  const macCandidates = () => {
    if (macPasswords) return macPasswords;
    macPasswords = [];
    if (!keychain || platform !== 'darwin') return macPasswords;
    for (const n of APP_NAMES) {
      try {
        const pw = String(exec('security', ['find-generic-password', '-w', '-s', `${n} Safe Storage`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20000 })).trim();
        if (pw) macPasswords.push([n, pw]);
      } catch {}
    }
    if (!macPasswords.length) log('warn', 'No "Artemis Safe Storage" keychain item was readable; set keys with environment variables instead');
    return macPasswords;
  };
  /** Decrypts one stored value (base64 of the safeStorage output, or "plain:..."). Returns '' when it cannot. */
  function decrypt(stored) {
    if (!stored || typeof stored !== 'string') return '';
    if (stored.startsWith('plain:')) return stored.slice(6);
    let buf;
    try { buf = Buffer.from(stored, 'base64'); } catch { return ''; }
    const tag = buf.subarray(0, 3).toString('latin1');
    const body = buf.subarray(3);
    if (tag === 'v10' && platform === 'darwin') {
      for (const [, pw] of macCandidates()) { try { return aesDecrypt(body, pw, 1003); } catch {} }
      return '';
    }
    if (tag === 'v10' && platform === 'linux') { try { return aesDecrypt(body, 'peanuts', 1); } catch { return ''; } }
    return '';
  }
  return { decrypt };
}

module.exports = { createSecretReader, aesDecrypt };
