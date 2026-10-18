# Security and App Lock

**Settings → Security** locks the Artemis window behind a password, with Touch ID and your own voice as optional ways to unlock. It can also recognize your voice offline, lock when a stranger speaks, and alert you on Telegram after repeated failed attempts.

It is an app lock, not disk encryption: it does not protect your files from someone with full access to your Mac account. Scheduled tasks keep running while Artemis is locked.

## How to use

### Set up the lock

1. Open **Settings → Security**.
2. Under **App lock**, turn on **Lock Artemis with the password**, then enter a **New password** and **Repeat the new password**.
3. Artemis shows **Your recovery code** once. Write it down or store it in a password manager. It unlocks Artemis even during a lockdown. You can create a new one later with **Make a new code**.
4. Under **When to lock**, choose any of:
   - **When Artemis starts**: the lock screen appears every time the app opens.
   - **After being idle**: no keyboard, mouse or Sentinel use for the time you pick. Idle time of the whole Mac counts too.
   - **When the Mac sleeps or the screen locks**: locks as soon as the lid closes or you lock the screen.
5. Under **Unlock with**, turn on **Touch ID** (needs a Mac with a fingerprint reader) and, after voice recognition is set up, **My voice (Sentinel)**. The password always works.

### Lock right away

Any of these locks Artemis immediately:

- the **Lock now** button in Settings → Security;
- the **Lock Artemis** shortcut (default `Cmd+Option+Shift+L`, set in Settings → Keyboard shortcuts);
- the menu bar (tray) icon;
- the command palette;
- saying "Artemis, lock" while Sentinel is on.

### Set up voice recognition

1. Under **Voice recognition**, press **Download** next to **Voice model** (about 28 MB, downloaded once).
2. Press **Enrol my voice** and read each sentence aloud with **Record**. Use your normal voice, in a quiet room, close to the microphone. Record at least three.
3. Press **Test my voice** to see how well it recognizes you, and adjust **Strictness** if needed. Higher is stricter: fewer strangers get in, but you may be refused more often.
4. Choose how other voices are handled:
   - **Only respond to my voice**: Sentinel ignores anyone else (push-to-talk too), and another voice hears "Unauthorized access."
   - **Let other voices chat only**: another voice can talk to Artemis, but nothing is executed for it (no tools, files, memory or commands, and it cannot see your chats). "Only respond to my voice" takes priority.
   - **Lock Artemis when another voice speaks**: the first voice that is not yours locks the app right away.

### Unauthorized access alerts

1. Under **Unauthorized access**, set **Failed voice attempts**, **Failed password or Touch ID attempts** and the **Counted within** window.
2. Turn on **Tell me on Telegram** (needs the Telegram bot from [Phone (Telegram)](Phone-Telegram.md)) and press **Send a test alert**.
3. Optionally turn on **Send a photo from the camera**: one webcam picture goes with the alert and is not saved on the Mac. It needs camera access.

After repeated failures Artemis locks for 5 minutes, then 15, 60 and 240 if it keeps happening. During a lockdown voice, password and Touch ID are off; only the recovery code works.

## Settings

| Setting | Where | What it does |
| --- | --- | --- |
| Lock Artemis with the password | Security → App lock | Turns the app lock on. Off until you set a password. |
| When Artemis starts | Security → When to lock | Locks at every launch. |
| After being idle | Security → When to lock | Locks after the idle time you pick. |
| When the Mac sleeps or the screen locks | Security → When to lock | Locks on sleep or screen lock. |
| Touch ID | Security → Unlock with | Unlock with your fingerprint. |
| My voice (Sentinel) | Security → Unlock with | Your voice opens the lock screen. Needs the voice model and an enrolled voice. |
| Touch ID before sensitive actions | Security → Sensitive actions | Asks for Touch ID when you approve a delete, terminal, computer control, connector write or file write in a chat. |
| Only respond to my voice | Security → Voice recognition | Ignores every other speaker. |
| Let other voices chat only | Security → Voice recognition | Other voices can talk but nothing runs for them. |
| Lock Artemis when another voice speaks | Security → Voice recognition | Locks on the first stranger's voice. |
| Strictness | Security → Voice recognition | How close a voice must match yours. |
| Failed voice attempts / Failed password or Touch ID attempts | Security → Unauthorized access | How many failures start a lockdown. |
| Counted within | Security → Unauthorized access | The time window for counting failures (1 to 60 minutes). |
| Tell me on Telegram | Security → Unauthorized access | Sends an alert to your paired Telegram chat. |
| Send a photo from the camera | Security → Unauthorized access | Attaches one webcam picture to the alert. |
| Pause the phone while locked | Security → Unauthorized access | On: Artemis does not answer from Telegram until you unlock it on the computer. |

## Tips

- Keep the recovery code somewhere other than the Mac itself.
- **Touch ID before sensitive actions** is not asked in chats set to approve everything, when you approve from the phone, or for scheduled tasks.
- If you are refused often, record your voice again in the room where you usually use Sentinel, or lower **Strictness**.

## Limits and safety

- While locked, Artemis refuses every action from the window, the MCP server answers "locked", and Sentinel keeps listening (so your voice can unlock it, if enabled).
- Voice recognition runs on your Mac. Nothing is sent anywhere and no recordings are kept. The model is WeSpeaker CAM++ (CC BY 4.0).
- A recording or a cloned voice can fool speaker recognition. That is why sensitive actions can ask for Touch ID.
- Voice recognition needs `onnxruntime-node`, which `pnpm install` installs. If it is missing, Settings shows **Speech engine missing**.

## See also

- [Sentinel (Voice)](Sentinel-Voice.md)
- [Phone (Telegram)](Phone-Telegram.md)
- [Tools and Approvals](Tools-and-Approvals.md)
- [Scheduled Tasks](Scheduled-Tasks.md)
- [Quick Window and Shortcuts](Quick-Window-and-Shortcuts.md)
