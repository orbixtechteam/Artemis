# Quick Window and Shortcuts

Artemis keeps running in the tray (menu bar) so you can reach it from any app. The Quick window gives you a small chat and a search box, the command palette finds anything inside the main window, and tabs and split view let you keep several chats and notes open.

## How to use

### Quick window

1. Click the tray icon, or press the **Quick chat** shortcut (default `Cmd/Ctrl+Shift+Space`) from any app. The Quick window opens on its **Chat** tab.
2. Type your message. The conversation works like a normal chat.
3. Press **Open in the main window** to move the conversation into Artemis.
4. Switch to the **Search** tab with `Cmd/Ctrl+2` (back to Chat with `Cmd/Ctrl+1`) to find chats, notes, files and actions without opening the main window. The **Quick search** shortcut opens the window directly on this tab.
5. Press Esc to hide the window. Pressing the shortcut while the window is open on the other tab switches tabs instead of closing it.

### Command palette

1. In the main window press `Cmd/Ctrl+K`.
2. Type to search actions, chats, notes, files and settings pages (fuzzy matching).
3. `Enter` opens the result, `Cmd/Ctrl+Enter` opens a chat or note in a new tab, `Esc` closes.

### Tabs and split view

1. Chats and notes open in tabs. `Cmd/Ctrl`-click a chat or note in the sidebar to open it in a new tab.
2. Drag a tab to reorder it. Middle-click closes it. `Cmd/Ctrl+1…9` jumps to a tab, and `Cmd+Option+Left/Right` (or `Ctrl+Shift+PageUp/PageDown`) moves the active tab.
3. Right-click a tab and choose **Pin tab** to keep it compact on the left. Pinned tabs survive `Cmd/Ctrl+W` and **Close other tabs**.
4. Right-click a tab or a sidebar item and choose **Open in split view** to show it next to the current chat.
5. Tab order and pins are restored the next time Artemis starts.

### Find in a chat or note

Press `Cmd/Ctrl+F` in the pane that has the focus (or is under the mouse). `Enter` / `Shift+Enter` or `Cmd/Ctrl+G` / `Cmd/Ctrl+Shift+G` move to the next or previous match; `Esc` closes.

## Shortcuts

Set them in **Settings → Keyboard shortcuts**: click a box and press the keys. Esc cancels, **Clear** turns the shortcut off. You can also type an Electron accelerator such as `CommandOrControl+Shift+Space`.

| Shortcut | Default | Where |
| --- | --- | --- |
| Quick chat: open or hide the Quick window on its Chat tab | `Cmd/Ctrl+Shift+Space` | Any app |
| Quick search: open the Quick window on its Search tab | Off (for example `Cmd/Ctrl+Shift+F`) | Any app |
| Sentinel on/off, without bringing Artemis to the front | `Cmd/Ctrl+Shift+A` | Any app |
| Lock Artemis (needs a password set in Security) | `Cmd+Option+Shift+L` | Any app |
| Command palette | `Cmd/Ctrl+K` | Artemis window |
| Find in chat or note (not configurable) | `Cmd/Ctrl+F` | Artemis window |
| Sentinel push-to-talk (set in Settings → Voice) | Off | Any app (see [Sentinel](Sentinel-Voice.md)) |
| Emergency stop for computer control | `Cmd/Ctrl+Shift+Esc` | Any app, while Artemis controls the computer |

## Settings

| Setting | Where | What it does |
| --- | --- | --- |
| Quick chat | Keyboard shortcuts → From any app | Opens or hides the Quick window on its Chat tab. |
| Quick search | Keyboard shortcuts → From any app | Opens the Quick window on its Search tab. |
| Sentinel on/off | Keyboard shortcuts → From any app | Turns voice mode on or off. |
| Lock Artemis | Keyboard shortcuts → From any app | Locks the app right away. |
| Command palette | Keyboard shortcuts → In Artemis | Opens or closes the palette. |
| Quick chat shortcut opens the palette | Keyboard shortcuts → In Artemis | With the Artemis window in front, the Quick chat shortcut opens the palette instead of the Quick window. |
| Keep running in the background | General | Closing the window keeps Artemis running. Needed for the phone bot and scheduled tasks. |
| Start Artemis when I log in | General | Starts Artemis when you log in. |

## Tips

- With **Keep running in the background** on, closing the main window keeps Artemis running, which the Telegram bot and scheduled tasks need. Quit with `Cmd+Q` or from the menu bar icon.
- The Search tab is the fastest way to reopen a note or file from another app.

## Limits and safety

- A global shortcut that another app already uses cannot be registered. Settings shows the error under the field and leaves that shortcut off; pick another combination.

## See also

- [Chat and Projects](Chat-and-Projects.md)
- [Notes](Notes.md)
- [Sentinel (Voice)](Sentinel-Voice.md)
- [Security and App Lock](Security-and-App-Lock.md)
- [Troubleshooting](Troubleshooting.md)
