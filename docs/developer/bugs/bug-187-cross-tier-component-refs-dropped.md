# Bug 187 — a character composite loses any component that lives in a group or project store

| | |
|---|---|
| **Status** | **Open** |
| **Found** | 2026-10-09, code audit for the [wardrobe refactor plan](../features/wardrobe-refactor.md) |
| **Fixed** | — |
| **Severity** | **High** (silent data loss) — the stripped reference is written back to disk by the next write of any item in the same vault |
| **Who it bites** | anyone who builds a composite in a character's own wardrobe from parts that hang in a group or project store, whether through `wardrobe_create` (which resolves components across every tier) or the item editor (whose candidate list includes the project tier) |
| **Provenance** | Original to v4. The group and project wardrobe tiers were added after the vault reader's component-seeding step, which still seeds from Quilltap General alone |
| **Defect site** | `lib/database/repositories/vault-overlay/vault-readers.ts:383-395` (`readCharacterVaultWardrobe` seeds `findArchetypes(true)` with no tiers); `lib/database/repositories/vault-overlay/parsers.ts:466-490` (`resolveAndCheckComponentItems` drops an unknown ref); `lib/database/repositories/vault-overlay/wardrobe-writes.ts:95,150,200` (`readMountItems` → `projectVaultWardrobe` re-projects the stripped list) |
| **Fix site** | proposed: Phase B of the refactor plan — the reader keeps an unresolved UUID reference, and component resolution moves to the per-request pool |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../bugs.md) |

---

## Symptom

A character's "Regimental kit" composite is made from a coat and boots that
hang in the household group's `Wardrobe/` folder. It saves fine. On the next
read of the character's wardrobe the two parts are gone from
`componentItemIds` (with a `Wardrobe item references unknown component;
dropping ref` warning in the log). The next time anything in that vault is
written — any item, not just the composite — the whole folder is re-projected
from the stripped in-memory list and the loss is permanent.

## Root cause

`buildWardrobeItemFile` (`lib/mount-index/character-vault.ts:338-340`) writes a
component as its slug when the slug map knows it and as a raw UUID otherwise.
On read, `readCharacterVaultWardrobe` builds the slug and id maps from the
vault's own items and, when any item has components, seeds them with
`repos.wardrobe.findArchetypes(true)` — **General only**; the call passes no
group or project tier. `resolveAndCheckComponentItems` then treats a reference
that matches neither map as unknown and removes it.

The write side is more permissive than the read side: `buildCyclePeers`
(`wardrobe-writes.ts:111-128`) accepts the same cross-tier reference, so a
write succeeds and the read that follows silently undoes it.

The project and group folders have the mirror gap: `readSharedWardrobe` reads
with `seedArchetypes: false`, so a project composite that references a General
item loses that reference too (acknowledged in the comment at
`lib/mount-index/shared-wardrobe.ts:56-60`).

## Why it survived

The warning is logged at `warn` and the composite still renders, just thinner.
Same-tier composites, the common case, are unaffected. Read-time hydration in
`resolve-equipped.ts` recovers the *equipped* case, so a worn outfit still
shows its parts for as long as the reference survives on disk.

## Fix (proposed)

- Parsing keeps an unresolved reference as the UUID it was written as.
  `expandComposites` already tolerates unknown ids; a slug that matches
  nothing still warns.
- Component resolution for display and for the cycle check uses the
  per-request wearable pool (every tier the character can reach), not a
  General-only seed from inside the vault reader. With that the reader no
  longer calls back into the repository and the `seedArchetypes` recursion
  guard goes away.

## How to verify

Golden: create a group item, make a character composite with it as a
component through `wardrobe_create`, read the character's wardrobe twice, then
update an unrelated item in the same vault. The composite's
`componentItemIds` must be unchanged after every step.
