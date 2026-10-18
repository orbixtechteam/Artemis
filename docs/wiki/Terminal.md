# Terminal

Artemis can run shell commands on your computer in two ways: `run_command` for one-off commands, and an integrated terminal you can watch and type into.

## How to use

1. Turn on Settings → Tools & safety → **Terminal commands**.
2. Ask for something that needs a command, for example "show the git log of this project".
3. The first command in a task shows an approval card with the command. **Allow for this task** lets Artemis run commands until the task ends.
4. Open the integrated terminal with the terminal button in the sidebar, Cmd/Ctrl+` or Cmd/Ctrl+J. You can also pick **Terminal** in the command palette (Cmd/Ctrl+K).

## The two command tools

| Tool | What it does |
| --- | --- |
| `run_command` | Runs a command in your login shell and returns the exit code, stdout and stderr. It starts in the project folder (or your home folder). Default timeout 60 seconds, maximum 300. |
| `terminal_run` | Types a command into the visible integrated terminal and returns what it printed. The session keeps its state (current folder, environment variables), so it suits dev servers, installs, ssh and REPLs. You can type in the same session. |
| `terminal_read` | Reads the latest lines of the integrated terminal, for example to check a running server. |

## Settings

| Setting | Where | What it does |
| --- | --- | --- |
| Terminal commands | Tools & safety → Tools | Turns `run_command` and the integrated terminal tools on. |
| Switch heavy tools on only when needed | Tools & safety → Saving tokens | The terminal tools are sent to the model only after it asks for them. |

## Tips

- Ask Artemis to use the integrated terminal for long-running work so you can watch it live.
- Reading the terminal has its own approval: Artemis can read the output for the task, but typing into it asks.
- The integrated terminal needs Python 3. On a Mac, run `xcode-select --install` or `brew install python` if it does not open.

## Limits and safety

- Commands are **not sandboxed**. A command can reach anything your user account can. Read the command on the card before you allow it.
- A small blocklist stops obvious mistakes: `sudo`/`doas`, formatting disks, writing to `/dev/` with `dd`, fork bombs, shutdown/reboot, piping a download into a shell or interpreter, and recursive deletes of `/`, `~` or top-level system and home folders.
- Sub-agents never get terminal tools. The integrated terminal tools (`terminal_run`, `terminal_read`) are not used in scheduled tasks or unattended phone tasks.
- The integrated terminal is available on macOS and Linux, not on Windows.

## See also

- [Tools and Approvals](Tools-and-Approvals.md)
- [Computer Control](Computer-Control.md)
- [MCP](MCP.md) (outside apps can run commands in the Artemis terminal)
