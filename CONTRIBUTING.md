# Contributing to Artemis

Thanks for helping. Artemis is a plain-JavaScript Electron + React app; there is no TypeScript and no linter. Please read the [Code of Conduct](CODE_OF_CONDUCT) first.

## Ways to help

- **Report a bug**: open an issue with your macOS/Windows/Linux version, the Artemis version (the `.dmg` name or `package.json`), the provider and model, the steps to reproduce, and what you expected. Logs are in `~/.artemis/logs`; remove anything private before you paste them.
- **Suggest a feature**: open an issue first for anything bigger than a small change, so we can agree on the shape before you write code.
- **Send a fix**: small, focused pull requests are easiest to review.
- **Security problems**: do not open a public issue. See [SECURITY.md](SECURITY).

## Setup

Requires Node.js 20+ and [pnpm](https://pnpm.io) (pnpm only: `pnpm-lock.yaml` is the one lockfile, do not add `package-lock.json`).

```
pnpm install
pnpm dev        # Vite + Electron with hot reload
pnpm test       # every scripts/test-*.js in sequence
```

Run one test with `node scripts/test-tools.js`. Tests are plain Node scripts using `assert`, and they run without Electron.

## Guidelines

- Everything in the repo is English: code, comments, UI text, tests and docs.
- Match the surrounding style: single quotes, semicolons, 2-space indent, comments only where the logic is not obvious.
- Tests are plain Node scripts in `scripts/`. A new `scripts/test-*.js` file must also be added to the `test` script in `package.json`.
- Modules in `electron/` take Electron objects by injection instead of requiring `electron` at the top level, so they can be tested without Electron.
- File tools must go through `resolveSafe` (see `electron/tools.js`). Never bypass it.
- A new IPC channel needs three edits: `ipcMain.handle` in `electron/main.js` or the matching `electron/ipc/<area>.js`, a method in `electron/preload.js`, and the caller in `src/`. While the app is locked, acting channels are blocked in `electron/lock.js`; decide whether yours should be.
- A new tool needs a schema in `definitions` and a `case` in `runTool` (`electron/tools.js`), a line in `summarize` (the approval card text), and a system-prompt hint in `buildSystem` if the model needs guidance. Decide which approval category it belongs to.
- Treat web pages, files and screenshots as untrusted input. Do not add anything that lets them trigger an action without approval.
- Keep user data safe: no new place that writes secrets in plain text, and no network request that is not tied to a feature the user turned on.
- Do not commit build output, local data or keys (`dist/`, `release/`, `.env`, `.artemis/`).

## Pull requests

1. Branch from `main`.
2. Keep the change small and describe what it does and why.
3. Run `pnpm test` (the CI also runs `pnpm build`). Say what you tested by hand, especially anything in the UI.
4. Update the README or `agents.md` when behavior or architecture changes.

You are welcome to use AI tools, but you are responsible for what you submit: read it, run it and be able to explain it.

See [`agents.md`](agents) for an architecture overview.

By contributing you agree that your work is released under the GNU Affero General Public License v3.0 (AGPL-3.0), the license of this project.
