---
url: /salon
---

# The Inventory

> **[Open this page in Quilltap](/salon)**

Every adventurer of consequence carries *something* — a sword with a name, a lantern that has seen better centuries, three potions of dubious provenance, a signet ring that settles arguments at the city gate. **The Inventory** is where those things are kept, and it is kept by **Pascal the Croupier**, who regards the table's furniture as part of the game and counts it with the same unblinking eye he turns on the dice.

The Inventory is not the [Wardrobe](wardrobe.md). The Wardrobe dresses a character; the Inventory furnishes their pockets. A cloak goes in the Wardrobe. The dagger hidden in its lining goes here.

## Where to find it

- **The left rail's Inventory button** (the open box) opens the Inventory as a workspace tab, from which every shelf in the house may be browsed.
- **In a Salon chat**, each character's card in the participant list carries an Inventory button. That opens the Inventory *for that character in that chat*, with the **Carrying now** pane alongside and an Equip button on every row.
- **On a project's page in Prospero**, the **Inventory** card browses the project's own shelf (see [Project Inventory](project-inventory.md)).

At the top of the dialog a single dropdown chooses which inventory you are looking at: a **character**, **Quilltap General**, a **project** or a **group**.

## Where items are kept

An item lives on one of four shelves. Each is an `Inventory/` folder in a document store, one `.json` file per item, so every item may also be read and edited in [the Scriptorium](scriptorium.md) like any other file.

1. **A character's own inventory** — in their character vault. Only they can carry it.
2. **A group's inventory** — in the group's store. Every member of the group can reach it.
3. **A project's inventory** — in the project's store. Every character in that project's chats can reach it, unless the project keeps a [roster](project-characters.md) that leaves them off — then their own tools find the shelf closed, though you may still hand them its objects.
4. **Quilltap General** — the household's shelf. Every character in every chat can reach it.

Browsing a character shows everything within their reach, merged: their own shelf first, then their groups', the project's (when you are in a chat that has one), then General. An item that comes from a shared shelf is marked with where it is kept. When two shelves hold items with the same identity, the nearer one wins, exactly as it does for garments.

## Quilltap General

Quilltap General is the household-wide shelf: the coins, torches and rope that every character in every chat may lay hands on without anyone keeping duplicates. Choose **Quilltap General** from the dropdown to curate it directly — every item there takes the full `⋮` menu, and **+ New Item** creates straight onto the shelf. It is also the natural home for **archetypes** (below) that the whole house shares: put *Sword* in General once, and any character anywhere may have their own instance of it.

## What an item is

Every item has a **name** — what it is ("sword") — and may have a **title** — what this particular one is called ("Excalibur"). Where both exist, Quilltap says the title and puts the name in parentheses.

Each item carries **two descriptions**, and they are for two different audiences:

- **What the characters know about it** (`description`) — told to the model on every turn while the item is carried. *"A broad blade of pattern-welded steel; the inscription on one face reads 'take me up', on the other 'cast me away'."* An item with no description is carried silently: the model is told nothing about it. The browser marks such items so you know.
- **How it should be drawn** (`imageDescription`) — rendering hints for the image pipelines. While the item is carried it joins the character's appearance, so the Lantern's story backgrounds, the image tool and the character's avatar all show it: *"carrying a longsword with a jewelled pommel."* Leave it empty (or only spaces) and the item is invisible in every picture of the character — avatars, story backgrounds, the image tool — though the item's own picture still has a subject, falling back to its description, title or name.

The rest of the item's particulars:

- **Equipped by default** — carried automatically when the character arrives in a chat (see below).
- **Carried at most** — how many of this sort of thing one character may carry at once in one chat. "Sort of thing" means items whose *name* matches, ignoring case: two magic bows are two of the same sort even if each has its own title. The default is one.
- **Can be copied** — whether the item may be duplicated or copied to another shelf. Off by default: a unique object stays unique. Moving it, or making an instance of an archetype, is always allowed — neither is a copy.
- **Glyph** — an emoji, or a small SVG drawing (sixteen kilobytes at most, stripped of anything that is not a plain picture). The glyph is what you see in lists and in the Carrying now pane.
- **Pictures** — an item may have pictures, uploaded or generated (see below).
- **Metadata** — a JSON object for whatever else you care to note: weight, charges remaining, the name of the smith. Quilltap does not read it; it is yours.

### A title may not borrow a name

When anything — a character's tool, a custom tool, a message placeholder — asks after an item by a word, Pascal looks for it by id first, then by **title**, then by **name**, and stops at the first that answers. So a title that happens to *be* some other thing's name quietly answers in that thing's place: give a pencil the title "tape measure" and every enquiry after tape measures finds the pencil, while the real tape measures sit unasked-for in the drawer. Nothing complains. It is simply wrong, and confidently so.

Pascal therefore refuses such a title when an item is made, when it is retitled, and when an item with a title is given a new name. He refuses on two grounds and says which:

- **The title is a name.** Any name of anything on the shelves within reach, the item's own included — "Lantern" for a thing whose name is *lantern* is refused as surely as "Sword" for a thing called *pencil*. (*kind-name shadow*)
- **The title is a word a custom tool's gate asks after, and that word already finds something else.** If the tool's *who may reach for it* gate asks after "ansible resonator" and that phrase already finds an item, a second item titled "Ansible Resonator" would steal the gate from it. (*live gate shadow*)

The refusal names the title, every collision and the tool concerned. The comparison ignores capitals, extra spaces and accents, and nothing else; apostrophes count.

There is one exception, and it is by design: when a gate asks after a phrase that finds **nothing else at all**, the item titled with it *is* the thing the gate means, and the title is allowed. *Friday's Yellow Tape Measure* may be both the tape measure's title and the key of the tool that wants it. Pascal notes such double duty in the log and lets it pass.

Retitling an item *away* from a gate's phrase is never refused, nor is archiving, deleting or moving it off the shelf, but Pascal makes a note at once: whether the gate now finds nothing (the tool has quietly gone dark), finds some other item (the tool is now gated on a stranger), or cannot be told because a shelf or a tool's file would not open (unverifiable — which he counts as an emergency all the same).

Pascal watches the hands as well as the buttons. An item's file edited directly — by a character's document tools, or by you in the Scriptorium — is checked exactly as an edit in the Inventory's own editor is: he reads what the file said before, and judges the change from that. A retitle, an archive, a restore, a deletion and a move into or out of `Inventory/` all count; a new description or a new folder does not.

If Pascal cannot read everything he needs to check — a shelf that will not open, a custom tool's file that is listed but will not load, the previous state of a file being rewritten — he refuses the title rather than guess, and names what he could not read. An item with no title is never refused.

## Archetypes and instances

A shared shelf often holds not a particular sword but the *idea* of a sword. Create one with **+ New Archetype** (or tick **Archetype** in any new item's editor) and it becomes a class of thing rather than a thing: it can be edited, browsed and instantiated, but never carried.

**Instantiate…** (on an archetype's `⋮` menu, or **+ From archetype** beneath the list) makes an **instance**: an item of its own, kept on whichever shelf you choose, that *inherits* everything from its archetype except what it overrides. *Excalibur* is an instance of *Sword*: it takes the archetype's description and drawing hints, and overrides the title and perhaps a line or two of description.

- In the editor, every field an instance could inherit shows the archetype's value greyed, with an **Inherit** toggle. Turn it off to give the instance its own value; turn it back on to let the archetype speak for it again.
- **Edit the archetype** and every instance that has not overridden the field changes with it.
- **Detach** an instance and it stops following its archetype: its current values are written into it and it stands on its own thereafter.
- **An archetype cannot be deleted while anything derives from it.** Quilltap tells you how many instances there are and who holds them, and offers **Detach all and delete**, which bakes every instance into a standalone item first. When one of those instances belongs to an archived character, the deletion is refused outright and the archived characters are named — their vaults are sealed, and must be restored before anything in them can change.
- An instance may live on any shelf and its archetype on any other; moving either one keeps the relationship.

## Kits

A **kit** is a loadout: a named list of items picked up or set down in one gesture. *Burglar's kit*: lockpicks, a dark lantern, soft-soled shoes. Create one with **+ New Kit** and choose its members.

- A kit is never carried itself; in a chat it shows as **all**, **some** or **none** of its members carried.
- **Equip** a kit and every member is taken up at once. If any member would break its *Carried at most* limit, nothing is taken up and Quilltap says which item and which limit.
- A kit may name **archetypes**. Equipping it then gives the character their own instance of each archetype, kept in their own vault — the "starter kit on the project shelf" arrangement. A character who already has a spare instance of that archetype uses it rather than gaining another.
- **Unequip** a kit and its members are set down. Instances it made are kept.
- A kit cannot contain another kit.

## Carrying things in a chat

What a character carries is **per chat**, just as their outfit is. Opening the Inventory from a participant card in the Salon shows the **Carrying now** pane for that character in that chat:

- **Unequip** beside each carried item sets it down.
- The kits within reach show their all / some / none state, with **Equip** and **Unequip** for the whole kit.
- **Take up…** opens a picker over everything within reach that is not already carried, with pictures, so you can see what you are choosing.
- **Reset to defaults** throws away this chat's choices for this character and carries exactly what is *equipped by default*.

Each row in the list beside it has an **Equip** button too. Archetypes and archived items cannot be carried.

Every equip or unequip posts a short line from Pascal in the chat — *"Vivienne takes up Excalibur and a signet ring."* — and, if the character's avatar is drawn per chat, redraws it with the new burden in hand.

### Equipped by default

When a character arrives in a chat — the chat starts, they are added or brought back, or two chats are merged — they take up every item within their reach that is flagged **Equipped by default** (and not archived, and not an archetype). A flagged kit brings its members. A **continuation** of another chat, or a merge, carries over exactly what they carried there instead.

Defaults apply *only on arrival*. A chat from before the Inventory existed, or one where you have already changed things, is left as it stands; **Reset to defaults** is there when you want the defaults again.

A shared shelf's defaults reach everyone who can reach the shelf: an item flagged on a project's shelf is carried by every character in every chat of that project.

## What the characters are told

While anything described is carried, each turn ends with a short section the model reads:

```
## Carried and equipped

Excalibur (sword): A broad blade of pattern-welded steel…
Dark lantern: Shuttered on three sides; it throws a narrow beam.
```

It comes after the recalled memories and any [progressions](character-progressions.md), and is absent altogether when nothing carried has a description — a turn with nothing to say about the pockets is exactly what it would have been without the Inventory. The same section reaches the character's greeting at the start of a chat, and [Carina](carina.md) answers with it in view.

## Pictures

Every item may keep pictures, in `Inventory/images/` beside it. Open the item's editor to **Upload…** one or **Generate** one: generation draws the item as a still life from its drawing hints (or its description, or failing both its name), through your image profile, with [the Concierge](the-concierge.md) standing by should the provider take fright. One picture is the item's current one.

Pictures are for *choosing*, not for decoration: they appear where you pick from a wider array — the Take up… picker, the instantiate picker, the kit member picker, the transfer dialog — and in the item's own editor and full-screen viewer. Everywhere else an item shows its glyph. An instance with no pictures of its own shows its archetype's.

## Folders

An inventory is a folder tree, under exactly the rules the Wardrobe follows: up to eight levels deep, `images` reserved, sibling names unique regardless of case. **New folder**, rename and delete are on the folder bar; deleting a folder moves what it held up a level, never away. Select several items to **Move to folder…** together. Since every folder is a real folder in the document store, rearranging things in the Scriptorium rearranges them here as well.

## Moving and copying between shelves

From an item's `⋮` menu, **Move to another inventory…** and **Copy to another inventory…** send it to any other shelf, keeping its folder path. Moving keeps the item's identity, so every chat that carries it still does; copying makes a new item, and is refused when the item cannot be copied. An instance moved elsewhere still follows its archetype.

An item moved out of a character's reach simply stops counting as carried; the next equip in that chat tidies the list.

Kits are kept whole, and Pascal will not be talked out of it. A kit sent to another shelf must still be able to reach every one of its members from there, or it stays where it is and you are told which members it would lose. Likewise, moving an item that some kit names, to a shelf that kit cannot reach, is refused with the kit's name, so nobody opens the burglar's kit to find the lockpicks have wandered off to another character's vault. Move the kit first, or take the item out of it.

Duplicate an item's file in the Scriptorium and the copy carries the original's identity. Quilltap keeps the original, the file at the item's own name, and leaves the copy where you put it, untouched by later changes, until you give it an identity of its own or delete it.

## Archiving

**Archive** puts an item away without deleting it. Archived items are not carried in any chat and cannot be taken up; **Restore** brings them back. An archived archetype still answers for its instances.

## What the characters may do for themselves

A character is not obliged to wait upon the operator's hand. Given the run of their own pockets, they may rummage through them with nine tools of their own, all of which Pascal keeps an eye on:

| Tool | What it does |
|---|---|
| `inventory_list` | Lists what they carry and can reach, each object marked **equipped** (on their person in this chat), **carried** (in their own vault but not equipped) or **reachable** (on a shared shelf). Archetypes are listed as things one may pick up. Shared objects are marked read-only. |
| `inventory_read` | Reads one object in full: both descriptions, its metadata, the archetype it derives from, how many may be carried, and a kit's members. |
| `inventory_equip` | Takes up one to eight objects or kits, through the very same machinery as the Carrying now pane. If carrying one more would break an object's limit, nothing changes and they are told why. |
| `inventory_unequip` | Sets objects down. A kit sets down every member it holds. |
| `inventory_pick_up` | Makes an instance of a reachable **archetype** in their own vault — a *magic bow* from the project shelf becomes their own magic bow — and equips it unless asked not to. The limit is checked first: a pick-up that would break it makes nothing at all. |
| `inventory_create` | Makes a new object of their own, plainly: never an archetype, never a kit, never copyable. |
| `inventory_update` | Amends one of their **own** objects — name, title, descriptions, emoji, limit, metadata. Shared objects are not theirs to amend. On an instance, a change is an override of the archetype. |
| `inventory_archive` | Puts away (or restores) one of their own objects. Putting one away also sets it down in every chat, so a later restore returns it to the pocket, not to the hand. |
| `inventory_give` | Hands one of their own objects to another character in the chat. The object moves to the receiver's vault, keeping its identity; the giver stops carrying it in every chat; the receiver decides for themselves whether to take it up. Should the hand-over be refused, the giver keeps carrying it exactly as before. Shared objects, kits, archived characters and anyone not seated at the table are refused, politely but firmly. |

Every reference may be an object's id, its title ("Excalibur") or its name ("sword"), without regard to case. A character-made or picked-up object lands at the root of their vault, where you may file it as you please.

However many of these a character uses in one reply, Pascal posts **one** line at the end of it — *"Vivienne takes up a compass and picks up a magic bow."* A gift gets a line of its own: *"Vivienne hands the lantern to Marcus."*

### Inventory management

Whether a character may use any of these tools is the **Inventory Management** setting on the character's page in Aurora, beside *Self-Dressing* and *Outfit Creation*. It is on unless you turn it off, and it governs the whole family — a character who may not manage their inventory cannot so much as list it. The [Brahma Console](brahma-console.md) and the [Scenario Builder](scenario-builder.md) never offer these tools.

The [`self_inventory`](character-system-transparency.md) tool, despite the name, has nothing to do with any of this: it is a character's look at their own settings, not their pockets.

## Pascal's custom tools and the Inventory

[Custom tools](custom-tools.md) reach the bag too. A tool's outcome table — or its *who may reach for it* gate — may ask whether the rolling character has an object **equipped**, **carried**, **reachable** or **absent**, or how many of its kind they have equipped; a message may quote `{{inventory.sword.title}}`; a roll may be drawn from the dice a sword names in its metadata; and a side effect may equip, unequip or pick up objects for the roller. All of it is the rolling character's alone, and a run nobody made finds no inventory at all. [Pascal's Workbench](pascals-workbench.md) builds and proves such tools, with a mock inventory on the Proving Bench.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/salon")`

## Related Pages

- [Project Inventory](project-inventory.md) — a project's shared shelf
- [The Wardrobe](wardrobe.md) — what characters wear, as opposed to what they carry
- [Pascal's Workbench](pascals-workbench.md) — Pascal's other occupation: the custom tools
- [Custom Tools](custom-tools.md) — tools that read and change what a character carries
- [The Scriptorium](scriptorium.md) — where the `Inventory/` folders live as files
