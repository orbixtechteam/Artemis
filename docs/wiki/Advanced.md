# Advanced: prompts and the command blocklist

Settings → **Advanced** shows everything Artemis tells the model in its own words, and the run_command blocklist. They are defaults, not rules.

## System prompts

Every piece has a name and a default: who Artemis is, how to use each tool (files, web, Make, browser, terminal, notes …), memory, helper agents, untrusted content, and how scheduled tasks, heartbeats, webhooks and team leads behave. For each one you can:

- **edit** it: your text is used instead, in the app and in the background gateway;
- **switch it off**: nothing is sent for it;
- **reset** it to the default.

Live values go in as placeholders such as `{root}` (the folder), `{agents}` (your helper agents) or `{token}` (the word a heartbeat answers when there is nothing to report). Some pieces are what makes a feature work: without the heartbeat rules every check is sent to you, and without "Untrusted content" or the webhook rules, text on a web page or in a webhook payload can steer the model. Your custom instructions (General), projects, SOUL.md and agents come on top.

## Command blocklist

Checked before `run_command` runs, on this computer and in the sandbox: `sudo`, formatting disks, writing to devices, fork bombs, shutdown, piping downloads into a shell, recursive deletes of `/` or `~` and a few more. Each rule can be switched off, you can add your own (one per line, a word or a regular expression, optionally `=> reason`), or switch the whole list off. Commands still ask for approval unless you allowed them.

Stored in `settings.json` as `promptOverrides` and `shellPolicy`.
