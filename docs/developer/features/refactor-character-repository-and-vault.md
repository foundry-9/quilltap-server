# Refactor — The character repository, the vault, and Aurora's writes

**Status:** Proposed 2026-11-09 (4.13-dev); the four open questions in §9 were settled with the human the same day, so every decision in §5 is confirmed. Nothing implemented. Written to be run by an implementing model: §5 holds the decisions, which are settled; the mechanics under each phase in §6 are the implementer's to work out. Where the code contradicts a decision in §5, stop and report rather than improvise around it.

**Scope:** `lib/database/repositories/characters.repository.ts`, `lib/database/repositories/vault-overlay/*`, `lib/database/repositories/character-properties-overlay.ts` (the barrel), `lib/mount-index/character-vault.ts`, `lib/mount-index/character-scaffold.ts`, `lib/startup/backfill-character-vaults.ts`, the character API under `app/api/v1/characters/**`, and the Aurora character page's write paths (`app/aurora/[id]/**`, `app/aurora/shared/*`, `components/characters/apply-character-field-updates.ts`). The groups and projects store repositories are touched only in the optional last phase.

**Related:** [project-store-cutover.md](complete/project-store-cutover.md) (the owner-store model characters never joined), [remove-character-overlay-residue.md](complete/remove-character-overlay-residue.md) (the previous clean-up; its "canonical split" is still the target), [aurora-character-page-unification.md](complete/aurora-character-page-unification.md) (the page this spec's client phase builds on), [character-archive-spec.md](complete/character-archive-spec.md) §4.2a (the keep-set), [refactor-4-12-tier-walk.md](refactor-4-12-tier-walk.md) and [refactor-4-12-document-core.md](refactor-4-12-document-core.md) (the style of chokepoint this spec adds), bugs 8, 154, 165, 185, #146, #148, #149, #150.

---

## 1. The problem

The 4.6 cutover moved every character content field out of the `characters` row and into the character's vault, and the code that did it was correct. What it left is a repository that is a hand-rolled copy of the machine projects and groups share, a vault layout spelled in nine places, an id scheme that changes a prompt's identity when it is renamed, and one startup heal that, since the columns were dropped, can only ever write blanks. Adding `kind` (one enum) touched seven server files outside tests; adding `birthday` touched nine. Three operator-visible defects fall out of the same seams (§1.4).

### 1.1 Two copies of one machine

`AbstractStoreBackedRepository` (`store-backed.repository.ts`, 353 lines) is the chokepoint for "a slim row whose content lives in its official store": overlay on read, route-and-strip on write, provision on create, `findByIdRaw`/`findAllRaw`, `createBoundToStore`, `setOfficialMountPointId`, a managed-field-stripping `_update` and `toPersistedRow`. Projects and groups each bind it in about fifty lines.

`CharactersRepository` (977 lines) extends `TaggableBaseRepository` instead and re-implements every one of those: `findById`/`findAll`/`findByUserId`/`findByIds`/`findByTag` each call the overlay by hand (`:90-233`), `create` (`:299-341`) is `AbstractStoreBackedRepository.create` with `ensureCharacterVault` in place of `provisionOfficialStore`, `createBoundToVault` (`:356-375`) is `createBoundToStore` renamed, `update` (`:415-438`), `toPersistedRow` (`:448-455`) and `_update` (`:465-506`) are the base class's with `MANAGED_FIELDS` in place of `this.store.managedFields`. The only differences of substance are the pointer column's name (`characterDocumentMountPointId`, not `officialMountPointId`), the archive guard, and the store-name reconcile after create / rename / delete. About 250 lines are duplicate.

The provisioner is duplicated the same way: `ensureCharacterVault` (`character-vault.ts:147-226`, adopt-by-name then create, scaffold, write managed files, link, verify the link stuck) beside `ensureOwnerOfficialStore` → `ensureOfficialStore` (adopt-by-link then create, link). They differ in what they adopt by and in the scaffold; the flow is the same.

### 1.2 The vault layout is spelled nine times

"Which character field lives in which file, with what defaults" appears in:

| Where | What it spells |
|---|---|
| `vault-overlay/schema.ts` | path constants, `SINGLE_FILE_OVERLAY_PATHS`, `CHARACTER_VAULT_DESCRIPTORS` (the table that calls itself the single source of truth), `MANAGED_FIELDS`, the three Zod file schemas |
| `vault-overlay/read-overlay.ts` `hydrateOne` | the field ← file mapping, by hand, per file (`:130-320`); the comment admits it "mirrors" the descriptor table |
| `vault-overlay/managed-fields.ts` `writeCharacterVaultManagedFields` | the field → file mapping, by hand, with the `properties.json` defaults inline (`:230-245`) |
| `vault-overlay/managed-fields.ts` `applyDocumentStoreWriteOverlay` | the mapping again, with a hand-kept `propsKeys` list and the same defaults a second time (`:437-500`) |
| `vault-overlay/managed-fields.ts` `readCharacterVaultManagedFields` | the mapping a fourth time; **no callers** (its "sync-back action" is gone) |
| `vault-overlay/vault-readers.ts` | eleven per-field readers; three have a caller (`readCharacterVaultProperties` in the backfill, `readCharacterVaultPhysicalPrompts` in the PUT handler, `readCharacterVaultWardrobe` in `shared-wardrobe.ts`), the rest are dead; a second copy of the default-prompt normalisation (`:270-295` vs `read-overlay.ts:270-298`) |
| `mount-index/character-scaffold.ts` | `PROPERTIES_JSON` and `PHYSICAL_PROMPTS_JSON` seed objects, the blank-markdown list |
| `mount-index/character-vault.ts` `REQUIRED_VAULT_FILES`, `mount-index/sync/planner.ts` `CHARACTER_VAULT_KEYSTONES` | which files a populated vault must have, twice, each commented "mirrors the other" |
| `characters/archive-service.ts` | the §4.2a keep-set, by importing every path constant |

Downstream, `app/api/v1/characters/[id]/handlers/put.ts:26-114` and `handlers/post.ts:30-78` restate the `Character` schema field by field, each vault-managed boolean carrying a comment that it "must be named here or the parse strips it before `update()` can route it". That is the shape of #146 (a System Prompt field silently discarded), and it will be the shape of the next one.

### 1.3 Ids that move, writes that sweep

A prompt's id is `stableUuidFromString('prompt:<mount>:<path>')` (`parsers.ts:225`) and a scenario's the same with `scenario:` (`:671`); the path is `sanitizeFileName(name).md`. So renaming a prompt or a scenario changes its id on the next read. Consequences already in the code:

- `addScenario` (`characters.repository.ts:883-931`) snapshots ids, adds, re-reads and matches by title to return the id a later read will give (bug 165). `addSystemPrompt` does not, so `POST /prompts` returns an id that is never seen again, and `systemPromptsPatch` (`:739-758`) nulls `defaultSystemPromptId` when the default is the transient id, leaving the flag to answer until "the next write heals the column".
- `chats.selectedSystemPromptId` and `characters.defaultSystemPromptId` / `defaultScenarioId` are DB columns naming path hashes. A rename strands them; prompts fall back through `resolveDefaultSystemPrompt`, scenarios have no fallback.
- The physical description's id is minted by the client and again by the PUT, then replaced on read by `stableUuidFromString('physical:<mount>')`.

The wardrobe solved exactly this in 4.9: `Wardrobe/*.md` carry `id:` in frontmatter and `wardrobeItemIdForDocument` (`parsers.ts:291`) prefers it, falling back to the path hash. Prompts and scenarios never got the same treatment.

Every sub-array write is a whole-folder projection. `updateSystemPrompt` → `findById` (full hydration) → `update({ systemPrompts: all })` → `projectArrayIntoVaultFolder` writes every file and **deletes every `.md` in the folder not in the array** (`vault-projection.ts:140-163`; the `ownsFile` option exists but the prompt and scenario callers do not pass it). A `Prompts/draft.md` an operator wrote by hand with no frontmatter parses to `null` (`parsePromptFile`), is therefore not in the array, and is deleted the next time any prompt is saved. The same holds for a `Scenarios/*.md` with an empty body.

`update()` itself reads the raw row three times (the archive guard, inside `applyDocumentStoreWriteOverlay`, inside `_update`) and hydrates the vault once; `addScenario` hydrates four times.

### 1.4 Defects at the seams (verified in the code; filed 2026-11-09 as #148, #149, #150)

1. **The startup heal hollows a vault (#148).** `backfillCharacterVaults` (`backfill-character-vaults.ts:80-95`) calls `readCharacterVaultProperties`, which returns `null` for a **missing, unreadable, malformed or schema-invalid** `properties.json` alike (`parsers.ts:61-91`, fail-soft by design), and on `null` runs `writeCharacterVaultManagedFields(mount, { character: rawRow })`. A raw row has no content, so this writes `''` over `identity.md`, `description.md`, `manifesto.md`, `personality.md` and `example-dialogues.md`, and projects `[]` over `Prompts/` and `Scenarios/`, sweeping every file in both. One stray comma in a hand-edited `properties.json` (or `talkativeness: 0`, which the schema's `min(0.1)` rejects) at boot destroys the character's content. The comment above the call ("so the vault populator writes DB values") predates the column drop. The write path already knows this distinction — `readCharacterVaultPropertiesForWrite` throws on present-but-invalid (bug 8) — the heal path never learned it. The `test('still seeds a vault it had to repopulate')` in `backfill-character-vaults-metadata.test.ts:119` exercises the branch without noticing what it writes.
2. **Clearing the physical description is a no-op (#149).** The card's Clear sends `physicalDescription: null`; the write overlay skips the vault on `null` ("a DB-side concern", `managed-fields.ts:526-530`), `_update` strips the key, and the read overlay rebuilds the record from the untouched files. Nothing changes and nothing says so.
3. **A whole-array scenarios PUT un-archives (#150).** The PUT's scenario item schema has no `archived` or `description` (`put.ts:33-43`) and normalisation rebuilds each item from id/title/content/timestamps (`:179-187`). The Optimizer's apply (`useCharacterOptimizer.ts:413-420`) and TemplateTools (`TemplateHighlighter.tsx:392-401`) send the full array, so every archived scenario comes back active and every description is dropped. `ScenariosCard` knows (its header comment) and uses the per-item route; the other two callers do not.

Smaller, same family: `?action=depiction-guidelines` writes the vault through `writeStoreFile` with no archive guard; `?action=rename` writes `systemPrompts` through a raw `update` and skips `systemPromptsPatch`, so the column is not kept in step; `?action=avatar` returns `{ data }` where every sibling returns `{ character }`, and the Optimizer guesses the envelope; two client writers (`MetadataCard`, `useCharacterProgressions`) each read-merge-replace `metadata` with nothing between them.

### 1.5 The raw/hydrated split is a type lie

`findByIdRaw` returns a `Character` whose nineteen managed fields are Zod defaults (`scenarios: []`, `talkativeness: 0.5`, `kind: 'roleplay'`) or `undefined`. Its docblock says "almost no caller wants this"; there are 78 callers, most of them correct (existence, pointer, DB-only flags, hot paths that must survive a broken vault — the audit for this spec found no misuse). The type system cannot tell a caller which fields it may trust, so correctness rests on a comment at each site. `lib/memory/consolidation.ts:420` reads `subject.identity` from a raw row on purpose, and nothing marks it.

## 2. Goal

A character is **one slim row plus one vault**, and the code says so once:

- one repository base for every store-backed owner (characters, projects, groups), with the pointer column, the write guard and the post-write hooks as parameters;
- one declarative description of the vault layout — each managed field's file, codec, default, seed and keystone status — from which hydration, patch writes, full projection, the scaffold, the required-file list, the keep-set and the API schemas are all derived;
- prompts and scenarios with ids that survive a rename, written one file at a time, never sweeping a file the projection did not write;
- a `CharacterRow` type for the row and `Character` for the hydrated entity, so a raw read cannot be mistaken for a full one;
- an API whose update and create schemas are derived from the entity schema and reject what they do not know, with one response envelope;
- a client that sends what the user changed and lets the server own every rule it currently re-derives;
- the three defects in §1.4 closed, and a repair path for a broken vault that never writes over content.

## 3. Non-goals — examined and deliberately left alone

- **Putting any content back in DB columns, or dual-writing.** The vault is the record; the cutover was right.
- **Changing the vault file layout** (names, folders, frontmatter keys, `properties.json` shape). Hand-editing, the filesystem sync and `.qtap` bundles depend on it. The only additive change is an `id:` frontmatter key on prompt and scenario files (§5 D5).
- **Renaming `characterDocumentMountPointId` to `officialMountPointId`.** It would be tidy and it would cost a migration touching exports, backups, restore, imports, the CLI and the export JSON schema. Parameterise the base instead.
- **The four vantage-point fields and `manifesto`.** Not interchangeable; nothing here collapses or renames them (CLAUDE.md).
- **`archive-service.ts`** (901 lines, a 946-line test). Linear, crash-ordered, correct. It changes only to take its keep-set from the layout table instead of importing nine constants.
- **Wardrobe, Inventory, subprompts, photos, avatar rolls, depiction guidelines.** These are vault *side-stores* with their own chokepoints (CLAUDE.md), not managed fields. Their modules only move out of `vault-overlay/` (D8) and the depiction-guidelines route gains the archive guard it lacks. Their write paths stay.
- **The job-child contract.** Character writes from the child buffer as they do today; nothing here adds a host-RPC or a read-your-writes overlay.
- **`systemTransparency` and the other DB-only flags.** They stay columns.
- **The `defaultSystemPromptId` two-places fact.** The chokepoint (`setDefaultSystemPrompt` / `systemPromptsPatch`) stays; stable ids make the column stop going stale, which is the fix.
- **`stableUuidFromString` as a fallback.** Legacy files and hand-created files keep their path-derived id; it is what every chat already references.
- **The `.qtap` export shape and the SillyTavern mapping.** Unchanged; the export reads the hydrated character and already carries the vault documents.
- **The Aurora page's layout, tabs, autosave engine and the one-page save model** from the unification spec. Only what it sends and what it computes locally change.

## 4. Known state (verified 2026-11-09)

- `CharactersRepository` 977 lines; `vault-overlay/` 4,079 lines, of which `inventory-readers.ts`, `inventory-writes.ts`, `item-folder-ops.ts`, `wardrobe-writes.ts`, `wardrobe-sync.ts` (1,563 lines) belong to the wardrobe and inventory; `character-properties-overlay.ts` is a 137-line barrel with a 70-line docblock describing the pre-4.7 world.
- Import cycle: `mount-index/character-vault.ts` imports `writeCharacterVaultManagedFields` from the barrel; `vault-overlay/managed-fields.ts` imports `ensureCharacterVault`, `buildSystemPromptFile`, `buildScenarioFile`, `renderPhysicalPromptsJson` from `character-vault.ts`. `characters.repository.ts` lazily imports `reconcile-store-names` to break another.
- Raw-read callers: 78 (`findByIdRaw` 70, `findAllRaw` 5, `findByDocumentMountPointIdRaw` 1, `findNamesByIds` 4), by purpose: existence/ownership 23, needs the pointer 24, DB-only flag 5, must survive a broken vault 16, bootstrap/restore 10, wrong 0. `app/api/v1/mount-points/[id]/route.ts:112` scans `findAllRaw()` for one pointer where `findByDocumentMountPointIdRaw` exists.
- `repos.characters.create` callers: `handlers/post.ts` ×3, `import-characters.ts` ×3, `seed-initial-data.ts` ×2, `sillytavern-import-service.ts` ×2, `restore.ts` ×1 (plus `createBoundToVault` ×1). `update` callers: 29. Import creates a scaffold vault then tears it down in `reconcile.ts:118-160` (`discardScaffoldVault`) to re-point at the bundle's vault; restore uses `createBoundToVault` and skips the scaffold.
- `ensureCharacterVault(rawRow)` callers that may *create* a vault: the backfill, four mail handlers, `mailbox.ts`, `subprompts.ts:213`, `managed-fields.ts:404`, `restore.ts:669`, `seed-initial-data.ts:338`. A vault created from a raw row holds defaults; only adoption-by-name recovers content.
- Realtime: `'characters'` is a topic (`topic-map.ts:124-133`) but only the subprompts routes publish it. A PUT, a prompt save or a scenario save publishes nothing; the client relies on its own invalidation.
- Tests that fence this area today: `character-properties-overlay.test.ts` (2,546 lines, read overlay), `manifesto-vault-roundtrip.test.ts`, `metadata-vault-roundtrip.test.ts`, `character-default-system-prompt-lockstep.test.ts`, `character-add-scenario-projected-id.test.ts`, `character-scenarios-archived.test.ts`, `characters-repository-archive.test.ts`, `vault-projection-*.test.ts`, `backfill-character-vaults-metadata.test.ts`, `archive-service.test.ts`, `put.route.test.ts`, `kind-chokepoint.test.ts`, and on the client `character-autosave-patch.test.ts`, `character-page-save-model.test.ts`, `apply-character-field-updates.test.ts`. Untested: the `/prompts` and `/scenarios` routes, the item GET and its POST actions, Clear on the physical description, `archived` through the array PUT, ids across a rename.

## 5. Decisions of record

**D1. The heal never writes over content.** The only automatic repair of a linked vault is: seed `properties.json` from defaults **when the file is absent**, seed `metadata.json` when absent (as today), and nothing else. A present-but-invalid keystone is reported (startup log at `error`, the Almanack, and the vault-health action in D10) and left alone. `writeCharacterVaultManagedFields` is never called with a raw row again; after this spec it has exactly two callers, `create` (in-memory payload) and the cutover migration (frozen). `ensureCharacterVault` creating a *new* vault from a raw row is acceptable only for a character that has no vault at all; it must write only `properties.json`, `metadata.json` and the blank scaffold, never project the row's non-existent content as `''` files that look authored. This is a bug fix and goes first (Phase 0).

**D2. `CharacterRow` and `Character` are two types.** `CharacterRowSchema` is the Zod schema of the `characters` table (the slim row); `CharacterSchema = CharacterRowSchema.extend(<managed fields>)` is the hydrated entity. `findByIdRaw`, `findAllRaw`, `findByDocumentMountPointIdRaw` return `CharacterRow`; `findById`, `findAll`, `findByIds`, `findByUserId`, `findByTag`, `findUserControlled`, `findByDefaultImageId`, `findByAvatarOverrideImageId` return `Character`. `_update` validates with the row schema, so a managed field can no longer reach `$set` and the stripping dance in `toPersistedRow` / `_update` becomes unnecessary. `MANAGED_FIELDS` is derived as `keyof Character − keyof CharacterRow`, never hand-listed. The 78 raw callers are re-typed; the audit says this is mechanical, and where a caller does read a managed field from a row (`consolidation.ts:420`) the compiler now makes the author write the `null` they meant. `CharacterInput` keeps its meaning (the hydrated create payload).

**D3. One store-backed base.** `AbstractStoreBackedRepository` gains what characters need and `CharactersRepository` extends it: a configurable pointer field (`pointerField: 'officialMountPointId' | 'characterDocumentMountPointId'`, defaulting to the former), a `guardUpdate(existingRow, patch)` hook (characters: `validateCharacterArchivePatch`), and `afterCreate` / `afterRename` / `afterDelete` hooks (characters: `reconcileStoreNames`). `createBoundToVault` becomes `createBoundToStore`. The class hierarchy question (the base currently extends `AbstractBaseRepository`; characters need `UserOwned` and `Taggable`; projects are user-owned too) is the implementer's — the requirement is one implementation of overlay-on-read, route-and-strip-on-write, provision-on-create and the raw readers, with no copy left in `characters.repository.ts`. The `StoreOverlayBinding` for characters is produced by the layout module (D4); `ensureOfficialStore` for characters is `ensureCharacterVault`'s flow expressed as an `ensure-official-store.ts` binding (adopt-by-name stays, since a lost link write is a real failure mode the project flow never had, bug 185 / the cloud-materialisation incident). The raw-read docblocks are rewritten to describe the 78 legitimate uses, not forbid them.

**D4. One vault layout table, and everything derives from it.** A new `lib/characters/vault/` module (the character's vault is the character's concern, not the database layer's; this also ends the `mount-index ↔ repositories` cycle) holds a declarative layout: for each managed field or field group, its file, a codec (`parse(raw, ctx) → Partial<Character>`, `render(character) → string`), its defaults, whether it is a **keystone**, and its scaffold seed. The physical pair is one composite entry (two files, one field), not two descriptors that look at each other. From the table, the module derives and exports: the batched hydrator (today's `hydrateOne`, now a fold over the table), the patch writer (today's `applyDocumentStoreWriteOverlay`, with `properties.json` read-modify-write kept and its for-write strictness kept), the full projection (`writeCharacterVaultManagedFields`), the scaffold seeds, `REQUIRED_VAULT_FILES` (= the keystones, which `sync/planner.ts` imports instead of restating), the archive keep-set, `MANAGED_FIELDS`, and the `N/9` "character files" health figure the stats action computes. `vault-readers.ts` and `readCharacterVaultManagedFields` are deleted; the three surviving per-file readers become `readVaultFile(layout.entry)` calls. The Zod file schemas keep their leniency rules exactly (optional-with-default for `canChooseOutfit`, `canDrawDiagrams`, `diagramStyle`, `kind`, `birthday`, `humanoid`; strict nullability on `title` / `firstMessage`). A test asserts that every entry in the table round-trips `render(parse(x)) = x` for a fixture character, replacing the hand-written per-field round-trip tests where they overlap.

**D5. Prompt and scenario files carry `id:` in frontmatter.** The projection writes the item's id into `Prompts/*.md` and `Scenarios/*.md` frontmatter; the parsers prefer a UUID-shaped frontmatter `id` and fall back to today's path hash. Because the fallback *is* today's id, no migration is needed and no existing reference breaks: the first re-projection of a legacy file writes its current (hash) id into the file, and from then on the id survives a rename. New items get a random UUID that is persisted on the first write, so `addSystemPrompt` and `addScenario` return the real id and the re-read hack (bug 165) and the `transientId` special case in `systemPromptsPatch` are deleted. The rule is one shared helper beside `wardrobeItemIdForDocument` (same shape: frontmatter id, else path hash). The other scenario scopes (`lib/scenarios/location.ts`, project / group / General `Scenarios/`) adopt the same key so a scenario moved between tiers keeps its id. The physical description's id becomes server-owned (`stableUuidFromString('physical:<mount>')` on read and on write; the PUT and the client stop minting one).

**D6. Sub-collection writes are per item and never sweep what they did not write.** `addSystemPrompt` / `updateSystemPrompt` / `deleteSystemPrompt` and the scenario trio write, rename (a name change moves the file through `lib/documents/core` `renameDocument`, so `chat_documents` and link siblings follow) or delete **one file**, found by id (D5). A whole-array replace (`writeCharacterVaultManagedFields` on create; the cutover) sweeps only files that **parse as items**, so a hand-authored draft without frontmatter is left alone; `projectArrayIntoVaultFolder` is called with an `ownsFile` that says so, for prompts and scenarios as the wardrobe already does. `update({ systemPrompts })` and `update({ scenarios })` as whole-array patches are removed from the repository's public surface (the rename service, the only other caller, is re-pointed at per-item ops and at `setDefaultSystemPrompt` so the column stays in step). `update()` reads the raw row once and passes it down; sub-array ops take the hydrated character they already hold rather than re-reading.

**D7. Clear means clear.** `update({ physicalDescription: null })` writes an empty `physical-description.md` and a `physical-prompts.json` with every prompt `null`, preserving `humanoid` (a setting, not generated text — the existing rule). The read overlay then yields a record with every text field `null`, which the UI renders as empty. A test covers the Clear button end to end.

**D8. `vault-overlay/` is dissolved.** Wardrobe modules (`wardrobe-writes.ts`, `wardrobe-sync.ts`) move under `lib/wardrobe/`, inventory modules (`inventory-readers.ts`, `inventory-writes.ts`) under `lib/inventory/`, `item-folder-ops.ts` beside `lib/mount-index/item-folder-location.ts`; the character pieces become `lib/characters/vault/` (D4). `character-properties-overlay.ts` is deleted; its twenty-odd importers point at the new homes. `character-scaffold.ts` folds into the vault module (its seeds are the table's seeds). `CharacterVaultUnavailableError` lives with the layout. The CLAUDE.md chokepoint list gains a paragraph for the character vault and the base.

**D9. The API schemas are derived and strict.** `updateCharacterSchema` is `patchSchemaOf(CharacterWritableSchema)` where `CharacterWritableSchema` is `CharacterSchema` minus server-owned fields (`id`, `userId`, `createdAt`, `updatedAt`, `archivedAt`, `archiveFileId`, `archivedAvatarFileId`, `characterDocumentMountPointId`, `defaultImageId`, `tags`, `partnerLinks`, `avatarOverrides`, which have their own actions) minus the sub-collections (`systemPrompts`, `scenarios`, which have their own routes), and it is **`.strict()`**: an unknown key is a 400, not a silent drop (confirmed by the human 2026-11-09, §9.2). (`patchSchemaOf`, not `.partial()` — bug 244.) `createCharacterSchema` is the same writable shape with the sub-collections allowed, so `NewCharacterView` stops needing a follow-up PUT for `aliases` / `pronouns` / `birthday` / `kind`. The per-field transforms the PUT does today (empty-string-to-undefined on the profile ids, scenario normalisation) either move into the entity schema or disappear with the arrays. `defaultSystemPromptId` keeps its detour through `setDefaultSystemPrompt`. Every character-returning action returns `{ character }`; `?action=avatar` stops returning `{ data }`. `?action=depiction-guidelines` runs the archive guard. The PUT handler publishes `publishRealtime('characters', id)` after a write, as the subprompts routes do, so a second tab refetches.

**D10. A broken vault is reported and repairable, never auto-rewritten.** `GET /api/v1/characters/[id]?action=vault-health` answers from the row and the file list without hydrating: which keystones are present, which parse, and the parse error for each. `POST ?action=repair-vault` does exactly what D1 allows (seed absent keystones) and nothing else. The Aurora page, on a 503 from the item GET, shows a card with the health report and the repair button instead of a dead page; the 503 semantics of `findById` stay as they are (CLAUDE.md: no silent-hollow). The Almanack's existing vault check points at the action.

**D11. The client sends intent and the server owns the rules.** Moves to the server, with the client code deleted: "first prompt is default" and the default-prompt resolution order (`CharacterPage.tsx:340-349, 380-384`, `useSystemPrompts.ts:115, 140`); alias de-duplication (`CharacterPage.tsx:323-328`, `useCharacterOptimizer.ts:399-410`); the favourite toggle reads its new state from the response rather than from an optimistic flip against a server-side read. The Optimizer's and TemplateTools' scenario applies go through the per-item route (which fixes §1.4.3). `applyCharacterFieldUpdates` stays as the one client fan-out, simplified to "main PUT, then per-item prompt and scenario calls". The retired `physicalDescription.name` is no longer sent. `metadata` gains a server-side key-level patch for the HTTP route — `PUT ?action=patch-metadata` with `{ set: {...}, unset: [...] }` applied under the character's write serialisation — so `MetadataCard` and `useCharacterProgressions` stop racing; the repository primitive stays whole-object replace (the job child's Pascal effects depend on it). This changes a decision of record (DDL.md: "a patch REPLACES the whole object"); **confirmed by the human 2026-11-09** (§9.1). DDL.md's `metadata` row gains the exception: the HTTP action merges keys, the repository and every job-child writer still replace the object.

**D12. Phase 7 is attempted, and gated** (confirmed by the human 2026-11-09, §9.4). Re-expressing the project and group overlays on the D4 engine is kept only if, after Phase 2, their four-file layout maps onto the table with no new descriptor kind and `document-store-overlay.ts` can be deleted outright. If it needs a special case, leave them on their engine and record why.

## 6. Phases

Each phase is independently committable and leaves the suite green. Order matters for Phases 0–3; 4–6 may interleave; 7 is last.

### Phase 0 — Stop the bleeding

- Reproduce §1.4.1 in a test: a vault with authored `identity.md` and two prompts and a `properties.json` containing `talkativeness: 0`; run `backfillCharacterVaults`; assert the identity and both prompts are untouched. Then make it pass per D1. Same for the "absent `properties.json`" case: assert only `properties.json` (and `metadata.json`) are written.
- Reproduce §1.4.3 in a route test (an archived scenario survives a whole-array PUT) and close it the quick way for now (carry `archived` and `description` through the PUT schema); D9 removes the array later.
- Reproduce §1.4.2 (Clear) and implement D7.
- Add `ownsFile` to the prompt and scenario projections (D6, first half): a file that does not parse as an item is never swept. Test with a frontmatter-less draft.
- The three defects are filed as #148 (heal), #149 (Clear) and #150 (array PUT); commits close them with `Fixes #N`, fill in each issue's Fix site, and cite them in the CHANGELOG.
- Done when: the four tests pass, `npx tsc` clean, CHANGELOG entry, the three issues closed.

### Phase 1 — `CharacterRow`

- Split the schema (D2) in `lib/schemas/character.types.ts`; derive `MANAGED_FIELDS`; re-type the raw readers; fix the 78 callers (expect type errors only where a caller spreads a raw row into something typed `Character` — those are the sites to look at twice).
- `_update` validates against the row schema; delete the `toPersistedRow` / `_update` stripping; keep a test that a managed field in a patch never reaches `$set`.
- Done when: `npx tsc` clean with no `as Character` casts added to silence it; a grep-test asserts no file outside the vault module imports `MANAGED_FIELDS` as a literal set.

### Phase 2 — The layout table and `lib/characters/vault/`

- Build the table and derive the hydrator, patch writer, full projection, seeds, keystones, keep-set and health figure (D4). Port `read-overlay.ts` and `managed-fields.ts` onto it; delete `vault-readers.ts`, `readCharacterVaultManagedFields`, `CHARACTER_VAULT_DESCRIPTORS` as a separate thing, `character-scaffold.ts`'s seed objects, `REQUIRED_VAULT_FILES`, `CHARACTER_VAULT_KEYSTONES` (import instead).
- Move wardrobe and inventory modules out (D8); delete the barrel; fix importers; `archive-service.ts` takes its keep-set from the table.
- Keep every existing overlay test passing by re-pointing imports before changing behaviour; add the round-trip property test over the table.
- Done when: the field ← file mapping exists in exactly one file (a grep for `'properties.json'` outside `lib/characters/vault/`, migrations and tests finds nothing); the import cycle is gone (no `lib/mount-index/*` import from `lib/database/repositories/*` for characters); `npm run lint` passes.

### Phase 3 — Stable ids and per-item writes

- Frontmatter `id:` on prompts and scenarios, the shared id rule, the parser fallback (D5). Golden test: a legacy file without `id` parses to the same id as before; after one projection it carries that id; after a rename it keeps it.
- Per-item repository ops; `update()` loses the array patches; the rename service re-pointed; `addScenario`'s re-read and `systemPromptsPatch`'s `transientId` deleted (D6). Route tests for `/prompts` and `/scenarios` (none exist).
- Physical description id server-owned (D5 last sentence).
- Done when: `POST /prompts` returns an id the next `GET` returns; renaming a prompt keeps `chats.selectedSystemPromptId` valid in a test; `update` call count per single-prompt edit is one raw read and one hydration.

### Phase 4 — One base

- D3. Extend the base, move characters onto it, express `ensureCharacterVault` as the character's `ensureOfficialStore` binding, rename `createBoundToVault`. Restore (`restore.ts:250`) and import (`import-characters.ts`, `reconcile.ts:118-160`) both use `createBoundToStore` when the bundle carries a vault, so the import stops provisioning a scaffold it then deletes.
- Done when: `characters.repository.ts` contains only the character-specific methods (partner links, favourites, control, Carina, the sub-collection ops, names) and the binding; the store-backed base has one `_update`, one `create`, one raw-reader set; `grep -n "applyDocumentStoreOverlay" lib/database/repositories/characters.repository.ts` is empty.

### Phase 5 — The API

- D9 and D10. Derived strict schemas; one envelope; archive guard on depiction guidelines; realtime publish on write; `vault-health` and `repair-vault`; `metadata` key patch (pending §9.1).
- `mount-points/[id]/route.ts:112` uses `findByDocumentMountPointIdRaw`.
- Done when: a PUT with an unknown key is a 400 (test); `handlers/put.ts` has no hand-written field list; every `{ data }` character envelope is gone.

### Phase 6 — Aurora

- D11. Delete the client-side rule copies; route the Optimizer and TemplateTools through the fan-out; `NewCharacterView` sends everything in one create; the 503 repair card; `MetadataCard` / progressions on the key patch.
- Done when: `grep -rn "isDefault" app/aurora components/characters` shows only display, never derivation; `character-page-save-model.test.ts` and `apply-character-field-updates.test.ts` updated and green; the repair card is exercised in a test with a mocked 503.

### Phase 7 — Projects and groups on the engine (gated, D12)

- Attempt the port after Phase 2 has landed; keep it only if `lib/database/document-store-overlay.ts` can be deleted with no new descriptor kind. Either way, record the outcome in §10 of this document.

## 7. Verification

- `npx tsc`, `npm run lint`, `npm run test:unit` after every phase (not `--findRelatedTests`; it is broken here).
- Grep-tests to add, in the style of `reach-chokepoint.test.ts`: (a) the layout table is the only speller of vault paths; (b) no caller outside `lib/characters/vault/` calls `writeDatabaseDocument` on a character managed path; (c) `writeCharacterVaultManagedFields` has exactly its two sanctioned callers; (d) no client file derives a default prompt.
- On V4test (never Friday): create a character through the wizard, rename a prompt, start a chat with it selected, confirm the chat still names it; archive a scenario, run the Optimizer's apply, confirm it is still archived; Clear a physical description, reload, confirm it is empty; hand-edit `properties.json` to `talkativeness: 0`, restart, confirm the character's content survives and the page shows the repair card; repair, confirm the file is rewritten and nothing else changed (`doc_mount_documents` sha check).
- Export a character to `.qtap` before Phase 3 and import it after: prompt and scenario ids in old chats still resolve.

## 8. Documentation

- `docs/developer/DDL.md` — the `characters` section: the row/entity split, the `id:` frontmatter key, `metadata` patch semantics if §9.1 is accepted, the vault module path.
- `CLAUDE.md` — a chokepoint paragraph: the character vault layout table, `CharacterRow` vs `Character`, the store-backed base, per-item sub-collection writes, "the heal never writes content".
- `help/characters.md` (or the page's current help file) — the repair card and Clear, in voice, with `url` frontmatter and the In-Chat Navigation section.
- `docs/CHANGELOG.md` — plain voice, per phase.
- `.claude/commands/update-documentation.md` and `docs/developer/features/ROADMAP.md` — this spec is listed (done with this proposal).
- `public/schemas/qtap-export.schema.json` — only if a field is added (the frontmatter `id` rides in document content, not the schema).
- `docs/developer/SYSTEM_FLOWCHARTS.md` — a character write, if a diagram for it exists; add one if not.

## 9. Questions settled with the human (2026-11-09)

1. **`metadata` key-level patch (D11): confirmed.** DDL.md recorded "a patch REPLACES the whole object; key-level edits are the caller's read-modify-write", and two client callers raced on it. The HTTP route gains `PUT ?action=patch-metadata` with `{ set, unset }`; the repository primitive and every job-child writer keep whole-object replace. DDL.md records the exception.
2. **Strict PUT (D9): confirmed.** An unknown key in the character PUT is a 400. The client ships with the server, so there is no compatibility cost; a missed field fails on its first save instead of vanishing (#146).
3. **Filing the three §1.4 defects: done.** #148 (High), #149 (Medium), #150 (Medium).
4. **Phase 7 (D12): attempt it, gated.** Port projects and groups onto the layout engine after Phase 2; keep the port only if `document-store-overlay.ts` can be deleted with no new descriptor kind, otherwise record why in §10 and leave them.

## 10. As built

(Empty until implemented. Record per phase what landed and where it departed from §5–6.)
