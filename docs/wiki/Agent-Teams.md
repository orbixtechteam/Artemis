# Agent teams

A team is a goal plus a few of your agents. Artemis leads: it splits the goal into tasks, gives each to the member whose role fits, lets them talk in a shared room and check each other's work, and writes the result. Open **Agents** in the sidebar → **Deploy a team**.

## Members are full workers

What a member can do is set by its tool groups (Settings → Agents & brains → an agent → Tools):

| Group | Gives |
| --- | --- |
| read, write | project / Files folder |
| web | web search and fetch |
| chats | your saved chats |
| make | your Make.com scenarios (post to social media, call any app Make connects) |
| browser | the browser: sites where you signed in once stay signed in (Substack, dashboards …) |
| connectors | your MCP connectors (mail, calendar, Notion …) |
| shell | `run_command`, in the [sandbox](Sandbox.md) when one is set |
| phone | send to your phone (Telegram) |
| memory | long-term memory (`memory_search`, `memory_note`, `memory_save`) |
| automation | scheduled tasks, heartbeats and webhooks |

Make, browser, connectors, shell, phone, memory and automation work in teams only; a `delegate` helper in a chat keeps read, write, web and chats.

## Settings of a team

- **Ask me before acting**: writing files, commands, Make, posting and sending ask first, in the room and on Telegram (Allow / Deny buttons) when it is paired. Off: the team acts on its own.
- **Let Artemis add agents**: when no member fits a task, the lead creates one (`team_hire`, up to 3 per team). It is saved as one of your agents.
- **Budget**: in dollars (from the prices in Settings → Models & providers; a model without a price counts as $0 and the room says so), in tokens (counts every model), and in time. The run pauses when one is reached; Resume gives it the same again.
- **Team rules**: anything every member should follow. Added to every prompt of the team. There are no built-in content rules: the team does what you and your agents decide.
- **Runs by itself**: every day, weekdays or every few hours a new run starts (a scheduled task marked *Team*). It keeps running while Artemis is closed when the background gateway is on (Settings → Gateway → Keep running in the background); the Mac has to be awake.

## The notebook

At the end of every run the lead's summary is added to the team's notebook (with the date). Every new run reads it, so a daily team knows what it did yesterday and what came of it. The room shows it under **Notebook**, where you can also clear it. For more, give members the *memory* group.

## Where it runs

In the app, or in the background gateway while that runs: the window then follows the team through the gateway's API (`/v1/teams`) and approvals you give in the room go there. Runs that were going in the app pause when the gateway takes over; Resume continues them there.
