# Troubleshooting

Common problems and how to fix them. When something is unclear, open **Logs** in the sidebar first: it shows what Artemis did step by step.

## The model ignores tools or answers without using them

- Tool calling needs a model that supports it. Check the model's page. A model without tool support still works for plain chat.
- Small models cope better with fewer tools. With every tool group on, the tool list alone is roughly 10,000 tokens. Turn off groups you do not need in **Settings → Tools & safety**, or switch tools off for one chat with the **Tools** pill next to the model picker.
- Keep **Switch heavy tools on only when needed** and **Switch connectors on only when needed** on; they keep requests small.

## A local model (Ollama, LM Studio) forgets instructions or cuts off

Ollama's default context window is small and silently cuts long prompts, including the system prompt and the tool list. Set `OLLAMA_CONTEXT_LENGTH=16384` (or more) on the server, or create a model with `PARAMETER num_ctx 16384` in a Modelfile. See [Providers and Models](Providers-and-Models.md).

## Screenshots or images are ignored, or the reply is empty after a screenshot

The model cannot see images. Artemis then leaves images out and shows a notice; if the model still replies with nothing, the screenshot is replaced with a note so it can finish in text. The screenshot itself is always shown to you in the chat. For tasks that need the model to look at the screen, pick a vision model.

## "The model stopped without an answer"

The model returned empty replies even after Artemis asked it to carry on. Try again, or pick another model. Some models only produce hidden reasoning for certain tool results.

## Computer control or screenshots do not work (macOS)

1. Open **Settings → Access** and check the macOS permissions list.
2. Grant **Screen Recording** and **Accessibility** to Artemis in System Settings → Privacy & Security. If you run Artemis from a terminal (`pnpm dev`), allow the terminal app instead.
3. macOS may ask you to restart Artemis after granting a permission.
4. From source, check with `pnpm selftest:computer`.

Computer control works on macOS only. See [Computer Control](Computer-Control.md).

## macOS says the app cannot be opened

The release build is unsigned. Right-click Artemis in Applications and choose **Open**, or go to System Settings → Privacy & Security and click **Open Anyway**. You only need to do this once.

## A keyboard shortcut does not work

A global shortcut that another app already uses cannot be registered. **Settings → Keyboard shortcuts** shows the error under the field and leaves the shortcut off. Choose a different combination. A push-to-talk key that is a lone modifier, or has no Cmd, Option or Ctrl, works only while the Artemis window is in front.

## Sentinel does not hear me, or hears too much

- Pick the right **Microphone** in **Settings → Voice → Audio devices**.
- Set a **Speech-to-text provider** that supports `/audio/transcriptions` (Whisper).
- Lower **Microphone sensitivity** if other voices are picked up; raise it in a quiet room.
- If you turned on voice recognition, check **Test my voice** in **Settings → Security**, or record your voice again.

See [Sentinel (Voice)](Sentinel-Voice.md).

## The Sentinel widget is not visible

The widget appears only while Sentinel is on. If it disappears whenever the Artemis window is in front, turn off **Hide the widget while Artemis is open** in **Settings → Voice**.

## The Telegram bot does not answer

- Artemis must be running. Turn on **Keep running in the background** in **Settings → General** so closing the window does not quit it.
- Check the **Status** line in **Settings → Phone**: the bot must be online and paired.
- If **Pause the phone while locked** is on, unlock Artemis first.

## My chats or settings look empty after an error

If `chats.json` (or the projects or memory file) cannot be read, Artemis does not overwrite it. It sets the file aside as `chats.json.corrupt-<time>` and tells you, and saving to that store is refused until you have been told. `chats.json.bak` keeps a copy at most 10 minutes old. Quit Artemis and restore from the `.bak` or `.corrupt-` file in the data folder.

## Where things are stored

| What | Where |
| --- | --- |
| Chats, projects, memory, settings, connectors | The app data folder (on macOS `~/Library/Application Support/Artemis`), as JSON files |
| User skills, agents, brains, themes | `skills/`, `agents/`, `brains/`, `themes/` in the app data folder |
| Project skills, agents, themes | `<project>/.artemis/` |
| Notes | `Documents/Artemis Notes` by default; you can pick another folder for Notes |
| Attached files | The Files library, `Documents/Artemis/Files` by default |
| Logs | `~/.artemis/logs` (kept 14 days, keys and tokens masked) |

API keys and tokens are encrypted with the OS keychain. On systems without OS encryption (some Linux setups) they are stored in plain text in the data folder.

## Reading the logs

1. Click **Logs** in the sidebar (or say "open logs" to Sentinel).
2. Use **Search logs…** to filter, and the task list at the top to see running and finished tasks.
3. **Open log file** shows the file on disk, which you can attach to a bug report. Keys and tokens are masked.

## Upgrading from Ares

Earlier builds were called Ares and kept data in `~/.ares`, `Documents/Ares Notes` and `<project>/.ares`. Quit the app and run `pnpm migrate:ares` (dry run), then `pnpm migrate:ares -- --apply`.

## See also

- [Getting Started](Getting-Started.md)
- [Providers and Models](Providers-and-Models.md)
- [Tools and Approvals](Tools-and-Approvals.md)
- [Computer Control](Computer-Control.md)
- [Sentinel (Voice)](Sentinel-Voice.md)
- [Phone (Telegram)](Phone-Telegram.md)

## Artemis does not quit, or the Sentinel widget freezes

Quitting closes every window and ends the app after at most a few seconds, even if a background step hangs. If the widget still freezes, note what Sentinel was doing (speaking, answering with images, expanded view) and send the log from **Settings → Logs**.
