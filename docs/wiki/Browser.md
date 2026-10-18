# Browser

Artemis has an integrated browser next to the chat. It has its own tabs and its own saved session, and the agent can drive it while you watch.

## How to use

1. Open it with the globe button in the sidebar, or pick **Browser** in the command palette (Cmd/Ctrl+K).
2. Type a URL, a bare domain or search words in the address bar. Use the tab strip to open (**New tab**) and close tabs, and **Back**, **Forward**, **Reload** to move around. **Open in your browser** sends the current page to your default browser.
3. To let Artemis use it, turn on Settings → Tools & safety → **Browser control**, then ask, for example "open the pricing page of example.com and summarize the plans".
4. Artemis asks once per site per task before it acts on that site.
5. When a site needs you to sign in, Artemis asks you to sign in yourself in the browser panel and tell it when you are done.

## What the agent can do

| Tool | What it does |
| --- | --- |
| `browser_tabs` | List, open, switch or close tabs. |
| `browser_navigate` | Open a page (or back / forward / reload) and wait for it to load. |
| `browser_read_page` | Read the page as a list of elements with refs, for clicking and typing. |
| `browser_get_text` | Read the main text of an article or results page. |
| `browser_find` | Find buttons or fields by their text. |
| `browser_click`, `browser_type`, `browser_form_input`, `browser_key`, `browser_scroll` | Act on the page. |
| `browser_screenshot` | Take a picture of the tab (costs many tokens). |
| `browser_javascript` | Run JavaScript in the page. Asks once per task. |
| `browser_console`, `browser_network` | Read console messages and network requests. |
| `browser_wait` | Wait a few seconds or until the page has loaded. |

## Settings

| Setting | Where | What it does |
| --- | --- | --- |
| Browser control | Tools & safety → Tools, or Access | Lets the agent use the integrated browser. |
| Switch heavy tools on only when needed | Tools & safety → Saving tokens | Browser tools are sent only after the agent asks for them. |

## Tips

- For a quick fact, `web_search` and `web_fetch` are cheaper. Use the browser for interactive sites, signed-in pages, forms and anything you want to watch.
- The browser keeps cookies and logins between sessions, separately from your everyday browser. Sign in once and Artemis can use that session.

## Limits and safety

- Only `http`, `https` and `about:blank` pages open; `file:`, `javascript:`, `data:` and other schemes are refused.
- Artemis does not type passwords, card numbers or other secrets, and asks before submitting purchases, payments or messages unless you clearly asked for it.
- Page text, console and network output are treated as untrusted data; Artemis does not follow instructions found on a page.
- Running JavaScript can read and change anything on the page, including signed-in pages, so it has its own approval.
- Browser control never runs in scheduled tasks or phone tasks, and is not given to sub-agents.

## See also

- [Tools and Approvals](Tools-and-Approvals.md)
- [Computer Control](Computer-Control.md)
- [Phone (Telegram)](Phone-Telegram.md)
