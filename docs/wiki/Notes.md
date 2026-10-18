# Notes

Notes are a folder of Markdown files shown at the top of the sidebar. They support folders, search, `[[wiki links]]`, embeds, images and a graph view, and Artemis can search, read and write them when you allow it.

## How to use

1. Click **+** (**New note**) in the **Notes** header of the sidebar. The note is created in the folder you last selected.
2. Type a title at the top of the note (click it later to rename) and write in Markdown. The bar shows **Saving…** / **Saved** and the word count; notes save automatically.
3. Switch between **Edit**, **Split** and **Preview**. In **Split**, choose **Side by side** or **Editor above, preview below**. The mode is remembered per note.
4. Link notes with `[[Note name]]`. Typing `[[` suggests existing notes. Clicking a link opens the note, or creates it if it does not exist yet.
5. Embed another note inline with `![[Note name]]`.
6. Drop or paste images (and other files such as PDFs, audio or video) into a note. They are saved next to the note, so relative links keep working.
7. Click **Notes that link here** to see backlinks.
8. Use **Find & replace** (Cmd/Ctrl+F) inside a note.

### Organize

- **New folder** (folder icon) creates a folder. Right-click a folder for **New note here** and **New folder here**.
- Right-click a note for **Open**, **Open in new tab**, **Open in split view**, **Rename**, **Move to…** and **Delete**.
- Double-click a name to rename it in place.
- Drag a note or folder onto a folder to move it, or onto "Drop here to move to the top level".
- Click the search icon (**Search notes**) to search titles and text.

### Open notes like chats

- Click: open in the current tab.
- Cmd/Ctrl-click: open in a new tab.
- Right-click → **Open in split view**: show the note next to a chat.

### Graph view

Click **Graph view** in the Notes header (or **Notes graph** in the command palette). Each note is a node and each link is an edge; links to notes that do not exist yet show as ghost nodes. Use **Filter notes…** to narrow the graph, **Reload** and **Fit to screen**. Click a node to open the note, Cmd/Ctrl-click or middle-click to open it in a new tab, and drag nodes to rearrange them.

## Let Artemis use your notes

With **Notes knowledge base** on, Artemis can use these tools:

| Tool | What it does | Asks first |
| --- | --- | --- |
| notes_list | Lists folders and notes | Once per task |
| notes_search | Searches titles and text | Once per task |
| notes_read | Reads one note | Once per task |
| notes_write | Creates or replaces a note | Yes |
| notes_edit | Replaces one passage in a note | Yes |
| notes_append | Adds text to the end of a note, creating it if needed | Yes |

Ask things like "what did I write about the Q3 launch in my notes?" or "add today's meeting summary to Meetings/Weekly.md". A note changed by Artemis (from the app, Sentinel, the phone or an MCP client) shows up in the sidebar right away, and an open note reloads.

Notes and project files are different places. If Artemis asks for a note that does not exist but a project file with that path does, it reads the file and says so.

## Settings

| Setting | Where | What it does |
| --- | --- | --- |
| Notes knowledge base | Settings → Tools & safety | Artemis can search and read your notes after you approve |

## Files library

Files you attach to chats are kept in a separate **Files library** (default `Documents/Artemis/Files`), shown on the **Files** page. With **Notes knowledge base** on, Artemis can also list, search and read files there (`library_*` tools); writing and deleting library files ask first. See [Files and Attachments](Files-and-Attachments.md).

## Tips

- Notes are plain `.md` files, so you can open the same folder in another Markdown editor or sync it with any sync tool.
- The notes folder defaults to `Documents/Artemis Notes`.
- Task-list checkboxes (`- [ ]`) can be ticked in the preview.

## Limits and safety

- A file dropped into a note can be at most 25 MB.
- Notes are not encrypted; they are ordinary files on your disk.

## See also

- [Memory](Memory.md)
- [Files and Attachments](Files-and-Attachments.md)
- [Quick Window and Shortcuts](Quick-Window-and-Shortcuts.md)
- [MCP](MCP.md)
