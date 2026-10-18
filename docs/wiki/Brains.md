# Brains

Brains are named personalities that can each answer with their own model. You can talk to one brain, or let the council of brains vote on who answers and which skills and agents to use.

## How to use

1. In a chat, open the brain menu next to the model picker.
2. Pick one brain (Lancelot, Galahad or Percival), **Council (vote)**, or **No brain** for plain Artemis.
3. Send your message. With a single brain, it answers in its own tone with its own model.
4. With **Council (vote)**, every brain votes first. The majority picks who answers; skills and agents are used only when at least two brains vote for them. The vote is shown in the chat.
5. The council's choice sticks for the chat. Click **Re-vote** next to the brain menu to ask the council again for the next message.

## Built-in brains

| Brain | Role | Personality |
| --- | --- | --- |
| Lancelot | The Architect | Logical, fast and decisive. Answer first, then short reasoning |
| Galahad | The Guardian | Careful and thorough. Checks facts, points out risks, asks before hard-to-undo actions |
| Percival | The Unbound | Warm, creative and intuitive. Good for writing, ideas and simple explanations |

## Settings

| Setting | Where | What it does |
| --- | --- | --- |
| Default brain for new chats | Settings → Brains | No brain, Council, or one brain. Telegram and scheduled tasks use this brain too (Council only works in the app) |
| Role | Settings → Brains → Edit… | The brain's title |
| What is it good at? | Settings → Brains → Edit… | The council reads this line when it decides who should answer |
| Model | Settings → Brains → Edit… | This brain answers with this model, whatever model the chat uses. Empty means "Same as chat" |
| Personality | Settings → Brains → Edit… | The text added to the system prompt when this brain answers |

Click **Save brain** to keep your changes. An edited brain shows **edited**, and **Reset** restores its default personality and model.

## Files

Edited brains are saved as `<userData>/brains/<slug>.md`, with frontmatter (`name`, `role`, `description`, `model`, `order`) and the personality as the body.

## Tips

- Give each brain a different model, for example a fast cheap model for Lancelot and a stronger one for Galahad.
- A brain only changes tone and model. Every other rule, tool and approval stays the same.

## Limits and safety

- A council vote costs a few thousand tokens per vote, because every brain makes one short model call.
- At most 5 brains vote.
- Council is never the default unless you choose it in Settings → Brains.

## See also

- [Sub-Agents](Sub-Agents.md)
- [Skills](Skills.md)
- [Providers and Models](Providers-and-Models.md)
- [Usage Limits](Usage-Limits.md)
