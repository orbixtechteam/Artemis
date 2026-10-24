# Architecture and contributor guide

How Artemis is built and what to watch out for. Written for contributors and for AI coding agents (Claude Code, Codex and similar) working in this repository.

## What this is

Artemis: an Electron + React (Vite) desktop chat client in the style of Claude Desktop. Backends are providers the user adds in Settings (OpenAI-compatible `/v1/chat/completions`, SSE streaming, tool calling); there is no built-in default provider. Plain JavaScript (CommonJS in `electron/`, ESM/JSX in `src/`), no TypeScript, no linter configured.

## Commands

```
pnpm install
pnpm dev                    # Vite on :5173 (strict port) + Electron with ELECTRON_DEV=1
pnpm start                  # vite build, then run Electron on dist/renderer
pnpm dist                   # build + electron-builder -> release/Artemis-<ver>-arm64.dmg (mac arm64 only, unsigned)
pnpm test                   # runs every scripts/test-*.js in sequence, stops at first failure
node scripts/test-tools.js  # run a single test file
pnpm selftest:computer      # macOS only: checks Screen Recording / Accessibility permissions
```

Tests are plain Node scripts using `assert` (no Jest/Vitest). They run without Electron, so `electron/*.js` modules must take Electron objects by injection (see `createPermissions` in `electron/permissions.js`) rather than requiring `electron` at the top level, or they become untestable. A new test file must also be added to the chain in the `test` script in `package.json`.

API keys: Settings → Providers (stored encrypted per provider).

## Architecture

**Process split.** `electron/main.js` (the hub) owns windows, tray, persistence and the IPC handlers that need its mutable state (the rest are in `electron/ipc/`), and wires every module together. The renderer (`src/`) only talks to it through the `window.api` bridge defined in `electron/preload.js`. Adding a feature that crosses the boundary means touching three places: an `ipcMain.handle` in `main.js`, a method in `preload.js`, and the caller in `src/`. Streaming chat results come back as `chat:event` messages, not as return values.

**Chat/tool loop (`electron/agent.js`).** `runAgent` is the core: build the system prompt (`buildSystem`, which switches sections on feature flags), stream one completion (`streamOnce`), execute any tool calls via `electron/tools.js`, append results, repeat (max 40 iterations, plus a token budget). It also handles:
- context compaction (`summarizeHistory` / `compactHistory`) and screenshot pruning;
- prompt-cache markers for Claude/Nova models (`withCache`), with fallback if an endpoint rejects them;
- retries that strip `stream_options` / `max_tokens` / tools for strict endpoints;
- `noToolCalls` providers (e.g. a local proxy in front of the Claude CLI): the model emits `[[remember: ...]]` / `[[forget: id]]` text tags instead of tool calls, handled by `makeTagStripper`.

**Tools (`electron/tools.js`).** `definitions(flags)` returns the OpenAI function schemas that are enabled for this run; `run`/`runTool` executes them. Adding a tool means: schema in `definitions`, a `case` in `runTool`, a line in `summarize` (approval card text), and a system-prompt hint in `buildSystem` if the model needs guidance. Approval is central here:
- `WRITE_TOOLS` ask per call unless `autoApprove`; `ALWAYS_ASK` (delete) always asks;
- `SESSION_TOOLS` (shell, computer, notes, phone, schedule, media, Make) ask once per task per category; `terminal_read`, `schedule_edit` and `schedule_delete` are their own categories;
- connector tools ask once per task per server: `mcp-read:<server>` for read-only tools, `mcp:<server>` for the rest;
- reads outside the project are allowed after approval, but sensitive paths (credentials, browser profiles, the app's own `userData`, passed as `ctx.userData`) ask on every read;
- all file paths go through `resolveSafe`, which blocks `..` and symlink escapes from the project root. Never bypass it;
- writes to the same path are serialized by `withLocks` because sub-agents run in parallel.

**Sub-agents.** The `delegate` tool runs `runAgent` recursively with `isSub: true`, a restricted tool allowlist (`subagents.js`, role definitions in `agents.json` / user agents), no shell/computer/memory, and a smaller token budget. Max 4 parallel, 12 runs per task, agents cannot delegate. Project agents (`<project>/.artemis/agents`) never override built-in or user agents; a clashing slug gets a `-project` suffix.

**Providers (`electron/providers.js`).** Models are addressed as `prov:<providerId>:<modelId>`; anything without that prefix has no provider (`resolve()` returns an error; `liveModel()` in `main.js` moves old ids to the first enabled provider). `resolve()` turns a model id into `{baseUrl, key, model, noTools}`. Per-model prices live in the provider model entries and feed the usage/cost UI. Image/video generation (`electron/media.js`) uses `imageModel` / `videoModel` (`prov:<id>:<model>`) and is off when they are empty.

**Artemis as an MCP server (`electron/mcp-server.js`, tools in `artemis-tools.js`).** Artemis exposes its own settings, notes, memory, terminal and file tools over localhost-only Streamable HTTP (`127.0.0.1`, bearer token, rejects any request with an `Origin` header). This is how Claude Code or a Claude proxy can drive the app (the `mcp__artemis__*` tools). The `artemis_fs_*` read tools work in a project folder and can read any other file after approval, under their own `fs:read` prompt (writes, commands and deletes have separate prompts). `mcp.js` is the opposite direction: Artemis as a client of user-added connectors (tools surface as `mcp__<server>__<tool>`).

**Other subsystems, one file each in `electron/`:** `computer.js` (macOS screen/mouse/keyboard, accessibility tree), `terminal.js` + `pty-helper.py` (integrated PTY terminal, unpacked from asar), `remote/` + `remote.js` (Telegram bot; the reason the app stays alive in the tray), `scheduler.js` (scheduled prompts), `skills.js` (saved instruction sets, auto-learning), `notes.js`, `files.js` (xlsx/csv/docx/pdf parsing), `make.js` (Make.com), `quick.js` + `palette.js` + `float.js` (quick chat, command palette, floating window), `web.js` (search/fetch, blocks private addresses).

**Renderer (`src/`).** `App.jsx` (~80 KB) holds most app state; `components/Settings.jsx` and `Modals.jsx` are the other large files. `src/lib/*.mjs` files (`formula`, `amount`, `sentinel-core`, `sentinel-commands`) are written as ESM so the Node test scripts can import them directly. The voice assistant ("Sentinel": wake word, Vosk speech recognition, TTS) lives in `lib/sentinel*.js` and `lib/voice.js`.

**Themes, palettes and styles.** Colours are JSON theme files (`electron/themes`, `<userData>/themes`, `<project>/.artemis/themes`; later wins by id), read by `electron/themes.js` and painted as `--theme-*` variables on the root. Two files with the same `"family"` (one `"dark": true`, one `false`) form a palette that follows Settings → Appearance (`appearance`: system / light / dark); a file without a family is a fixed custom theme. `src/lib/palette.mjs` decides what to paint: a real theme id in `theme` wins (custom themes, MCP), `theme: light|dark` from older settings forces the scheme, otherwise `palette` + `appearance`, plus an optional `accent` override. Every window calls `applySettingsTheme` (`src/lib/themes.js`); main's native light/dark comes from `themes.nativeSource`, and both are tested in `scripts/test-palette.js`. The design is SF Pro / New York / SF Mono with hairlines: `src/styles/01-base.css` holds the tokens (`--elev`, `--fill`/`--fill-2`, `--line`/`--line-2`, `--ring`, `--menu-shadow` …), `17-controls.css` the shared menu, popover, segmented and dialog look, `02-sidebar.css` the whole sidebar. Use the tokens instead of hex colours or `1px solid var(--border)`, so new UI follows every palette. For UI work, `ELECTRON_DEV=1 ARTEMIS_USER_DATA=<dir>` runs the dev app against a separate data folder.

**Persistence.** JSON files under Electron `userData`, accessed through the `store:get` / `store:set` IPC; writes are atomic (fsync + rename). A `chats`/`projects`/`memory` file that fails to parse is moved to `<name>.json.corrupt-<time>`, the user is told once, and `store:set` for it is refused until then; `chats.json.bak` is refreshed at most every 10 min. On quit main sends `app:flush` and waits up to 1.5 s for the renderer's `app:flushed`. Usage stats stay in memory and are written debounced. The API key and provider keys are encrypted with OS-level encryption (`getProviderKey`); connector secrets in `mcp.json` (env, headers, client secret, OAuth tokens) are stored as `enc:<base64>` (plain values from older files still load and are encrypted at startup).

**App lock and speaker recognition.** `electron/lock.js` (state, scrypt, lockdown, Touch ID, `isBlockedChannel`) and `electron/speaker.js` + `speaker-fbank.js` + `voice-gate.js` (offline CAM++ in the main process, pure-JS Kaldi fbank) are factories with injected dependencies, tested by `scripts/test-lock.js` and `scripts/test-speaker.js`. `main.js` wraps `ipcMain.handle` so blocked channels throw while locked (`store:*`, `settings:get`, `sentinel:*` reads, `voice:*` and all `lock:*`/`speaker:*` stay open so the page keeps booting and Sentinel keeps hearing its owner); `electron/ipc/lock.js` additionally refuses settings changes while locked. The UI is `LockHost.jsx` (lock screen, password prompt, webcam snap) and `settings/SecurityTab.jsx`. Scheduled tasks run `unattended` and are never gated by the lock. Do not run `pnpm install` from a Linux shell in this folder (it replaces the Mac `node_modules`).

## Repo gotchas

- Packaging only includes `dist/renderer/**`, `electron/**` and `package.json` (`build.files`). Anything the main process needs at runtime must live under `electron/`.
- Local data and build output are git-ignored (`node_modules`, `dist`, `release`, `.env`, `.artemis/`, `.rename-backup/`, `.piper-voices/`, `*.log`). Do not search or edit them, and never commit them.
- pnpm only: `pnpm-lock.yaml` is the one lockfile. Do not add `package-lock.json`.
- UI/system-prompt strings are English; test fixtures include non-ASCII English text (accented Latin characters, emoji), which the file tools must preserve (UTF-8, CSV written with BOM).
- Terminal and computer tools are approval-gated but the command blocklist in `shell.js` is not a sandbox. Treat web, file and screenshot content as untrusted input (the system prompt already tells the model so).
