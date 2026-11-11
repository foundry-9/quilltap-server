# Refactor 4.13 — One insert policy and one id-remap table for restore and import

**Status:** Done (2026-11-11). Proposed 2026-11-10, written against `HEAD` = 167d06503. Part of the [4.13 refactor set](refactor-4-13.md). Fixes #188, #190, #193 and #195 by construction, and closes the remap gaps listed in §4.2.

Line numbers are from the audit and will drift. Re-locate each site by name before editing.

## 1. The problem

Two subsystems bring rows into an instance: backup restore (`lib/backup/restore/`) and `.qtap` import (`lib/import/quilltap-import/`). Each answers the same two questions for every entity kind, by hand, per kind:

1. **What happens when the row already exists?** (skip / overwrite / duplicate / replace-all)
2. **Which fields hold ids, and what do they become?**

The answers have diverged, and four filed bugs are the divergence:

| Question | Answers in the code today | Bug |
|---|---|---|
| Overwrite | Document stores update in place (`import-document-stores.ts:73-104`). Everything else deletes the row and recreates it under a new id (`import-characters.ts:134-183`, `import-profiles.ts`, `import-entities.ts`, `import-files.ts`), so every outside reference dangles. | #188 |
| Duplicate: what goes in the id map | The created row's id (tags, characters, chats). A random UUID no row receives (three profile kinds, roleplay templates, projects, groups). | #195 |
| Sidecar rows of a skipped chat | Guarded (wardrobe history, avatar timeline). Inserted again (annotations, chat documents, informs: `execute.ts:663-803`). | #193 |
| Template ids on restore | Preserved for every entity except prompt and roleplay templates (`restore.ts:400-428`). Built-in roleplay templates have a random id per instance. | #190 |
| `roleplayTemplateId` on chats and participants | Remapped by import (`reconcile.ts`). Not remapped by restore (`uuid-remap.ts`). | #190 |
| `summaryAnchorMessageIds` | Remapped by import (`message-id-remap.ts:119-131`). Not by restore. | §4.2 |
| Chat `imageProfileId`, `storyBackgroundImageId`, `message.attachments` | Remapped by restore. Not by import. | §4.2 |
| `swipeGroupId` | Restore remaps the whole string; import rewrites `swipe-<id>`. | §4.2 |
| A target id the map does not know | Restore mints an id that names nothing. Import keeps or nulls it, case by case. | §4.2 |
| Counters in the summary | Six restore kinds report `data.X.length` although each loop can fail per row (`restore.ts:1492-1502`). | §4.2 |

About 560 lines of eager remapping in `uuid-remap.ts:361-922`, about 500 of post-insert remapping in `reconcile.ts:176-680` plus `message-id-remap.ts` and inline remaps in `import-entities.ts:505-590` and `execute.ts:663-803`; and about forty near-identical try / create / warn blocks in `restore.ts:164-1326` beside their import counterparts.

## 2. Goal

- **One id-field table**: a declarative list of `(entity, field path, target kind, on-missing policy)` that both restore and import drive their remapping from, with a schema-driven test that fails when a UUID-typed field is neither listed nor explicitly exempt.
- **One insert helper**: `insertUnderPolicy(kind, incoming, policy)` that owns skip / overwrite / duplicate / replace, writes the id map from the row that actually exists afterwards, and returns a per-row outcome the summary counts from.

## 3. Non-goals

- The bundle and backup formats. No schema change to `.qtap` or `qtap-export.schema.json`.
- The NDJSON reader/writer and streaming import.
- The vault side of a character import (`rememberBundleVault`, store-name reconcile) beyond passing the right id in.
- `preserveIds` semantics for archive/rehydrate: unchanged.

## 4. Known state

### 4.1 Verified by reading (2026-11-10)

- `getPreserveIdsCreateOptions` (`types.ts:173-176`) returns `undefined` unless `options.preserveIds`.
- `import-characters.ts:134-141` maps to `existing.id`, deletes, and `:183` overwrites the map with the new row's id.
- `import-profiles.ts:76-96` sets the map to `randomUUID()` and creates without it.
- `restore.ts:400-428` destructures `id` away for both template kinds.
- `execute.ts:725-803` inserts informs for `idMaps.chats.get(inform.chatId) ?? inform.chatId` with no created-by-this-import check; a skipped chat maps to itself (`import-entities.ts:387-391`).

### 4.2 Traced by the audit, not independently re-verified

- Restore id gaps in `uuid-remap.ts`: `chats.summaryAnchorMessageIds`, `characters.archiveFileId` / `archivedAvatarFileId`, `chats.consoleConnectionProfileId`, and ids inside message payloads (`carinaMeta.answererId`, `hostEvent.*`, `pascalMeta.callerParticipantId`, `pendingExternalAttachments[].fileId`).
- A groups-only bundle never restores members or linked stores (`execute.ts:842-900`): both id maps are empty for a single-type bundle and there is no warning.
- The importer does not require the `__footer__` record (`quilltap-import-stream.ts:516-518`), so a truncated export imports as success.
- Backup and replace-mode delete enumerate characters, projects and groups with `findAll()`, which drops rows whose store is unreadable (`backup-service.ts:158-173`, `restore/delete-service.ts:157-181, 316`). A backup then silently omits the character and its memories; a replace restore or "delete all my data" leaves the row behind.
- LLM logs are capped at the newest 10,000 in backup and in delete (`backup-service.ts:175`, `delete-service.ts:166`); `LLMLogsRepository.deleteByUserId` exists and is unused there.

Each of these is in scope if confirmed. File a bug (`gh issue create --label bug`, confirm with the human first) for any that reproduces, before fixing it.

## 5. Design

### 5.1 The id-field table

`lib/backup/id-fields.ts` (name open), one entry per id-bearing field:

```ts
{ entity: 'chat', path: 'roleplayTemplateId', target: 'roleplayTemplate', onMissing: 'null' }
{ entity: 'chat', path: 'participants[].characterId', target: 'character', onMissing: 'keep' }
{ entity: 'message', path: 'swipeGroupId', target: 'message', encoding: 'swipe-prefix', onMissing: 'keep' }
```

`onMissing` is one of `keep` (the id may name a row already in the instance), `null`, or `drop-row`. "Mint an id that names nothing" is not an option. Settle each field's policy once; where restore and import disagree today, §8 lists the choice.

One `remapEntity(entity, row, idMaps)` walks the table. Restore's eager pass and import's post-insert reconcile both call it; they differ only in when.

The guard test walks the Zod schemas of every exported entity, collects fields typed `z.uuid()` (and arrays of them), and fails for any not in the table or in an `EXEMPT` list with a reason.

### 5.2 The insert helper

```ts
type Outcome = { status: 'created' | 'updated' | 'skipped' | 'failed'; id?: string; warning?: string }
insertUnderPolicy(kind, incoming, { strategy, preserveIds, findExisting, create, update })
```

Rules, stated once:

- **Skip**: map incoming id → existing id; outcome `skipped`.
- **Overwrite**: update in place where the repository can, else create with `{ id: existing.id }`. The row keeps its id; fields the bundle cannot carry (a profile's `apiKeyId`) keep their existing value.
- **Duplicate**: create a new row; map incoming id → **created** row's id.
- The summary counts outcomes; nothing counts array lengths.
- Sidecar loops (annotations, chat documents, informs, and the two that already guard) receive the set of chat ids with status `created` and insert only for those.

### 5.3 Built-in roleplay templates

Built-ins get deterministic ids (a UUIDv5 over a fixed namespace and the template's stable key) so a restore into a fresh instance resolves them. A migration re-keys existing built-in rows and every pointer to them (the id-field table says which fields those are). This is the one schema-adjacent change; it needs a pretty label in `lib/startup/prettify.ts` and `reportProgress` in its loop.

## 6. Phases

1. **Failing tests** for #188, #190, #193, #195, one per entity kind where the kinds differ.
2. **`insertUnderPolicy`** adopted by the import files (`import-profiles.ts`, `import-entities.ts`, `import-characters.ts`, `import-files.ts`); fixes #188, #195. Then gate the sidecar loops (#193).
3. **The id-field table** and `remapEntity`, adopted by import's reconcile first (behaviour-neutral where the table matches today's code), then by restore's `uuid-remap.ts`. Add the guard test; resolve each field it reports.
4. **Restore's create loops** onto the helper; template ids preserved (#190 first half).
5. **Deterministic built-in ids** and the migration (#190 second half). Decision 3 below first.
6. **§4.2 items** that reproduced, each with its issue number.

## 7. Tests and gates

- Round-trip tests: export → import with each strategy into an instance that already has the entities; backup → restore into a fresh instance and into the source instance. Assert referential integrity by walking the id-field table: every listed field resolves or is null.
- Expected size: 900–1,200 lines removed across both subsystems; medium risk. Restore is the higher-risk half; land import first.
- DDL.md if the migration changes anything it documents; `docs/CHANGELOG.md`; `help/` pages for import and backup if the Overwrite description changes.

## 8. Decisions for the human

1. Overwrite keeps the existing id (proposed). Is there any entity where a fresh id is wanted?
2. Per-field `onMissing` where the two sides disagree today: `summaryAnchorMessageIds` (proposed: drop the unknown ids from the array), chat `imageProfileId` (proposed: null), `swipeGroupId` (proposed: import's `swipe-<id>` rewrite).
3. Deterministic built-in roleplay template ids with a re-keying migration (proposed), or match built-ins by name at restore time and leave ids random?
4. Backup of a character whose vault is unreadable: back up the row and its memories with a manifest warning (proposed), or refuse the backup?

**Decisions taken.** All four §8 proposals: (1) Overwrite keeps the existing id for every entity; (2) `summaryAnchorMessageIds` drops unknown ids, chat `imageProfileId` is cleared, `swipeGroupId` uses the `swipe-<id>` rewrite; (3) deterministic UUIDv5 built-in ids with a re-keying migration (`rekey-built-in-roleplay-templates-v1`; project pointers, which live in project stores, re-keyed by the boot step `rekeyProjectRoleplayTemplatePointers`); (4) a row whose store is unreadable is backed up as its bare row with its memories and a `manifest.warnings` note.

**§4.2 outcomes.** Every traced item reproduced and was filed and fixed: restore id gaps (#199, plus `linkGroupId` not reissued), groups-only bundles (#200), the missing footer (#201), and `findAll` / the 10,000-log cap in backup and deletion (#202).

**What landed beyond the plan.** Reconciliation now rewrites only rows the import wrote (it used to remap skipped, pre-existing rows through the bundle's maps). Import remaps character ids inside message payloads. A legacy `plugin:*` roleplay template reference is opaque and never cleared. A pre-change backup cannot say which built-in template a chat used; those pointers clear on a new-account restore.

**Left as bespoke** (listed in the table with the reason): vault and avatar pointers on import, scenario sources, character-keyed chat columns, wardrobe item ids, polymorphic `linkedTo`, the memory import's pre-minted ids, and the inform verifier. Restore's folder, mount-point, blob, plugin-config, text-rule, wear-ledger, history and avatar-timeline loops keep their own loops (each has bespoke conflict handling); their counts were already outcome counts.
