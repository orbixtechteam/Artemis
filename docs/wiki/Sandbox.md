# Sandbox for terminal commands

By default `run_command` runs in your real shell, and the only guard is the approval card plus a small blocklist. The sandbox makes commands run somewhere they cannot hurt this computer:

- **Docker container**: one container per project folder, created on first use and reused (installed packages stay). Only the project folder is visible, at `/workspace`. No extra Linux capabilities, `no-new-privileges`, memory, CPU and process limits, network on or off.
- **Another machine (SSH)**: commands run on a server you can reach with `ssh` (key login), in a folder there. Files of this computer are not available on that machine.
- **This computer, isolated**: no Docker needed. Commands run on this computer under the OS sandbox: `sandbox-exec` (Seatbelt, built into macOS) or `bwrap` (bubblewrap, Linux). They can read files, but write only to the project folder, temp folders, package caches (`~/.npm`, `~/.cache`, pnpm store…) and the extra folders you list. `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.kube`, `~/.docker`, `~/.config/gh`, `~/.config/gcloud` and the Keychains folder are hidden. Network on or off. Not available on Windows.

Set it in **Settings → Tools → Sandbox for terminal commands** (visible while "Terminal commands" is on). Press **Test** after saving: it runs `uname`, `id`, `node -v`, `python3 -V` in the sandbox. The first Docker run downloads the image.

## What changes when it is on

- `run_command` runs in the sandbox; the agent is told where it runs and that the project is at `/workspace`.
- The terminal panel (`terminal_run`) is not offered to the agent, because it is this computer's shell.
- Scheduled tasks may run commands in the sandbox without asking (they cannot outside it).
- Phone and gateway messages may run commands in the sandbox even with "No terminal or computer control from outside" on.
- The headless gateway runs commands in the sandbox without `--allow-shell`.
- File tools (read, write, edit) still work on the project folder directly, with their usual approvals.

## Settings

| Setting | Default | |
| --- | --- | --- |
| Where commands run | This computer | This computer / This computer, isolated / Docker container / Another machine (SSH) |
| Extra writable folders | | Isolated only; one per line, `~` allowed |
| Image | `node:22-bookworm` | Any image with `sh`; Debian-based images have `timeout` and `setsid`, which Stop and time limits use |
| Network in the container | On | Off = `--network none` |
| Limits | `2g`, `2` CPUs | Per container |
| Host / Folder there | | SSH only |

**Remove sandbox containers** deletes every container Artemis created (`label=artemis.sandbox=1`). They are also safe to delete with `docker rm -f`.

## Requirements

Docker Desktop, OrbStack, Colima or plain Docker on Linux, with `docker` on the PATH. For SSH: `ssh host` must work without a password prompt. Isolated: nothing on macOS; on Linux `bubblewrap` (`sudo apt install bubblewrap` or `sudo dnf install bubblewrap`) with unprivileged user namespaces enabled.

## See also

- [Tools and Approvals](Tools-and-Approvals.md)
- [Terminal](Terminal.md)
- [Gateway and command line](Gateway.md)
