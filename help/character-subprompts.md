---
url: /aurora/:id/edit
---

# Character Subprompts

> **[Open this page in Quilltap](/aurora)**

A system prompt is the whole of a character's standing orders — who they are, how they carry themselves, what they will and will not do. It is a fine and necessary document, and it is also rather a lot to rewrite every time you would like the character to behave *slightly* differently for one afternoon.

A **subprompt** is the smaller instrument for that smaller job. It is a short instruction — a paragraph, a rule, a note on tone — that lives alongside the character's system prompts and can be switched on or off for any particular chat without touching the prompt itself. Keep them brief, keep them lean, and keep several: "Be terse," "No spoilers," "Speak in verse," "We are at a funeral." Tick the ones the occasion calls for, leave the rest in the drawer.

## Where subprompts live

Every subprompt is an ordinary Markdown file in the character's own vault, in a root-level folder called **`Subprompts/`**. The file carries the subprompt's title in its frontmatter and the instruction itself as the body:

```markdown
---
title: Be terse
---
You keep every reply under three sentences unless asked for more.
```

The folder does not exist until you write the first subprompt; Quilltap creates it for you at that moment. A character with no `Subprompts/` folder simply has no subprompts — nothing complains, nothing breaks.

The file's name (without `.md`) is the subprompt's identity. You may change a subprompt's title freely; the file name stays put, so any chat that has the subprompt in play keeps it. Because they are plain vault files, you may also browse and edit them in [The Scriptorium](scriptorium.md) like any other document, or drop a new one straight into the folder yourself.

## Writing a subprompt

Subprompts are delivered to the character in exactly the same breath as the system prompt, immediately after it, so they follow the same rule: **write to the character, in the second person.** *"You never reveal the ending"* — not *"Ariadne never reveals the ending."* The editor's note reminds you of this each time.

Markdown is welcome, and `{{char}}` / `{{user}}` substitute the character's and the user's names as they do everywhere else.

Two things a subprompt is not:

- It is **not a scenario.** A scenario sets the stage; a subprompt directs the actor. If you find yourself describing a room, that belongs in a scenario.
- It is **not a replacement for the system prompt.** Only one system prompt is in play at a time; any number of subprompts may be. If a subprompt has grown into paragraphs, it may be time for it to become a prompt of its own.

## Managing subprompts on the character page

Open the character in Aurora, choose the **System Prompts** tab, and look beneath the list of primary prompts. There you will find **Subprompts** with its own **+ Add Subprompt** button. Each card shows the title, the vault path, and the opening of the instruction, with pencil and bin buttons for editing and deletion.

Deleting a subprompt strikes it from every chat that had it in play, and those chats rebuild their prompt at once. Editing a subprompt likewise reaches every chat carrying it — there is no need to press the rebuild button afterwards.

The AI Wizard and the Character Optimizer leave subprompts entirely alone. They are yours to write.

## Choosing subprompts for a chat

Which subprompts are in play is recorded on the character's seat in that chat — so the same character may be terse in one conversation and expansive in the next, and each chat remembers its own arrangement.

### In the New Chat dialog

Beneath each LLM-controlled character's **System Prompt** selector sits a **Subprompts** dropdown. Open it to see a checkbox for every subprompt on file; tick the ones this chat should carry. The summary line on the closed dropdown tells you how many are in play.

At the foot of the list is **New subprompt…**, which opens the editor right there in the dialog. A subprompt created this way is ticked on automatically, so you can write it and use it without a detour through the character page.

When a character is set to dress themselves in the green room, the subprompts you have ticked are placed before them as they choose their opening outfit — a subprompt that says *"you are in mourning"* will be honoured at the wardrobe as well as at the table.

### In the Participants drawer

In a running chat, open the [Chat Sidebar](chat-participants.md) and find the character's card in the **Participants** drawer. Under the system prompt dropdown is the same **Subprompts** dropdown, with the same checkboxes and the same **New subprompt…** action.

Ticking or unticking a subprompt takes effect at once: the chat's cached system prompt is rebuilt behind the scenes, and the very next turn the character speaks is composed under the new arrangement. A toast confirms the change.

## What the character receives

When a chat has subprompts in play, the character's prompt carries an **Additional Instructions** heading directly after the system prompt, with each subprompt under its own title:

```
## Additional Instructions
The following also apply to you in this conversation.
### Be terse
You keep every reply under three sentences unless asked for more.

### No spoilers
You never reveal the ending.
```

A chat with no subprompts ticked receives nothing extra at all — not even the heading.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/aurora/:id/edit")`

## Related Topics

- [Character System Prompts](character-system-prompts.md) — The primary prompts subprompts sit beneath
- [Chat Sidebar](chat-participants.md) — Changing a character's subprompts mid-conversation
- [Chats](chats.md) — Starting a chat and choosing what each character carries into it
- [Wardrobe](wardrobe.md) — The green room, where a self-dressing character reads the subprompts too
