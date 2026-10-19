# Tools and Approvals

Artemis works through tools: files, web, memory, notes, terminal, computer control, the browser and connectors. You choose which tools it may use, and anything that changes something asks you first on an approval card.

## How to use

1. Open Settings (Cmd/Ctrl+,) → **Tools & safety** and switch on the tool groups you want.
2. In a chat, use the **Tools** pill next to the model picker to turn tools on or off for that chat. Off sends much smaller requests, which small local models and free tiers need.
3. Use the permission pill next to the message box to pick **Ask first** or **Auto-allow** for that chat.
4. When Artemis wants to act, an approval card appears in the chat. Read it, then press **Allow** (Cmd/Ctrl+Enter) or **Deny** (Esc).
5. For a file write or edit, the card shows the file path and a preview (a diff for edits). **Open folder** shows the file in Finder.
6. Some kinds of action show **Allow for this task**. Allowing them once covers that kind of action until the current task ends.

## Approval rules

| Action | How often it asks |
| --- | --- |
| Writing or editing a file | Every time, unless Auto-allow is on |
| Deleting a file | Every time, even with Auto-allow |
| Terminal commands, computer control | Once per task |
| Browser control | Once per site per task |
| Running JavaScript in a browser page | Once per task |
| Notes and Files library (browse, search, read) | Once per task; writing a note asks every time |
| A connector (MCP server) | Once per task per server; read-only tools have a separate "read" approval |
| Scheduled tasks (create, change, delete) | Once per task for each kind |
| Reading a folder outside the project | Once per folder per task (read-only) |
| Reading credentials, browser profiles or Artemis's own data | Every time |
| Looking up your location from your IP | Once per task |

## Settings

| Setting | Where | What it does |
| --- | --- | --- |
| Tools on by default in new chats | Tools & safety → Tools | Files, memory, notes, web and terminal are on in new chats. |
| Auto-allow all in new chats | Tools & safety → Tools | Off by default: every action asks. On: file edits, agent file writes, web, terminal, computer control, Make and connectors run without asking. Deleting files always asks. Phone messages follow this, but only file edits are auto-allowed there. |
| Memory | Tools & safety → Tools | Lets Artemis save and use durable facts. |
| Web search and page fetch | Tools & safety → Tools | Turns on `web_search` and `web_fetch`. |
| Notes knowledge base | Tools & safety → Tools | Artemis can search and read your notes after you approve. |
| Terminal commands | Tools & safety → Tools | Shell commands and the integrated terminal. Asks once per task. |
| Computer control (macOS) | Tools & safety → Tools | Screen, mouse and keyboard. Asks once per task. Emergency stop: Cmd+Shift+Esc. |
| Browser control | Tools & safety → Tools | Artemis can open pages, click, type and fill forms in the integrated browser. Asks once per site per task; never runs in scheduled or phone tasks. |
| Connectors (MCP servers) | Tools & safety → Tools | Lets Artemis use your MCP connectors. |
| Full file access | Tools & safety → Tools | Files anywhere on the computer, not only in the project folder. Asks once per outside folder for reading, every time for keys and credentials, and for every change. |
| Switch heavy tools on only when needed | Tools & safety → Saving tokens | Computer control, browser, terminal, media, phone, scheduling, helper agents and Make are sent only after the assistant asks for them. Files, web, memory and notes are always sent. |
| Switch connectors on only when needed | Tools & safety → Saving tokens | Connector tools are sent only after the assistant asks for that app. |
| Skills / Let Artemis learn by itself / Search my earlier chats | Tools & safety → Skills and learning | See [Skills](Skills.md) and [Chat and Projects](Chat-and-Projects.md). |
| What Artemis may use | Access | The same switches in one list, plus Agents and a status line for Phone (Telegram). |
| Approve everything in new chats | Access | Same as Auto-allow all in new chats. |

## Web search and page fetch

- `web_search` needs a search engine chosen in Settings → Tools: the Brave Search API (your own key) or an AI search model on one of your providers. Artemis does not scrape DuckDuckGo or Bing.
- `web_fetch` reads one page. It refuses local and private network addresses.
- Text from web pages is treated as untrusted data; Artemis does not follow instructions found there.

## Reading outside the project folder

File tools work inside the project folder (or the default files folder for chats without a project). Writing outside it is always blocked unless **Full file access** is on, and then every change asks.

Reading outside is allowed after you approve:

1. Ask Artemis to read an absolute path or a `~` path, for example `~/Downloads/report.csv`.
2. The card names the real file and folder (and the link target, if the path is a symlink).
3. **Allow for this task** lets it read that folder for the rest of the task.

Locations that may hold secrets (for example `.ssh`, `.aws`, `.env` files, `.git-credentials`, browser profiles, Keychains and Artemis's own data folder) ask every time and are never covered by a session or auto approval.

## The Access page

Settings → **Access** shows everything Artemis can reach in one place:

- **macOS permissions**: Microphone, Screen Recording, Accessibility, Automation (System Events), Notifications, Camera and Touch ID, each with a status and an **Allow** or **Test** button.
- **Security**: a summary of app lock, voice recognition, Touch ID, Telegram alerts and the alert photo, with **Open** to jump to Security.
- **Folders Artemis can reach**: the default files folder, each project folder and the Notes folder, with **Show** to open them in Finder. Terminal and computer control are listed as "Any folder" when on.
- **What Artemis may use**: the tool switches.
- **Let other apps control Artemis (MCP server)**: see [MCP](MCP.md).

## Tips

- Keep Auto-allow off until you trust a model and a project.
- If a small local model struggles, turn off tool groups you do not need or keep "Switch heavy tools on only when needed" on. With every group on, the tool list alone is about 10,000 tokens.
- Cmd/Ctrl+Enter allows and Esc denies the newest pending card.

## Limits and safety

- Approvals are the real guard. The terminal blocklist is not a sandbox (see [Terminal](Terminal.md)).
- Sub-agents never get shell, computer control, file deletion or memory.
- Touch ID can be required before sensitive approvals; see [Security and App Lock](Security-and-App-Lock.md).

## See also

- [Terminal](Terminal.md)
- [Browser](Browser.md)
- [Computer Control](Computer-Control.md)
- [Files and Attachments](Files-and-Attachments.md)
- [MCP](MCP.md)
- [Security and App Lock](Security-and-App-Lock.md)
