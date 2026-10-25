# Providers and Models

Artemis talks to any server that speaks the OpenAI chat API (`/v1/chat/completions` with streaming and tool calling). You add providers in Settings, and the models from every enabled provider appear in the model picker.

## How to use

### Add a provider

1. Open Settings (`Cmd/Ctrl+,`) → **Providers** and click **Add provider…**.
2. Under **Start from**, pick a preset. Each preset fills in the name, the endpoint URL and, for some, a starter model list:

   | Preset | Endpoint | Key |
   | --- | --- | --- |
   | Cloudflare Workers AI | Cloudflare account endpoint | required |
   | Ollama (local) | `http://localhost:11434/v1` | none |
   | LM Studio (local) | `http://localhost:1234/v1` | none |
   | OpenRouter | `https://openrouter.ai/api/v1` | required |
   | OpenAI | `https://api.openai.com/v1` | required |
   | Anthropic (Claude API) | `https://api.anthropic.com/v1` | required (pay per token; Claude Pro/Max logins cannot be used) |
   | Custom (OpenAI-compatible) | any server with `/v1/chat/completions` | optional |

3. Check **Name** and **Endpoint URL** (with or without `/v1`).
4. Paste the **API key**. Keys are stored encrypted. For an existing provider the field shows that a key is saved; type a new one to replace it.
5. Click **Fetch models** to load the provider's list. Pick models one by one with **Add a model**, or edit the **Models** box directly.
6. Click **Test connection**, then **Add provider**.

Provider changes are saved right away. Use the switch on a provider row to enable or disable it, **Edit…** to change it, and **Remove** inside the editor to delete it together with its key.

### The Models box

One model per line:

```
model-id
model-id | price in | price out
```

Prices are USD per 1M tokens and optional. Artemis uses them to estimate spending and enforce [usage limits](Usage-Limits.md). Models without a price count as free (local models, for example).

Internally a model is addressed as `prov:<providerId>:<modelId>`.

### Pick a model

- **Default model** (Settings → General → Model) is used for new chats.
- Each chat has a model picker at the top; changing it affects only that chat.
- **Reasoning level** (Auto, Low, Medium, High) sets how hard the model thinks. Set the default in Settings → General and change it per chat next to the model picker. Models that do not support it ignore it.

### Models for specific jobs

Several features can use a smaller, cheaper model than your chat model:

| Setting | Where | Used for |
| --- | --- | --- |
| Model for scheduled tasks | Settings → General → Scheduled tasks | Every scheduled task without its own model |
| Title model | Settings → General → Chat titles | Automatic chat titles |
| Learning model | Settings → Tools & safety → Skills and learning | Deciding whether a finished task is worth saving as a skill |
| Sentinel model | Settings → Voice | Voice (Sentinel) chats; a small fast model starts spoken answers sooner |
| Image model | Settings → General → Model | Image generation; needs an endpoint with `/images/generations` |
| Video model | Settings → General → Model | Video generation; needs an endpoint with `/videos/generations` |

Image and video models are picked from the same providers. **Off** disables generation.

## Claude Code and Codex (your subscription, no API key)

If Claude Code or Codex is installed on this computer, the model menu of a chat shows a group **Your subscription (no API key)** with:

- **Claude Code · your Claude plan**: runs the `claude` CLI with the Claude Pro/Max login you made in it.
- **Codex · your ChatGPT plan**: runs the `codex` CLI with the ChatGPT login you made in it.

Sign in once in a terminal first: run `claude` and sign in, or run `codex login`. Artemis never passes your API-key variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY` …) to the CLI, so it always uses the plan login.

How it works:

- Each message starts the CLI once in the chat's folder (the project folder, or the Files folder). Earlier messages go along as text.
- The CLI works with its own tools for files, commands and the web. Artemis's own tools (the browser, Make, your connectors, memory, notes, scheduled tasks, the phone …) reach it over a private local MCP server, with a key that only lives for that message.
- Approvals follow the chat's permission setting. "Ask" asks before Claude Code runs a command or changes a file and before Artemis tools that need an OK. Codex cannot ask in the middle of a run, so with "Ask" it only reads.
- Usage is counted in tokens with no price, since it comes out of your plan.

Background helpers (chat titles, memory, the council) keep using a provider model.

## Settings

| Setting | Where | What it does |
| --- | --- | --- |
| This provider requires an API key | Provider editor | Marks the key as required; the row shows "key missing" without one |
| This server cannot call tools | Provider editor | For a proxy in front of the Claude CLI that ignores tool calls. Artemis then sends plain chat only; memory still works through a hidden marker |
| Extra headers (optional) | Provider editor | One `Name: value` per line, sent with every request. Cloudflare AI Gateway uses `cf-aig-gateway-id: default`. `Authorization` cannot be overridden |
| Routing | Provider editor (OpenRouter only) | Default (balanced), Cheapest first, Lowest latency first or Highest throughput first |
| Preferred servers (optional) | Provider editor (OpenRouter only) | Comma-separated OpenRouter server slugs tried first; use this or a routing choice, not both |

## Local models (Ollama and LM Studio)

1. **Ollama:** start Ollama, add the **Ollama (local)** preset and click **Fetch models**.
2. **LM Studio:** start the local server in LM Studio (Developer tab), load a model, add the **LM Studio (local)** preset and click **Fetch models**.

Things to know:

- **Tool calling** needs a model that supports it. A model without tool support still works for plain chat; turn tools off for that chat with the **Tools** pill.
- **Context length:** Ollama's default context window is small and silently cuts long prompts, including the system prompt and the tool list. Set `OLLAMA_CONTEXT_LENGTH=16384` (or more) on the server, or create a model with `PARAMETER num_ctx 16384` in a Modelfile.
- **Fewer tools for small models:** with every tool group on, the tool list alone is roughly 10,000 tokens. Turn off groups you do not need in Settings → Tools & safety, and keep **Switch heavy tools on only when needed** on.
- **A server on another machine** works: put its address in the endpoint URL. Ollama has no authentication, so reach it over a private network (for example Tailscale), not the open internet.

## Tips

- OpenRouter gives you one key for hundreds of models, which makes it easy to try several.
- Use a cheap model for scheduled tasks, titles and learning; keep the strong model for chats.
- If a model shows images as "left out", it cannot see images. Pick a vision model for screenshots and attached images.

## Limits and safety

- Keys and tokens are encrypted with the OS keychain (Electron `safeStorage`). If the OS offers no encryption (some Linux setups) they are stored in plain text in the app data folder.
- Artemis only contacts the providers you add. There is no analytics. The only other request is the update check against GitHub Releases, which you can turn off in Settings → General → Updates.

## See also

- [Getting Started](Getting-Started.md)
- [Usage Limits](Usage-Limits.md)
- [Brains](Brains.md)
- [Sentinel Voice](Sentinel-Voice.md)
- [Troubleshooting](Troubleshooting.md)
