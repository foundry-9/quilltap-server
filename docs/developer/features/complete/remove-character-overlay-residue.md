# Remove the character two-path "overlay" residue

**Status:** planned — handoff for Claude Code
**Author:** drafted with Charlie, June 12 2026
**Goal:** Leave *only* what must be in the `characters` DB row, with everything else living solely in the character vault (document store). Remove every trace of the legacy second path — the DB mirror, its sync-back machinery, the dead toggle-era logic, and the now-empty `wardrobe_items` table.

---

## Background: what "the overlay" actually is now

The 4.6 `cutover-characters-to-vault-v1` migration already dropped the content columns on `characters` (identity, description, manifesto, personality, exampleDialogues, firstMessage, scenarios, systemPrompts, physicalDescription, title, talkativeness, aliases, pronouns). For those *character-row* fields the cutover is clean: reads go through `applyDocumentStoreOverlay` (store-only, no DB fallback — `lib/database/repositories/vault-overlay/read-overlay.ts`) and writes through `applyDocumentStoreWriteOverlay`. That part is fine and is **not** what we're removing.

The residue is concentrated in **two** places, both of which still maintain a *second copy* of character detail in the database:

1. **The `wardrobe_items` DB mirror.** Unlike the character content fields, the wardrobe was never fully cut over. The vault `Wardrobe/*.md` files are authoritative *on read*, but the code still keeps `wardrobe_items` rows populated as a mirror and reconciles the two on every write. This is the real "two-path overlay": vault + DB, kept in sync by a sweep. The last commit (`48289e4d`) started killing it — it removed the no-vault SQL-write fallback in `WardrobeRepository.create`. This plan finishes the job.

2. **Stale toggle-era logic and comments in the managed-fields write overlay.** `lib/database/repositories/vault-overlay/managed-fields.ts` still carries a mental model from before the cutover was unconditional — an "overlay on/off toggle", "frozen DB values", and two dead lines that write `dbPatch.systemPrompts` / `dbPatch.scenarios` "to mirror the vault into the DB column" (columns that no longer exist; `_update` strips them anyway). Dead code and misleading comments.

### The canonical split (target end state)

`characters` row keeps **only**: `id`, `userId`, `name`, vault pointer (`characterDocumentMountPointId`), reference/link ids (`defaultImageId`, `defaultConnectionProfileId`, `defaultPartnerId`, `defaultRoleplayTemplateId`, `defaultImageProfileId`, `defaultScenarioId`, `defaultSystemPromptId`), behaviour flags (`isFavorite`, `npc`, `controlledBy`, `canDressThemselves`, `canCreateOutfits`, `defaultAgentModeEnabled`, `defaultHelpToolsEnabled`, `defaultTimestampConfig`, `coreWhisperEnabled`, `canBeCarina`), access-control state (`systemTransparency` — intentionally DB-only), JSON link arrays (`partnerLinks`, `tags`, `avatarOverrides`), timestamps, and the deprecated-but-untouched `scenario` / `sillyTavindData` legacy columns (out of scope here).

Everything else — all character *content* and **all wardrobe items** — lives only in the vault. After this work there is no `wardrobe_items` table and no code that reads or writes character detail from the DB.

---

## Pre-flight: confirm the migrations have run (go/no-go)

The destructive step (dropping `wardrobe_items`) is only safe once every character's wardrobe has been populated into its vault. Three one-time tasks do that population:

- `lib/startup/refresh-vault-wardrobe.ts` — projects each vault's wardrobe from DB rows; gated by the `wardrobe_folder_migrated_v1` flag in `instance_settings`.
- `lib/startup/move-shared-wardrobe-to-general.ts` — relocates shared archetypes (characterId NULL) into the Quilltap General mount, dropping their DB rows.
- The migration chain `migrate-clothing-records-to-wardrobe` → `add-wardrobe-component-item-ids-v1` → `migrate-outfit-presets-to-composites-v1`.

**Before writing the drop migration, verify on a copy of the production DB** (Charlie's `~/iCloud/Quilltap/Friday` instance is the realistic test corpus) that:

```bash
# Flag is set (refresh-vault-wardrobe ran to completion):
npx quilltap --instance Friday settings get wardrobe_folder_migrated_v1   # expect "true"
# No character-owned rows remain unrepresented in vaults; spot-check a few characters:
npx quilltap --instance Friday wardrobe list --character <id>             # compare to vault Wardrobe/*.md
```

If the flag isn't set, the population pass hasn't finished — **do not drop the table yet.** The drop migration's `shouldRun` must itself gate on this flag (see step 6) so it can never run ahead of population.

---

## Implementation steps

Work top-down: rip out the code paths first (so the table becomes provably unused), then drop the table, then update docs/exports/tests. Each step is individually committable.

### 1. Delete the wardrobe DB-mirror sync machinery

File: `lib/database/repositories/vault-overlay/wardrobe-sync.ts`

- Delete `syncCharacterVaultWardrobe`, `performVaultWardrobeSync`, and `ingestVaultOnlyWardrobeIntoDb` entirely. Their whole reason to exist is "promote vault-only items into the DB, then re-project DB → vault" — pure mirror maintenance.
- **Keep** `getOverlaidWardrobeItems` (the read path) and `projectVaultWardrobe` (used by writes and the one-time startup refresh). But simplify `getOverlaidWardrobeItems`: a character with a linked vault should read *only* from the vault. The `loadDbItems()` fallback branch (lines ~57–65, `!hasLinkedVault → loadDbItems`) is the second read path — after this work every character has a vault (the backfill guarantees it), so a missing vault is an error, not a reason to read DB rows. Make it throw `CharacterVaultUnavailableError` to match the character-content read overlay's semantics, or — if you want to stay lenient on read — return `[]`. Do **not** keep a DB read.
- Update the barrel `lib/database/repositories/character-properties-overlay.ts` to stop re-exporting the deleted symbols (the `wardrobe-sync` export block, lines ~118–123).

### 2. Strip the DB fallback paths out of `WardrobeRepository`

File: `lib/database/repositories/wardrobe.repository.ts`

- **`update()`** — remove the entire "Fallback — legacy DB update + sync-out" branch (the `_update` + `syncCharacterVaultWardrobe` tail). After removing it, `update` should require a resolvable vault mount and throw if `vault.handled` is false, mirroring what `create()` already does post-`48289e4d`.
- **`delete()`** — same: remove the "Fallback — legacy DB delete + sync-out" branch and the tombstone `syncCharacterVaultWardrobe(..., new Set([id]))` call. Require the vault path; throw if unresolved.
- **`createFromVault()`** — delete the method. It exists solely to promote vault items into DB rows for the sync sweep; with the sweep gone it has no caller. (Confirm: its only callers are `ingestVaultOnlyWardrobeIntoDb`, deleted in step 1, and the backfill — see step 4.)
- **`findByCharacterIdRaw()`** — this reads `wardrobe_items` directly. Audit its callers (`wardrobe-sync.ts` [deleted], `character-vault.ts`, `refresh-vault-wardrobe.ts`, `backfill-character-vaults.ts`). Once steps 1 and 4 land, the only remaining callers are the one-time startup population tasks. **Keep `findByCharacterIdRaw` only as long as those tasks need it** (see step 7 on retiring them); once they're gone, delete it too.
- **`findArchetypes()` / `findArchetypeById()`** — remove the "Fallback to DB rows (pre-migration instances, or General unprovisioned)" branches (`findByFilter(createNullableFilter('characterId', null))` and the `_findById` tail). Shared archetypes live in Quilltap General after `move-shared-wardrobe-to-general`; the DB fallback is the second path. If General is unprovisioned, that's a startup ordering bug to surface, not a row to read.
- **`findByIds` / `findByIdForCharacter` / `findByIdsForCharacter`** — these still do raw `_findById` / `findByFilter` lookups "for shared archetype items" and "pre-cutover items." Re-point them at the vault tiers (`findByCharacterId` + `findArchetypes`) and drop the raw DB lookups. Verify no caller depends on resolving an id that exists *only* as a DB row.
- The `WardrobeRepository` will end up with essentially no live `wardrobe_items` reads/writes. The class still extends `AbstractBaseRepository<WardrobeItem>('wardrobe_items', …)`; that's fine until the table is dropped in step 6, at which point reassess whether the repository should stop binding a table at all (it may only need the vault-write helpers).

### 3. Clean the managed-fields write overlay

File: `lib/database/repositories/vault-overlay/managed-fields.ts`

- In `applyDocumentStoreWriteOverlay`, the `prompts-dir` and `scenarios-dir` cases set `dbPatch.systemPrompts = incoming` / `dbPatch.scenarios = incoming` "to mirror the vault projection into the DB column." Those columns were dropped in 4.6 and `_update` strips `MANAGED_FIELDS` regardless — these two assignments are dead. Delete them (and the misleading comments).
- Rewrite the file's header comment block (the "Vault is source of truth / toggle overlay on-off / frozen DB values / sync-properties-from-vault" paragraph, lines ~300–307). There is no toggle and no frozen DB value post-cutover; sourcing is unconditional. State the actual invariant: managed fields are vault-only; the DB row never carries them.
- The on-the-fly vault provisioning branch (`!hasLinkedVault → logger.error + ensureCharacterVault`) is a legitimate self-heal, not residue — keep it.

### 4. Repoint the startup backfill off DB wardrobe rows

File: `lib/startup/backfill-character-vaults.ts`

- The `filesRepopulated` branch reads `repos.wardrobe.findByCharacterIdRaw(character.id)` to repopulate a linked-but-empty vault. Once the table is dropped this source vanishes. Two options — pick per the go/no-go state:
  - **Preferred:** by the time the table is dropped, every vault is already populated, so a *content* repopulation from DB wardrobe rows is moot. Change this branch to repopulate from whatever non-wardrobe raw fields it still needs and pass an empty wardrobe list (or drop the wardrobe argument from `writeCharacterVaultManagedFields` if wardrobe is no longer part of initial projection).
  - If you want belt-and-suspenders during the transition, keep `findByCharacterIdRaw` alive for exactly this call until the drop migration has shipped and run everywhere, then remove in a follow-up.
- Audit `lib/mount-index/character-vault.ts:76` (`ensureCharacterVault` → `writeCharacterVaultManagedFields` with `findByCharacterIdRaw`) the same way: new-vault provisioning should source wardrobe from the in-memory character / vault, never from `wardrobe_items`.

### 5. Update exports, backup, and restore

- **Export** (`lib/export/ndjson-writer.ts:144`) already uses the overlay-aware `findByCharacterId` (vault-sourced) — verify it stays that way and reads nothing from `wardrobe_items`.
- **Backup/restore** (`lib/backup/restore/restore.ts`) — commit `48289e4d` added a path that "seeds legacy wardrobe items into the vault after doc-store mounts are restored." Confirm restore writes wardrobe into the **vault**, not into `wardrobe_items`. Any restore branch that inserts `wardrobe_items` rows must be redirected to the vault writer (`createVaultWardrobeItem` / `projectVaultWardrobe`) or to a legacy-import shim that lands in the vault.
- Check `lib/import/quilltap-import/import-characters.ts` (it references `outfit_presets`/wardrobe) and the SillyTavern import/export paths under `lib/sillytavern` — ensure none create `wardrobe_items` rows.

### 6. Add the drop migration

New file: `migrations/scripts/drop-wardrobe-items-table-v1.ts`, modelled exactly on `migrations/scripts/drop-outfit-presets-table-v1.ts`:

- Snapshot all `wardrobe_items` rows to `<dataDir>/backup/pre-drop-wardrobe-items.json` before dropping (same safety pattern).
- `DROP INDEX IF EXISTS` for every index on the table (check DDL.md / `create-wardrobe-items-table` for index names), then `DROP TABLE IF EXISTS "wardrobe_items"`.
- `introducedInVersion`: the next release version. `dependsOn`: the latest wardrobe-population migration in the chain (`add-wardrobe-component-item-ids-v1` or later — pick the newest that guarantees vault population).
- **`shouldRun` must gate on populated vaults.** Return false unless `isSQLiteBackend()`, the table exists, **and** the `wardrobe_folder_migrated_v1` flag is `'true'` in `instance_settings`. This is the safety interlock: the table can never be dropped before `refresh-vault-wardrobe` has populated the vaults. (Note: `refresh-vault-wardrobe` is a *startup task*, not a migration, and runs after the mount-index DB is up — migrations run before it. So a fresh upgrade will: run migrations [drop migration's `shouldRun` returns false, flag not yet set] → run startup population [sets the flag] → next startup, migration drops the table. Document this two-startup sequence in the migration's header comment.)
- Register it in `migrations/scripts/index.ts`.
- Add a prettify label in `lib/startup/prettify.ts` in the steampunk-Wodehouse voice, e.g. `'drop-wardrobe-items-table-v1': 'Clearing out the old wardrobe ledger'`. Required or the loading screen leaks the migration id.
- No `reportProgress` loop needed (single `DROP`), matching the outfit-presets precedent.

### 7. Retire the now-obsolete one-time startup tasks (follow-up, after the drop ships everywhere)

Once `wardrobe_items` is gone and the flag is universally set, these become no-ops or dead code:

- `lib/startup/refresh-vault-wardrobe.ts` — its job (DB → vault projection) is meaningless without the table. Once the flag is guaranteed set on all instances, delete the task and its registration. **Do not delete it in the same release as the drop migration** — it must still run on instances upgrading straight through. Gate its removal on a version where every supported upgrade path has already set the flag.
- `lib/startup/move-shared-wardrobe-to-general.ts` — same reasoning; retire once its DB source is gone.
- After both are gone, delete `findByCharacterIdRaw` and any remaining `wardrobe_items` references.

### 8. Update DDL and docs

- `docs/developer/DDL.md` — the `wardrobe_items` section already says "LEGACY/DEPRECATED in 4.6 … slated for removal." Replace it with a note that the table was dropped in `drop-wardrobe-items-table-v1`, and point wardrobe storage entirely at the vault `Wardrobe/*.md` layout (character vault + Quilltap General + project stores). Keep DDL.md authoritative and current.
- `docs/CHANGELOG.md` — terse plain-English entries (per the standing rule, no steampunk voice) for: removed wardrobe DB mirror + sync-back; dropped `wardrobe_items` table; cleaned dead managed-fields mirror writes.
- User-visible behaviour shouldn't change, but if any help doc references wardrobe storage internals, update under `help/*.md` per the standing rule (url frontmatter + In-Chat Navigation).
- Update `public/schemas/qtap-export.schema.json` only if the export shape changes (it shouldn't — export already reads the vault).

### 9. Tests

- Update/remove tests that assert the DB mirror or sync-back behaviour:
  - `__tests__/unit/lib/wardrobe/wardrobe-frontmatter-replace.test.ts`
  - `__tests__/unit/app/api/v1/chats/[id]/actions/outfit.test.ts`
  - any test exercising `syncCharacterVaultWardrobe` / `createFromVault` / `findByCharacterIdRaw` mirror promotion.
- Add a migration test for `drop-wardrobe-items-table-v1` mirroring `cutover-characters-to-vault.test.ts` / the outfit-presets drop test: assert the snapshot file is written, the table is gone, and `shouldRun` returns false when the population flag is unset.
- Keep the character-content overlay tests (`character-properties-overlay.test.ts`, `manifesto-vault-roundtrip.test.ts`, `character-manifesto-nullable.test.ts`) green — that overlay is staying.
- If you add/remove a tool or change a repository's public surface, refresh the relevant snapshot tests (`npx jest -u` on the affected snapshot).

---

## Verification checklist (final task in the handoff)

1. `npx tsc` clean (not `npm run build`).
2. `npx jest` for the touched repository, overlay, wardrobe, export/restore, and migration suites.
3. On a copy of the Friday instance: run a full startup, confirm `wardrobe_folder_migrated_v1 = true`, restart, confirm the drop migration runs and `wardrobe_items` is gone (`npx quilltap --instance <copy> ...` can't see the table; the snapshot JSON exists under `backup/`).
4. Round-trip: create / edit / delete a wardrobe item via the API on a vault-linked character and confirm it lands only in `Wardrobe/*.md` (no table to write to). Confirm a shared archetype create lands in Quilltap General.
5. Export a character to `.qtap`, re-import into a clean instance, confirm wardrobe survives — proving the vault is the sole source.
6. `grep -rn "wardrobe_items\|syncCharacterVaultWardrobe\|createFromVault\|findByCharacterIdRaw" lib app` returns nothing live (only migration history / snapshots).

---

## Hard stops / cautions for the implementer

- **Don't drop the table before the population flag is set** — the `shouldRun` interlock in step 6 is the guard; don't weaken it.
- **Don't delete `refresh-vault-wardrobe` / `move-shared-wardrobe-to-general` in the same release as the drop migration** — straight-through upgraders still need them to run once.
- **`systemTransparency` stays a DB column.** It is access-control state, not content — never route it to the vault.
- The character *content* overlay (identity/description/manifesto/etc. read+write) is **not** in scope — it's already correctly store-only. Touch only the wardrobe mirror and the dead managed-fields mirror writes.
- Follow the repo's commit rules: changelog + DDL + help, `npx tsc`, version bump via the `/commit` flow. The commit skill will block a migration that lacks a prettify label.
