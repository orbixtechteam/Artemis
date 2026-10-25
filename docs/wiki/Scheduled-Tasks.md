# Scheduled Tasks

Scheduled tasks run a prompt by themselves: once at a set time, every few minutes or hours, daily, on weekdays, on certain weekdays, or monthly. Each run appears as its own chat.

## How to use

1. Open **Scheduled** in the sidebar and click **New task** (or **Create your first task**).
2. Fill in:
   - **Name**, for example `Morning news summary`.
   - **What should Artemis do?**: a complete, self-contained prompt. Each run starts a fresh chat, so include everything the task needs.
   - **Repeat**: **Every day**, **Weekdays**, **Certain weekdays**, **Every month**, **Every few minutes / hours** or **Once**.
   - **Time**, **Date**, **Day of month**, **Every** or the weekday buttons, depending on the repeat type.
   - With **Every few minutes / hours**: tick **Only between** to limit it to a time of day (for example 09:00–18:00, or 22:00–06:00 across midnight) and click the days it runs on. The editor shows the next run times as you change it.
   - **Project**: the project whose folder and instructions the task uses, or **No project**.
   - **Model**: a model for this task, or **Default (Settings → General)**.
3. Choose the options you need:
   - **Plain reminder**: shows the text exactly as written, without running the AI.
   - **Allow file changes in the project folder**: otherwise the task can only read.
   - **Send the result to my phone (Telegram)**.
4. Click **Save**.

You can also ask in a chat, for example "every weekday at 8:30, summarize my unread project notes" or "remind me tomorrow at 10 to call the bank". Artemis creates the task with `schedule_task` after you approve it, and can list, change, pause, resume or delete tasks the same way.

The Scheduled page also has **Heartbeat** and **Webhooks** tabs: see [Heartbeat and webhooks](Heartbeat-and-Webhooks.md). A task marked **Team** starts a new run of an [agent team](Agent-Teams.md).

On the Scheduled page each task shows its next and last run and how many times it ran. Use **Run now** to run it immediately, the pencil to edit, the trash icon to delete, and the switch to pause or resume. A **Failed** badge shows the last error when you hover over it.

## Settings

| Setting | Where | What it does |
| --- | --- | --- |
| Model for scheduled tasks | Settings → General → Scheduled tasks | Used by every task that has no model of its own. A small, cheap model is usually enough |
| Keep running in the background | Settings → General → Startup and background | Closing the window keeps Artemis running, which scheduled tasks need |
| Start Artemis when I log in | Settings → General → Startup and background | Starts Artemis at login so tasks can run |
| Default brain for new chats | Settings → Brains | Scheduled tasks use this brain too (Council only works in the app) |

## Tips

- Put recurring tasks on a cheap model, and give a task its own model only when it needs a stronger one.
- Turn on **Send the result to my phone (Telegram)** for tasks whose result you want to see right away. See [Phone (Telegram)](Phone-Telegram.md).
- Use **Plain reminder** for simple reminders; it costs no tokens.

## Limits and safety

- Tasks run while Artemis is open (it can stay in the menu bar). If Artemis was closed at the scheduled time, the task runs once when you open it again.
- Scheduled tasks always run, whether Artemis is locked or not, and never wait for the lock or Touch ID.
- They cannot use the terminal, the computer tool or the browser, and they cannot ask for approval.
- Without **Allow file changes in the project folder**, a task can only read files.
- The shortest interval is 5 minutes.
- Automatic chat titles and learning are not used for scheduled chats.

## See also

- [Make](Make.md)
- [Phone (Telegram)](Phone-Telegram.md)
- [Brains](Brains.md)
- [Security and App Lock](Security-and-App-Lock.md)
- [Providers and Models](Providers-and-Models.md)
