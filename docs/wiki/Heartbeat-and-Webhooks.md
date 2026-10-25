# Heartbeat, timed tasks and webhooks

Three ways Artemis works by itself, all on the **Scheduled** page. They run where the background jobs run: in the app while it is open, or in the background gateway while it runs (Settings → Gateway → Keep running in the background), so they also work while the app is closed.

## Every few minutes, at certain hours and days

A scheduled task set to **Every few minutes / hours** can also be limited to a time of day and to some days: *every 30 minutes, only between 09:00 and 18:00, Monday to Friday*. Tick **Only between** for the hours and click the days below it (all days by default). A window such as 22:00–06:00 runs past midnight. The editor shows the next run times as you change it. At most every 5 minutes.

In chat, just say it: *"every 30 minutes on weekdays from 9 to 6, check …"*. It costs the same as any scheduled task: one run each time.

## Heartbeat

A heartbeat is a short checklist that Artemis goes through every few minutes. You can have several, each with its own name, checklist, interval (2 minutes to 24 hours), hours and model: for example *Inbox* every 10 minutes and *Website* every 6 hours (Scheduled → Heartbeat → New heartbeat). The first one keeps its checklist in `HEARTBEAT.md` in the memory workspace, the others in `heartbeats/<id>.md`:

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
- In chat: *"keep an eye on my inbox for messages from the bank, every 5 minutes"* → `heartbeat_set` creates or changes a heartbeat; `heartbeat_get` lists them and `heartbeat_delete` removes one (changes ask for approval every time).

It is the right tool for "tell me when …" without a fixed time; a scheduled task is the right tool for "every morning at 9 …".

### Cost

Each check is one model call: the system prompt and tools plus the checklist, about 5–8 thousand input tokens and a few output tokens. When an item needs a tool (your mail through a connector, a web search) each extra step sends the context again, so such a check costs 2–4 times as much. The heartbeat editor shows how many checks a day its settings make. Rough numbers for **every 30 minutes, day and night (48 checks a day)**:

| Model | Per day | Per month |
| --- | --- | --- |
| DeepSeek | ~$0.02–0.08 | ~$0.5–2.5 |
| GLM | ~$0.15 | ~$5 |
| Claude Haiku | ~$0.3 | ~$9 |
| Claude Sonnet | ~$0.9 | ~$27 |

Prices change and depend on your provider; prompt caching (DeepSeek, Anthropic) lowers them, because most of each check is the same as the last one. Every 2 minutes is 720 checks a day, 15 times the table above. To keep it cheap: pick a cheap **model** for each heartbeat, keep checklists to a few items, give fast intervals only to what really needs them, and limit the hours if night checks are not needed. Every check shows up in Settings → Usage as source `heartbeat`.

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

Files: `electron/scheduler.js`, `electron/core/heartbeat.js`, `hooks.js`, `hookservice.js`, `tunnel.js`. State: `<data>/heartbeats.json` (the list), `heartbeat-state.json`, `hooks.json` (private, it holds the secrets), `hooks-state.json`.
