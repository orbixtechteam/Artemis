// electron-builder afterPack hook. With "identity": null the app is never signed, so it keeps the
// Electron binary's own ad-hoc signature (identifier "Electron", Info.plist not bound). macOS then
// cannot tie the running app to dev.orbixlabs.artemis and drops its notifications.
// Re-sign the whole bundle ad-hoc so every part takes its identifier from its own Info.plist.
const { execFileSync, spawnSync } = require('child_process');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
  // codesign -dv prints to stderr
  const info = spawnSync('codesign', ['-dv', app], { encoding: 'utf8' }).stderr;
  const id = (info.match(/^Identifier=(.*)$/m) || [])[1];
  if (id !== context.packager.appInfo.id) throw new Error(`after-pack: signed as "${id}", expected "${context.packager.appInfo.id}"`);
  console.log(`after-pack: ad-hoc signed ${app} as ${id}`);
};
