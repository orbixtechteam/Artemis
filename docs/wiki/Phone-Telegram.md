# Phone (Telegram)

Pair a private Telegram bot with Artemis and talk to the same agent from your phone, with the same memory, projects and notes. You can send it photos and files, open your desktop chats, and, if you allow it, see and control your computer.

## How to use

1. In Telegram, create a bot with **@BotFather** and copy its token.
2. In Artemis, open **Settings → Phone**, turn on **Telegram bot** and paste the token into **Bot token**. It is saved when you leave the field or press Enter.
3. The **Status** line shows the bot name and a pairing code. In Telegram, open your bot, press **Start** and send `/pair <code>`.
4. When the status says **Connected to @yourbot**, just write to the bot. Photos and files (xlsx, csv, pdf, docx, txt) are read too.
5. To disconnect, press **Unpair** in Settings, or send `/unpair` from the phone.

Artemis must keep running for the bot to answer. With **Keep running in the background** (Settings → General) on, closing the main window keeps it running; quit with `Cmd+Q` or from the menu bar icon.

### Commands

| Command | What it does |
| --- | --- |
| `/model` | Show models, or `/model <name>` to switch |
| `/project` | Choose a project (and its folder) |
| `/tools` | Turn web, terminal, computer, memory, connectors, notes on or off |
| `/settings`, `/providers` | Switches and model providers on or off |
| `/compact` | Summarize the earlier part of the chat to save tokens |
| `/notes` | Recent notes; `/notes words` searches. Tap one to read it |
| `/note Title: text` | Add text to a note (created if new; `Folder/Title: text` works) |
| `/status` | What is currently set |
| `/screen` | See your computer screen now |
| `/chats` | Your desktop chats; tap one to continue it on the phone (new messages also appear in the app) |
| `/search words` | Find an earlier chat |
| `/last` | Recent messages of the open chat |
| `/skills` | List skills |
| `/new` | Start a new chat |
| `/stop` | Cancel the running task |
| `/memory`, `/remember text`, `/forget id` | List, add or remove memory |
| `/connectors` | List MCP connectors |
| `/help` | All commands |

### Getting files and screenshots on the phone

In a desktop chat you can ask Artemis to send something to your phone, for example "send this file to my phone" or "send me a screenshot". It uses the `send_to_phone` tool, which can send a message, a project file or a screenshot. File results in a chat also have a **Send to phone** button.

## Settings

| Setting | Where | What it does |
| --- | --- | --- |
| Telegram bot | Phone → Telegram | Turns the bot on or off. |
| Bot token | Phone → Telegram | The token from @BotFather, stored encrypted. |
| Project folder for phone chats | Phone → Phone chats | The folder the assistant can read and write when you chat from the phone. Empty means none. |
| Continue my most recent desktop chat | Phone → Phone chats | A phone message goes into the chat you used last on the desktop (within 12 hours). `/new` starts a fresh chat, `/open` picks another. |
| Full control from the phone | Phone → Phone chats | Terminal plus screen, mouse and keyboard from Telegram, with live screenshots. Each task still asks you to approve on the phone. |
| Phone (Telegram) | Access | Lets you chat from your phone and lets Artemis send you files. |
| Pause the phone while locked | Security → Unauthorized access | Stops phone answers while the app is locked. |

## Tips

- Set **Project folder for phone chats** so phone tasks can work with files in that project.
- Use `/chats` to pick up a desktop conversation on the phone and keep it in sync.
- The bot is also where lock alerts arrive (see [Security and App Lock](Security-and-App-Lock.md)).

## Limits and safety

- After five wrong pairing codes the code changes and pairing pauses for 10 minutes.
- Anyone who gets into your paired Telegram account can do what you allowed from the phone. Leave **Full control from the phone** off unless you need it.
- The integrated browser is never driven from phone tasks.
- Messages go through the Telegram API only while the bot is on.

## See also

- [Security and App Lock](Security-and-App-Lock.md)
- [Computer Control](Computer-Control.md)
- [Notes](Notes.md)
- [Memory](Memory.md)
- [Scheduled Tasks](Scheduled-Tasks.md)
