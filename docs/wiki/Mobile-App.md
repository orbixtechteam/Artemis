# Phone and web app

The Artemis app for iPhone, Android and the browser. It connects to an Artemis server (see [Home Server](Home-Server.md)) and does what the desktop app does: the answers run on the server, so they keep going when the phone locks or the app closes, and the app picks a running answer up again when it opens.

## What it has

- **Home**: everything the desktop sidebar has, as a page: Search, Agents, Scheduled, Artifacts, Connectors; Workspace (Projects, Notes, Files, Skills, Automations, Memory); Pinned (every project with its latest chats, then pinned chats) and the other chats by day. The app opens on a new chat; Back goes to Home.
- **Chat**: streaming answers with Markdown, tables and code; tool cards; approvals; folded thinking ("Thought for 3 s", tap to read); copy, read aloud, edit a message, regenerate; incognito chats; dictation with the microphone.
- **The + menu** (as on the desktop): add files (PDF, Word, Excel, CSV, text, code) and photos, compact the chat, Tools, Helper agents, Ask before acting, Brain (or the council), Thinking level, Project (and **New project**).
- **Attachments**: tap one in the message box to preview it before sending, × to remove it. In a sent message a file is a small card; tap it to open it.
- **Viewers like the desktop's**: spreadsheets and CSV as the sheet editor (column letters, row numbers, the first row frozen, sheet tabs), Word and Markdown as a document page, PDF, pictures, code; artifacts (web pages, SVG, documents, spreadsheets, code).
- **Chats**: long press for rename, pin, move to a project, delete. Hold a chat and drag it onto a project on Home to put it there, or anywhere else to take it out of its project.
- **Projects**: long press for open, new chat in it, edit name and instructions, pin, hide from Home, delete. A project page shows its instructions, its files (add, open, remove) and its chats.
- **Everything else**: Memory, Agents and teams, Scheduled tasks (with their editor), Notes (read and edit), Files, Skills, Automations, Usage, Connectors (switch on or off, keys, sign in), Settings (model, profile, paired devices, appearance).
- **Look**: the desktop's palettes (Artemis, Midnight, Graphite, Forest, Ember, Classic), Automatic / Light / Dark and the accent. While the desktop app is linked, the phone follows its choice.

## Run it while developing

```bash
cd mobile
npm install
npx expo start -c            # scan the QR code with Expo Go (same Wi-Fi), or press i / a / w
```

The mobile app uses npm and its own `node_modules`, separate from the desktop app's pnpm.

## Install it on your iPhone

### Free, with Xcode and your Apple ID

1. Install Xcode from the App Store and open it once. Then `xcode-select --install` and `brew install cocoapods`.
2. Xcode → Settings → Accounts → add your Apple ID.
3. Connect the iPhone with a cable and trust the computer.
4. Build:
   ```bash
   cd mobile
   npx expo prebuild -p ios --clean
   open ios/Artemis.xcworkspace
   ```
5. In Xcode: the Artemis target → Signing & Capabilities → Team: your name (Personal Team). If the bundle identifier is taken, make it unique (for example `dev.yourname.artemis`). Product → Scheme → Edit Scheme → Run → Build Configuration: **Release**. Pick your iPhone and press Run.
6. On the iPhone: Settings → Privacy & Security → **Developer Mode** on; Settings → General → VPN & Device Management → your Apple ID → **Trust**.

With a free Apple ID the app works for 7 days; connect the phone and press Run again to renew it. SideStore or AltStore can renew it over Wi-Fi.

### With an Apple Developer account (TestFlight or the App Store)

```bash
npm install -g eas-cli
cd mobile
eas login
eas build -p ios --profile production
eas submit -p ios
```

Then install it from TestFlight. `eas build -p ios --profile preview` makes an ad-hoc build for registered devices. Android: `eas build -p android --profile preview` gives an APK.

### As a web app, nothing to install

Open the server's https address in Safari (the server serves the web app when it runs with `--web`), then Share → **Add to Home Screen**.

## Notifications

Push notifications are free and need no Apple Developer account: your server sends them through [ntfy](https://ntfy.sh), an open-source push service, and the free ntfy app shows them (iPhone and Android). A tap opens the chat in the Artemis app.

1. In the Artemis app: **Settings → Notifications → Push notifications** on. A private topic is made for you.
2. **Get the ntfy app**, then **Subscribe in ntfy** (the topic is also copied: in ntfy tap **+** and paste it if the app does not open by itself).
3. **Send a test**.

You get one when a scheduled task finishes, when an answer you asked for on the phone is ready while the app is closed, and when a task from the phone waits for your OK. Each can be switched off, and **Show the text** off sends only the title. The same settings are on the desktop in **Settings → Notifications → On your phone**. You can use your own ntfy server instead of ntfy.sh (on iPhone it needs `upstream-base-url: https://ntfy.sh` for instant delivery). Anyone who knows the topic can read the notifications: keep it private, or make a new one.

## Connect

Open the app, enter the server's address and a pairing code (from `artemis pair`, the desktop app's Settings → Server & devices → New code, or another paired phone), or scan the QR code. Use the server's https address (your tunnel or reverse proxy) so the app works away from home; `http://192.168…` works only on the home Wi-Fi.

## Web app

```bash
cd mobile && npm run export:web        # -> mobile/dist-web
node bin/artemis.js gateway --web mobile/dist-web --public-host artemis.example.com
```

The server then serves the web app at its own address. To host the web app somewhere else, allow that address on the server: `--allow-origin https://app.example.com`.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| Old screens after an update | Restart Expo with `npx expo start -c` (clears the cache). |
| `Not found` on something new | The server runs older code: restart it. |
| A file does not open from a chat | Files sent before this version were not kept on the server; Artemis shows the text it read from them instead. |
| Sign-in to a connector fails | Open the server through its https address, or sign the connector in on the desktop (it goes to the server on its own). |

## See also

- [Home Server](Home-Server.md)
- [Chat and Projects](Chat-and-Projects.md)
