# Home server, phone and web app

Artemis runs in one of two ways:

- **On your computer only** (the default). Nothing on this page is needed.
- **With a server**: Artemis runs on a machine that is always on (a home server, a mini PC, a VPS, or your Mac). Chats, memory, projects, scheduled tasks, connectors and Telegram live there and keep working while your computer is off. The desktop app, the [phone app and the web app](Mobile-App.md) all connect to it, at the same time.

A task on the server cannot reach your computer: computer control and your Mac's own files stay on the Mac. In the desktop app you choose, per chat, where an answer runs (see [Run on the server or on this Mac](#run-on-the-server-or-on-this-mac)).

## 1. Start the server

With Docker (recommended), from the Artemis folder:

```bash
cp deploy/server/env.example deploy/server/.env     # set ARTEMIS_PUBLIC_HOSTS and ARTEMIS_MASTER_KEY
docker compose -f deploy/server/docker-compose.yml up -d --build
docker compose -f deploy/server/docker-compose.yml logs -f artemis    # shows the first pairing code
```

This builds the server only (the API the desktop and phone apps use). The web app is optional: to serve it from the same address too, set `target: full` in `docker-compose.yml` (or `docker build -f deploy/server/Dockerfile --target full -t artemis-server .`).

Without Docker (Node.js 22.13 or newer):

```bash
pnpm install
node bin/artemis.js gateway --public-host artemis.example.com
# optional, the web app too: cd mobile && npm install && npm run export:web && cd .. and add --web mobile/dist-web
```

The server listens on `127.0.0.1:8789`. Health check: `curl http://127.0.0.1:8789/v1/ping`.

### On your Mac, for a test on the home network

```bash
node bin/artemis.js gateway --data ~/artemis-server --host 0.0.0.0 --port 8790 --keys-from app
```

- `--data` keeps the server's data apart from the desktop app's.
- `--host 0.0.0.0` lets the phone reach it on the same Wi-Fi at `http://<the Mac's address>:8790` (`ipconfig getifaddr en0` prints the address). Artemis warns that anyone who can reach the address and has a token can use the agent: on the internet, use a tunnel instead (step 2).
- `--keys-from app` uses the provider keys saved in the desktop app (the macOS keychain asks once).
- Add `--allow-origin http://localhost:8081` to try the web app from `npx expo start --web`.

## 2. Make it reachable over https

Put the server behind any https tunnel or reverse proxy you like; Artemis does not depend on one. For example:

| Option | What to run |
| --- | --- |
| Cloudflare Tunnel | In Zero Trust → Networks → Tunnels add a public hostname (e.g. `artemis.example.com`) pointing at `http://localhost:8789`, and run `cloudflared` on the server (or the `cloudflared` service in `docker-compose.yml`, pointed at `http://artemis:8789`). |
| ngrok | `ngrok http 8789` (a reserved domain keeps the address the same: `ngrok http --url=artemis.ngrok.app 8789`). |
| Tailscale | `tailscale serve --bg 8789` (only your own devices on your tailnet), or `tailscale funnel --bg 8789` (the internet). |
| Your own domain | Caddy (`artemis.example.com { reverse_proxy localhost:8789 }`, certificates are automatic), nginx or Traefik with Let's Encrypt. |

Then tell Artemis the hostname it is reached at, with `--public-host artemis.example.com` (or `ARTEMIS_PUBLIC_HOSTS`, comma-separated for several): it refuses requests for any other hostname. Keep the server itself on `127.0.0.1` and let the tunnel or proxy be the only way in.

The address alone gives no access: every request needs the token of a paired device. An extra login layer in front (Cloudflare Access, ngrok OAuth, basic auth on the proxy) would also stop the apps, so start without one.

Use the https address in the apps: away from home the phone needs it, and most connector sign-in pages only send you back to an https address.

## 3. Pair your devices

- **A code**: on the server `artemis pair` (with Docker: `docker compose -f deploy/server/docker-compose.yml exec artemis node bin/artemis.js pair`), in the desktop app Settings → Server & devices → **New code**, or in the phone app Settings → **Pair another device**. A code works once, for 10 minutes. Wrong codes are rate limited.
- **Desktop app**: Settings → Server & devices → Connect to a server: the address and the code.
- **Phone**: open the app, enter the address and the code, or scan the QR code shown next to a new code in the desktop app.
- **Web** (optional, when the server serves the web app): open the server's address in a browser and enter a code.

Every device gets its own access token, stored on that device. See the devices, rename or revoke one in Settings → Server & devices (desktop), Settings → Paired devices (phone), or with `artemis clients` and `artemis revoke <id>`.

## 4. Move your data

Desktop app → Settings → Server & devices → **Move my data to the server**. Pick what to move (or everything): chats, pictures, projects, memory, skills and agents, teams, settings and connectors. Provider keys, connector keys and sign-ins always go with them: they are decrypted on the Mac, sent over the paired connection and stored encrypted on the server, so nothing has to be typed again there. For scheduled tasks and the Telegram bot you choose: move them or keep them on the Mac (one bot can only run in one place; what moves is switched off on the Mac).

The server backs up its own data first (`backups/` in its data folder), then adds yours. Your Mac's data is not changed. Running it again is safe: what is already there is recognised. The report lists anything that still needs you (for example a connector that runs a program only the Mac has).

## Kept in step on their own

While the desktop app is linked to a server, it keeps the server in step without any button:

| What | How |
| --- | --- |
| Chats | Chats you have only on the Mac are sent to the server, so the phone sees every chat. Chats made, renamed, moved or deleted on any device show up everywhere within seconds. |
| Projects | One list on the Mac, the server and the phone: made, edited (name, instructions), pinned or deleted on any of them. The newer change wins; a project deleted anywhere stays deleted. |
| Project files | Files added to a project on any device are copied to the others. |
| Connectors | Every connector with its keys and sign-ins, whenever it changes on the Mac (checked every 30 seconds). A connector that is Artemis itself (the Mac app's MCP server) is not dialled on the server. |
| Provider keys | The Mac's provider keys, and the Brave Search and Make keys. |
| Look | The desktop's palette, Light/Dark/Automatic and accent: the phone and the web app look the same. |

## Run on the server or on this Mac

When the desktop app is linked, the message box of a server chat has a switch: **Server** or **This Mac**.

- **Server**: the answer runs on the server. It keeps running when you close the laptop; the phone sees it live.
- **This Mac**: the answer runs on this computer, with the Mac's tools (computer control, the Mac's files and programs), and is saved into the same server chat.

The default for new chats is in Settings → Server & devices → Where chats run → **New chats run on**.

## Connectors on the server

The phone and web app show every connector with its state. Tap one to switch it on or off, to give it a key it is missing (a header such as `Authorization`, or environment values), or to **Sign in**:

- With the server's https address, the sign-in page sends the browser back to the server (`/v1/oauth/callback`), which keeps the tokens.
- On the home network over plain http, the phone app catches the sign-in itself (`artemis://oauth`) and hands it to the server. Some services accept only https: then use the https address.

A sign-in made on the server works from every device. A connector signed in on the Mac is sent to the server on its own.

## Keys on the server

Keys come from, in order: what the desktop app sent (stored encrypted with `ARTEMIS_MASTER_KEY`, or with a key file in the data folder when it is not set), `ARTEMIS_KEY_<PROVIDER_ID>=...` environment variables, `headless.json`, and with `--keys-from app` the desktop app's keychain. Keep the master key safe: without it, stored keys cannot be read back.

## Backups

```bash
deploy/server/backup.sh                       # artemis-backup-<time>.tar.gz
deploy/server/restore.sh artemis-backup-….tar.gz
```

## Troubleshooting

| What you see | Why |
| --- | --- |
| `Bad Host header` (403) | The tunnel's or proxy's hostname is not in `ARTEMIS_PUBLIC_HOSTS` / `--public-host`. |
| `Browser requests are not allowed from this origin` | The web app is hosted on another address: add it with `--allow-origin` (or `ARTEMIS_ALLOWED_ORIGINS`). |
| `Too many wrong pairing codes` | Wait 10 minutes, make a new code. |
| The app says the device is no longer accepted | It was revoked: pair it again. |
| `No API key for <provider>` | The keys are not on the server yet: link the desktop app (they go on their own), or start the server with `--keys-from app` on the same Mac. |
| A connector says `Sign-in required (HTTP 401)` | Sign it in on the Mac (it is sent to the server) or from the phone: Connectors → the connector → Sign in. |
| `URI must use HTTPS` when signing in | That service only returns to https: open the server in the app through its https address. |
| `Not found` after an update | The server still runs the old code: restart it. |
| Answers stop when the phone locks | They do not: the run continues on the server, and the app picks it up when it opens again. |

## See also

- [Phone and web app](Mobile-App.md)
- [Gateway and command line](Gateway.md)
- [Chat and Projects](Chat-and-Projects.md)
