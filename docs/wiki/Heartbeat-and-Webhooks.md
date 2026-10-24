# Heartbeat, cron and webhooks

Three ways Artemis works by itself, all on the **Scheduled** page. They run where the background jobs run: in the app while it is open, or in the background gateway while it runs (Settings → Gateway → Keep running in the background), so they also work while the app is closed.

## Cron expressions

Scheduled tasks have one more repeat type: **Custom (cron expression)**. Five fields in your local time: minute, hour, day of month, month, day of week.

| Expression | Runs |
| --- | --- |
| `*/30 9-18 * * 1-5` | every 30 minutes, 9:00–18:30, Monday to Friday |
| `0 9 1,15 * *` | 9:00 on the 1st and the 15th |
| `0 8 * * mon` | Mondays at 8:00 |
| `@daily` / `@hourly` / `@weekly` | shortcuts |

`*`, ranges (`1-5`), lists (`1,15`), steps (`*/15`) and names (`mon-fri`, `jan,jul`) work. When both the day of month and the day of week are set, a day matches when either does (as in classic cron). A task cannot run more often than every 5 minutes. In chat: *"every 30 minutes on weekdays from 9 to 6, check …"* uses `repeat: cron` by itself.

A cron task costs the same as any scheduled task: one run each time.

## Heartbeat

A short checklist, `HEARTBEAT.md` in the memory workspace, that Artemis goes through every few minutes:

```markdown
# Heartbeat
- If an email from a client or my bank arrived since the last check, tell me who and what in one line.
- If a meeting in my calendar starts within the next 30 minutes, remind me.
```

- When nothing needs you, the model answers `HEARTBEAT_OK` and you hear nothing.
- When something does, its message arrives as a chat, a notification and on Telegram (Scheduled → Heartbeat → *Send alerts to my phone*).
- The same alert is not sent twice within 24 hours, and the last alert is shown to the model so it does not repeat itself.
- Day and night by default; you can limit it to hours (*Only between…*, e.g. 08:00–23:00, or 22:00–06:00 across midnight).
- Off by default. With an empty checklist no check runs at all.
- In chat: *"keep an eye on my inbox for messages from the bank"* → `heartbeat_set` (asks for approval every time).

It is the right tool for "tell me when …" without a fixed time; a scheduled task is the right tool for "every morning at 9 …".

### Cost

Each check is one model call: the system prompt and tools plus the checklist, about 5–8 thousand input tokens and a few output tokens. When an item needs a tool (your mail through a connector, a web search) each extra step sends the context again, so such a check costs 2–4 times as much. Rough numbers for **every 30 minutes, day and night (48 checks a day)**:

| Model | Per day | Per month |
| --- | --- | --- |
| DeepSeek | ~$0.02–0.08 | ~$0.5–2.5 |
| GLM | ~$0.15 | ~$5 |
| Claude Haiku | ~$0.3 | ~$9 |
| Claude Sonnet | ~$0.9 | ~$27 |

Prices change and depend on your provider; prompt caching (DeepSeek, Anthropic) lowers them, because most of each check is the same as the last one. To keep it cheap: pick a cheap **model** for the heartbeat (Scheduled → Heartbeat → Model), keep the checklist to a few items, use 30–60 minutes, and limit the hours if night checks are not needed. Every check shows up in Settings → Usage as source `heartbeat`.

## Webhooks

An address that an outside service calls when something happens: GitHub (a new issue), Stripe (a payment), a form, n8n, Zapier, a script. Artemis then follows that webhook's instructions by itself and tells you.

Scheduled → Webhooks → switch on the **webhook server**. It has its own port (8790 by default) and answers nothing but:

```
POST /hooks/<name>      → 202 { ok, accepted, id }   (the run happens right after)
GET  /health
```

so it can be put on the internet without exposing chats, memory or the gateway.

Each webhook has:

- **Instructions**: what to do with each event (*"Summarise the new issue in two lines"*).
- **Who can call it**:
  - *Secret token*: `Authorization: Bearer <secret>`, `X-Artemis-Token: <secret>` or `?token=<secret>`.
  - *GitHub signature*: `X-Hub-Signature-256`; paste the webhook's secret into GitHub.
  - *Stripe signature*: `Stripe-Signature`, checked with the `whsec_…` signing secret from Stripe; at most 5 minutes old.
- **Events**: only these start a run (`issues.opened`, `pull_request`, `invoice.*`); others get `200 ignored` and cost nothing. GitHub's `ping` is answered without a run.
- **At most per hour** (default 20; more get `429`), a model, a project, phone on/off, and whether it may edit files.

The event's data reaches the model inside `<payload>` with a note that it is data, not instructions, so text such as "ignore your instructions" in an issue title is not followed. Bodies up to 1 MB; the model sees the first 20,000 characters. When an event needs no message the model answers `NO_REPLY` and the run stays quiet. Each event is one run (the same cost as a scheduled task), so filter the events you need.

In chat: *"make me a webhook for new GitHub issues in my repo"* → `hook_create` (asks for approval) returns the URL, the secret and where to paste them. `hook_list` and `hook_delete` too.

### On the internet (Cloudflare tunnel)

The server listens on `127.0.0.1` only. For services on the internet pick **On the internet**:

- **Cloudflare quick tunnel**: no account. Artemis runs `cloudflared tunnel --url http://127.0.0.1:8790` and shows the `https://….trycloudflare.com` address. Free, but the address changes every time the tunnel starts, so you update it in the other service.
- **Cloudflare tunnel with your own domain**: create a tunnel in Cloudflare (Zero Trust → Networks → Tunnels), add a public hostname such as `hooks.example.com` pointing at `http://127.0.0.1:8790`, and paste the tunnel token and the address in Artemis. Free and stable.

Both need `cloudflared` (`brew install cloudflared`). The tunnel only ever reaches the webhook port. The token is stored encrypted like other secrets; the background gateway also reads `ARTEMIS_TUNNEL_TOKEN` or `tunnelToken` in `headless.json`.

### Testing a webhook

```bash
curl -X POST http://127.0.0.1:8790/hooks/form \
  -H "Authorization: Bearer <secret>" -H "content-type: application/json" \
  -d '{"type":"signup","name":"Ali","email":"ali@example.com"}'
```

Files: `electron/core/cron.js`, `heartbeat.js`, `hooks.js`, `hookservice.js`, `tunnel.js`. State: `<data>/heartbeat.json`, `hooks.json` (private, it holds the secrets), `hooks-state.json`.
