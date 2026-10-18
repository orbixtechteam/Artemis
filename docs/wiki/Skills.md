# Skills

Skills are saved instructions for tasks you repeat. Artemis sees a one-line description of every enabled skill and loads the full instructions when a request matches.

## How to use

1. Open **Skills** in the sidebar.
2. Click **New skill** and fill in:
   - **Name**, for example `Weekly report` (cannot be changed later).
   - **When should Artemis use it?**: one short, specific line. It is shown to the assistant in every chat.
   - **Instructions**: the steps, formats and pitfalls.
   - **Available in**: **Every chat**, or **Only in project "..."** for a project skill.
3. Click **Save**.
4. Ask for the task in a chat. Artemis calls `use_skill` to load the instructions, then follows them. You can also pick a skill from the `@` menu in the message box to make sure it is used.
5. Use the switch on a skill row to turn it off without deleting it, the pencil to edit it, and the trash icon to delete it.

Other ways to add a skill:

- **Import…**: choose a `SKILL.md` file or a skill folder.
- Tell Artemis "remember how to do this" after a task, and it saves a skill with `create_skill`.
- **Open folder** opens your user skills folder so you can add skill folders by hand.

## SKILL.md format

Skills use the same layout as [agentskills.io](https://agentskills.io): a folder with a `SKILL.md` file.

```markdown
---
name: Weekly report
description: Use when I ask for the weekly sales report
---

1. Open the latest sales sheet in the project folder.
2. Summarize totals per region.
3. Write 5 bullet points, no more.
```

- **User skills** live in `<userData>/skills/<slug>/SKILL.md` and work in every chat.
- **Project skills** live in `<project folder>/.artemis/skills/<slug>/SKILL.md` and work only in that project. A user skill wins over a project skill with the same folder name.
- Skills written by Artemis carry `created-by: agent` and show a **learned** badge.

## Learning and improving

When **Let Artemis learn by itself** is on, Artemis can:

- save a new skill (`create_skill`) after a multi-step task you are likely to repeat, or after you teach it how you want something done;
- improve an existing skill (`update_skill`) when it learns something new while using it, for example after you correct it.

After a task with several steps, the **Learning model** decides whether it is worth saving as a skill. You always see the skill first and choose **Allow** or **Deny**. With learning off, Artemis asks before saving.

## Settings

| Setting | Where | What it does |
| --- | --- | --- |
| Skills | Settings → Tools & safety → Skills and learning | Artemis can load your saved instructions for tasks you repeat |
| Let Artemis learn by itself | Settings → Tools & safety → Skills and learning | Saves and improves skills on its own. Off = it asks before saving |
| Learning model | Settings → Tools & safety → Skills and learning | The model that decides whether a finished task is worth a skill. "Automatic" uses a small, cheap model |

## Tips

- Keep the description short and specific: it is sent with every chat, and it is how Artemis decides to use the skill.
- Write instructions in the imperative and keep them under about 60 lines.
- Use memory for facts about you, and skills for how to do a kind of task.

## Limits and safety

- Learning is not used in incognito chats or scheduled tasks.
- Project skills come from the project folder; review them before you trust a project you did not write.

## See also

- [Sub-Agents](Sub-Agents.md)
- [Brains](Brains.md)
- [Memory](Memory.md)
- [Chat and Projects](Chat-and-Projects.md)
