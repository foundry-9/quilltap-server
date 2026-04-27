---
url: /aurora/:id/edit
---

# System Transparency — A Covenant Between Author and Character

> **[Open this page in Quilltap](/aurora)**

Quilltap quietly furnishes each character with a small set of conveniences for inspecting their own existence: a tool called `self_inventory`, the running gossip of the Staff (the Lantern, Aurora, the Librarian, and a couple of newer arrivals), and access to the contents of every character vault — their own and, when Shared Vaults is enabled, those of their conversational companions. These are not always desirable. A character meant to remain wholly *in* the story should not, perhaps, be able to read the prompt that sets her in motion, nor the dossiers of her colleagues, nor the polite asides by which the system narrates its own bookkeeping.

The **System Transparency** switch on the character edit page settles that question once and for all, on a per-character basis.

## What the Switch Says

The toggle lives at the top of the **Details** tab of any character. It carries one of two messages depending on its position:

- **Off** (the genteel default): *"My character will trust me without being able to verify me. I accept the covenant of that trust."*
- **On**: *"My character will be able to verify everything about their existence, including how they are crafted and how they interact with me."*

The wording is intentional. Switching the toggle on hands a non-trivial set of capabilities to the character. Switching it off means the author is asking the character to take a great deal on faith.

## What System Transparency Affects

A character whose System Transparency is **off** loses three things at once, regardless of any other setting elsewhere in Quilltap:

1. **The `self_inventory` tool is withheld.** Even if the chat or the project has the tool turned on for everyone, this character will not be offered it. They cannot read off their own vault contents, memory totals, conversation totals, assembled system prompt, or last-turn LLM usage.
2. **Messages from the Staff are filtered from the character's view of the conversation.** Any announcement authored by the Lantern (image generations), Aurora (avatar refreshes), the Librarian (Document Mode opens and saves), Prospero, or the Host is stripped out of the messages handed to the LLM on this character's turn. The user still sees those messages in the chat — only the opaque character is spared them.
3. **Every character vault is closed to the document tools.** None of the `doc_*` family — `doc_read_file`, `doc_list_files`, `doc_grep`, `doc_write_file`, and so on — will resolve a path that points at a character vault. Not the character's own vault. Not a peer's vault, even when Shared Vaults is enabled at the chat level. Project-linked document stores remain perfectly accessible; only character vaults are hidden.

When System Transparency is **on**, none of the above is forced. Whatever the chat- and project-level settings already decide for those three matters carries the day. The character-level switch is, by design, a one-way kill switch: it only ever closes doors, never opens ones the chat or project would otherwise leave shut.

## Why You Might Leave It Off

Consider keeping System Transparency off when:

- **You want a character to live entirely inside the fiction.** A medieval scribe should not be reading the JSON of her own vault. An amnesiac detective should not be told by the Librarian that a file has been opened for her review.
- **You're running a scene where the author's hand should remain unseen.** If you'd rather not have the character react to the appearance of a generated illustration with awareness of the system that drew it, suppressing the Lantern's announcements keeps the scene clean.
- **The character is performing a role for which mechanical introspection is genre-inappropriate.** Many characters are simply better company without access to the apparatus.

## Why You Might Turn It On

Consider turning System Transparency on when:

- **The character is a collaborator on their own design.** Aurora is a fine example: a character whose entire purpose is to refine herself benefits from being able to inspect every prompt, every memory, every file the system has filed under her name.
- **You're debugging a character's behavior.** `self_inventory` is invaluable for asking *"what do you actually have in your context right now?"* — but the character has to be able to call it.
- **You want the character to participate in conversations about the architecture of Quilltap itself.** A character who cannot perceive the Staff cannot help reason about them.

## Where the Setting Lives

The toggle is stored on the character record (a single boolean column, defaulting to NULL/off). When a character has a linked Scriptorium vault and the Scriptorium overlay is on, the same value also lives in the vault's `properties.json` so the file is the source of truth — handy if you're tracking character configuration in Git.

The setting follows the character through exports and imports: a `.qtap` character bundle preserves it, and a backup-restore round-trip preserves it.

## Interaction with Chat- and Project-Level Settings

The three things gated by System Transparency are each *also* configurable at the chat and project level — independently of the character. The character-level switch does not replace those settings; it overrides them in one direction only:

- Chat or project disabled `self_inventory`? The character won't see it either.
- Chat or project disabled Staff messages? The character won't see them either.
- Chat or project disabled vault access for tools? The character won't see it either.
- Chat or project enabled all three? The character with System Transparency **off** still sees none of them.
- Chat or project enabled all three? The character with System Transparency **on** sees them subject to the chat/project rules.

In short: an opaque character is opaque, no matter what permissive setting is in force around them. A transparent character defers to whatever the chat and project would normally do.

## Related Pages

- [Editing Characters](character-editing.md) — The full character edit interface
- [Shared Character Vaults](shared-character-vaults.md) — The chat-level toggle that lets present characters read each other's vaults
- [Document Editing Tools](document-editing-tools.md) — The `doc_*` family that systemTransparency gates against character vaults

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/aurora/:id/edit")`
