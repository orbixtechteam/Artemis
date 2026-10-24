# Gateway and command line

The gateway is a small HTTP API in front of Artemis. Through it, the `artemis` command line, scripts and other programs use the same agent, saved chats and memory as the app. It runs in two ways:

- **Inside the desktop app**: Settings → Access → **Gateway**. Messages that arrive through it show up live as chats in the window, and approvals can be answered in the window or by the program that sent the message.
- **Headless**: `artemis gateway` runs Artemis without a window (for example on a server, or on your Mac at login so Telegram and scheduled tasks keep working when the app is closed). It uses the same data folder: chats, memory, skills, agents, projects, connectors and scheduled tasks.

## Running both at once

The app and the headless gateway can run at the same time on one data folder:

- **Chats** are shared through `artemis.db`. What the gateway writes (a Telegram conversation, a scheduled task, a CLI chat) appears in the app's chat list within a couple of seconds; if the app saves an older copy of a chat in the meantime, the messages are merged, not lost.
- **Background jobs run in one place**: while the headless gateway runs, it owns scheduled tasks, the Telegram bot and the gateway API; the app stops its own and takes them back when the gateway stops. Settings → Access → Gateway shows when the headless gateway is in charge.
- **Usage** is counted together (the gateway writes `usage-headless.json`), so daily and monthly limits cover both.
- Only one headless gateway per data folder.

## Command line

Needs Node.js 22.13 or newer for `artemis gateway` (it uses the built-in SQLite). From the source folder:

```
node bin/artemis.js help
pnpm link --global      # optional: makes `artemis` available everywhere
```

| Command | What it does |
| --- | --- |
| `artemis gateway [--port 8789] [--allow-shell] [--no-telegram] [--no-connectors] [--no-browser] [--no-computer] [--no-scheduler]` | Runs Artemis headless |
| `artemis status` | Shows whether a gateway runs, its model and running tasks |
| `artemis chat "message"` | Sends one message and streams the answer; prints the session id |
| `artemis chat -s <id> "message"` | Continues a chat |
| `artemis chat` | Interactive chat (`/new`, `/exit`, Ctrl+C stops an answer) |
| `echo "text" \| artemis chat` | Message from standard input |
| `artemis sessions` / `artemis show <id>` | Recent chats / the last turns of one |
| `artemis search <words>` | Full-text search over saved chats |
| `artemis memory search <words>` | Searches long-term memory |
| `artemis memory list` / `add <text>` / `note <text>` | The `MEMORY.md` list, add a fact, add a daily note line |
| `artemis token` | Prints the gateway address and token |
| `artemis service install` / `status` / `uninstall` | Runs the gateway as a background service (see below) |

`--data <folder>` picks another data folder (default: the desktop app's, or `$ARTEMIS_HOME`). `--json` prints raw events. When a task wants to do something that needs approval, the command line asks `[y/N]`.

## Provider keys when headless

The app stores keys encrypted with the operating system. The headless gateway reads them in this order:

1. an environment variable `ARTEMIS_KEY_<PROVIDER_ID>` (the provider id in upper case, other characters as `_`), and `ARTEMIS_BRAVE_KEY` for Brave Search;
2. `<data folder>/headless.json`: `{ "keys": { "<providerId>": "sk-..." }, "braveKey": "..." }` (keep it readable by you only);
3. the app's saved keys: on macOS through the "Artemis Safe Storage" keychain item (macOS asks once whether to allow it; `--no-keychain` skips this).

## What headless can do

| Feature | Headless | Notes |
| --- | --- | --- |
| Chat, files, web, memory, notes, skills, helper agents | Yes | Same settings as the app |
| Scheduled tasks | Yes | `--no-scheduler` to leave them to the app |
| Telegram | Yes | Same bot, pairing and commands as the app; approvals arrive as buttons. `--no-telegram` to skip |
| Connectors (MCP) | Yes | From `mcp.json`. OAuth connectors must be signed in once in the app; refreshed tokens are saved by the gateway. `--no-connectors` to skip |
| Browser | Yes, with Playwright | Its own Chromium profile (`headless-browser/`), headless. Install once: `pnpm add -O playwright-core && npx playwright install chromium`, or set `"headlessBrowserChannel": "chrome"` in `settings.json` to use your installed Chrome. `"headlessBrowserVisible": true` shows the window |
| Computer control | macOS only | Allowed when "Computer control" is on in Settings. Grant Screen Recording and Accessibility to the terminal (or `node`) that runs the gateway |
| Terminal commands (`run_command`) | Yes, in the [sandbox](Sandbox.md) | With a sandbox set in Settings → Tools, commands run in Docker or over SSH. Without one, only with `--allow-shell` (then on this machine) |
| Terminal panel, image/video generation, Make | No | App only |

## API

All requests need `Authorization: Bearer <token>`. Requests with an `Origin` header (from a web page) are refused.

| Method and path | Body / query | Answer |
| --- | --- | --- |
| `GET /v1/health` | | `{ mode, version, model }` |
| `POST /v1/chat` | `{ message, session_id?, model?, project_id?, stream? }` | Server-sent events, ending with `done { session_id, text }`; with `stream: false` one JSON answer |
| `GET /v1/sessions` | `?limit=20` | Recent chats |
| `GET /v1/sessions/<id>` | `?last=20` | `{ id, title, turns }` |
| `GET /v1/search` | `?q=…&limit=8` | Chat search hits |
| `GET /v1/runs` / `POST /v1/runs/<id>/abort` | | Running tasks / stop one |
| `POST /v1/approvals/<id>` | `{ approve: true }` | Answers a `tool:approval` event |
| `GET /v1/memory` | `?q=…&limit=6` | Memory search hits `{ path, from, to, text, score }` |
| `GET /v1/memory/list` / `POST /v1/memory` / `POST /v1/memory/note` | `{ text }` | The fact list / add a fact / add a daily note line |

Events in the stream are the agent's own: `chunk` (answer text), `step:new`, `tool:call`, `tool:result`, `tool:approval`, `notice`, `error`, then `done`.

## Security

- It listens on `127.0.0.1` only (the headless gateway accepts `--host`, but then put it behind TLS, for example a tunnel or reverse proxy).
- The token is in Settings → Access → Gateway and in `<data folder>/gateway.json` (readable by you only), which is how the command line finds it. **New token** invalidates the old one.
- "No terminal or computer control from outside" blocks those tools for gateway messages even when approved.

## Keep it running in the background

Settings → Privacy & safety → Gateway → **Keep running in the background**, or from a terminal:

```
artemis service install      # start at login, restart if it stops
artemis service status
artemis service uninstall
```

This installs a launchd agent on macOS (`~/Library/LaunchAgents/dev.orbixlabs.artemis.gateway.plist`) or a systemd user unit on Linux (`~/.config/systemd/user/artemis-gateway.service`), like `openclaw onboard --install-daemon` or `hermes gateway install`. From the app it runs Artemis's own binary in Node mode, so no separate Node.js is needed. Flags given to `artemis service install` (for example `--no-browser`) are passed to the gateway. The log is `~/.artemis/logs/gateway.log`.

While the service runs, the app hands it scheduled tasks, Telegram and the gateway API, and shows its chats live. Closing the app changes nothing for the service.

## Where the chats are

Since this version, chats are stored in `artemis.db` (SQLite, with a full-text index) in the data folder. `chats.json` is still written as a backup copy, so an older build of Artemis opens your chats as before. A deleted chat stays in the database for 30 days before it is removed for good.

## See also

- [Memory](Memory.md)
- [MCP](MCP.md): Artemis as an MCP server for Claude Code
- [Scheduled Tasks](Scheduled-Tasks.md)
