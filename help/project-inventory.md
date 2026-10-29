---
url: /prospero/:id
---

# Project Inventory

> **[Open this page in Quilltap](/prospero)**

Some things belong not to any one player but to the production: the company's lanterns, the ship's charts, the regiment's issue rifles, a crate of starter kits by the door. **Project Inventory** is the shelf where they are kept — an `Inventory/` folder in the project's own document store, within reach of every character in every chat of that project (or, when the project keeps a roster, of every character on it). Pascal the Croupier keeps the count.

## Where to find it

On a project's page in Prospero, open the **Inventory** card. It browses the project's shelf directly: its items, its kits, its archetypes and its folders. The same shelf can be chosen from the dropdown at the top of the [Inventory](inventory.md) dialog anywhere in Quilltap.

## What a project shelf is good for

- **Shared stock.** An item here can be taken up by any character in any of the project's chats. It is a reference, not a possession: two characters may carry the same lantern, and each is described with it.
- **Archetypes.** Put *Magic bow* on the project's shelf as an archetype, and each character may have their own instance of it — in their own vault, inheriting the archetype's descriptions and overriding what makes it theirs. Edit the archetype and every instance that has not overridden a field follows.
- **Starter kits.** A kit on the project's shelf may name archetypes. When a character equips it, they receive their own instance of each, kept in their own vault, and carry them all at once.
- **Defaults for the whole cast.** An item or kit flagged **Equipped by default** here is taken up by every character who arrives in any chat of the project. Defaults apply on arrival only; **Reset to defaults** in a chat's Carrying now pane applies them afresh.

## Things to know

- The project shelf is reached only from the project's own chats. A character in a chat outside the project does not see it.
- The project's [character roster](project-characters.md) governs the shelf just as it governs the wardrobe. With **Allow Any Character** off, a character who is not on the roster cannot see, take up or pick up anything here through their own tools or a custom tool's effects — though whatever they already carry stays in their hands. You may always hand them objects from the shelf yourself, and its **Equipped by default** items still arrive with every character.
- An archetype here cannot be deleted while instances of it exist anywhere — in this project or out of it. Quilltap names the holders and offers to detach them all first.
- Everything else — the two descriptions, glyphs, pictures, folders, moving and copying between shelves, archiving — works exactly as described in [The Inventory](inventory.md).

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/prospero/:id")`

## Related Pages

- [The Inventory](inventory.md) — the full Inventory, including character shelves and Quilltap General
- [Project Wardrobe](project-wardrobe.md) — the project's shared garments
- [Project Files](project-files.md) — the project's document store, where the shelf lives
