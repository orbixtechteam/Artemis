# Usage Limits

Artemis records the tokens every request uses and estimates the cost from the prices you set per model. You can cap spending and tokens per day and per month, and limit how long a single answer may be.

## How to use

### Set a spending limit

1. Open Settings → **Usage limits**.
2. Under **Quick setup**, pick a preset: **No spending limit**, **Light: $1/day, $20/month**, **Normal: $5/day, $50/month** or **Heavy: $20/day, $200/month**.
3. Or set each limit yourself under **Spending** (**Spending today**, **Spending this month**) and **Tokens** (**Tokens today**, **Tokens this month**): click a preset chip, **Off**, or type a custom value (for example `7.5` dollars or `750k` tokens) and press Enter.

Each row shows how much you used and a progress bar once a limit is set. Artemis warns at 80% and stops answering when a limit is reached.

### See your usage

- Click the **Usage** button (chart icon) next to the message box for a quick summary.
- Open the full **Usage** window from the command palette (`Cmd/Ctrl+K` → Usage). It shows **Total tokens**, **Prompt (in)**, **Response (out)**, **Requests** and **Est. cost** for **Last 24 hours**, **Last 7 days**, **Last 30 days** or **All time**, filtered by project, with tokens per day for the last 14 days and breakdowns **By model**, **By chat** and **By project**. **Reset stats** clears the history.

### Limit the length of one answer

Under **Answers**, set **Max length of one answer (tokens)**: 2k, 4k, 8k, 16k, 32k or a custom number. Longer answers cost more; 8192 fits most replies.

## Settings

| Setting | Where | What it does |
| --- | --- | --- |
| Spending today / this month | Settings → Usage limits → Spending | Stops answering when the estimated cost reaches the limit |
| Tokens today / this month | Settings → Usage limits → Tokens | Stops answering when the token count reaches the limit |
| Max length of one answer (tokens) | Settings → Usage limits → Answers | Caps the tokens of a single reply |
| Models (with prices) | Settings → Providers → provider editor | `model-id \| price in \| price out` in USD per 1M tokens; the basis for cost estimates |

## How long runs and long chats are handled

These are automatic; there is no setting for them in the UI.

- **Run budget.** One run (all tool steps of one answer together) may use about 1.5M tokens. When a run goes over, Artemis summarizes the earlier steps and carries on (up to three times, and only while the run keeps changing things). Otherwise it stops with a notice; send a message to continue.
- **Compaction.** When a chat's history grows past about 40,000 tokens, the older part is summarized. You see "Conversation compacted: earlier messages were summarized to save tokens." and a collapsed **Earlier conversation compacted (N messages summarized)** entry in the chat that you can expand. If summarizing fails, old tool output is shortened instead.
- **Screenshots.** Only the newest screenshots are kept in the request; older ones are replaced with a short note.

## Tips

- Costs are estimates from list prices. Cached input is billed at 10% of the input price; image and video generation is not included.
- Local models without a price count as free, so a token limit is the better cap for them.
- To save tokens, keep **Switch heavy tools on only when needed** and **Switch connectors on only when needed** on (Settings → Tools & safety), and turn the **Tools** pill off for plain-chat conversations.
- Only token counts are stored for usage, never message text. Incognito chats are not counted.

## Limits and safety

- A limit only works for models with a price. Add prices in the provider's **Models** box.
- When a limit is reached, every chat stops answering until the day or month rolls over or you raise the limit.

## See also

- [Providers and Models](Providers-and-Models.md)
- [Chat and Projects](Chat-and-Projects.md)
- [Scheduled Tasks](Scheduled-Tasks.md)
