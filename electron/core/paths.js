// Where Artemis keeps its data when there is no Electron to ask (headless gateway, CLI).
// Mirrors main.js: the first existing of the old folder names wins (AI Desktop, Zero, Artemis), like app.setPath('userData').
const fs = require('fs');
const os = require('os');
const path = require('path');

function appDataDir(platform = process.platform, env = process.env, home = os.homedir()) {
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support');
  if (platform === 'win32') return env.APPDATA || path.join(home, 'AppData', 'Roaming');
  return env.XDG_CONFIG_HOME || path.join(home, '.config');
}

function defaultDataDir({ platform = process.platform, env = process.env, home = os.homedir(), exists = fs.existsSync } = {}) {
  if (env.ARTEMIS_HOME) return path.resolve(env.ARTEMIS_HOME);
  const base = appDataDir(platform, env, home);
  for (const name of ['AI Desktop', 'Zero', 'Artemis']) { const d = path.join(base, name); if (exists(d)) return d; }
  return path.join(base, 'Artemis');
}

module.exports = { defaultDataDir, appDataDir };
