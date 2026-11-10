---
url: /salon
---

# The Atlas

> **[Open this page in Quilltap](/salon)**

A story is furnished with more than people. There is the Convertible that has carried the party through three chapters and two border crossings; the Lighthouse whose keeper keeps rather more than the light; the brass contraption in the cellar that nobody admits to having wound. Characters forget such things, and painters invent them afresh each time, which is how a silver roadster becomes a green coupé between one background and the next. **The Atlas** is the remedy: a gazetteer of the named things in your world, kept one entry to a page, consulted quietly whenever a thing is mentioned.

The Atlas has no tools for the characters and no voice of its own. It does not speak; it is *looked up*.

## Where to find it

- **The left rail's Atlas button** (the folded map), just below the Inventory. In the workspace it opens as a tab; in a Salon chat it opens with the chat's project selected (or Quilltap General, for a chat with no project); anywhere else it opens on Quilltap General.
- **On a project's page in Prospero**, the **Atlas** card browses the project's own pages (see [Project Atlas](project-atlas.md)).
- **On a character's page in Aurora**, the **Atlas** card in the **Appearance** section opens that character's private pages.

There is no Atlas button on a chat's participant cards. A thing belongs to the world, not to a seat at the table.

## The four shelves

Every entry is filed on one of four shelves, chosen from the dropdown at the top of the dialog — the same four the Wardrobe and the Inventory keep:

| Shelf | Who is told of it |
|---|---|
| **A character's vault** | That character alone |
| **A group** | Every member of the group |
| **A project** | Every character seated in a chat of that project |
| **Quilltap General** | Everyone, everywhere |

When two shelves hold an entry of the same name, the nearer one wins for each character: their own vault, then their groups, then the project, then General. So the project's *Convertible* is what most of the company knows, while the one character who has spent a lifetime under its bonnet may keep a fuller page of their own in their vault — and is told that one instead.

## An entry

- **Name** — what the thing is properly called. No two live entries on one shelf may share a name (case does not count); Quilltap will decline the second politely.
- **Also called** — every other word the thing answers to: *lander*, *car*, *dinghy*. Type a word and press Enter or a comma to add it; Backspace in an empty box takes the last one back; each word has its own little ✕. Plurals are not guessed — if the company speaks of "the cars", add *cars* yourself.
- **Graphic prompt** — what it looks like, in a sentence or two, for the image models and for a character asked to describe it. The editor counts as you type and clears its throat past 200 characters, since painters attend best to brevity; it will never stop you saving a longer one.
- **What is known** — everything else, in Markdown, with the same editor (and typeaheads) as the rest of Quilltap. History, quirks, who owns it, what is hidden under the floor of the boot.
- **Folder** and **Pictures**, as below.

Beneath the name and the words it answers to, the editor posts the occasional notice: another entry within reach also answers to one of your words (the stronger shelf will win it), or a word is a character's name or alias. People always outrank things, so a word a character answers to will never call up an entry — rename one or the other if you meant it to.

## When a thing is named

Quilltap listens for an entry's name and its other words, whole and in any case: *car* finds "the car" and "Car!", never "cars" or "carpet". Then:

- **The characters are told.** On each turn, a character who can reach the entry and has heard it named in the last few lines of conversation is handed its particulars — name, other words, appearance and what is known — in a short private note after the rest of the turn's notes, beside the note about who is being spoken of. Six quiet lines later the note lapses until the thing is mentioned again. Nothing is posted in the chat and nothing is remembered about having told them; it is simply looked up afresh each time.
- **The scenario counts once.** A thing named in the chat's scenario is told to each character on their first turn under that scenario — and again on their first turn after the scenario is revised — and thereafter only when someone names it.
- **You get a chip.** The first mention of each thing in the chat — very often in the Host's scenario card — wears a chip with a dashed rule beneath (a person's chip has a dotted one). Rest the pointer on it, or tab to it, to see the entry: its picture, its other words, its appearance, what is known, and the shelf it came from. Click to pin it open. Later mentions, by name or by any other word, get no second chip. Edit the entry and the chip's card follows at once.
- **The painters are given a reference.** See below.

## Pictures that mention things

When the Lantern paints a [story background](story-backgrounds.md), it gathers the things named in the scene, the scene's state, the recent conversation and the scenario, and hands their appearances to the artist who writes the painter's instructions — as a reference, *not* an order: "if this thing is in the picture, it looks like this". A Convertible named only in the scenario is therefore not parked in every drawing room the story wanders into; when the scene is at the kerb, it is silver and of the 1930s, every time. A background's things are drawn from everything the company present can reach between them.

When a character (or you) calls `generate_image`, a prompt that names a thing is likewise handed to the artist with the thing's appearance, and a placeholder such as `{{Convertible}}` that names no character but does name an entry is read as that entry. Should the artist be indisposed, the appearance is simply added to the end of the prompt. A prompt that names nothing goes out exactly as written.

In the plain image dialog there is no artist at all, so a thing you name there is in the picture by your own word, and its appearance is added to your prompt.

Avatars, wardrobe and Inventory pictures, and an entry's own picture never consult the Atlas.

## Pictures of an entry

Each entry keeps a small gallery: **Upload** one, or **Generate** one from its graphic prompt (the Concierge's usual arrangements apply). Choose which is current; the current one appears on the entry's row, in the editor, full-screen, and in the chip's card. These pictures are for you — they are never shown to a painter as a reference.

## Filing, moving and putting away

Everything the Inventory's browser does, the Atlas's does too: **folders** (make, rename, delete, file into), **select several** at once, **duplicate**, **move or copy to a folder**, **move or copy to another shelf** (pictures travel along; a move keeps the entry's identity, and a shelf that already holds a live entry of that name declines it), **archive** (an archived entry is told to no one and chipped nowhere, and **Show archived** brings it back into view) and **delete**.

## Things to know

- Entries are ordinary Markdown files in an `Atlas/` folder of the shelf's [document store](scriptorium.md), the fields in frontmatter and *what is known* as the body. You may edit one in Document Mode; the browser, the next turn and the chip all see the change at once. A file there with no `id` in its frontmatter is a note of yours, and is left alone.
- `Atlas/` in a character's vault is a private folder, hidden from the character's own document tools like `Wardrobe/` and `Inventory/`.
- A character's Atlas pages are not kept when the character is archived.
- Entries ride along in backups and `.qtap` exports as ordinary store documents.
- SillyTavern lorebooks are neither read nor written.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/salon")`

## Related Pages

- [Project Atlas](project-atlas.md) — a project's own pages
- [Absent Acquaintances](salon-host-introductions.md) — the same arrangement, for people
- [Story Backgrounds](story-backgrounds.md) — how the Lantern paints, and what it consults
- [The Inventory](inventory.md) — the things a character carries, as opposed to the things the world contains
- [The Scriptorium](scriptorium.md) — where the `Atlas/` folders live as files
