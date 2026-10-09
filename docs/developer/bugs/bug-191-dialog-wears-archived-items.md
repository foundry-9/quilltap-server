# Bug 191 — the wardrobe dialog can wear an archived item

| | |
|---|---|
| **Status** | **Open** |
| **Found** | 2026-10-09, code audit for the [wardrobe refactor plan](../features/wardrobe-refactor.md) |
| **Fixed** | — |
| **Severity** | Medium — an archived garment is retired on purpose; the tool refuses it, the UI does not, and `set_all` (the "Wear this fitting" commit) does not check at all |
| **Who it bites** | the operator dressing a character from the dialog with "show archived" on, and any client that posts `?action=equip` with an archived id |
| **Provenance** | Original to v4. The archived check was added to the `wardrobe_wear` tool and never mirrored into the route that serves the same primitives |
| **Defect site** | `app/api/v1/chats/[id]/actions/outfit.ts:273-285` (`set_all` validates reachability only), `:300-340` (`wear` / `replace` / `add_to_slot` accept the item `findByIdForCharacter` returns, which includes archived items by design); compare `lib/tools/handlers/wardrobe-wear-handler.ts:94` |
| **Fix site** | proposed: one `resolveWearable(pool, ref)` in `lib/wardrobe/wear-ops.ts` (not found, archived, slot coverage, one set of messages) used by the tool and the route |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../bugs.md) |

---

## Symptom

With archived items shown in the dialog, the row's Wear button on an archived
garment puts it on, and the fitting room will commit it in a `set_all`. The
same gesture through `wardrobe_wear` answers "is archived".

## Root cause

`findByIdForCharacter` includes archived items so the equip read path can
still name a garment archived after a chat loaded it. The wear tool checks
`item.archivedAt` after that lookup; `handleEquipSlot` does not, in any of its
modes.

## Why it survived

The dialog hides archived rows by default, so the path needs the toggle on.

## Fix (proposed)

Both callers resolve the item through a shared `resolveWearable`, which
refuses an archived item with the tool's existing message. `set_all` filters
its id set through the same predicate.

## How to verify

Archive an item, show archived in the dialog, press Wear: the request must be
refused with the same message the tool gives. The fitting room must refuse to
commit a fitting containing it.
