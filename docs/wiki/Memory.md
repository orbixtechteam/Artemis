# Memory

Artemis keeps long-term memory in plain Markdown files that you can open and edit yourself. The important parts go into every chat; everything else can be searched.

| File | What it is | In every chat? |
| --- | --- | --- |
| `SOUL.md` | Who Artemis is for you: voice, values, what it must never do. You write it. | Yes |
| `USER.md` | Lasting context about you: work, projects, people, how you like answers. You write it. | Yes |
| `MEMORY.md` | Durable facts, one `- ` line each. Artemis adds them with `memory_save`; you can add, edit or delete lines. | Yes (the newest 80 entries) |
| `memory/YYYY-MM-DD.md` | One journal file per day: notable events, decisions, results. | Today and yesterday |

The files live in the **memory folder**: `<data folder>/workspace` (Settings → Tools → Long-term memory → **Open folder**). Text inside `<!-- -->` comments is ignored.

## How to use

1. Make sure memory is on: **Settings → Tools → Memory**, or the **Memory on** checkbox on the Memory page.
2. In a chat, say "remember that ..." (for example "remember that I write reports in British English"). Artemis saves one short sentence to `MEMORY.md`. It can also save a lasting fact you mention without being asked.
3. To remove a fact, say "forget that ..." and Artemis deletes the line.
4. Ask about something from earlier ("what did we decide about the deploy last week?"). Artemis calls `memory_search`, which looks through all memory files, and `memory_get` to read more lines. `search_chats` still finds whole past conversations.
5. Artemis writes notable events of the day to the daily note with `memory_note`.
6. Open **Memory** in the sidebar to manage the `MEMORY.md` list in the app (add, edit, delete). Lines you wrote by hand in the file show up there too.

## Saving before compacting (memory flush)

When a long chat gets summarized to save tokens, the details of the older messages would be lost. Before that happens, a small model reads those messages and saves lasting facts you stated to `MEMORY.md` and notable events to today's note. It never saves passwords, keys, card numbers or health details, and it skips facts that are already saved. It runs on the side, so the chat does not wait for it.

Turn it off, or pick the model, in **Settings → Tools → Long-term memory**.

## Search by meaning (optional)

`memory_search` always searches by keywords (full-text, with ranking). If you set an **embedding model** in Settings → Tools → Long-term memory (for example `text-embedding-3-small` on OpenAI or OpenRouter, or `nomic-embed-text` on Ollama), it also searches by meaning and merges both result lists. Vectors are cached, so each piece of text is embedded once. **Rebuild index** re-reads every file and embeds what is missing.

## Settings

| Setting | Where | What it does |
| --- | --- | --- |
| Memory | Settings → Tools | Turns memory on or off for all chats |
| Save what matters before compacting | Settings → Tools → Long-term memory | The memory flush described above |
| Memory model | Settings → Tools → Long-term memory | Model for the flush (default: the scheduled-task model, else the chat's model) |
| Search by meaning | Settings → Tools → Long-term memory | Embedding model for `memory_search` |
| `memoryV2` | `settings.json` | `false` goes back to the old `memory.json` list |
| `workspaceFolder` | `settings.json` | Another folder for the memory files |

## Incognito chats

The ghost button at the top of the sidebar starts a **New incognito chat: not saved, no memory**. In an incognito chat:

- long-term memory is off, and nothing is saved to it (no flush either);
- the chat is not saved to history and disappears when you leave it;
- incognito chats are never searched by "Search my earlier chats", and Artemis does not learn skills from them.

## Moving from the old memory

The first time this version starts, the entries in `memory.json` are copied into `MEMORY.md`. `memory.json` itself is left untouched, so an older build still finds it. Entry ids are now derived from the text, so they change once.

## Tips

- Put stable things about you in `USER.md` and the style you want in `SOUL.md`; keep `MEMORY.md` for single facts.
- `SOUL.md`, `USER.md` and the `MEMORY.md` list are sent with every message, so keep them short. Daily notes and older facts cost nothing until they are searched.
- Use [Notes](Notes.md) for longer knowledge and [Skills](Skills.md) for how to do a task.
- Models that cannot call tools can still save and forget facts: Artemis lets them mark a fact at the end of a reply, and saves it for them.

## Limits and safety

- Everything stays on your computer: Markdown files in the memory folder and a search index in `artemis.db`.
- Messages from your phone and from the [Gateway](Gateway.md) use the same memory as the app.
- Sub-agents never get memory.
- `memory_get` reads only Markdown files inside the memory folder.

## See also

- [Gateway and command line](Gateway.md)
- [Notes](Notes.md)
- [Skills](Skills.md)
- [Chat and Projects](Chat-and-Projects.md)
