# Artemis server, desktop client and mobile/web app

Status: 2026-11-21. Phase 1 (audit, decisions) and Phase 2 (server API, pairing, client auth) are done. The rest is below, in order.

## Decisions (agreed with Ulvi)

1. **Two ways to run Artemis.** Fully local on the user's computer (as today, nothing changes for users who never connect a server), or with a server. With a server, the desktop app is a client of it and can still run a task on the computer.
2. **Chats live on the server** when one is connected. A turn the desktop runs locally ("This computer") is written to the same server chat, marked `env: 'local'`, so every client sees the whole conversation and where each turn ran.
3. **The server must work like the desktop.** Same agent (`runAgent`), same history sent to the model (`core/history.js` = `src/lib/history.js`, checked by a test), same saved message format (`core/turn-builder.js` = the window's event reducer), same memory, skills, agents, schedules, teams and connectors.
4. **Auth is Artemis's job only.** Cloudflare (Tunnel, Access, DNS) is set up by the user; Artemis needs only: accept the tunnel hostname (`--public-host`), and authenticate every call itself.
5. **Telegram and scheduled tasks:** after migration the user chooses per item whether it moves to the server or stays on the computer. Nothing moves on its own.
6. **Mobile and web are one Expo app** (React Native + Expo Router; the same code builds for iOS, Android and web). In the app the user enters the server's base URL and a pairing code. The web build can be served by the server itself (`--web <folder>`, same origin) or deployed anywhere (`--allow-origin`). It must cover all client features, not only chat (see Phase 5).

## Data ownership

| What | Local-only user | With a server |
| --- | --- | --- |
| Chats, projects, memory, skills, agents, teams | desktop data folder | server data folder (desktop keeps its old copy untouched) |
| Schedules, heartbeats, webhooks, Telegram | desktop | where the user chose at migration |
| Provider keys, connector secrets | desktop (OS encryption) | server, entered on the server or sent once from the desktop, re-encrypted there |
| Files a task makes | the computer | where the task ran (`env` on the file card); moved only by Download / Upload |
| Computer control, local terminal, local files | desktop only | desktop only; a server task never reaches the computer |

## Done: Phase 2, server API and pairing

New files: `electron/core/clients.js` (paired clients), `core/runhub.js` (runs that outlive a connection), `core/turn-builder.js`, `core/history.js`, `scripts/test-server.js`. Changed: `core/gateway.js`, `core/headless.js`, `core/sessions.js`, `core/cli.js`.

- **Pairing.** `artemis gateway` prints a code on first start; `artemis pair` (or `POST /v1/pairing` from a paired app) makes another. Codes: 8 characters, 10 minutes, single use, only a hash stored, wrong guesses rate-limited per address (`cf-connecting-ip` behind the tunnel) and in total. `POST /v1/pair { code, name, kind }` returns a client token `art_<id>.<secret>` (only its hash is stored). `artemis clients`, `artemis revoke <id>`, `POST /v1/clients/:id/rotate|revoke`.
- **Tunnel.** `--public-host artemis.example.com` (or `ARTEMIS_PUBLIC_HOSTS`) lets the loopback gateway accept that Host header. Other hosts are still refused (DNS rebinding).
- **Browsers.** Requests with an `Origin` are still refused, except the gateway's own web app (`--web`) and `--allow-origin` entries, which get CORS.
- **Runs survive disconnects.** `detach: true` on `/v1/chat`; every SSE event has `id: <seq>`; `GET /v1/runs/:id/events?after=N` (or `Last-Event-ID`) replays and follows. If too much was missed, a `snapshot` event carries the message built so far. `GET /v1/approvals` lists questions still waiting.
- **Full chats.** Server turns are saved in the desktop format (tool cards, files, thinking, artifacts), written while they stream (`sessions.startTurn` / `putMessage`), so the desktop sees them live. `GET /v1/sessions/:id?full=1`, `GET /v1/media/:name`, `GET /v1/sessions?limit&before&project_id`.
- **Extra areas.** `/v1/x/models`, `/v1/x/projects`, `POST|DELETE /v1/x/sessions/:id` (rename, pin, move, delete). Phase 5 adds the rest here.
- The in-app gateway (Settings → Gateway) and the CLI are unchanged for existing users.

## Phase 3: migration (desktop → server)

- Desktop: Settings → Server → "Move my data to the server". Pick Everything or: chats, projects, memory (workspace files), skills, agents, teams, media, settings; schedules/heartbeats/webhooks/Telegram each with "move" or "keep here".
- Transfer: `POST /v1/x/migrate/start` (manifest: counts, sizes, sha256 per file) → `PUT /v1/x/migrate/:id/file?path=` (raw bytes, ≤ 50 MB a request, resumable) → `POST /v1/x/migrate/:id/commit`. Paths are checked against an allow-list of areas (no `..`, no absolute paths, safe names), sizes and hashes verified before anything is applied.
- Commit: `VACUUM INTO` backup of `artemis.db` and a copy of the JSON files to `<data>/backups/<time>/`, then `sessions.importChats` (ids and times kept, retries add nothing), workspace files merged, memory index rebuilt on the server, projects with Mac folders become server projects without a folder (the report says so).
- Report: added / merged / skipped chats, media copied, failures, and what needs the user again (keys, OAuth connectors, stdio connectors with Mac paths).
- Secrets: separate step. The desktop decrypts on the Mac only after the user confirms, sends over the paired HTTPS connection, the server stores them in `secrets.json` encrypted with `ARTEMIS_MASTER_KEY` (AES-256-GCM). Keys can also be typed in the server settings from any client.
- The desktop's own data is only read, never changed.

## Phase 4: desktop as a client

- `electron/server-client.js`: the paired connection (URL, token in the OS keychain via safeStorage), health, reconnect with backoff, SSE with resume.
- Settings → Server: connect (URL + code), status, this device's name, other paired devices (rename, revoke, "Add a phone": code + QR), disconnect.
- Chat list: server chats shown from the API (kept in a separate store so the local `sync()` never touches them); local chats stay as they are.
- Composer: "Home server / This computer" switch, shown on every turn. Server turns go to `/v1/chat`; local turns run `executeRun` with history from the server chat and are written back (`env: 'local'`). If the chosen place is offline: an error with Retry / switch, never a silent fallback.
- File cards show where a file is; "Download to this computer" (`GET /v1/x/files`) and "Send to server" (upload before a server task).

## Phase 5: Expo app (iOS, Android, web)

`mobile/` (Expo SDK, Expo Router, TypeScript off to match the repo). Streaming with `expo/fetch` (native) and `fetch` streams (web), resume with `after=`. Token in `expo-secure-store` (native) / encrypted IndexedDB (web).
Screens, in the order they ship: Connect (URL, code, QR scan) · Chats (search, projects, pin, rename, delete) · Chat (stream, stop, tool cards, approvals and questions, files, images in and out, model picker) · Projects · Memory · Schedules · Agents and teams · Skills · Connectors status · Settings (providers and keys, server devices, appearance).
Server side for these: `/v1/x/settings`, `/v1/x/providers`, `/v1/x/schedules`, `/v1/x/skills`, `/v1/x/agents`, `/v1/x/connectors`, `/v1/x/files` (with the same approvals as the desktop).

## Phase 6: server deployment

`deploy/server/`: Dockerfile (Node 22 slim, Chromium for the browser tools, no Electron), `docker-compose.yml` (data volume, files volume, restart, health check on `/v1/ping`, `ARTEMIS_PUBLIC_HOSTS`, `ARTEMIS_MASTER_KEY`), backup/restore scripts, `docs/wiki/Home-Server.md` (Cloudflare Tunnel pointing at `http://localhost:8789`, pairing, backups, limits: no computer control on the server).

## Phase 7: verification

Tests for migration (retry, bad paths, hashes, backup), routing (no local tools in server runs), server restart and restore, Expo connect/stream/resume/revoke, and a migration of a copy of a real data folder.
