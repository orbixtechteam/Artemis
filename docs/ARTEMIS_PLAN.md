# Artemis: audit and implementation plan

Written 2026-11-11 against `main` at `d4c0f89` (v1.7.20). Audience: the engineer or coding agent who implements this.
Read `agents.md` first; every rule there still applies (plain JS, pnpm only, tests are Node scripts added to the `test` chain, IPC changes touch `main.js` + `preload.js` + `src/`).

Goal: the Claude Desktop experience (files, artifacts, sheets, docs, whiteboards, clean UI) on any model, with agents that run like a Grok/ChatGPT-style bot, plus DeepSeek-Harness-style self-written plugins.

## 0. What was read, and what was not

- Artemis source: `electron/` (main, agent, tools, cli-agents, mcp, mcp-server, teams, library, media, core/*), `src/` (App, Message, Markdown, ToolCard, SidePanel, SheetEditor, MediaBlock, stick, tabs, history, cost, CSS). Not every file was read end to end; `main.js` and `App.jsx` were read by topic.
- `anthropics/claude-code` does **not** contain the CLI source. It holds plugins, examples, the changelog and docs links. What is usable from it: the plugin layout and the documented behaviour (headless `stream-json`, MCP timeouts). Nothing in this plan copies Claude Code internals.
- `deepseek-ai/deepseek-harness`: read through its README, product page and the published architecture + plugin quick reference. It is TypeScript on Cordis ("everything is a plugin"). The architecture is not portable into Artemis as is; the ideas are (section 3.6).
- Nothing was run in the app. Each finding is tagged **Confirmed** (the cause is visible in the code) or **Likely** (fits the symptom, needs a repro before the fix is called done).

## 1. Bugs, with root cause

### B1. "New chat" or a sidebar chat sometimes opens Settings — Confirmed
`src/App.jsx:1166` (`select`) looks for another tab with `t.s.view === 'chat' && t.s.chatId === id` and activates it. Page tabs (Settings, Memory, Usage, Connectors) are stored as `{ view: 'chat', chatId: <chat that was open>, modal: 'settings' }` (`openPage`, `App.jsx:299`). So any chat that was current when a page tab was opened now routes to that page tab. `newChat` reuses the empty "New chat", which is very often that chat.
Fix: one helper in `src/lib/tabs.mjs`, `findChatTab(tabs, chatId, exceptId)`, that requires `!t.s.modal`; use it in `select` and `splitChat` (`App.jsx:233`). Test in `scripts/test-tabs.js`.

### B1b. Users with only Claude Code / Codex are pushed to Settings — Likely
`hasApiKey` (`electron/main.js:397`) is true only when an enabled provider has models. `App.jsx:944` opens Settings at start and `App.jsx:1263` blocks sending when it is false, even if the chat model is `cli:claude…`.
Fix: gate on "the chat's model resolves" (`prov:` resolves or the CLI is found), not on a global flag.

### B2. Scrolling up in a chat jumps or snaps back down — Confirmed (mechanism), needs repro to confirm it is the only cause
Three things combine:
1. `src/styles/13-polish.css:14`: `.messages > .msg { content-visibility: auto; contain-intrinsic-size: auto 400px }`. Messages above the viewport have a guessed height; scrolling up makes them real, so `scrollHeight` changes under the reader.
2. `src/styles/03-chat.css:19`: `overflow-anchor: none`, so the browser does not compensate.
3. `src/lib/stick.js`: the `scroll` handler re-pins whenever the list is within 4 px of the end. A height change that shrinks the list clamps `scrollTop` to the end, which re-pins, and the next streamed frame pulls the view to the bottom. Small trackpad deltas at the bottom do the same (wheel sets unpinned, the scroll event that follows is still within 4 px and pins again).
Fix:
- Re-pin only on a user gesture that moves down and ends at the bottom (wheel `deltaY > 0`, End, PageDown, scrollbar drag, the "jump" button). Never from a bare `scroll` event.
- Keep `content-visibility` only for finished messages and let the size be remembered (`contain-intrinsic-size: auto <last>` already does this after first paint); set `overflow-anchor: auto` on `.messages` while unpinned and `none` while pinned (toggle a class from `watchIntent`).
- Test `stick.js` logic with a fake element (it is pure enough); add a manual check to the PR: stream a long answer, scroll up with a trackpad at once and slowly.

### B3. File links in an answer do nothing — Confirmed
`src/components/Markdown.jsx:31`: the `a` renderer returns early for anything that is not `http(s)`. A path, `file://` link or Files-library name is a dead link, and `will-navigate` blocks it.
Fix: a link resolver. `file://`, absolute, `~/`, and relative paths (against the project folder, then the Files folder) open the in-app viewer (`openPreview`); ⌘-click reveals in Finder. Unknown schemes stay blocked. Also add an `img` renderer (B6).

### B4. Generated images and videos are saved in `~/Library/Application Support/Artemis/media` — Confirmed
`electron/main.js:962`: `mediaDir = <userData>/media`. `media.load()` only reads from that one folder.
Fix: save to `<project folder>/generated/` when the chat has a project, else `<Files>/Generated/`. Store the absolute path in the step (already done), serve it through a protocol handler instead of base64 over IPC (`MediaBlock.jsx` builds a Blob from base64 today), and allow reads from the Files root and project roots. One-time migration moves existing files and rewrites paths in chats. Chat-attachment thumbnails (`core/mediastore.js`) can stay in userData: they are a cache.

### B5. The assistant cannot hand a file to the chat — Confirmed (missing feature)
There is no tool for it. A file only appears as buttons under a `write_file`/`write_spreadsheet` tool card (`ToolCard.jsx:371`). Files made by `run_command`, by a CLI agent's own tools, or already in Files have no card, so the model writes a path as text (which is B3).
Fix: section 3.1.

### B6. Images cannot be opened or zoomed — Confirmed
`MediaBlock.jsx` renders a bare `<img>`; attachments open `FilePanel` with a static `.preview-img`; Markdown has no `img` renderer.
Fix: one `Lightbox` component (fit, 100%, wheel/pinch zoom, drag to pan, arrows between images of the message, Copy, Save as, Show in folder, Esc). Use it from MediaBlock, attachment chips, Markdown images and tool screenshots.

### B7. No "Save as" or drag-out — Confirmed
`FilePanel` offers Copy, Open with default app, Show in folder, Send to phone. There is no download to another place.
Fix: `files:save-as` (save dialog + copy) and drag-out with `webContents.startDrag` on file cards and the viewer title.

### B8. An open file or sheet does not update when the agent edits it — Confirmed
No file watching anywhere (`fs.watch` is not used). `FilePanel` shows a parsed snapshot; `SheetEditor` loads once per path.
Fix: section 3.1 (watch) and 3.3 (live operations).

### B9. CSV preview looks poor — Confirmed
`DataTable` in `SidePanel.jsx:63` is a plain `<table>` with no row numbers in clean mode, no column letters, no types, no sticky header, no alignment for numbers.
Fix: section 3.3. Preview and editor become one grid.

### B10. `ask_user` and approval cards time out under Claude Code / Codex — Confirmed (mechanism)
For CLI models the question is a tool call over Artemis's local MCP server. `electron/mcp-server.js:60-92` answers with one JSON body and sends **nothing** until the tool returns. Claude Code's per-request timer for HTTP servers runs to the first response byte and is `max(60 s, server timeout, MCP_TIMEOUT)`; its idle timeout is 5 min without progress. A person who takes over a minute to answer loses the call. Codex has its own tool timeout (check the current `tool_timeout_sec` default before fixing).
Fix:
- For `tools/call`, answer at once with `content-type: text/event-stream`, flush headers, send `notifications/progress` every 15 s when the request carried a `progressToken`, then the result event.
- In `cli-agents.js:129` add `"timeout": 86400000` to the server entry of `--mcp-config`, and set `MCP_TOOL_TIMEOUT` and `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT=0` in the child env. Set the Codex equivalent.
- Test: `scripts/test-mcp.js` with a tool that resolves after 2 s and asserts headers arrive first; a fixture run with a 90 s question.

### B11. Long tasks "time out" — several causes
- **Confirmed:** CLI answers do not stream. `cli-agents.js:126` lacks `--include-partial-messages`, so text arrives one whole message at a time and a long turn looks frozen. Add the flag and handle `stream_event` text/thinking deltas in `claudeReader`.
- **Confirmed:** `STALL_MS = 90000` (`agent.js:279`) aborts when a provider is silent for 90 s. Reasoning models that do not stream their thinking and local models that are loading hit this. Make it per provider (default 300 s, 600 s for local), and reset the timer on SSE comments/keep-alives too.
- **Confirmed:** connector tool calls are capped at 180 s (`mcp.js:472`) and `run_command` at 300 s (`shell.js:112`). Raise both behind a setting and add a background mode for commands (start, poll with `terminal_read`-style tool, kill).
- **Likely:** each run is one long IPC stream tied to the window. Check that a renderer reload does not orphan a run (the run should live in main and the window should re-attach by `requestId`).

### B12. Compaction is inconsistent — Confirmed
Two systems that do not agree:
- Renderer: `needsCompact` (`App.jsx:1344`) at `compactAt` (80%) of a **guessed** window (`history.js:64`, regex on the model id) using chars/4, and it does not count the system prompt or tool schemas.
- Main: `runLimit = min(40000, 60% of window)` (`agent.js:770`). Above ~40k estimated tokens the run summarizes its own copy of the history (`agent.js:1008`). That summary is not written back to the chat; `summaryCache` is in memory (20 entries), so after a restart it is paid for again. The chat UI shows no compaction while the model is already working from a summary.
- chars/4 is wrong for Azerbaijani, Turkish, Russian and code; real `usage.prompt_tokens` is available on almost every step and is not used for this decision.
- Summaries are capped at 1500 output tokens and nothing is re-attached afterwards (open files, task note is kept, artifacts are not).
Fix: section 3.2.

### B13. Cost and usage are wrong or empty — Confirmed
- Prices exist only if the user typed them per model (`src/lib/cost.js`: unknown model = $0). No built-in price table, and OpenRouter's returned `usage.cost` is ignored.
- Prompt caching is switched on only for model ids that start with `anthropic/` or `amazon/nova` (`agent.js:715`). Claude through any other id pays full input price every step.
- Claude Code: `total_cost_usd` and `modelUsage` in the `result` event are ignored; cache-creation tokens are folded into `prompt` without `cacheWrite` (`cli-agents.js:69`); `result.usage` is the sum of all API calls in the turn, so it must never be shown as "context used".
- Estimated records (`estimated: true`) are mixed with real ones in totals without a marker in the UI.
Fix: section 3.2.

### B14. Fixed token overhead per step — Confirmed (measured)
With every tool group on: 90 tools = 54.6k characters of schema (about 13.7k tokens) plus a 12k-character system prompt, sent on every step. The base set is 15 tools (about 2.4k tokens). Lazy groups are on by default (`toolsLazy`), which helps, but switching a group on mid-run changes the `tools` array and invalidates the provider's prompt cache from that point. Tool descriptions are long (several are 500+ characters).
Fix: tighten descriptions, keep the tool list stable inside a run (decide groups at the first step from the request; later additions go through one generic `call_tool` or code mode, section 3.5).

### B15. Past team runs are gone — Confirmed
`electron/teams.js:518`: `t.run = { ...freshRun() }` on every start. Only a text `notebook` survives. Live text per member is clipped to 1500 characters and task logs to 80 entries.
Fix: section 3.7.

### B16. Artifacts live inside the chat JSON — Confirmed
`App.jsx:1081` keeps up to 12 **full** copies of each artifact in the chat; `create_artifact` (`tools.js:1221`) needs the whole content again for any change. Result: large chats, expensive edits, artifacts that are not files (no Files entry, no "open in sheet editor", nothing for the next chat to read).
Fix: section 3.1.

### B17. Tool-call loops — Not reproduced
Guards exist: the same call more than 3 times stops the run (`agent.js:1235`), plus failure streaks. Likely triggers worth testing: (a) `trimOldTools` replaces old output with a stub and the model reads the file again; (b) the 40k in-run summary (B12) drops results mid-task and the model redoes the work; (c) near-identical calls with different arguments are not caught. Do not guess a fix: build the trajectory view (3.7) first, capture one looping run, then fix what it shows. B12's fix removes (b).

## 2. Design decisions (make these once)

1. **Everything the assistant makes is a file.** Artifacts, sheets, docs, boards, generated media: real files in the project folder or `<Files>`, shown through one viewer. The chat stores references, never content.
2. **One event pipeline for live edits.** The agent edits through operations (`sheet_edit`, `doc_edit`, `board_edit`); main applies them to the file and emits `file:op`; an open editor animates them, a closed one just sees the file change. This is what gives the Claude-style cursor.
3. **Token decisions use real usage.** Estimates only when a provider returns none.
4. **CLI agents are first-class models**, not a side path: streaming, cost, questions, files, compaction all work the same.
5. **Plugins run isolated.** Model-written code never runs in the main process or the app document.
6. **No new framework.** Stay on React 18 + plain JS. Add libraries only where listed.

## 3. Workstreams

### 3.1 Files, outputs and artifacts (foundation for 3.3 to 3.5)
- Tool `present_files({ paths, note? })`: validates paths with `resolveSafe`/Files root, emits `{ type: 'files', items: [{ path, name, kind, size }] }`. Renderer stores `step.files` and renders `FileCard` (icon, name, "Table · CSV" style subtitle, click opens the viewer, hover shows Save as / Show in folder; draggable). System prompt: "after creating or changing a file the user asked for, call present_files; never paste a path as the answer". Expose it on the CLI bridge too, and auto-present for CLI `Write`/`file_change` steps.
- Auto-present: a successful `write_file`, `write_spreadsheet`, `generate_*` adds the card itself; the tool card buttons at `ToolCard.jsx:371` go away.
- Artifacts become files: `create_artifact` writes `<root>/artifacts/<slug>.<ext>` and returns the path; add `edit_artifact` (same contract as `edit_file`) so a change costs a diff, not a rewrite. Versions: keep the last N copies in `<userData>/versions/<hash>/` with timestamps, not in the chat. Migrate existing `chat.artifacts` on load.
- Viewer (replaces `FilePanel` + `ArtifactPanel`): one component with a type registry (image → Lightbox, csv/xlsx → Sheet, md/docx → Doc, excalidraw → Board, html/svg → sandboxed frame, pdf, code, video/audio). Header like Claude: Preview/Code toggle, title, version picker, Copy, Download, expand, close.
- `files:watch` in main (`fs.watch` on the open file's folder, debounced, compares mtime+size) → `file:changed` → the viewer reloads unless the user has unsaved edits (then it shows "Changed on disk: reload / keep mine").
- Media in the right folder (B4), Lightbox (B6), Save as + drag-out (B7), link resolver (B3).
Done when: asking any model (API or `cli:claude`) for "a CSV with test data" shows a file card in the answer, one click opens it in the grid, Download saves it elsewhere, and the file is in the project/Files folder.

### 3.2 Context and cost engine
- `contextOf(model)`: provider-reported window when the models endpoint gives one, a user override per model, then the regex guess. One implementation shared by main and renderer (`src/lib/*.mjs` imported by both).
- Track `lastPromptTokens` per chat from real usage (per step, not summed). Context meter in the composer uses it.
- One compaction rule in main: when `lastPromptTokens + reserve > window * compactAt`, summarize. Remove the fixed 40k `runLimit`; keep `contextTokens` as an optional user cap. Remove the renderer's own trigger; the renderer only shows state.
- Persist every compaction as the chat's compact marker (the mechanism 1.7.20 added) so UI and model always agree, including in-run compactions.
- Before summarizing, clear old tool results first (`trimOldTools` already does a version of this); summarize only when that is not enough. After summarizing, re-attach: task note, the list of files touched with paths, the last 2 file reads if small, open artifact paths.
- Summary budget scales with the window (not a fixed 1500 tokens); the prompt keeps the existing sections and adds "files created/changed" and "user corrections".
- Caching: mark cache breakpoints for every Claude model regardless of id prefix (detect by provider type or a probe that falls back, as the code already does on rejection); keep system + tools byte-stable within a run.
- Cost: built-in price table (JSON in `electron/`, user prices override), use provider-reported cost when present (`usage.cost`, Claude Code `total_cost_usd`), record `cacheWrite` for CLI, show estimated numbers with a "~". Subscription CLI runs show tokens and "included in plan" instead of $0.
- Tests: extend `scripts/test-compact.js` (trigger from real usage, persistence, re-attachment) and `scripts/test-amount.js`/a new `test-cost.js`.
Done when: the meter matches the provider's `prompt_tokens` within a few percent, a 100-step run on a 200k model compacts near the limit instead of at 40k, and Usage totals match the provider dashboard for a test day.

### 3.3 Sheets
Keep `SheetEditor.jsx` and `formula.mjs` (virtualized grid, undo, formulas already exist); a library swap would cost more than it gives. Work:
- One grid for preview and edit (drop `DataTable`). Column letters, row numbers, frozen header row, sticky first column, right-aligned numbers, column resize/auto-fit, selection stats, fill handle, copy/paste with Excel/Sheets.
- Column types: text, number, currency, percent, date, checkbox, select (coloured chips). Inferred for CSV; editable in a column menu.
- Formatting must survive save. The bundled SheetJS community build does not write styles or data validation. Choose one: (a) add ExcelJS for the `.xlsx` write path, or (b) a native `*.sheet.json` (cells, types, formats, frozen rows) as the working format with export to xlsx/csv. Recommended: (b) for sheets Artemis creates, plus a view-state sidecar for plain csv/xlsx so they open the same way.
- Agent tools: `sheet_read(range)`, `sheet_edit(ops)` where ops are `set`, `format`, `insert_rows`, `delete_rows`, `add_sheet`, `set_column_type`, `freeze`. Ops go through the 3.1 pipeline; the open grid plays them cell by cell with a labelled cursor and a Stop button. `write_spreadsheet`/`update_cells` stay as thin wrappers.
- "Ask about selection": the selected range is sent as context with the next message.
Done when: the two Claude screenshots (CSV preview, Sheets with dropdown chips and `$` format) can be matched side by side, and an edit request changes the open sheet live.

### 3.4 Docs
- Editor: TipTap (MIT, ProseMirror) with Markdown as the stored format (`.md` in the project/Files folder), so every doc stays readable by any tool and by the model.
- Blocks: headings, lists, tasks, tables, code, images, callouts, date and mention chips, outline sidebar, slash menu, bubble toolbar.
- Agent tools: `doc_create(title, outline)`, `doc_edit(ops)` with `replace_section(heading)`, `insert_after(anchor)`, `replace_text(old, new)`. Creation writes the title and placeholder sections first, then fills them one by one, streamed into the open editor with the cursor label (same pipeline as sheets).
- Export: docx (the repo already has mammoth for reading; add a writer), PDF via `webContents.printToPDF`.

### 3.5 Whiteboard, MCP code mode
- Whiteboard: Excalidraw (MIT) in the viewer, `.excalidraw` files, tool `board_edit(ops)` (add/update/delete elements, auto-layout for flowcharts). Avoid tldraw (licence key required).
- MCP code mode (Settings → Connectors → "Code mode"): the model gets two tools instead of every connector schema: `mcp_search(query, detail)` and `mcp_run(code)`. `mcp_run` executes JavaScript in an Electron `utilityProcess` with no `require`, no network, CPU/time/memory limits, and a `servers.<slug>.<tool>(args)` proxy that calls back into main, so the existing per-connector approvals still apply. Only what the code logs returns to the model. Type stubs are generated from the MCP schemas and served by `mcp_search`. Note `node:vm` alone is not a security boundary; the process boundary plus an empty global scope is the minimum.
Done when: a task across two connectors with 100+ tools runs with under 3k tokens of tool schema.

### 3.6 Plugins the assistant can write (DeepSeek Harness idea, Artemis shape)
What Harness does: every capability is a hot-reloadable Cordis plugin; a "creator mode" loads a plugin-development skill, writes files, installs with a `plugin_manager` tool and verifies live; UI plugins render React inside the app document. Artemis should take the workflow, not the runtime:
- A plugin is a folder `<userData>/plugins/<id>/` (or `<project>/.artemis/plugins/`) with `plugin.json`: `tools` (JSON schema + entry file), `panels` (HTML entry + where it docks: side panel, floating, status bar), `commands` (slash commands), `skills`, `mcpServers`, `permissions` (fs roots, network hosts, shell). The same folder layout as a Claude Code plugin (`commands/`, `skills/`, `agents/`, `.mcp.json`) is accepted so those can be imported.
- Tools run in a `utilityProcess` per plugin with a small RPC API (`artemis.fs` scoped to declared roots, `artemis.fetch` to declared hosts, `artemis.notify`, `artemis.storage`). Panels run in the existing sandboxed `artifact://` frame with the bridge from `useArtifactBridge`. Nothing a plugin ships runs in main or in the app document.
- `plugin_manager` tool (list, scaffold, install, enable, disable, reload, logs) + a bundled `plugin-development` skill + file-watch reload. First enable of a plugin shows its permissions and asks once.
- Acceptance demo: "make me a floating Pomodoro timer" produces a working panel without restarting the app.

### 3.7 Agents: CLI parity, history, trajectory
- Claude Code: `--include-partial-messages` streaming; map `total_cost_usd`/`modelUsage`; MCP timeouts (B10); `present_files` and the edit-op tools on the bridge; consider one long-lived process per chat with `--input-format stream-json` to avoid a cold start per turn. Codex: the same list against its JSON events.
- There is no supported API to drive the Claude Desktop or ChatGPT desktop apps themselves. The supported route to a user's plan is the two CLIs, which Artemis already uses; say so in the UI ("Runs on your Claude plan through Claude Code").
- Sessions as an append-only event log in SQLite (`core/sessions.js` already has `seq`): `turn`, `step`, `tool_call`, `tool_result`, `usage`, `compact`. The chat array becomes a projection. This is also what makes re-attach after a window reload trivial.
- Team runs: table `team_runs` (id, team, started, ended, status, spend, summary) + `team_events`. The Agents page gets a run list per team; a past run opens read-only with every member's full transcript.
- Trajectory view (from Harness): per turn, the timeline of model calls with tokens, cache hits, tool inputs/outputs and timing. Needed to debug B17 and to show users where money went.

### 3.8 UI pass
- Icons: one set, Lucide (ISC), replacing the hand-drawn paths in `Icons.jsx` behind the same `<Icon name>` API. 1.5 px stroke, 16/20 px sizes only.
- Chat: file cards, quiet tool rows (one line, expandable), no button rows under tool calls, consistent 720 px reading column.
- Viewer header and split behaviour copied from the Claude screenshots: chat stays visible left, viewer right, expand to full.
- `App.jsx` (2180 lines) is the main source of navigation bugs. Do not rewrite it; extract as you touch: `useTabs` (pure reducer in `tabs.mjs`, already half there), `useChats`, `useRuns`, `usePanel`. Each extraction ships with tests for its reducer.

## 4. Order of work

| Phase | Content | Why here |
| - | - | - |
| 0 | B1, B1b, B2, B3, B6, B10, B11 (streaming flag, stall time), B13 (cache prefix rule, CLI cost) | Small, independent, each removes a daily annoyance. One PR per bug with a test. |
| 1 | 3.1 files/outputs/viewer, B4, B7, B8, B16 | Everything after depends on it. |
| 2 | 3.2 context + cost | Cuts spend before features add more tool traffic. |
| 3 | 3.3 sheets | Highest-value editor; proves the live-op pipeline. |
| 4 | 3.7 CLI parity, event log, team history, trajectory | Needs phase 1 tools; unlocks B17. |
| 5 | 3.4 docs | Reuses the phase 3 pipeline. |
| 6 | 3.5 code mode, then whiteboard | Independent. |
| 7 | 3.6 plugins | Largest surface; needs the isolation pieces from code mode. |
| 8 | 3.8 UI pass | Runs alongside from phase 1; finish here. |

## 5. Rules for whoever implements

- One finding or feature slice per PR, with a test in `scripts/` added to the `test` chain. Reproduce a **Likely** bug before fixing it and say in the PR how.
- Headless parity: anything added to `runAgent` options in `main.js` is added in `core/headless.js` and `core/teamrun.js` too, or the gateway, Telegram and teams silently lose it.
- New tools need all four places (`definitions`, `runTool`, `summarize`, a `buildSystem` hint) and an approval category.
- All paths through `resolveSafe`. Plugin and code-mode code never gets Node built-ins.
- UI strings in English; use the CSS tokens in `01-base.css`, no hex colours.
- Do not run `pnpm install` from a Linux shell in this folder.

## 6. Open questions for Ulvi

1. Sheets storage: native `*.sheet.json` with export (recommended) or ExcelJS and stay xlsx-only?
2. Should artifacts for chats without a project go to `<Files>/Artifacts/` (recommended) or a per-chat folder?
3. Compaction default: near the window limit (cheaper with caching, better memory) or an earlier cap for models without caching? Suggested: limit-based, with the cap as a per-model setting.
4. Plugins: is importing Claude Code plugin folders a goal for v1, or only Artemis-native ones?

## 7. How DeepSeek Harness solved the same problems (source read)

Source: `deepseek-ai/deepseek-harness` cloned at `e8f7b93a` (2026-11-11), MIT licence. Each package ships a README with a "Model Experience" section (what the model sees, token effect, KV-cache effect); that habit alone is worth copying. Paths below are inside that repo. Where this section and sections 3.2, 3.5 or 3.6 disagree, this section wins.

### 7.1 Compaction (`packages/compaction/*`, `packages/llm/token-meter`)

| Topic | Harness | Artemis today | Change |
| - | - | - | - |
| When | `trigger = floor(min(W × 0.8, W − O − 65536))`; W = window, O = request output cap. Per-model overrides (`modelPolicies`). | Fixed 40k in the run, 80% of a guessed window in the renderer (B12). | Use the Harness formula, one place, per-model override in Settings → Providers. |
| Measuring | `token-meter`: last provider-reported `prompt_tokens` for an identical request envelope, plus a chars/4 estimate only for what was appended since. Fully estimated only when tools/model/config changed. | chars/4 for everything. | Port this anchor + delta rule (`agent.js` keeps `lastUsage` + the message count it covered). |
| What is kept | Newest `16% × (W − O)` tokens kept verbatim; older span replaced by ONE user message. Cuts never split an assistant tool call from its result (`toolPairingBalancedBefore/After`). | Keeps "since the last user message" or the last 6 messages. | Token-based retention + tool-pair-safe cut. |
| Summary call | Replays the conversation's own system prompt, tools and messages, then adds the compaction instruction as the **last user message**, so the provider's prompt cache is hit and the summary is cheap. Output cap = headroom (64k), not 1.5k. A summary cut off by `max_tokens` is an error, not a checkpoint. | Separate system prompt + whole transcript as text (cache miss, full price), 1500 output tokens. | Same replay trick; raise the cap; fail on truncation. |
| Summary format | 8 fixed sections: Primary Request, Key Technical Concepts, Files and Code, Errors and Fixes, Pending Jobs, Current Work, Next Step, Critical Context. Wrapped in `<compacted-summary>` with a preamble telling the model to continue without acknowledging it. Re-compaction merges the prior summary instead of nesting it. | 6 sections, no merge rule. | Use their instruction text (`compaction-basic/src/summarizer.ts`, MIT, credit in `THIRD_PARTY_NOTICES.md`). |
| Before summarizing | `tool-result-pruner`: any tool result over 8192 chars becomes first 4096 + `[... tool result middle pruned ...]` + last 1024. Runs only when pressure is confirmed, so cache prefixes are not disturbed early. Often removes the need for a summary. | `trimOldTools` runs on **every** step (cache churn) and keeps only the first 1000 chars. | Run pruning only under pressure; keep head + tail. |
| Overflow error | A real `context window exceeded` error triggers compaction and a retry of the same step. Images over a route's budget are swapped for text with the file path (`compaction-image-offload`), choice remembered. | Partial (`ctxRetried`). | Port both. |
| Model switch | Switching to a model with a smaller window compacts first, using the old model; failure blocks the switch with a clear message. | Not handled. | Port. |
| Durability | Compaction is written to the session log (start / summary / end events). The UI and the model always agree; replay is deterministic; nothing is recomputed after restart. | In-run summary is in memory only (B12). | Persist as the chat's compact marker. |
| Manual | `/compact` command only; no model-facing compaction tool (they decided against it). | `compact_chat` tool + button. | Keep the button, drop the tool (the model compacting itself mid-task was a cost source). |

### 7.2 Big tool outputs (`packages/spill/*`)
Harness: a tool result over `maxInlineTokens` (12,500 suggested) is saved whole to a file; the model gets the head and tail plus `Full result stored at: <path>. Use read with offset/limit, or grep this path.` Artemis `clip()` cuts at 60,000 chars and the rest is lost, so the model re-runs the command. Change: spill to `<userData>/spill/<chat>/<call>.txt`, 12.5k-token preview, path in the notice. Applies to `run_command`, `web_fetch`, MCP results, browser text.

### 7.3 Tool calling and token use
- **Code mode = PTC** (`packages/core/tool-executor-ptc`, `packages/ptc-runtime/*`). Only one tool, `run_code`, is sent; every other tool becomes `await tools.name(args)` inside an async TypeScript body. A generated SDK block (typed declarations) replaces the JSON schemas. Only what the program passes to `inspect(...)` returns to the model. Read-only calls may run in parallel under `Promise.all`; writing calls run one at a time; normal approvals still apply to every nested call. Runs in a fresh Node process per call with a 120 s default / 600 s max deadline, 512 MB heap, output cap, and a call allowance (1024 per minute of timeout) that kills runaway loops. Selected per agent preset, so native and code-mode agents coexist.
  For Artemis: implement section 3.5 this way, not with `node:vm`. Run the program in an Electron `utilityProcess` (or `child_process.fork` with `--max-old-space-size`), bridge `tools.*` calls back over IPC into the existing `tools.run()` so `resolveSafe`, approvals and MCP permissions are reused. Settings → Advanced → "Code mode" (off / connectors only / all tools). Start with "connectors only": built-in tools stay native, every MCP tool goes behind `run_code`.
- **Cache stability is a design rule there.** Every package documents its KV-cache effect. Their rule: system prompt, tool list and message prefix stay byte-identical within a session; anything that changes per step goes after the last cache point. Artemis breaks this with lazy tool groups switching on mid-run (B14) and with per-step `trimOldTools`. Fix: decide tools at turn start; mid-turn needs go through code mode or a generic call tool.
- **Tool descriptions** (`preset/agent-preset/skills/dsh-doc/references/tool-design.md`): say each fact once, put parameter rules on the parameter, delete constraints the model learns from results, "measure the change: compare first-turn prompt tokens before and after". Apply to `electron/tools.js` (90 tools, ~13.7k tokens) and add a test that prints first-turn prompt size so regressions are visible.
- **Loops** (`packages/guard/repeat-tool-reminder`): identical repeated calls get an advisory reminder at 3, 5 and 8 repeats ("look at the previous result, change approach or finish"); never a hard stop; counter resets on a new user message. Artemis hard-stops the run at 4 (`agent.js:1235`). Switch to reminders; keep a hard stop only far higher (for example 12).

### 7.4 Files, deliverables, previews (B3 to B8)
- `present` tool (`packages/deliverables/tool-present`): declares existing files (any path, including ones made by shell) as deliverables, at most 4 per call, path + optional description; nothing is copied. Called once files are final.
- System prompt text (`deliverables/deliverable-file-references/src/index.ts`): show results inline; use `![alt](<path>)` for images and `[name](<path>)` for files, with angle brackets for spaces; link every mention of an existing file; do not call `present` just to list edited source files. Adopt this text and make Artemis's Markdown renderer resolve those links (B3).
- `workspace-changes`: per turn, a "changed files" card with line counts, from git snapshots taken into a private index (the user's repo, index and refs untouched), plus whole-file copies before the first edit for files git does not cover. Each file opens a before/after diff. Artemis has nothing like it; add after `present`.
- Previews (`client/ui-sidebar-documentpreview`): right sidebar with a renderer registry: Markdown/code paged, PDF/HTML/images/spreadsheets full bytes, Word/PowerPoint converted to PDF locally (`document/office-kit`: native LibreOffice when present, WASM otherwise), auto or manual reload when the file changes. `client/ui-file-actions`: Download/Save original bytes, Copy image as PNG, reveal saved file. `client/ui-open-in-app`: "Open in" lists installed apps with icons.
- Attachments (`attachment/attachment-local`): stored once by content hash, bytes verified on read, images normalized per model route. Artemis's `mediastore.js` already does the hash part.

### 7.5 Scroll (B2), from `client/ui-chat/src/client/chat/use-scroll-follow.ts` and the ui-chat README
- Follow intent changes only when **the reader moved**: the code compares the current `scrollTop` with the last sampled one. Content growth never counts as reader movement, so it can neither pin nor unpin.
- Small reader movements stay "pending" until a 500 ms sample or `scrollend`, so layout growth cannot erase a small gesture.
- Browser scroll anchoring is **disabled only while following the tail** and enabled while reading above.
- While pinned, a `ResizeObserver` follows the new floor; while not pinned, height changes keep the top position.
- Sending a message always restores following.
- Wheel, touchstart, pointerdown and scroll keys interrupt a smooth follow animation; actual movement after that decides.
- The transcript stays fully mounted (no `content-visibility` guessing); history pages load with a semantic anchor (`data-chat-anchor-key`) restored after prepend.
Replace `src/lib/stick.js` with a port of `ScrollFollow` (about 180 lines, MIT) and remove `content-visibility` from `.messages > .msg`.

### 7.6 Long tasks and questions (B10, B11)
- Background commands (`jobs/*`, `shell/tool-bash`): every command is a job from its start. `run_in_background` returns an id at once; a foreground command that passes its timeout **becomes** a background job with the same id instead of being killed. `job_output` (can wait), `job_list`, `job_kill`. When a job finishes, the agent gets a notice with short output: next step if busy, a new turn if idle. Replace Artemis's 300 s kill (`shell.js:112`).
- Questions (`interaction/tool-ask-user`, `user-questions`): blocking by default (no timeout). Optional timed mode: after the deadline the model continues independent work while the question stays answerable; an answer that arrives later is queued for the agent. A timeout is never treated as approval. Artemis's problem is the CLI transport (B10), so the MCP streaming fix stays; add timed mode later.
- Retries (`llm/llm-retry`): retry policy per provider (bounded or unlimited), each retry written to the log before the backoff, the failed step re-run in the same turn. Show "Retrying (2/5) in 8 s" in the chat.
- Tool timeouts (`guard/timeout-policy`): each tool declares its own limit; on timeout the model gets a clear error after cancellation settles.
- Claude Code / Codex (`subagent/subagent-claude-code`, `subagent-codex`): Harness runs them **unattended**, one self-contained task each, and returns only the final answer; no questions are routed back. For Artemis, where the CLI is the chat model, keep interactive mode but apply B10.

### 7.7 Plugins the agent writes itself ("Creator mode")
How it works there:
1. A Creator agent preset has `plugin_manager` (list/enable/disable/install/remove bundles; every action needs approval), read-only runtime inspection tools (`cordis_inspect_list`, `cordis_inspect_query`: live services, events, tools, UI slots, theme tokens), and the `dsh-doc` skill.
2. The skill (`preset/agent-preset/skills/dsh-doc/`) is short; detail lives in `references/*.md` read on demand (plugin development, UI plugins, MCP bundles, tool design, verification, artwork) plus copyable `templates/` (a UI decoration and an MCP bundle).
3. Flow (`references/plugin-development.md`): resolve where the result appears → inspect only the APIs needed → copy a template into the workspace → fill manifest, localized title/description, icon → syntax-check → `install_bundle` with the absolute directory → hot reload applies it → exercise the feature on the real page → run a UI/UX review through a sub-agent → fix → report what stayed unverified. No mock previews.
4. UI plugins are React components registered into named slots (`ctx.slots.register({ name: 'conversation.composer.dock', id, order }, Component)`), styled only with theme tokens. Installs go through pnpm, with build-script approval, version-compatibility checks and rollback of `package.json`/lockfile on failure. A Plugins page has Installed and Discover tabs (plugin indexes).
5. Their honest limit: installed host code runs in-process outside the sandbox (`boot/plugin-manager` README). No signing or registry trust yet.

What Artemis takes (replaces section 3.6 details, keeps its isolation rule):
- Same workflow, smaller surface: `plugin_manager` tool (`list`, `scaffold`, `install`, `enable`, `disable`, `reload`, `logs`, `remove`), a bundled `artemis-plugins` skill with `references/` and two templates (`panel` and `tool`), and an `inspect_app` tool that lists available slots, theme tokens, IPC-safe APIs and current plugins.
- Plugin = folder with `plugin.json` (`id`, `name`, `description`, `icon`, `tools[]`, `panels[]`, `slots[]`, `commands[]`, `skills/`, `mcp`, `permissions`). Installing = copying into `<userData>/plugins/<id>/` + enabling; reload is a file watch, so no restart.
- Safer than Harness on purpose: tools run in a `utilityProcess` per plugin with only the declared permissions; UI runs in a sandboxed frame mounted into a named slot (`sidebar.panel`, `composer.dock`, `chat.message.after`, `statusbar`, `floating`) with theme tokens passed in as CSS variables. First enable shows the permissions.
- Slots must exist first: name the extension points in `App.jsx` while extracting components (3.8), otherwise UI plugins have nowhere to mount.
- Acceptance demo stays the same: "make me a floating Pomodoro timer" → working, without restart, verified by the agent with a screenshot of the real window.

### 7.8 Agents, teams, trajectory
- Sessions are an append-only event log (`session/*`); the chat view, token usage and compaction state are projections of it. Forks and resumes are derived from it. This is the shape 3.7 asks for.
- Teams (`team/agent-team`): a durable shared task board with compare-and-set ownership on top of the normal sub-agent tree; members message each other with the ordinary sub-agent tools. Runs persist because they are sessions.
- Trajectory tab (`client/ui-trajectory`): turn-aware ledger of User/Assistant/Tool/Subtool/compaction records with tokens, cache hits, duration, inputs and outputs; virtualized; follows the tail while streaming. Build this before chasing B17.
- Composer stats (`client/ui-chat`): turn/step counts, output speed, LLM vs tool time, time to first token, token total and cache-hit rate in a small dock under the composer. This is the honest "how much did this cost" display B13 needs.

### 7.9 What not to copy
- Cordis and the profile/bundle/pnpm machinery: too large for Artemis's plain-JS codebase; plain folders + `plugin.json` cover the use case.
- In-process host plugins: keep Artemis's isolation rule.
- The amount of configuration surface: Harness exposes most numbers; Artemis should expose only the per-model compaction override and the code-mode switch.

### 7.10 Order of work, revised
Phase 0 adds: B2 via the `ScrollFollow` port (7.5), repeat reminders (7.3), spill (7.2).
Phase 2 (context and cost) is now: token meter (anchor + delta) → pruner-under-pressure → cache-replay summary with the 8-section format → persisted compaction → overflow and model-switch recovery → composer stats dock.
Phase 1 adds the `present` tool text and link rules from 7.4; `workspace-changes` follows in phase 4.
Phase 6 code mode follows 7.3 exactly.
Phase 7 plugins follow 7.7.

## 8. Every format: view, edit, agent, export

Today: PDF, DOCX and PPTX open as extracted plain text (`src/lib/langs.js:35` maps them to `text`); CSV/XLSX show a plain table; there is no whiteboard. One viewer (3.1) hosts every row below; every row reloads when the file changes on disk and has Download / Save as / Open in / Copy.

| Format | View | Edit by the user | What the agent can do | Export |
| - | - | - | - | - |
| CSV / TSV | Sheet grid (3.3): column letters, row numbers, frozen header, types inferred, number alignment, search | Same grid, typed cells, undo | `sheet_read`, `sheet_edit` ops, played live with a labelled cursor | CSV, XLSX |
| XLSX / XLS / ODS | Same grid, sheet tabs, formulas evaluated (`formula.mjs`), formats and dropdown chips | Same grid | Same tools; `sheet_recalc` | XLSX (ExcelJS for styles), CSV per sheet, PDF |
| Artemis Sheet (`.sheet.json`) | Same grid, full formatting | Same grid | Same tools | XLSX, CSV, PDF |
| Markdown / Artemis Doc (`.md`) | Doc editor (3.4, TipTap): headings, tables, tasks, images, outline | Inline, slash menu, bubble toolbar | `doc_create` (outline first, sections filled live), `doc_edit` ops | DOCX, PDF, MD |
| DOCX | Rendered page view: `mammoth` to HTML (already a dependency) in a sandboxed frame; LibreOffice → PDF when installed for exact layout | "Edit as Doc": convert to `.md` copy, save back to DOCX on export | Read text with structure; edits go through the `.md` copy | DOCX, PDF |
| PDF | pdf.js (`pdfjs-dist`): page thumbnails, continuous pages, zoom (fit width / fit page / %), text selection, search, page jump | Not editable; "Ask about selection" | `pdf_read(pages)`, `pdf_render(page)` to an image for layout questions; scanned PDFs: render and let a vision model read | Save as, print |
| PPTX | Slides as images: LibreOffice → PDF → pdf.js when installed; otherwise a slide list with titles and text | Not editable in v1 | Read slide text; render a slide to an image | PDF |
| Images | Lightbox (B6): fit / 100%, wheel and pinch zoom, pan, arrows between images, copy as PNG | Not editable | Already readable by vision models | Save as, copy |
| Video / audio | Native player with scrubbing | No | — | Save as |
| HTML / SVG artifacts | Sandboxed frame (existing `artifact://`), Preview / Code toggle, versions | Code view | `create_artifact` / `edit_artifact` as files | HTML, PNG snapshot |
| Code / text | Highlighted, line numbers, wrap toggle, find | Text editor | `edit_file` | Save as |
| Whiteboard (`.excalidraw`) | Excalidraw (MIT) canvas | Full drawing, sticky notes, arrows, frames | `board_create`, `board_edit` ops (add / move / connect / delete elements, `layout: flow / grid / tree`), streamed live like sheets | PNG, SVG, PDF |
| Mermaid in an answer | Rendered inline; "Open as whiteboard" converts it (Excalidraw ships a Mermaid importer) | On the board | Writes Mermaid; user promotes it | via board |

Notes for the implementer:
- Conversion order for DOCX/PPTX: LibreOffice if `soffice` is found (check the usual macOS path `/Applications/LibreOffice.app/Contents/MacOS/soffice` and `PATH`), else the fallback in the table. Never ask the user to install anything to see a file. Cache conversions by file hash in `<userData>/previews/`.
- pdf.js runs its worker from the app bundle; no CDN.
- The Lightbox, PDF view and whiteboard all reuse one zoom/pan helper.
- Agent edit ops for sheets, docs and boards share one pipeline (`file:op` events, section 2 decision 2), so "live cursor" is built once.
- Order: images + PDF in phase 1 (viewer), sheets phase 3, docs + DOCX phase 5, whiteboard phase 6 (with code mode), PPTX last.

## 9. UI spec: match Claude's CSV, Sheets and Docs views

Reference: Ulvi's screenshots of Claude Desktop (CSV preview, Claude Sheets empty / filled / with chips, Claude Docs while writing and filled). Sizes are CSS px measured from 2x screenshots (±1 px). Use Artemis tokens (`01-base.css`) for colour; the accent replaces Claude's terracotta. "Done" for each view means a side-by-side screenshot at the same window size where layout, spacing and controls match.

### 9.1 Shared panel frame (all three)
- Split: chat on the left keeps its own width (~430 px min); the panel takes the rest, separated by one hairline. Expand makes the panel full-width; the chat stays one click away.
- Header 45 px, one hairline below, no background change. Left: title (15 px, `--text`) + chevron; the chevron menu holds Rename, Version history, Download as…, Open in…, Show in folder, Delete. Right, 32 px icon buttons: primary action (Sheets/Docs: **Export**, label + icon; CSV: **Copy** split button), Expand, Close.
- No toolbar rows unless the format needs one. No borders around the body.

### 9.2 Chat file card (what appears in the answer)
- Card 63 px tall, full message width up to 520 px, radius 12, background `--fill` (very light), no border. Icon tile 32 px, radius 8, tinted by type: sheet/CSV green, doc blue, board violet, PDF red, image neutral. Two lines: name (15 px, `--text`) and subtitle (13 px, `--muted`): "Table · CSV", "Artemis Sheets · Only you", "Artemis Docs · Only you", "PDF · 12 pages".
- Above the card, one muted line summarizing the tools: "Created a file, shared a file ›" (expands to the tool list). While working: animated dots + "Using Sheets: Update content 19s ›".
- Click opens the panel; the card for the open file gets a subtle active state.

### 9.3 CSV preview (read view)
- Header: segmented Preview/Code toggle (eye / code icons, 28 px, left of title), title "Test data · CSV" (extension in `--muted`), Copy split button (Copy / Download / Save as… / Open in… / Open as Sheet).
- Table: no vertical grid lines, horizontal hairlines only. Header row 32 px, 13 px `--muted`, not bold, sticky. Body rows 44 px, 15 px `--text`, first column (row index or id) `--muted`. Cell padding 0 16 px. Columns auto-size to content up to 320 px, ellipsis beyond, horizontal scroll for the rest. Numbers right-aligned.
- No search bar, no counts, no "first row is header" checkbox in this view (move those to the Code view / a menu). Fast for 100k rows (virtualized rows).
- "Open as Sheet" converts to the sheet editor without leaving the panel.

### 9.4 Sheets (editor)
- Formula bar 36 px: `ƒx` glyph, cell value or formula (placeholder: "Type a value, = for a formula, or @ to insert a date or dropdown"), right side zoom (`100% ▾`) and version history icon.
- Column headers 29 px, letters centered, 13 px `--muted`, background `--fill`. Row numbers 44 px wide, centered, `--muted`. The active row number and column letter get the accent-tinted background.
- Cells: row height 28 px, 14 px text, thin grid lines (`--line`), padding 0 8 px. Selected cell: 2 px accent border + fill handle square at bottom-right. Frozen header row shown with a slightly heavier bottom line.
- Typed columns: currency right-aligned (`$49.00`), dates tabular, select columns render as **chips**: height 22 px, radius 6, full cell width minus 6 px, label left, small chevron right, soft colour per option (blue, grey, violet, green, red, amber; 8 colours max, assigned in order, editable). Empty rows of a select column still show a faint chevron.
- Floating format bar, centred near the bottom of the grid, 40 px tall, radius 12, `--menu-shadow`: Bold, Italic, Underline ▾ | 123 (number format) ▾ | ⋯ | comment | **Ask Artemis** (sends the selected range as context). Shown while cells are selected.
- First-run hint over the grid: accent pill "Select any cells to ask Artemis about them." with a pointer, shown once.
- Bottom bar 35 px: `+` (add sheet), sheet list menu, then sheet tabs; active tab is a filled pill with the name bold and a chevron (rename, duplicate, delete, colour).
- Live edits by the agent: cells fill in order with a short highlight; a small accent label "Artemis" follows the cell being written; Stop button in the chat card.

### 9.5 Docs (editor)
- Top-left inside the body: outline button (34 px square, radius 10, hairline + soft shadow) toggles a heading outline. Top-right: mode pill "✎ Editing ▾" (Editing / Viewing / Suggesting later).
- Page: max text width 720 px, left padding ~52 px from the panel edge on narrow panels, centred on wide ones. Title: serif (`--font-serif`, New York), 36 px, weight 500, tight leading. Under it a meta row of chips 26 px: calendar icon + date, `@Name` of the author, separated by a dot.
- Body 17 px sans, line height 1.55, `--text`. H2 serif 28 px with 28 px top margin. Tables: header row tinted (`--fill-2`), cell padding 12 16, hairlines, radius 8 on the outer frame; drag handle `⋮⋮` appears on hover at the block's left, a pill handle above the table to add columns.
- Bottom floating toolbar (same component as the sheet bar): text style (Tт) | table | image | checklist | toggle/collapsible | ⋯ | comment | **Ask Artemis**.
- While the agent writes: the outline is created first; unfinished sections show as muted bracketed placeholders ("[Breakdown: customers and monthly revenue by plan and status]"); the section being written shows an accent tag "Artemis" above a 2 px caret, and text appears in place. Headings are written before their bodies.

### 9.6 What Artemis has today vs this spec
- Chat: tool buttons under each file tool call (`ToolCard.jsx:371`) → replace with 9.2 cards.
- CSV: `DataTable` with search bar and counts → 9.3.
- Sheets: `SheetEditor` (grid, formulas, undo exist) → restyle to 9.4, add typed columns and chips, floating bar, bottom tabs.
- Docs: none (Markdown preview / textarea) → build 9.5 on TipTap.
- Implementation order inside each phase: frame (9.1) → card (9.2) → view → live-agent animation.

## 10. Progress

Done (2026-11-11, all 68 test scripts pass, renderer bundles):
- B1 page tab taken for a chat (`tabs.mjs` `isChatTab` / `findChatTab`, 6 call sites), B1b CLI-only users sent to Settings.
- B2 scroll: `follow-model.mjs` + `stick.js` (Harness rules), `content-visibility` removed. Test: `test-stick.js`.
- B3 file links and local images in answers (`links.js`, `artemis-file://`, `file-links.js`, Markdown `a` / `img`). Test: `test-links.js`.
- B4 generated media saved to `<project>/generated` or `<Files>/Generated`, served from disk.
- B6 Lightbox for every image. Test: `test-zoom.js`.
- B7 Save as and drag-out (cards, viewer title, lightbox).
- B10 SSE + progress for tool calls from Claude Code / Codex, one-day tool timeout; B11 `--include-partial-messages` streaming, stall limit 5 min (10 min local).
- 7.3 repeat reminders at 3 / 5 / 8, stop at 12; Claude prompt caching under any provider id.
- 3.1 / 9.2 `present_files` + automatic file cards (`deliverables.js`, `FileCard.jsx`). Test: `test-deliverables.js`.
- 9.3 CSV / sheet read view with resizable columns and virtualized rows (`TableView.jsx`, `table-model.mjs`). Test: `test-table-model.js`.

Done after that (all 76 test scripts pass; the renderer bundles with the installed libraries):
- Phase 2 compaction and cost: `core/context.js` (threshold, pressure meter, 8-section cache-replay summary, spill of huge tool results), trim only under pressure, provider-reported cost (`usd`). The renderer's pre-send trigger uses the same formula (`src/lib/compact-threshold.mjs`). Tests: `test-context.js`, `test-compact.js`.
- 9.4 Sheets: Claude-style editor (`SheetEditor.jsx`, `sheet/*`), opens in edit mode, floating format bar with the ⋯ menu, resizable rows and columns, formats saved beside the file (`sheet-meta.js`). Tests: `test-sheet-format.js`, `test-sheet-ops.js`.
- Live edits: `file-watch.js` + `use-file-watch.js`; sheets, docs, boards and previews reload when the assistant rewrites the file. Test: `test-file-watch.js`.
- PDF (`PdfView.jsx`, pdf.js pages + text layer) and DOCX (`DocxView.jsx`, mammoth) as pages, themed.
- 9.5 Docs: `.md` files open as an editable Doc (`doc/DocEditor.jsx`, TipTap + tiptap-markdown): serif title, outline, Editing / Viewing, floating bar, tables, checklists, images, Ask Artemis, autosave. Test: `test-doc-outline.js`.
- Whiteboard: `.excalidraw` files open in Excalidraw (`board/BoardView.jsx`), follow the theme, autosave, reload on outside edits; fonts ship with the app (vite plugin). The prompt tells the model the file format. Test: `test-board-scene.js`.
- Code mode (Settings → Connectors → Code mode): `run_code` + `connector_tools` replace every connector schema; programs run in a child process under `--permission` and `--disallow-code-generation-from-strings`; each connector call goes through the normal approvals (`code-mode.js`, `code-runner-src.js`). Test: `test-code-mode.js`.
- Plugins (Settings → Plugins; sidebar → Plugins page, `PluginsView.jsx`): `plugin_manager` lets the assistant write, test, switch and remove plugins; plugin tools run in the code-mode sandbox with `web()` and connectors, panels open in the side panel (`plugins.js`, `ipc/plugins.js`, `PluginsView.jsx`). Test: `test-plugins.js`.

Still open: typed select columns with chips in sheets; Claude Code `total_cost_usd` (it is the API price even on a subscription, so it is not shown as spend yet); plugin panels in their own sidebar slot (today they open in the side panel).
