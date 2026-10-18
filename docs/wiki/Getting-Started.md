# Getting Started

This page takes you from a fresh install to your first chat with a project folder. It takes about five minutes.

## How to use

### 1. Install

**macOS (Apple silicon).** Download the `.dmg` from the Releases page, drag Artemis to Applications and open it. The build is unsigned, so macOS asks you to confirm the first launch: right-click the app and choose **Open**, or go to System Settings → Privacy & Security and click **Open Anyway**.

**From source (macOS, Windows, Linux).** You need Node.js 20+ and [pnpm](https://pnpm.io).

```
git clone <repo-url> artemis
cd artemis
pnpm install
pnpm dev         # development (Vite + Electron, hot reload)
pnpm start       # build and run the production bundle
```

Only the macOS arm64 build is packaged. Computer control, Touch ID and the macOS permission checks work on macOS only.

### 2. Add a provider

Artemis has no built-in model provider. You bring your own.

1. Open Settings (`Cmd/Ctrl+,`) and choose **Providers**.
2. Click **Add provider…**.
3. Under **Start from**, pick a preset: Cloudflare Workers AI, Ollama (local), LM Studio (local), OpenRouter, OpenAI, Anthropic (Claude API) or Custom (OpenAI-compatible).
4. Paste your **API key** (local servers usually need none).
5. Click **Fetch models** to load the provider's model list, then pick models with **Add a model**.
6. Click **Test connection** to check, then **Add provider**.

See [Providers and Models](Providers-and-Models.md) for details on each provider type.

### 3. Pick a default model

1. In Settings → **General**, open **Default model**.
2. Choose a model. New chats use it; you can switch per chat with the model picker at the top of a chat.

### 4. Create your first project

A project ties chats, instructions and a working folder together. Without a folder Artemis can still chat, but it cannot read or write your files.

1. Click **Projects** in the sidebar, then **Create your first project** (or **New project**).
2. Enter a **Project name**.
3. Under **Project folder**, click **Choose…** and select the folder Artemis may work in.
4. Optionally add **Project instructions** (added to every chat in the project) and a **Project logo**.
5. Click **Save** and start a chat in the project.

### 5. Send a message

Type in the message box and press Enter. Try something like "List the files in this folder and summarize what the project does." When Artemis wants to change a file, it shows an approval card first.

## Settings

| Setting | Where | What it does |
| --- | --- | --- |
| Default model | Settings → General → Model | Model used for new chats |
| Tools on by default in new chats | Settings → Tools & safety | Gives new chats files, memory, notes, web and terminal tools |
| Keep running in the background | Settings → General → Startup and background | Closing the window keeps Artemis running (needed for the phone bot and scheduled tasks) |
| Start Artemis when I log in | Settings → General → Startup and background | Launches Artemis at login |

## Tips

- Small local models work better with fewer tools. Turn tools off per chat with the **Tools** pill next to the model picker.
- Set a spending limit early in Settings → Usage limits. See [Usage Limits](Usage-Limits.md).
- If you used ChatGPT or Claude before, import your history from Settings → General → Import. See [Files and Attachments](Files-and-Attachments.md#import-chats-from-chatgpt-or-claude).
- Upgrading from the older Ares builds: quit the app and run `pnpm migrate:ares` (dry run), then `pnpm migrate:ares -- --apply`.

## Limits and safety

- File tools stay inside the project folder unless **Full file access** is on, and every change asks first unless you turn on auto-allow. See [Tools and Approvals](Tools-and-Approvals.md).
- Data (chats, notes, memory) is stored locally. Keys are encrypted with the OS keychain.

## See also

- [Providers and Models](Providers-and-Models.md)
- [Chat and Projects](Chat-and-Projects.md)
- [Tools and Approvals](Tools-and-Approvals.md)
- [Troubleshooting](Troubleshooting.md)
