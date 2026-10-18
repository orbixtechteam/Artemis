# Sentinel (Voice)

Sentinel is Artemis's hands-free voice mode. You say "Wake up" or press a push-to-talk key, speak your request, and Artemis answers in the chat and reads the answer aloud. The same Voice settings also cover dictation (the mic button) and reading replies aloud.

## How to use

1. Open **Settings → Voice**.
2. Under **Dictation**, pick a **Speech-to-text provider**. It needs an endpoint that supports `/audio/transcriptions` (Whisper), such as OpenAI or Groq. Add the provider under **Settings → Providers** first. Then pick a **Speech-to-text model** (for example `whisper-1`, `gpt-4o-mini-transcribe` or `whisper-large-v3-turbo`).
3. Under **Reading voice**, pick a **Voice engine** and press **Test voice** (see [Voice engines](#voice-engines)).
4. Turn Sentinel on with the shield button next to the mic, or with the **Sentinel on/off** shortcut (default `Cmd/Ctrl+Shift+A`) from any app. The first time, the offline **Voice model** (about 40 MB) is downloaded.
5. Say **"Wake up"**. The phrase is recognized on your computer by a small offline model, without AI or internet.
6. Speak your request. Artemis answers in the chat, reads the answer aloud and keeps listening for your next sentence.
7. Say **"bye bye"**, or stay silent for 10 seconds, to end the conversation. Sentinel then waits for "Wake up" again.

### Push-to-talk

1. In **Settings → Voice**, click the **Push-to-talk shortcut** box and press a combination: Cmd, Option or Ctrl (optionally with Shift) plus a key, for example `Option+Space`. Esc cancels.
2. Press the key once to talk and again to send. A pause also sends. In the Artemis window you can also hold the key while you speak.
3. Push-to-talk works without "Wake up" and turns Sentinel on if needed. A lone modifier (for example Right Option), or a key without Cmd, Option or Ctrl, works only while the Artemis window is in front.

### The floating widget

While Sentinel is on, a small always-on-top widget shows what it is doing: listening, thinking or speaking, what it heard and what it said. It stays visible when the main window is minimized or hidden, and on every desktop.

- **Visible inside Artemis too.** By default the widget also stays visible while the Artemis window is in front. Turn on **Hide the widget while Artemis is open** if you prefer it to disappear while Artemis is in front and come back when you switch to another app or minimize Artemis.
- **Move it.** Drag it anywhere. It remembers where you left it and grows or shrinks from the corner it sits in, so it stays where you put it.
- **Modes.**
  - *Compact*: the pill, with the current state and the last sentence.
  - *Expanded*: a mini chat with the full messages, tool steps and a message box. Click **Bigger: read the full messages** on the pill, or say "expand".
  - *Viewer*: shows an artifact or a file from the conversation inside the widget, with copy, download and open buttons.
- **Size.** The expanded card and the viewer each have a size you pick: **S**, **M** or **L** (the size button in the widget). The viewer is also capped to a share of the screen.
- **Buttons.** Mute the microphone, stop and wait for "Wake up" again, turn Sentinel off, see what is happening in the Logs, and **Open this chat in the app**.
- **Computer control.** When Artemis controls the computer while Sentinel is on, the widget shows the run instead of the separate step panel. It stays compact unless you expand it, and it is kept out of the screenshots the model takes.

### Spoken commands

Short sentences that match a command run right away instead of going to the chat. Inside a conversation you can just say them. With push-to-talk, "Artemis, lock" is read as the command "lock". Examples:

| Say | What happens |
| --- | --- |
| "bye bye", "goodbye" | Ends the conversation |
| "stop listening", "go to sleep", "Sentinel off" | Turns Sentinel off |
| "mute", "mute the mic" | Mutes the microphone |
| "lock", "lock the app" | Locks Artemis (needs a password, see [Security and App Lock](Security-and-App-Lock.md)) |
| "new chat", "incognito chat" | Starts a new chat |
| "open settings", "open logs", "open skills"… | Opens that page |
| "expand", "collapse", "pin", "unpin" | Changes the widget |
| "move the widget left" (right, top, bottom, center) | Moves the widget to that edge of the screen |
| "show me in the app" | Brings the Artemis window to the front |
| "open github dot com" | Opens the site in the integrated browser |
| "status", "what is my usage" | Reads the chat settings or today's spend |
| "no tools", "no agents", "brain off", "think harder" | Changes the current chat |
| "yes" / "no" | Approves or denies a pending approval |

Long sentences (more than about 10 words) are treated as questions, not commands.

## Voice engines

Pick one under **Settings → Voice → Reading voice → Voice engine**. Each engine keeps its own settings. If a local server is not running, Artemis falls back to the computer voice.

| Engine | Notes |
| --- | --- |
| **Computer voice (built in)** | Works offline, sounds robotic. For better quality on a Mac, download a Premium or Enhanced voice in System Settings → Accessibility → Spoken Content → System Voice → Manage Voices, then restart Artemis. |
| **Kokoro (local server, OpenAI-compatible)** | Fast and streamed. Set the **Server address**, **Model** and **Voice name** (for example `af_heart`). Any server with an OpenAI-compatible `/audio/speech` endpoint works here. |
| **Chatterbox (local server, emotional)** | Slower but expressive. Default address `http://localhost:8004` (Chatterbox-TTS-Server). Has **Emotion (exaggeration)**, **Pace / guidance (cfg weight)**, **Temperature** and **Speed factor**. |
| **Piper (local server)** | Light. Set the **English voice** (for example `en_US-lessac-medium`). |

**Voices per language** lets you add a language with its own voice. With **Language** set to Auto-detect, Sentinel answers in the language you speak and reads the answer with a voice for it.

## Settings

| Setting | Where | What it does |
| --- | --- | --- |
| Microphone | Voice → Audio devices | Used by the mic button and Sentinel. |
| Speakers / headphones | Voice → Audio devices | Where Artemis's voice plays (local voice servers follow it; the computer voice uses the system output). |
| Push-to-talk shortcut | Voice | Talk to Sentinel without "Wake up". |
| Read replies aloud automatically | Voice → Dictation | Reads every reply with the reading voice. |
| Streaming voice (faster start) | Voice → Reading voice | Plays audio while the server is still making it. |
| Speed | Voice → Reading voice | Slower, Normal, Faster or Fast. |
| Natural pacing | Voice → Reading voice | Off, Subtle or Expressive pauses between sentences. |
| Thinking out loud | Voice → Reading voice | Lets spoken answers start with "Hmm," or "Well,". |
| Start Sentinel when Artemis opens | Voice → Sentinel mode | Turns Sentinel on at launch. The microphone stays on while Sentinel is on. |
| Only react when I say "Artemis" | Voice → Sentinel mode | Inside a conversation, a sentence counts only if it starts with "Artemis" or follows Artemis's answer within a few seconds. |
| Push-to-talk only | Voice → Sentinel mode | Listens only while you use the push-to-talk key. |
| Microphone sensitivity | Voice → Sentinel mode | High (quiet room), Normal, or Low (noisy room, speak close). |
| Load the voice model in the background | Voice → Sentinel mode | Makes turning Sentinel on instant, at the cost of CPU and memory right after launch. |
| Interrupt by talking | Voice → Sentinel mode | Start talking while Artemis speaks and it stops. Off by default. |
| Stop words | Voice → Sentinel mode | Say "stop", "enough" or "be quiet" to cancel. Off by default. Push-to-talk always interrupts. |
| Hide the widget while Artemis is open | Voice → Sentinel mode | Off by default: the widget stays visible inside Artemis. |
| Sentinel model | Voice → Sentinel mode | A small, fast model for voice chats so answers start sooner. |
| Voice model | Voice → Sentinel mode | Shows whether the offline wake-word model is installed; **Remove** deletes it. |

## Tips

- Use headphones if you turn on **Interrupt by talking**; otherwise Artemis's own voice or room noise can cut it off.
- Pick a small model as the **Sentinel model**. Short spoken answers rarely need a big one.
- If short sentences get misheard with Auto-detect, set **Language** to one language.
- Press **Test voice**, **Test emotion** and **Test natural pacing** to hear your settings before using them.

## Limits and safety

- The wake word and stop words are recognized offline. Your sentences are sent to the speech-to-text provider you picked.
- The microphone stays on while Sentinel is on. Mute it from the widget or say "mute".
- To accept only your own voice, set up voice recognition in [Security and App Lock](Security-and-App-Lock.md).

## See also

- [Security and App Lock](Security-and-App-Lock.md)
- [Quick Window and Shortcuts](Quick-Window-and-Shortcuts.md)
- [Computer Control](Computer-Control.md)
- [Providers and Models](Providers-and-Models.md)
- [Troubleshooting](Troubleshooting.md)
