# Updates

Artemis can keep itself up to date from this project's GitHub Releases. It works like the update of other desktop apps: it looks in the background, downloads the new version, and installs it when you quit (or when you press **Restart and update**).

Settings → General → **Updates** shows the version you have, the state, and three switches:

| Setting | Default | What it does |
|---|---|---|
| Check for updates automatically | On | Asks GitHub for the latest release shortly after start and every 6 hours. Off: Artemis makes no update request at all; **Check now** still works. |
| Download updates automatically | On | Downloads the new version as soon as it is found. It is checked against its SHA-256 checksum and thrown away if it does not match. |
| Install when I quit Artemis | On | A downloaded update replaces the app when you quit it. **Restart and update** installs it at once and opens the new version. |

## How the install works

Artemis is not signed, so the usual macOS updater cannot be used. Instead a small script runs after Artemis has quit: it opens the downloaded `.dmg`, copies the new app next to the old one, swaps them, and opens the new version when you asked to restart. If any step fails, the old app stays. Your chats, notes and settings live outside the app and are not touched. The script's log is `install.log` in the updates folder inside the Artemis data folder.

- Artemis must be in a folder it can write to (for example Applications). If it is not, the Updates group says so and you can use **Release notes** to download the build yourself.
- A tray menu entry **Restart to update** appears when an update is ready.
- Automatic installing is for macOS. On other systems Artemis only tells you a new version exists and opens the release page.
- A development run (`pnpm dev`) only checks; it never installs.

## For maintainers: publishing a release

Change `version` in `package.json` (for example to `1.4.0`) and push to `main`. The `release` workflow does the rest: it skips when that release already exists, otherwise runs the tests, builds the macOS app, creates the tag (the same number) and the GitHub Release, and attaches the `.dmg`. Artemis only offers releases that are not drafts or pre-releases and whose number is higher than the installed one.

See also: [Troubleshooting](Troubleshooting.md), [Security and App Lock](Security-and-App-Lock.md).
