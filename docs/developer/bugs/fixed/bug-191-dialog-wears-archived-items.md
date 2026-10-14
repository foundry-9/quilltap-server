# Bug 191 — the wardrobe dialog can wear an archived item

| | |
|---|---|
| **Status** | **FIXED in v4 (2026-10-09)** |
| **Found** | 2026-10-09, code audit for the [wardrobe refactor plan](../../features/complete/wardrobe-refactor.md) |
| **Fixed** | 2026-10-09, v4.10-dev |
| **Severity** | Medium — an archived garment is retired on purpose; the tool refuses it, the UI does not, and `set_all` (the "Wear this fitting" commit) does not check at all |
| **Who it bites** | the operator dressing a character from the dialog with "show archived" on, and any client that posts `?action=equip` with an archived id |
| **Provenance** | Original to v4. The archived check was added to the `wardrobe_wear` tool and never mirrored into the route that serves the same primitives |
| **Defect site** | `app/api/v1/chats/[id]/actions/outfit.ts:273-285` (`set_all` validates reachability only), `:300-340` (`wear` / `replace` / `add_to_slot` accept the item `findByIdForCharacter` returns, which includes archived items by design); compare `lib/tools/handlers/wardrobe-wear-handler.ts:94` |
| **Fix site** | new `lib/wardrobe/wearable.ts` (`wearRefusal`, `archivedWearMessage`, `newlyWornArchivedItems`), used by `wardrobe-wear-handler.ts`, `app/api/v1/chats/[id]/actions/outfit.ts` (every wear mode and `set_all`) and the wardrobe dialog's wear gestures |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-09).** One rule, `wearRefusal` in `lib/wardrobe/wearable.ts`, says an archived
item may not be put on, in the tool's existing words. `wardrobe_wear` uses it; `?action=equip` now
refuses an archived item with 400 in `wear` / `equip`, `replace` and `add_to_slot`; and `set_all`
refuses a fitting that would *newly* put one on (`newlyWornArchivedItems`). An archived item already in
the character's current slots may stay in a committed fitting, since archiving never undresses anyone and
refusing it would block every commit until the item was taken off. The dialog checks the same rule
before staging a wear (row Wear button, slot pickers, outfit pull-down, fitting room) and shows the
refusal as a toast. Tests in `outfit.test.ts`.

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

## Fix (as proposed at filing)

Both callers resolve the item through a shared `resolveWearable`, which
refuses an archived item with the tool's existing message. `set_all` filters
its id set through the same predicate.

## How to verify

Archive an item, show archived in the dialog, press Wear: the request must be
refused with the same message the tool gives. The fitting room must refuse to
commit a fitting containing it.
