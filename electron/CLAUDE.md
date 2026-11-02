# electron/ (main process)

Node/CommonJS code that runs in Electron's main process. No bundler: files are `require`d directly. The renderer lives in `src/` and only talks to this folder through `preload.js`.

## Conventions

- Modules are factories: `createX(deps)` returns an object of functions (`createPermissions`, `createAgents`, `createMcpServer`). Electron objects, `fs` paths and helpers are injected through `deps`, so modules stay testable without Electron. Keep that pattern for new modules.
- Export with `module.exports = { createX, ...helpers }`.
- Tools return strings (or `{ __content: [...] }` for images); failures throw or return `{ ok: false, error }`. Keep error text user-readable.
- Do not add a new IPC channel (in `main.js` or `electron/ipc/`) without exposing it in `preload.js`; `scripts/test-main.js` fails if a preload channel has no handler.

## Files that need care

- `main.js`: app lifecycle, windows, persistence and wiring. Most IPC handlers live in `electron/ipc/<area>.js` (registered at the bottom of `main.js`); handlers that touch main's mutable state (`win`, `quick`, `remote`, browser and sentinel state) stay in `main.js`. Read the relevant section only; do not rewrite it wholesale.
- `agent.js`: the chat/tool loop. `tools.js`: tool definitions and the approval model. Deleting files, shell, computer control and Make are never given to sub-agents.
- `subagents.js`: role agents stored as markdown with frontmatter. User agents live in `<userData>/agents/<slug>.md`, project agents in `<project>/.artemis/agents/<slug>.md`. A user file overrides the built-in role with the same slug; project files (untrusted) never override built-in or user agents (a clash gets a `-project` slug). Tool groups: `read`, `write`, `web`, `chats`.
- `ipc/mcp.js` + `readMcpList`/`writeMcpList` in `main.js`: connector secrets are encrypted at rest (`enc:` prefix); always go through these helpers, never `readJson('mcp')` directly.
- Persistence: `readJson` quarantines an unparseable chats/projects/memory file (`.corrupt-<time>`) and `store:set` refuses that store until the user has been told; keep it that way so a bad read never overwrites data.
- `mcp-server.js`: Artemis as an MCP server (Streamable HTTP, JSON replies only). Binds to `127.0.0.1`, requires a bearer token, rejects any request with an `Origin` header. Do not loosen these checks.
- `permissions.js`: macOS permission checks (microphone, screen, accessibility, automation, notifications). Automation can only be probed by trying, so keep that probe silent.
- `artemis-tools.js`: the tools exposed to MCP clients (settings, theme, providers, memory, notes, terminal, agents and teams). The agent/team tools reuse the `tools.js` chat handlers (`agent_*`, `model_list`, `team_*`) with main's `teamsTools`; lists run at once, everything else asks.
- `computer.js`: computer control (open, ui, click_ui, key, type). `terminal.js`, `pty-helper.py`, `shell.js`: the visible terminal.
- JSON config: `personality.json`. Edit as data; keep valid JSON.

## Working in this folder

- Use the Artemis connectors (`artemis_fs_*`) for all file work in this project.
- Ask before running anything (build, tests, the app).
- Match the surrounding style: single quotes, semicolons, 2-space indent, terse comments only where logic is non-obvious.
- Tests are plain Node scripts chained by `pnpm test`; see the root `agents.md` for running a single one.
