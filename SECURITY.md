# Security

## Reporting a vulnerability

Please do not open a public issue for security problems. Use GitHub's private vulnerability reporting (the repository's Security tab, "Report a vulnerability") with a description, the affected version and steps to reproduce. We will reply as soon as we can and credit you in the fix if you want.

## Supported versions

Only the latest release receives security fixes.

## What to know

- Artemis can read and write files, run terminal commands and control the screen (macOS) when you allow it. Writes, deletes, the terminal and computer control ask for approval. The terminal blocklist is **not** a sandbox.
- File tools are confined to the project folder (`resolveSafe` blocks `..` and symlink escapes). Reading credentials, browser profiles and Artemis's own data folder asks every time.
- Web pages, files and screenshots are treated as untrusted input, but prompt injection is an open problem: review approval cards before accepting.
- API keys and tokens are encrypted with the OS keychain (Electron `safeStorage`). Where the OS has no encryption they are stored in plain text in the app data folder.
- The optional MCP server listens on 127.0.0.1 only, requires a bearer token and rejects requests that carry an `Origin` header.
- The app lock (password, recovery code, Touch ID) and voice recognition protect the Artemis window and its actions. They are not disk encryption, and a replayed or cloned voice can fool the speaker model; use Touch ID for sensitive approvals.
- Artemis contains no analytics or crash reporting. Its only update code asks GitHub for the latest release (Settings → General → Updates, can be turned off). Which features contact the internet is listed in the README under "Privacy, data and network access".
- Releases are unsigned.

## In scope

Bypassing an approval, the project-folder confinement or the app lock; leaking keys or tokens; the MCP server accepting requests it should refuse; an untrusted page, file or screenshot causing an action without approval.

## Out of scope

Anything that needs you to approve the action yourself; the terminal blocklist being incomplete (it is not a sandbox); attacks that need physical access to an unlocked computer or your OS account; vulnerabilities in a model provider or in a connector you added.
