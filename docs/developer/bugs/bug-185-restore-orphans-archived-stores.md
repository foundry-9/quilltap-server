# Bug 185 — a restore points every character, project and group at a fresh empty store and orphans the archive's own

| | |
|---|---|
| **Status** | OPEN |
| **Found** | 2026-10-05 (`replace` mode) and 2026-10-09 (`new-account` mode), the v5 port's dogfood walks restoring full backups of `Friday` |
| **Severity** | **High** — after a restore, every character's vault (wardrobe, prompts, scenarios, photos, managed fields) and every project's and group's official store appear empty. The data is restored, but nothing points at it. A `new-account` restore of `Friday` showed her wardrobe as **empty**: her pointer named a fresh 12-file vault while the archive's 847-link vault sat beside it, unreferenced. The 77 stores in the archive became 146 |
| **Who it bites** | anyone who restores a full backup, in either mode, of an instance whose characters, projects or groups have stores. That is every instance since document-store-backed characters |
| **Provenance** | Original to v4. The create paths were made to always provision (a deliberate guard against two entities sharing one store), and the restore was written to go through them |
| **Defect site** | `lib/backup/restore/restore.ts:200-202` (characters: `repos.characters.create(charData, { id })`) → `lib/database/repositories/characters.repository.ts:251-287` (drops any incoming `characterDocumentMountPointId` and provisions a fresh vault); `restore.ts` phases 13 / 13a (projects and groups: `create` → `store-backed.repository.ts:135-139` drops `officialMountPointId` and provisions a fresh store); then phase 22a restores the archive's own stores, links and files beside them, unreferenced. `lib/backup/restore/uuid-remap.ts:375-379` leaves the pointers raw in `new-account` mode on the same reasoning ("discarded and re-provisioned") |
| **v5 status** | `replace` mode **fixed in v5 as a ruled divergence** (P4.147, dogfood #141, 2026-10-05): when the archive carries the pointed store, the entity keeps the pointer and nothing is minted (pinned both ways as `FRESH_STORE_RESIDUAL` in `system_restore_state`). `new-account` mode is still v4-faithful (dogfood #159); the human ruled on 2026-10-09 that it is a bug, and the fix is ordered |
| **Index** | [bugs.md](../bugs.md) |

---

## Symptom

Restore a full backup, in **Replace** or **Import as new account** mode. Afterwards every character's
wardrobe, prompts, scenarios and photo album read empty (or hold only the files the create path just
projected from the row), and every project's and group's files, instructions and properties are gone
from view. The mount index holds two stores per entity: the fresh one the entity points at and the
archive's own, intact but orphaned. On `Friday` a full restore produced 146 stores from a 77-store archive.

## Root cause

`repos.characters.create` treats an incoming `characterDocumentMountPointId` as a hazard and drops it.
A freshly created character must own a fresh vault, so two characters can never share one
(`characters.repository.ts:251-287`). The store-backed `create` does the same with `officialMountPointId`
(`store-backed.repository.ts:135-139`). That is right for a new entity, but the restore reuses those
create paths for entities whose stores the archive carries and restores at 22a. The pointer is dropped,
a fresh store is minted, and the archived store arrives later with nothing pointing at it. In
`new-account` mode `uuid-remap.ts` gives every store a new id but leaves the pointers raw, on the
assumption that they will be discarded, so even a pointer-preserving create would name an id that no
longer exists.

## Why it survived

The restore tests check that rows and stores *arrive* (counts, ids, contents), not that each entity
*points at* its own. Both stores are present, so every "was it restored?" check passes. The
empty-looking vault only shows when someone opens a character after a restore.

## Fix

Not done in v4. v5's `replace` fix (P4.147) is one model: in the restore, build a map of the stores the
archive carries; when an entity's archived pointer names one of them, write the entity's slim row with
that pointer and mint nothing; otherwise fall through to the create path. The first entity to claim a
store keeps it, and a later claimant falls back with a WARN, so a damaged archive can never cross-link
two entities. For `new-account`, the map must translate through the restore's id remap: the archive's
store id becomes the id the store is restored under. Add an assertion that each restored entity points
at the store the archive gave it.
