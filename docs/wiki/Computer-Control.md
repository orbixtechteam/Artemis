# Computer Control

On macOS, Artemis can see your screen and use the mouse and keyboard to work in other apps. It asks once per task, and one shortcut stops it at any time.

## How to use

1. Turn on Settings → Tools & safety → **Computer control (macOS)**.
2. Open Settings → **Access** → macOS permissions and allow **Screen Recording**, **Accessibility** and **Automation (System Events)**. If you run Artemis from a terminal, allow the terminal app instead. macOS may ask you to restart Artemis.
3. Optional: run `pnpm selftest:computer` from the repo to check that everything works.
4. Ask for a task, for example "open Safari and go to example.com".
5. Approve the card (**Allow for this task**). Artemis can now control the computer until the task ends.
6. To stop, press **Cmd/Ctrl+Shift+Esc** or click **Stop**.

## What happens on screen

- If you were working in Artemis, its window minimizes so the screen behind it can be seen, and comes back at the end.
- If you were in another app (for example talking to Sentinel), the Artemis window is not moved; it is only hidden from screenshots.
- A small always-on-top panel in a screen corner shows the steps and has a **Stop** button. It never takes focus and is hidden from screenshots. You can drag it by its bar.
- When Sentinel is on, the Sentinel widget is used instead of the floating panel. It stays visible to you, compact (it is not expanded automatically), and hidden from screenshots. Click it to see the steps.
- Screenshots the agent takes appear in the chat on the tool card.

## Actions

| Action | What it does |
| --- | --- |
| `open` | Launch an app or open a URL in the default browser. |
| `ui` | List the buttons and fields of the front window (and of system toolbars or dialogs) as text. |
| `click_ui` | Click an element by its name, optionally filtered by role or app. |
| `key`, `type` | Press keys (for example `cmd+c`) or type text. |
| `left_click`, `double_click`, `right_click`, `left_click_drag`, `mouse_move`, `scroll` | Mouse actions at pixel positions of the latest screenshot. |
| `screenshot` | A picture of the screen. Artemis is not in it unless `include_artemis` is used. |
| `app_screenshot` | A picture of the Artemis window itself. Works while it is minimized or covered and needs no Screen Recording permission. |
| `capture_screen` | Save a screenshot file (main display, all displays, the front window or a region). Default: the Desktop. Never overwrites. |
| `record_screen_start`, `record_screen_stop` | Record the screen to a `.mov` file, optionally with the microphone. Stops by itself after 300 seconds by default (max 3600). |
| `wait` | Pause for a number of milliseconds. |

Up to 15 actions can run in one call, and `look` returns a screenshot after them.

## Settings

| Setting | Where | What it does |
| --- | --- | --- |
| Computer control (macOS) | Tools & safety → Tools, or Access | Turns the computer tool on. |
| macOS permissions | Access | Screen Recording, Accessibility and Automation status, with **Allow** buttons. |
| Switch heavy tools on only when needed | Tools & safety → Saving tokens | The computer tool is sent only after the agent asks for it. |

## Tips

- Screenshots are slow and cost many tokens. Artemis prefers `open`, `ui` and `click_ui`, and takes a screenshot only to check a milestone.
- To see what is on the Artemis window, ask for a screenshot "of Artemis"; it uses `app_screenshot`.
- Use a model that can read images for tasks that need screenshots. If the model cannot read them, the picture is still shown to you in the chat.

## Limits and safety

- macOS only. Touch ID can be required before computer control; see [Security and App Lock](Security-and-App-Lock.md).
- Computer control can reach anything your user account can. It is never given to sub-agents.
- Text in screenshots is treated as untrusted data; Artemis does not follow instructions it sees on screen.

## See also

- [Tools and Approvals](Tools-and-Approvals.md)
- [Sentinel Voice](Sentinel-Voice.md)
- [Browser](Browser.md)
- [Troubleshooting](Troubleshooting.md)
