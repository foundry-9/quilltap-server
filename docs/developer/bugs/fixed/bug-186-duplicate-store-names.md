# Bug 186 — two document stores can share a name, and a character's live vault can lose its own

| | |
|---|---|
| **Status** | **FIXED in v4 (2026-10-09)** |
| **Found** | 2026-10-09, live check of the bug 185 fix on `V4test`: a new-account restore into the same instance left two stores named "Tester Character Vault", and the instance already had live vaults named "Lorian Character Vault (3)" beside empty orphans holding "Lorian Character Vault" and "… (2)" |
| **Fixed** | 2026-10-09, v4.10-dev |
| **Severity** | **Medium** — a store name is an address (`qtap://` authorities, every doc tool's `mount_point`). Two stores answering to one name make it ambiguous, so the name stops working and only the UUID reaches the store; and a live vault named "… (3)" because orphans hold its plain name is not where a reader or a model looks for it |
| **Who it bites** | anyone who restores a backup in new-account mode into a populated instance, imports a `.qtap` with an overwrite onto a renamed store, or has old vaults left behind by bug 185, a re-provision, or a deleted character |
| **Provenance** | Original to v4. Name uniqueness was enforced only at the API routes and by `nextUniqueMountPointName` in the provisioning paths, with "deliberately no DB unique index" so a restore could insert archived rows verbatim. The restore and the `.qtap` overwrite wrote names unchecked; `repairMountPointNameCollisions` suffixed survivors only at the next boot. Nothing ever renamed a vault after its character, or freed its name from a vault no one used |
| **Defect site** | `lib/backup/restore/restore.ts` phase 22a (`docMountPoints.create(mpData)` with the archived name); `lib/import/quilltap-import/import-document-stores.ts` overwrite (`update(existing.id, { name: mp.name })`); `lib/database/repositories/doc-mount-points.repository.ts` (`create` / `update` with no name check); `lib/mount-index/character-vault.ts` (a new vault takes "… (N)" when an orphan holds the plain name) |
| **Fix site** | new `lib/mount-index/store-names.ts` (rules + `planStoreNames`) and `lib/mount-index/reconcile-store-names.ts`; `DocMountPointsRepository.create` / `update` (`MountPointNameTakenError`); `ensureMountPointNameUniqueIndex` in `mount-index-case-repair.ts`; restore 22a / 23a; `.qtap` import; `CharactersRepository` create / update / delete; boot chain in `instrumentation.ts`; mount-points rename route |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-09).** Store names are now unique by construction: the repository refuses a taken
name on create and rename, and a unique NOCASE index backs it. A restore picks a free name for each
incoming store. On top of the namespace, a reconcile names each live vault `<Name> Character Vault` and
retires every vault no character points at to `<Name> Version <timestamp> Store`.

## Symptom

After a new-account restore of `V4test` into itself, the Scriptorium listed two "Tester Character Vault"
stores, two "Quilltap General", and so on; `qtap://Tester%20Character%20Vault/…` named both. Separately,
`V4test`'s live vaults were "Lorian Character Vault (3)" and "Riya Character Vault (3)", because empty
vaults from earlier restores held the plain name and "… (2)".

## Root cause

The namespace rule lived at the edges (the two API routes, the provisioning helpers) and in a boot-time
repair, not at the write chokepoint. The restore inserted archived rows by name, by design, so a
same-instance new-account restore duplicated every name until the next boot. The `.qtap` overwrite
renamed a store to the archive's name without a check. And the character-vault name was decided once, at
provisioning, against whatever names already existed — so an orphan holding "<Name> Character Vault"
pushed the live vault to "(2)" for good.

## Why it survived

Duplicates healed at the next boot, and "(2)"/"(3)" vaults look like the documented same-name-character
case. No test restored into a populated instance.

## Fix

- **Chokepoint.** `DocMountPointsRepository.create` and `update` (when the name changes to one a peer
  holds) throw `MountPointNameTakenError`; `findNameHolder` is the shared lookup the API routes now use.
- **Index.** `ensureMountPointNameUniqueIndex` runs on every table init: `repairMountPointNameCollisions`
  first, then `CREATE UNIQUE INDEX idx_doc_mount_points_name_nocase ON doc_mount_points (name COLLATE NOCASE)`.
- **Restore.** Phase 22a gives each incoming store its archived name if free, otherwise the next ` (N)`,
  and keeps the archive's `createdAt`. Phase 23a runs the reconcile.
- **`.qtap` import.** The overwrite path uniquifies the archived name against every other store; the
  import ends with the reconcile.
- **Vault naming** (`store-names.ts`, pure). Live vaults claim `<Name> Character Vault` first (the holder
  of the plain name, else the older character, wins; each further live namesake takes the lowest free ` (N)`; a vault-shaped name may carry any number of ` (N)` suffixes). Every
  other store keeps its name if free, oldest first. A `storeType = 'character'` store no character points
  at, still bearing a vault-shaped name, is retired to `<Name> Version <YYYY-MM-DDTHHMMSSZ> Store`
  (its `createdAt`, UTC, colon-free for `qtap://`) — unless a character without a vault bears that name,
  which `ensureCharacterVault` may yet adopt. A retired or operator-renamed vault is left alone.
- **Reconcile** (`reconcileStoreNames`). Parent-only; two reads, a pure plan, and the renames in one
  transaction in two phases (placeholder, then final) so a swap never trips the index; publishes
  `mountPoints`. Runs at boot after the vault backfill, after a restore and an import, and from
  `CharactersRepository` on create, rename (`name` changed) and delete.
- **Rename route.** Renaming a live character vault answers 409: rename the character instead.

## Verify

- `__tests__/unit/lib/mount-index/store-names.test.ts` — the V4test case, rename, delete, namesakes,
  adoption, operator-renamed orphans, collisions and vault priority, idempotence.
- `__tests__/unit/lib/mount-index/reconcile-store-names.test.ts` — real SQLite under the index: a name
  swap between an orphan and the live vault; no-op in the job child.
- `__tests__/unit/lib/database/repositories/mount-index-case-repair.test.ts` — the index refuses a
  case-variant duplicate.
- `lib/database/repositories/__tests__/doc-mount-points-find-by-name.test.ts` — the repository refusal.
- `__tests__/unit/lib/backup/restore-store-binding.test.ts` — a new-account restore takes a free name.
- Live on `V4test`: after a boot, the live vaults read "Lorian Character Vault" / "Riya Character Vault"
  and the old ones "Lorian Version … Store"; a new-account restore into the instance leaves no two
  stores alike.
