# Make

Artemis can work with your [Make](https://www.make.com) (formerly Integromat) account: list, read, create, change, switch on or off and run your scenarios when you ask. The **Automations** page shows all your scenarios in one place.

## How to use

1. In Make, open your profile → **API** → **Add token**. Give it the scopes Artemis should use: scenarios (read, write, run), connections (read), teams and organizations (read).
2. In Artemis, open **Settings → Make**.
3. Pick your **Zone**: the address you see when you are logged in to Make, for example `eu1.make.com`. Choose **Other…** to type a different one.
4. Paste the token into **API token** and click **Save & test**. When it works, the row shows **Connected** with your organizations and teams.
5. Ask in a chat, for example:
   - "Which of my Make scenarios are on?"
   - "Show me the blueprint of the Invoice sync scenario."
   - "Create a scenario that fetches the latest posts from this URL every hour."
   - "Turn off the Slack digest scenario."
   - "Run the CRM export once now."
   You can also pick Make from the `@` menu in the message box.
6. Open **Automations** in the sidebar to search scenarios, filter by **All**, **On** or **Off** (and by team when you have several), switch a scenario on or off, **Run** it once, open it in Make, and expand a row to see its latest runs. **Open Make** opens your Make zone in the browser.

## Settings

| Setting | Where | What it does |
| --- | --- | --- |
| Use Make in chats | Settings → Make | Gives the assistant the Make tools |
| Zone | Settings → Make → Connection | Your Make region, for example `eu1.make.com` |
| API token | Settings → Make → Connection | Your Make API token. Saved with **Save & test** |
| Remove token | Settings → Make → Connection | Deletes the saved token from this computer |

## What Artemis can do

| Tool | What it does | Asks first |
| --- | --- | --- |
| make_overview | Lists your organizations and teams | No |
| make_list_scenarios | Lists scenarios of a team (id, name, active, schedule) | No |
| make_get_scenario | Returns a scenario and its blueprint | No |
| make_get | Read-only request to any other Make API v2 endpoint (connections, hooks, data stores, logs) | No |
| make_create_scenario | Creates a scenario | Yes |
| make_update_scenario | Changes a scenario | Yes |
| make_set_active | Turns a scenario on or off | Yes |
| make_run | Runs an active scenario once | Yes |

## Tips

- Ask Artemis to read an existing scenario first when you want a similar new one; it learns module ids and parameter shapes from the blueprint.
- Most Make API endpoints need a paid Make plan.

## Limits and safety

- When Artemis creates, changes, switches or runs a scenario, it asks for approval first (unless the chat auto-allows actions). Switches and **Run** on the Automations page are your own actions; **Run** asks you to confirm.
- The token is stored encrypted on this computer and is never written to chats or files.
- Sub-agents never get the Make tools.

## See also

- [Scheduled Tasks](Scheduled-Tasks.md)
- [Tools and Approvals](Tools-and-Approvals.md)
- [MCP](MCP.md)
