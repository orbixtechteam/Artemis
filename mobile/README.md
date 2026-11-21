# Artemis app (iPhone, Android, web)

One Expo (React Native) app for the phone and the browser. It connects to an Artemis server (`artemis gateway`: a
home server, a VPS or a Mac), pairs with a one-time code, and then does what the desktop app does with the server's
chats, projects (and their files), memory, agents, scheduled tasks, notes, files, artifacts, connectors, skills and
models. Runs happen on the server, so they keep going when the app is closed; the app picks a running answer up
again when it comes back. User guide: [docs/wiki/Mobile-App.md](../docs/wiki/Mobile-App.md).

## Run it

```bash
cd mobile
npm install                  # its own node_modules (npm), separate from the desktop app's pnpm
npx expo start -c            # Expo Go: scan the QR code; or press i (iOS simulator), a (Android), w (web)
npm test                     # tests of the pure helpers (scripts/test-lib.mjs)
```

## Layout

```
app/                 screens (Expo Router): index (opens a new chat), chat/[id], connect, settings, projects,
                     project, artifacts, artifact, notes, note, files, file, connectors, agents, scheduled, ...
src/lib/             core.js (events, SSE parsing), api.js (server, pairing, requests), session.js (server and look:
                     the desktop's palettes), render.js (pages for the viewers: sheet grid, documents, code)
src/components/      Home (the desktop sidebar as a page, drag and drop), Message, ChatOptions (the + menu),
                     ChatActions, ProjectActions, Preview (viewers), Markdown, Mic, Form, ui
```

## Web app

```bash
npm run export:web                   # -> mobile/dist-web
node ../bin/artemis.js gateway --web mobile/dist-web --public-host artemis.example.com
```

The server then serves the web app at its own address (same origin: no CORS setup). To host it elsewhere, allow that
origin on the server: `--allow-origin https://app.example.com`.

## Builds

- **Free, on your own iPhone**: `npx expo prebuild -p ios --clean`, open `ios/Artemis.xcworkspace`, sign with your
  Apple ID (Personal Team), Release configuration, Run. Works for 7 days per install.
- **EAS** (`eas.json`): `eas build -p ios --profile production` then `eas submit -p ios` (TestFlight / App Store, Apple
  Developer account); `--profile preview` for ad-hoc iOS builds or an Android APK.

Details: [docs/wiki/Mobile-App.md](../docs/wiki/Mobile-App.md#install-it-on-your-iphone).

## Pairing

On the server: `artemis pair`, or in the desktop app Settings → Server & devices → New code, or in this app
Settings → Pair another device. Links and QR codes have the form `artemis://connect?url=<server>&code=<code>`.
