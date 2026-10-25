# Sub-Agents

Sub-agents are role agents that Artemis can hand parts of a task to. Each one runs in isolation with its own instructions, tools and model, and only its final answer comes back to your chat.

## How to use

1. Make sure **Settings → Agents → Let Artemis use agents** is on (it is on by default).
2. In a chat, check that the agents pill next to the model picker says **Agents** (not **No agents**).
3. Ask for it in plain words, or mention an agent with `@`: for example `@Athena research the three most used open-source vector databases`. Typing `@` in the message box lists your agents.
4. Artemis plans the work, calls the `delegate` tool and runs up to 4 agents at once. Each agent shows up as a card in the chat with its task, tool calls, model and token count.
5. For important work, add "use the Reviewer" to your request. Artemis then sets `review: true` and Themis checks the output before the answer comes back.
6. Open **Agents** in the sidebar (under the "more" items) to see **Running now**: every agent that is working, what it is doing, and whether it is waiting for your approval. Click a card to open its chat.

## Built-in roles

| Agent | Role | Tools | Good for |
| --- | --- | --- | --- |
| Athena | Researcher | web, read, chats | Lookups, comparisons and summaries with sources |
| Hephaestus | Coder | read, write | Writing and editing code and project files |
| Calliope | Writer | read, write | Emails, docs, posts and summaries |
| Themis | Reviewer | read, web | Checking other agents' output (read-only) |

When you call `delegate` without naming an agent, Artemis uses a plain read-only helper (read, web, chats).

## Settings

| Setting | Where | What it does |
| --- | --- | --- |
| Let Artemis use agents | Settings → Agents | Lets Artemis hand parts of the work to agents (up to 4 at once, one level deep) |
| Ask before agents write files | Settings → Agents | On: every write by an agent asks you in the chat. Off: agents write without asking when edits are auto-allowed |
| Agents / No agents | Chat pill next to the model picker | Turns agents on or off for this chat only |
| Model | Agent editor | The model this agent uses. Empty means "Same as chat" |

## Write your own agent

In **Settings → Agents** (or the **Your agents** list on the Agents page) click **New agent…** and fill in:

- **Name**: how you call it, for example `Athena`. It cannot be changed after saving.
- **Role**: optional title. You can ask for the agent by name or by role.
- **What is it for?**: one line. Artemis reads it to decide when to use the agent.
- **Model**: put cheap jobs (search, summaries) on a cheap model and hard jobs on a strong one.
- **Tools**: the tool groups the agent may use.
- **Instructions**: the agent's system prompt.

Click **Save agent**. Agents are plain Markdown files, so you can also write them by hand. **Open agents folder** opens the folder.

```markdown
---
name: Scout
role: Market researcher
description: Finds pricing and feature data for competing products.
model: prov:openrouter:qwen/qwen3.5-flash
tools: web, read
---

Search for official pricing pages first. Report a table with product, price and source URL.
```

Tool groups:

| Group | Label in the editor | Tools |
| --- | --- | --- |
| `read` | Read project files | list_dir, read_file, search_files |
| `write` | Write and edit files (asks you each time) | write_file, edit_file, write_spreadsheet, update_cells, create_folder, move_file |
| `web` | Search and read the web | web_search, web_fetch |
| `chats` | Search your saved chats | search_chats, read_chat |
| `make` | Make.com scenarios (in teams) | make_* |
| `browser` | Drive the browser (in teams) | browser_* |
| `connectors` | Your connectors, MCP (in teams) | mcp__* tools, use_connector |
| `shell` | Run commands, in the sandbox when one is set (in teams) | run_command |
| `phone` | Send to your phone (in teams) | send_to_phone |
| `memory` | Long-term memory (in teams) | memory_search, memory_get, memory_note, memory_save |
| `automation` | Scheduled tasks, heartbeats and webhooks (in teams) | schedule_task …, hook_*, heartbeat_* |

The groups marked *in teams* work when the agent is a member of an [agent team](Agent-Teams.md); a `delegate` helper in a chat keeps read, write, web and chats.

### Where agent files live

- **User agents**: `<userData>/agents/<slug>.md`. Saving a built-in role (for example after **Edit…** on Athena) writes a user file that overrides it; the list then shows it as **edited** and **Reset** brings back the default.
- **Project agents**: `<project folder>/.artemis/agents/<slug>.md`. They come from the repository and are treated as untrusted: they never override a built-in or user agent (a clashing name gets a `-project` slug or a "(project)" suffix), a role match always prefers a non-project agent, and their description and instructions are size-capped.

## Tips

- Give each agent a self-contained task. Agents do not see your chat, only the task and optional shared context.
- Use agents for broad research or parallel work. For a single quick lookup, asking Artemis directly is cheaper.
- Two agents should never be given the same file.

## Limits and safety

- Up to 4 agents run at once, and at most 12 agent runs per task.
- Agents cannot call other agents.
- Agents never get file deletion, the terminal, computer control, Make, memory or connectors.
- Agent token use counts against the parent run's budget.
- If an agent's model is not available, it falls back to the chat model and a notice says so.

## See also

- [Brains](Brains.md)
- [Skills](Skills.md)
- [Tools and Approvals](Tools-and-Approvals.md)
- [Providers and Models](Providers-and-Models.md)
