---
url: /salon
---

# The Atlas

> **[Open this page in Quilltap](/salon)**

A story is furnished with more than people. There is the Convertible that has carried the party through three chapters and two border crossings; the Lighthouse whose keeper keeps rather more than the light; the brass contraption in the cellar that nobody admits to having wound. Characters forget such things, and painters invent them afresh each time, which is how a silver roadster becomes a green coupé between one background and the next. **The Atlas** is the remedy: a gazetteer of the named things in your world, kept one entry to a page, consulted quietly whenever a thing is mentioned.

The Atlas has no tools for the characters and no voice of its own. It does not speak; it is *looked up* — and what is found there is read out to each character by [the Commonplace Book](memory-recall-relevance.md), in the same private whisper that carries their memories and their Knowledge. It is, in short, the company's lorebook.

## Where to find it

- Open **Objects** and choose **The Atlas**. In the workspace it opens as a tab; in a Salon chat it opens with the chat's project selected (or Quilltap General, for a chat with no project); anywhere else it opens on Quilltap General.
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

## Asking Brahma to write one up

Writing an entry by hand is a fine thing when the particulars live in your head. When they are scattered across three chapters, a character's backstory and a conversation from last spring, let [Brahma](brahma-console.md) do the legwork. Beside **+ New Entry** at the foot of the Atlas sits **New Entry from Lore…**:

1. **Name the thing** — "the Convertible", "Blackmoor Hall", "the brass contraption in the cellar". A description good enough to find it by will serve.
2. **Search the document stores and records** is ticked to begin with. Brahma may then read every document store and look through characters, memories and conversations — reading only; he can change nothing. Untick it and he works from what you write below and nothing else (and from general knowledge, should the thing be a real one).
3. **Further details** (optional) — facts he should take as given, where to look, what to leave out, how long you would like it.
4. **Model** — Brahma's own engine is chosen for you (the project's Brahma engine for a project's Atlas, else the one set in [the Console's settings](brahma-console.md#choosing-the-engine-for-brahma), else your default). Any other profile may be chosen; while searching is on, profiles with tool use switched off are not offered.

Before he lifts a finger, Brahma is handed what a first look already turned up — the documents that mention your subject, a few lines from each, and the conversations where it was spoken of — so he begins by opening the two or three that matter rather than hunting for them. He works to the same research discipline as [the Console](brahma-console.md#how-the-console-researches), and stops once he has enough.

Press **Draft the entry** and his searches tick by as he makes them. What comes back is a draft of everything but the picture: a **name**, the other words it is **also called** (he is told which names the shelf already uses, and steers clear of them), a **graphic prompt** if the sources say what it looks like, and **what is known**. Ask for changes in the **Revise** box ("shorter, and find out what became of it after the war") as often as you like.

Nothing is filed until you say so. **Open in the editor** carries the draft into the ordinary new-entry editor, on the shelf and in the folder you were browsing, where you may amend any of it before pressing **Save**. Add a picture once it is saved, as below.

Should the model's answer come back in a muddle, the whole of it is kept as *what is known*, under the name you gave, with a note saying so.

## When a thing is named

Quilltap listens for an entry's name and its other words, whole and in any case: *car* finds "the car" and "Car!", never "cars" or "carpet". Then:

- **The characters are told.** On each turn, a character who can reach the entry and has heard it named in the last few lines of conversation is handed its particulars — name, other words, appearance and what is known — by the Commonplace Book, in the private whisper it sends before they speak. You will see it there yourself, under the line about the Atlas being unrolled across the table. Six quiet lines later the thing drops out of the whisper until it is mentioned again. Nothing is remembered about having told them; it is simply looked up afresh each time.
- **The scenario counts once.** A thing named in the chat's scenario is told to each character on their first turn under that scenario — and again on their first turn after the scenario is revised — and thereafter only when someone names it.
- **A thing need not be named to be remembered.** The Commonplace Book also consults the Atlas by *sense*: when the talk turns to smuggling routes and the Convertible's page is the one that mentions the false floor, the page may be fetched though nobody has said "Convertible". This is the same search that fetches a character's `Knowledge/` files, made with the same question — though the Atlas is held to a rather stricter standard of resemblance, a page being handed over whole where a file is merely pointed at — and it obeys the same shelves — an entry a character cannot reach, an archived one, or one hidden behind a nearer page of the same name is never fetched. A short entry arrives whole; of a long one, only the passage that answered.
- **There is one purse for it all.** Lore and Knowledge are paid for out of a single allowance of the character's attention (two parts in a hundred of the model's window, and never less than 800 tokens). Things *named* are served first, in the order they were said, up to eight of them; a page too long for what remains is trimmed at a word and marked with an ellipsis. Whatever is left is shared between the Knowledge files and the pages fetched by sense, best match first. A very long entry is therefore better kept as several shorter ones.
- **You get a chip.** The first mention of each thing in the chat — very often in the Host's scenario card — wears a chip with a dashed rule beneath (a person's chip has a dotted one). Rest the pointer on it, or tab to it, to see the entry: its picture, its other words, its appearance, what is known, and the shelf it came from. Click to pin it open. Later mentions, by name or by any other word, get no second chip. Edit the entry and the chip's card follows at once.
- **A folded card still shows its chips.** The Host's scenario card usually sits folded to a single line, and a chip inside a folded card would be a chip nobody sees. So the chips of whatever is first named in it are set out beside the folded line instead, each wearing the entry's own name — the Convertible's chip reads *Berline* even if the scenario called it "the lander".
- **The sidebar keeps the list.** Once a chat has named anything from the Atlas (or anyone [not in the room](salon-host-introductions.md)), the [Chat Sidebar](chat-participants.md) grows a **Concepts Named** drawer: every entry the conversation has mentioned, in the order it first came up, each with its picture and — where it was called something else — the word it went by. Rest the pointer on one for its card; click it and the transcript is wound back to the first mention, unfolding the scenario card if that is where it lies. A chat that has named nothing has no such drawer, which is itself a useful answer.
- **The painters are given a reference.** See below.

## Pictures that mention things

When the Lantern paints a [story background](story-backgrounds.md), it gathers the things named in the scene, the scene's state, the recent conversation and the scenario, and hands their appearances to the artist who writes the painter's instructions — as a reference, *not* an order: "if this thing is in the picture, it looks like this". A Convertible named only in the scenario is therefore not parked in every drawing room the story wanders into; when the scene is at the kerb, it is silver and of the 1930s, every time. A background's things are drawn from everything the company present can reach between them.

When a character (or you) calls `generate_image`, a prompt that names a thing is likewise handed to the artist with the thing's appearance, and a placeholder such as `{{Convertible}}` that names no character but does name an entry is read as that entry. Should the artist be indisposed, the appearance is simply added to the end of the prompt. A prompt that names nothing goes out exactly as written.

In the plain image dialog there is no artist at all, so a thing you name there is in the picture by your own word, and its appearance is added to your prompt.

Avatars, wardrobe and Inventory pictures, and an entry's own picture never consult the Atlas.

## Pictures of an entry

Each entry keeps a small gallery: **Upload** one, or **Generate** one from its graphic prompt (the Concierge's usual arrangements apply). Choose which is current; the current one appears on the entry's row, in the editor, full-screen, and in the chip's card. These pictures are for you — they are never shown to a painter as a reference.

To see one full-screen, click the thumbnail on the entry's row in the Atlas — no need to open the editor — or click any picture in the editor's Pictures section, where the arrows walk the whole gallery. Three buttons wait in the corner. **Save to a document store** (the bookmark) files a copy in the `photos/` folder of whichever store you choose — a character's vault, a project's files, any document store you keep, or Quilltap General, which is offered first — with an optional caption; leave it blank and the entry's name is used. Should the store already hold that very picture, you are told when it was filed rather than handed a duplicate. **Download** and **Copy** do precisely what they say. The entry's own gallery is not disturbed by any of it.

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
- [The Wardrobe](wardrobe.md#import-from-instructions) — where Aurora designs an outfit from a written brief, much as Brahma drafts an entry here
- [The Scriptorium](scriptorium.md) — where the `Atlas/` folders live as files
