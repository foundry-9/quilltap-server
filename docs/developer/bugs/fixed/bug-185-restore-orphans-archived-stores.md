# Bug 185 — a restore points every character, project and group at a fresh empty store and orphans the archive's own

| | |
|---|---|
| **Status** | **FIXED in v4 (2026-10-09)** |
| **Found** | 2026-10-05 (`replace` mode) and 2026-10-09 (`new-account` mode), the v5 port's dogfood walks restoring full backups of `Friday` |
| **Fixed** | 2026-10-09, v4.10-dev |
| **Severity** | **High** — after a restore, every character's vault (wardrobe, prompts, scenarios, photos, managed fields) and every project's and group's official store appear empty. The data is restored, but nothing points at it. A `new-account` restore of `Friday` showed her wardrobe as **empty**: her pointer named a fresh 12-file vault while the archive's 847-link vault sat beside it, unreferenced. The 77 stores in the archive became 146 |
| **Who it bites** | anyone who restores a full backup, in either mode, of an instance whose characters, projects or groups have stores. That is every instance since document-store-backed characters |
| **Provenance** | Original to v4. The create paths were made to always provision (a deliberate guard against two entities sharing one store), and the restore was written to go through them |
| **Defect site** | `lib/backup/restore/restore.ts:200-202` (characters: `repos.characters.create(charData, { id })`) → `lib/database/repositories/characters.repository.ts:251-287` (drops any incoming `characterDocumentMountPointId` and provisions a fresh vault); `restore.ts` phases 13 / 13a (projects and groups: `create` → `store-backed.repository.ts:135-139` drops `officialMountPointId` and provisions a fresh store); then phase 22a restores the archive's own stores, links and files beside them, unreferenced. `lib/backup/restore/uuid-remap.ts:375-379` leaves the pointers raw in `new-account` mode on the same reasoning ("discarded and re-provisioned") |
| **Fix site** | new `lib/backup/restore/store-claims.ts`; `lib/backup/restore/restore.ts` (phases 6, 9, 13, 13a, 22a-bis, 22a-i, 22h-bis); `CharactersRepository.createBoundToVault`; `AbstractStoreBackedRepository.createBoundToStore` / `provisionOfficialStore`; `lib/backup/restore/uuid-remap.ts` (characters, projects, groups) |
| **v5 status** | `replace` mode **fixed in v5 as a ruled divergence** (P4.147, dogfood #141, 2026-10-05): when the archive carries the pointed store, the entity keeps the pointer and nothing is minted (pinned both ways as `FRESH_STORE_RESIDUAL` in `system_restore_state`). `new-account` mode is still v4-faithful (dogfood #159); the human ruled on 2026-10-09 that it is a bug, and the fix is ordered |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-09).** On the v5 model, in both modes. The restore builds a claim map of the stores
the archive carries; a character, project or group whose archived pointer names one is written bound
to it (slim row with the pointer, nothing minted), first claim wins, and anything else falls back to
the create path with a restore warning. `new-account` mode remaps the pointers with the stores' own
ids. Four knock-on changes were needed to make binding safe; see **Fix**.

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

- **Claim map** (`lib/backup/restore/store-claims.ts`). Built from `data.docMountPoints` after any
  remap. `claim(kind, entityId, pointer)` binds when the pointer names a carried store not yet
  claimed; otherwise it reports `no-pointer`, `not-carried`, `wrong-kind` (a vault named by a project
  or group, or a typed non-vault named by a character; an untyped store from an older archive is
  accepted) or `already-claimed`. Every reason but `no-pointer` adds a restore warning naming the
  entity.
- **Bound creates.** `CharactersRepository.createBoundToVault(data, mountPointId, options)` and
  `AbstractStoreBackedRepository.createBoundToStore(...)` write the slim row with the pointer set
  and do nothing else: no provisioning, no projection, no link (the archive carries the link rows,
  22h). They return the raw row, because the store's rows arrive at 22a–22f and the overlay throws
  until they do. `create` still always mints; the restore is the only caller of the bound variants.
- **`new-account` remap.** `characterDocumentMountPointId` and `officialMountPointId` go through the
  remapper with everything else. The remapper maps one original id to one new id wherever it appears,
  so the pointer names the id the store is restored under.
- **Memories (phase 9)** were restored through the user-scoped repository, whose ownership check reads
  the character through the vault overlay. That would throw for every bound character, whose vault is
  not there yet. They are now created through the global repository after an ownership check by id:
  a character this restore wrote, or else a raw (`findByIdRaw`) read of the row's `userId`.
- **Store row lost at 22a.** A bound entity whose store row fails to restore would point at nothing.
  Phase 22a-i gives it a fresh store from its backup row: `ensureCharacterVault` for a character, the
  new `provisionOfficialStore` (factored out of `create`) for a project or group. An archived
  character is never given a vault; it is left as a tombstone with a warning.
- **User files.** The carried-store-row detection (bug 12) now covers project-bound files: with the
  project bound to its archived store, a replay would have minted a link in that store which the
  archived link at 22d then collides with. A non-carried file of a bound project is deferred to
  22h-bis, after the project's link rows exist, since the bridge finds a project's store through its
  links; there it is an ordinary write into the populated store.

## Verify

- `__tests__/unit/lib/backup/restore-store-binding.test.ts` drives `restore()` over mocked repositories:
  replace and new-account binding (each entity bound to exactly the id its store was restored under,
  nothing minted), first-claim-wins, not-carried and wrong-kind fallbacks, re-provisioning after a
  failed store row (and none for an archived character), memories of a bound character, and the
  carried / deferred project files. Run against the unfixed restore, the first seven cases all fail.
- `__tests__/unit/lib/backup/store-claims.test.ts`: the claim map.
- `__tests__/unit/lib/backup/uuid-remapper.test.ts`: pointers remapped in lockstep with their stores.
- By hand: restore a full backup of an instance with characters, projects and groups into a scratch
  instance, in each mode; the mount-point count matches the archive's, and a character's wardrobe,
  prompts and photos read as they did.
