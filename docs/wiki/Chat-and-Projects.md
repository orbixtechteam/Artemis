# Chat and Projects

Chats are where you talk to Artemis and watch it work. Projects group chats with shared instructions and a working folder, so Artemis knows where your files are and how you want it to behave.

## How to use

### Start a chat

1. Click **New chat** in the sidebar (or use the command palette, `Cmd/Ctrl+K` → New chat).
2. Pick a model with the model picker at the top if you want something other than the default.
3. Type your message and press Enter. Answers stream in with Markdown, tables and highlighted code. Tool steps appear as cards you can expand.

While an answer is running you can keep typing. New messages wait in a queue above the message box. **Send now** stops the current answer and sends that message; the **x** removes it from the queue. If you stop an answer yourself, the queue pauses until you press **Send now**.

### Controls next to the message box

| Control | What it does |
| --- | --- |
| Model picker | Model for this chat |
| Reasoning level | Auto, Low, Medium or High thinking for this chat |
| Tools | Turns tools (files, memory, notes, web, terminal and the rest) on or off for this chat. Off sends a much smaller request, good for small local models and free-tier limits |
| Agents | Lets Artemis hand parts of the work to helper agents. See [Sub-Agents](Sub-Agents.md) |
| Brain mode | Who answers: one brain, or the council. See [Brains](Brains.md) |
| Auto-allow all | Runs file edits, agent writes, web, terminal, computer control, Make and connectors without asking. Deleting files still asks. See [Tools and Approvals](Tools-and-Approvals.md) |
| Project | Moves the chat into a project |
| Attach (paperclip) | Adds files. See [Files and Attachments](Files-and-Attachments.md) |
| Usage | Shows token and cost usage. See [Usage Limits](Usage-Limits.md) |

Type `@` in the message box to mention a connector, skill, agent or Make, or to reuse a file from the Files library.

### Work with messages

- Right-click a message for **Copy message**, **Regenerate** and **Delete message**. Code blocks have **Copy code**.
- **Read aloud** speaks an answer and highlights the text as it is read.
- When a model thinks before answering, a **Thinking…** block shows it. Click it to expand or collapse.
- A failed answer shows an error card in plain words, with **Details** and, when possible, a button that fixes it (for example retry).

### Rename, pin and organize chats

- **Rename:** double-click a chat title in the sidebar. With **Automatic titles** on, Artemis names chats from their topic; a name you give yourself is never changed.
- **Pin:** hover a chat in the sidebar and click the pin.
- **Tabs:** chats and notes open in tabs. `Cmd/Ctrl`-click (or **Open in new tab**) opens one in a new tab.
- **Split view:** right-click a tab or a sidebar item and choose **Open in split view**. **Close split view** returns to one pane.

Tab shortcuts, pinning and reordering are covered in [Quick Window and Shortcuts](Quick-Window-and-Shortcuts.md).

### Incognito chats

Click the ghost icon in the sidebar (**New incognito chat: not saved, no memory**) or use the command palette. An incognito chat is not saved, disappears when you leave it, and has memory off. It is never searched by "Search my earlier chats", never auto-titled, never used for learning skills and not counted in usage stats.

### Projects

1. Click **Projects** in the sidebar, then **New project** (or **Create your first project**).
2. Fill in:
   - **Project name**
   - **Project logo** (optional, shown in the sidebar, saved in the project's `.artemis` folder)
   - **Project folder**: the folder Artemis can read and write in (writes ask for approval)
   - **Project instructions**: added to every chat in this project, for example "This project is for client reports. Write formally."
3. Click **Save**.

Open a project to see its **Instructions** and **Chats**. Use **Project settings** to change it. **Delete project** keeps the files in the folder; its chats become project-less.

A project folder can also carry its own agents (`.artemis/agents/`), skills (`.artemis/skills/`) and themes (`.artemis/themes/`).

## Settings

| Setting | Where | What it does |
| --- | --- | --- |
| Default model | Settings → General → Model | Model for new chats |
| Reasoning level | Settings → General → Model | Default thinking level for new chats |
| Automatic titles | Settings → General → Chat titles | Names each chat from its topic after the first reply |
| Title model | Settings → General → Chat titles | Model used for titles (a small one is enough) |
| Personality | Settings → General → Personality | Preset tone of voice |
| Personality notes | Settings → General → Personality | Your own words added to the preset |
| Custom instructions | Settings → General → Personality | Added to the system prompt of every chat |
| Tools on by default in new chats | Settings → Tools & safety | Default for the **Tools** pill |
| Search my earlier chats | Settings → Tools & safety | Lets Artemis look things up in saved chats when you refer to them |

## Tips

- Put rules that apply to one codebase or client in **Project instructions**, and rules for everything in **Custom instructions**.
- Long chats are compacted automatically: older messages are summarized and shown as **Earlier conversation compacted**. Expand it to read the summary. See [Usage Limits](Usage-Limits.md#how-long-runs-and-long-chats-are-handled).
- Find text in the open chat with `Cmd/Ctrl+F`.

## Limits and safety

- Chats are stored as local JSON. If the chats file cannot be read, it is set aside as `chats.json.corrupt-<time>` instead of being overwritten, and `chats.json.bak` keeps a copy at most 10 minutes old.
- Text from web pages, files and screenshots is treated as untrusted data; Artemis follows only your instructions.

## See also

- [Files and Attachments](Files-and-Attachments.md)
- [Tools and Approvals](Tools-and-Approvals.md)
- [Memory](Memory.md)
- [Notes](Notes.md)
- [Quick Window and Shortcuts](Quick-Window-and-Shortcuts.md)
