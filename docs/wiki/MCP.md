# MCP

Artemis speaks the Model Context Protocol in both directions. **Connectors** let the assistant use tools from MCP servers (GitHub, databases, Google Drive, Notion and so on). The **Artemis MCP server** lets Claude Code or another MCP app drive Artemis itself.

## How to use

### Add a connector

1. Click **Connectors** in the sidebar (under the "more" items if it is hidden).
2. Press **Add connector**, or use **Quick add** (Filesystem, Memory, Fetch), or **Import JSON** to paste a Claude Desktop config (`{"mcpServers": {"name": {"command": "npx", "args": [...]}}}`).
3. Fill in the form:
   - **Name**.
   - **Type**: **Local (command)** runs a program on your computer; **Remote (URL)** connects to a server over HTTP.
   - For a local server: **Command**, **Arguments** and **Environment variables** (one per line, `KEY=value`).
   - For a remote server: **Server URL**, **Authentication** (**Bearer token**, **API key (X-API-Key)** or **OAuth 2.1**) and **Additional headers** (one per line, `Header: value`).
4. Press **Add connector**. Artemis connects and lists the server's tools. Expand a connector to see them.

### Sign in with OAuth (for example Google Drive)

1. Choose **Remote (URL)** and **OAuth 2.1**.
2. Enter the **Authorization URL**, **Token URL**, **Client ID**, **Client secret (optional)** and **Scope**. For a Google Drive MCP URL (`drivemcp.googleapis.com`) the Google endpoints and a read-only Drive scope are filled in for you; Google requires the client secret.
3. Press **Sign in with OAuth** and finish in the browser. The form then shows **OAuth connected**. Tokens are refreshed automatically.

### Use a connector in a chat

Just ask for something the connector can do ("list my open GitHub issues"). You can also mention a connector in the message box to point the assistant at it. By default connector tools are sent to the model only after the assistant asks for that app, which keeps requests small.

### Let other apps control Artemis (MCP server)

1. Open **Settings → Access** and turn on **Artemis MCP server**. It listens on `127.0.0.1` only, default port `8788` (change it in **Port**).
2. Copy the **Token**. Apps send it as a bearer token.
3. To add it to Claude Code, run the command shown under **Add it to Claude Code** once in a terminal. It looks like:

   ```
   claude mcp add --transport http --scope user artemis http://127.0.0.1:8788/mcp --header "Authorization: Bearer <token>"
   ```

   Other MCP apps can use the JSON config shown in the same card (`type: http`, the URL and the `Authorization` header).
4. In the client, ask for things like "switch Artemis to the dark theme", "add a note", or "run `ls` in the Artemis terminal".

## Tools exposed by the Artemis MCP server

All tools are named `artemis_*`:

| Tools | What they do | Asks you? |
| --- | --- | --- |
| `artemis_status`, `artemis_get_settings` | Current model, theme, features, providers, connectors | No |
| `artemis_set_setting`, `artemis_set_theme` | Change safe settings (theme, text size, default model, voice options…) | No |
| `artemis_list_providers`, `artemis_set_provider_enabled`, `artemis_list_models`, `artemis_list_themes` | Providers, models and themes | No |
| `artemis_memory_list`, `artemis_memory_add`, `artemis_memory_remove` | Memory | No |
| `artemis_skills_list` | Skills | No |
| `artemis_notes_list`, `artemis_notes_search`, `artemis_notes_read` | Read notes | No |
| `artemis_notes_write`, `artemis_notes_create` | Change or create a note | Yes |
| `artemis_terminal_run`, `artemis_terminal_read` | Type a command into the Artemis terminal, read its last lines | Running asks |
| `artemis_projects`, `artemis_fs_*` (list, read, search, write, edit, delete files) | File tools inside a project folder | Changes, deletes and outside reads ask |
| `artemis_computer` | See and control the Mac screen | Yes |
| `artemis_view_image` | Show an attached image or an image in a project | No |
| `artemis_lock` | Lock Artemis (it cannot unlock) | No |

When an outside app needs approval, Artemis shows a dialog even if it is in the background, with **Allow once**, **Allow for 10 minutes**, **Always allow** and **Deny**. The prompts name what is asked, for example "Let an outside app change your files?", "Let an outside app read files on your computer?", "Let an outside app run a command on your computer?" or "Delete this from your project?". A delete asks every time.

## Settings

| Setting | Where | What it does |
| --- | --- | --- |
| Connectors (MCP servers) | Tools & safety | Turns all connector tools on or off. |
| Switch connectors on only when needed | Tools & safety → Saving tokens | Connector tools are sent only after the assistant asks for that app. |
| Artemis MCP server | Access | Starts or stops the local MCP server. |
| Port | Access | The port on `127.0.0.1` (saved when you leave the field). |
| Token | Access | The bearer token clients must send. |
| Don't ask before running commands from outside | Access | Off: Artemis asks each time an outside app wants to run a command or edit a note. |

## Tips

- Turn connectors you do not need off: every connector adds tools to the model's prompt.
- Each connector asks for approval once per task, unless its tool is read-only.
- If Claude Code still asks for permission in headless mode, allow `mcp__artemis` in the Claude Code settings.

## Limits and safety

- Connector secrets (environment values, headers, client secret, OAuth tokens) are encrypted at rest.
- The Artemis MCP server binds to `127.0.0.1`, requires the token, and rejects any request with an `Origin` header, so web pages cannot call it.
- Permissions that give Artemis more power (terminal, computer control, auto-approve, phone, API keys, endpoints) cannot be changed through the MCP server; you change them in Settings.
- While Artemis is locked, the MCP server answers "locked".
- Writes through `artemis_fs_*` cannot leave the project folder. Reads outside it need your approval.

## See also

- [Tools and Approvals](Tools-and-Approvals.md)
- [Files and Attachments](Files-and-Attachments.md)
- [Terminal](Terminal.md)
- [Notes](Notes.md)
- [Security and App Lock](Security-and-App-Lock.md)
