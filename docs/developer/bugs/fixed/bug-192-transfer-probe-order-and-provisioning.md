# Bug 192 — the transfer source probe walks tiers in the wrong order and provisions a store on read

| | |
|---|---|
| **Status** | **FIXED in v4 (2026-10-09)** |
| **Found** | 2026-10-09, code audit for the [wardrobe refactor plan](../../features/complete/wardrobe-refactor.md) |
| **Fixed** | 2026-10-09, v4.10-dev |
| **Severity** | Medium — when a group and a project store both hold an item with the same id, the transfer moves or copies the project's copy, not the group's, which is the copy the character actually wears; and a read probe creates a project document store as a side effect |
| **Who it bites** | anyone transferring from the character view (no explicit source container) when the same id is shadowed across tiers; any project without an official store yet, which gains one the first time a transfer is attempted from a chat in it |
| **Provenance** | Original to v4. `resolveSourceItem` was written when the shared tiers were General and project; the group tier was bolted on after the project probe |
| **Defect site** | `app/api/v1/wardrobe/transfers/route.ts:163-203` (`resolveSourceItem`: character → **project → group** → General); `lib/wardrobe/resolve-container.ts:86-112` (`resolveWardrobeContainer` ensures the official store and `Wardrobe/` folder for every project and group lookup, read or write) |
| **Fix site** | `app/api/v1/wardrobe/transfers/route.ts` (`resolveSourceItem` probes character → group stores (strongest first) → project → General, through `resolveWardrobeLocation`); `lib/wardrobe/location.ts` (`resolveWardrobeLocation`'s `ensure` flag; only the destination passes it) |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-09).** Phase A of the refactor replaced `resolveWardrobeContainer` with
`resolveWardrobeLocation` (`lib/wardrobe/location.ts`), which provisions a project or group store only
when the caller passes `ensure: true`. The transfer route passes it for the destination alone; the source
probe and an explicit source only read, so a project with no official store is skipped, not given one. The
probe now walks the character's vault, then their group stores (strongest first, matching the pool's
shadowing), then the project, then General — the canonical precedence. Regression tests in
`__tests__/unit/app/api/v1/wardrobe/transfers/route.test.ts`.

## Symptom

The canonical precedence (`dedupeTierTriple`, `findArchetypes`,
`mergeWearablePool`) is character > group > project > General: a group's copy
of an id shadows the project's. The transfer route's probe checks the project
before the group, so for a shadowed id it transfers the loser. Separately,
every probe into a project or group calls the store ensurer, so a project
with no official store acquires one because someone opened the move/copy
dialog.

## Root cause

Two hand-rolled tier walks that disagree (see §1.2 and §1.4 of the audit in
the refactor plan). `resolveWardrobeContainer` conflates "resolve" with
"ensure" because its only caller at the time was about to write.

## Why it survived

Same-id shadowing across group and project is rare; the extra store is
harmless-looking and named correctly.

## Fix (proposed)

- `resolveWardrobeLocation(scope, id, repos, userId, { ensure })`: reads pass
  `ensure: false` and get `null` for a store that does not exist yet.
- `resolveSourceItem` iterates the character's group mounts (as locations)
  before the project tier.

## How to verify

Unit test: an id present in both a group and a project store, transferred
from the character view, must resolve to the group copy. A project with no
store must still have none after a transfer dialog is opened and cancelled.
