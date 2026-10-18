# Memory

Memory is a short list of durable facts about you (preferences, context, goals). Artemis adds the list to every chat, so it knows these facts without being told again.

## How to use

1. Make sure memory is on: **Settings → Tools & safety → Memory**, or the **Memory on** checkbox on the Memory page.
2. In a chat, say "remember that ..." (for example "remember that I write reports in British English"). Artemis saves one short sentence with `memory_save`. It can also save a lasting fact you mention without being asked.
3. To remove a fact, say "forget that ..." and Artemis deletes it with `memory_forget`.
4. Open **Memory** in the sidebar (the count shows how many facts are saved) to manage the list yourself:
   - type in **Add a new fact…** and click **Add**;
   - edit any fact in place;
   - click the x next to a fact to delete it;
   - **Delete all** clears the list after you confirm.

## Settings

| Setting | Where | What it does |
| --- | --- | --- |
| Memory | Settings → Tools & safety | Turns memory on or off for all chats |
| Memory on | Memory page | The same switch |

## Incognito chats

The ghost button at the top of the sidebar starts a **New incognito chat: not saved, no memory**. In an incognito chat:

- long-term memory is off, and nothing is saved to it;
- the chat is not saved to history and disappears when you leave it;
- incognito chats are never searched by "Search my earlier chats", and Artemis does not learn skills from them.

## Tips

- Keep each fact to one short sentence. Memory is sent with every chat, so a long list costs tokens on every message.
- Use memory for facts about you. Use [Notes](Notes.md) for longer knowledge and [Skills](Skills.md) for how to do a task.
- Models that cannot call tools can still save and forget facts: Artemis lets them mark a fact at the end of a reply, and saves it for them.
- Importing ChatGPT or Claude data (Settings → General → Import) can also bring in memories.

## Limits and safety

- Memory is stored as plain JSON in the Artemis data folder on your computer (`memory.json` under `userData`).
- Messages from your phone use the same memory as the app.
- Sub-agents never get memory.

## See also

- [Notes](Notes.md)
- [Skills](Skills.md)
- [Chat and Projects](Chat-and-Projects.md)
- [Phone (Telegram)](Phone-Telegram.md)
