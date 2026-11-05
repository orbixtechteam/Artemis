// electron-builder afterPack hook. With "identity": null the app is never signed, so it keeps the
// Electron binary's own ad-hoc signature (identifier "Electron", Info.plist not bound). macOS then
// cannot tie the running app to dev.orbixlabs.artemis and drops its notifications.
// Re-sign the whole bundle so every part takes its identifier from its own Info.plist. In the release
// workflow MAC_SIGN_IDENTITY names a self-signed certificate: its designated requirement stays the same
// across builds, so the Keychain ("Artemis Safe Storage") does not ask again after every update.
// Without it (local builds) the bundle is signed ad-hoc.
const { execFileSync, spawnSync } = require('child_process');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const identity = process.env.MAC_SIGN_IDENTITY || '-';
  const kc = process.env.MAC_SIGN_KEYCHAIN ? ['--keychain', process.env.MAC_SIGN_KEYCHAIN] : [];
  execFileSync('codesign', ['--force', '--deep', '--sign', identity, ...kc, app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
  // codesign -dv prints to stderr
  const info = spawnSync('codesign', ['-dv', app], { encoding: 'utf8' }).stderr;
  const id = (info.match(/^Identifier=(.*)$/m) || [])[1];
  if (id !== context.packager.appInfo.id) throw new Error(`after-pack: signed as "${id}", expected "${context.packager.appInfo.id}"`);
  console.log(`after-pack: signed ${app} as ${id} with ${identity === '-' ? 'an ad-hoc signature' : identity}`);
};
