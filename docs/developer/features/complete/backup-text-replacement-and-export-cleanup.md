# Spec: Close the `text_replacement_rules` backup gap + tidy legacy export drift

**Author:** Ariadne (audit) → for Claude Code to execute
**Status:** Ready to implement
**Scope:** `lib/backup/**`, `lib/export/quilltap-export-service.ts`, tests, docs

---

## 1. Background & findings

An audit of the backup/restore and `.qtap` export/import systems against the full
data model (37 data-bearing repositories) found:

1. **`text_replacement_rules` is silently dropped by backup/restore.** It is ordinary
   user content (literal find→replace rules), **not** a secret. Its master switch,
   `chat_settings.textReplacementsEnabled`, *is* backed up — so a restore brings the
   feature back **enabled with zero rules**. That asymmetry is the bug. The table is
   absent from backup collection, the backup manifest, the staging writer, the restore
   reader, the restore loop, and the replace-mode truncation list.

2. **`.qtap` export/import is thorough and symmetric** — the live NDJSON writer emits
   20 record kinds and the importer handles all 20. **No entity is missing.**

3. **Legacy drift:** `lib/export/quilltap-export-service.ts` still contains an
   in-memory `createExport` path plus per-entity `exportXxx` builders that are **dead
   in production** (only `previewExport` and `generateExportFilename` from that file
   are called live, by `app/api/v1/system/tools/route.ts`). The dead `exportChats`
   builder also diverges from the schema/types by never collecting
   `conversationAnnotations` / `chatDocuments`. This is misleading dead code.

### Decisions (confirmed with Charlie)

- **Do back up `text_replacement_rules`.** ✅
- **Do NOT back up `terminal_sessions`.** Transient PTY session metadata; `transcriptPath`
  points at files, not content. Leave it out by design. (No work item — documented here
  so the omission is a recorded decision, not an accident.)
- **Do NOT add `text_replacement_rules` to `.qtap`.** It is global config with no
  `userId`, the same class as `chat_settings`/`instance_settings`, which `.qtap`
  intentionally omits. `.qtap` is for portable *entities*. Backup/restore is its home.
- **Do tidy the legacy export drift** by deleting the dead in-memory export path,
  keeping only what production uses. The nested-JSON **import** path and the
  `qtap-export.schema.json` schema stay — they still validate/accept legacy `.qtap`
  files (`peekFormat` → `collectLegacyJson` → `execute.ts`, which already handles
  annotations and chat documents).

---

## 2. Part A — Add `text_replacement_rules` to backup/restore (required)

The repository already exists: `globalRepos.textReplacementRules`
(`lib/database/repositories/text-replacement-rules.repository.ts`), exposing
`list()`, `create()`, `update()`, `delete()`, and `bulkReplace()`. The row type is
`TextReplacementRule` from `lib/schemas/text-replacement.types.ts`. The table is global
(no `userId`) with a unique `(fromText, caseSensitive)` constraint enforced by
`create()` (throws `TextReplacementRuleConflictError`).

Model every change on the existing **`embeddingStatus`** / **`tfidfVocabularies`**
handling — they are the closest precedent (global tables, optional arrays, guarded loops).

### A.1 `lib/backup/types.ts`

- Import `TextReplacementRule` from `@/lib/schemas/text-replacement.types`.
- Add to the `BackupData` interface (near `embeddingStatus`):
  `textReplacementRules?: TextReplacementRule[];`
- Add to the manifest `counts` block:
  `textReplacementRules?: number;`

> **Backup format version:** adding a new *optional* array is backward compatible —
> older backups simply lack the file and restore guards with `|| []`. **Do not** bump
> `backupFormat` (stays `3`). Restore of an old backup must still succeed.

### A.2 `lib/backup/backup-service.ts`

- In `collectBackupData`, fetch the rules:
  `const textReplacementRules = await globalRepos.textReplacementRules.list();`
  (Add it to the existing parallel collection or as a standalone `await` alongside
  `tfidfVocabularies` / `embeddingStatus`.)
- Add `textReplacementRules` to the returned `BackupData` object.
- In `createManifest`, add `textReplacementRules: data.textReplacementRules?.length || 0`
  to `counts`.
- In `createBackup`, in the staging-write block (next to the other
  `writeJsonArrayFile(... 'data', '...json')` calls), add:
  `await writeJsonArrayFile(path.join(stagingDir, 'data', 'text-replacement-rules.json'), data.textReplacementRules || []);`

### A.3 `lib/backup/restore/archive.ts`

- Import `TextReplacementRule`.
- Add to the read block (next to `embeddingStatus`):
  `const textReplacementRules = await readJsonArrayFileOptional<TextReplacementRule>(rootPath, 'data/text-replacement-rules.json', []);`
- Include `textReplacementRules` in the assembled `BackupData` object that this
  function returns.

### A.4 `lib/backup/restore/uuid-remap.ts` (`remapBackupData`)

- `text_replacement_rules` has **no foreign keys** to remapped entities, and no other
  table references rule IDs. Pass the array through **unchanged** (do not remap IDs).
  Add it to the returned object so it isn't dropped during remap. Add a one-line
  comment explaining why no remapping is needed.

### A.5 `lib/backup/restore/restore.ts`

- Add a restore loop modeled on the `embeddingStatus` loop (~line 617). Because the
  table is global with a unique `(fromText, caseSensitive)` constraint, insert each
  row through `globalRepos.textReplacementRules.create(...)` inside a `try/catch` that
  swallows `TextReplacementRuleConflictError` (skip duplicates; matches the tolerance
  of the other restore loops). Preserve `id`, `sortOrder`, `enabled`, `caseSensitive`,
  `createdAt`, `updatedAt` where `create` accepts them; if `create` regenerates
  `id`/timestamps, that is acceptable since nothing references rule IDs.
  - Track a `textReplacementRulesRestored` counter and add it to the restore result
    summary object (alongside `embeddingStatus`, `tfidfVocabularies`, etc. ~line 762).
- Fire debug/info logs around the loop, per project logging conventions.

### A.6 `lib/backup/restore/delete-service.ts`

- In `clearFormat3Entities()`, add `'text_replacement_rules'` to the `mainTables`
  array so **replace-mode** restore starts from a clean slate (otherwise restored rows
  collide with pre-existing rules on the unique constraint and get skipped).
- `deleteAllUserData` extends the same clearing; confirm the added truncate is reached
  on that path too (it calls the same helper). If `deleteAllUserData` has its own table
  list, add `text_replacement_rules` there as well.

### A.7 `lib/backup/restore/preview.ts`

- If the restore preview surfaces per-entity counts, add `textReplacementRules` so the
  pre-restore preview reports the rules it will bring in. (If preview only reads the
  manifest counts, A.1's manifest addition already covers it — verify.)

### A.8 Tests

- Extend the backup/restore round-trip test (find the existing one under
  `lib/backup/**/__tests__/` or `lib/backup/restore/**/__tests__/`) to:
  1. Seed N text-replacement rules.
  2. Create a backup; assert `manifest.counts.textReplacementRules === N` and that
     `data/text-replacement-rules.json` exists in the archive.
  3. Restore into a clean DB (replace mode); assert all N rules come back with
     `fromText`, `toText`, `caseSensitive`, `enabled`, `sortOrder` intact.
  4. Assert restoring an **old** backup with no `text-replacement-rules.json` still
     succeeds (the `|| []` / `readJsonArrayFileOptional` guard).

### A.9 Docs

- **`docs/CHANGELOG.md`** — terse, plain American English (changelog is the explicit
  exception to the house voice). E.g.:
  `Backup/restore now includes text replacement rules (previously only the enable switch was backed up).`
- **`help/*.md`** — text replacement is a user-visible feature, so the backup help doc
  must mention that rules are now included. Write this entry in the house
  steampunk/Wodehouse voice. Update the `url` frontmatter and the matching
  `help_navigate(...)` call per the help-file rules.
- **`docs/developer/DDL.md`** — already documents `text_replacement_rules`; confirm no
  edit needed beyond a note that it participates in backup/restore (optional).
- **`.claude/commands/update-documentation.md`** — no new doc added, so likely no change;
  verify.

### A.10 Export schema / `.qtap`

- **No change.** Per the decision above, `text_replacement_rules` does **not** go into
  `.qtap` or `public/schemas/qtap-export.schema.json`. Do not add it there.

---

## 3. Part B — Tidy the legacy export drift (cleanup)

**Goal:** remove the dead in-memory export path so the only export code is the live
NDJSON writer + the preview helpers. This eliminates the schema/type divergence without
touching any live behavior.

### B.1 Confirm dead before deleting

Re-run (must all report no callers outside the file itself and its tests):

```
for fn in createExport exportCharacters exportChats exportRoleplayTemplates \
          exportConnectionProfiles exportImageProfiles exportEmbeddingProfiles \
          exportTags exportProjects exportDocumentStores; do
  grep -rln "\b$fn\b" app lib --include=*.ts | grep -v __tests__ | grep -v quilltap-export-service.ts
done
```

(At audit time, all ten had **no** live callers. `previewExport` and
`generateExportFilename` from the same file **are** live, via
`app/api/v1/system/tools/route.ts`.)

### B.2 In `lib/export/quilltap-export-service.ts`

- **Delete** `createExport` and the ten `exportXxx` entity-builder functions.
- **Keep** `previewExport` and `generateExportFilename` (live).
- **Keep** helpers still referenced by `previewExport`: `collectCharacterMemories`,
  `collectChatMemories`. **Delete** helpers that become orphaned once the builders are
  gone (`sanitizeProfile`, `resolveApiKeyLabel`, `getChatMessages`, `createManifest`,
  `resolveTagNames` — verify each has no remaining reference before removing).
- Remove now-unused imports/types. Run `npx tsc` to surface dangling references.

### B.3 Do NOT touch

- `lib/export/ndjson-writer.ts` (live export) — leave as is.
- `lib/import/**` and `public/schemas/qtap-export.schema.json` — the nested-JSON
  **import** path still uses the schema and `execute.ts` already restores
  `conversationAnnotations` / `chatDocuments`. Leave intact.
- The `ChatsExportData` type fields and schema `conversationAnnotations`/`chatDocuments`
  arrays — they describe the **legacy import** format and stay.

### B.4 Lock in NDJSON thoroughness with a regression test

- Add/extend a test that exercises the live path: build a chat with at least one
  conversation annotation and one chat document, run `createNdjsonStream`, feed the
  output back through the importer (`assembleExportFromStream` / `executeImport`), and
  assert the annotation and chat document survive the round-trip. This guards against
  future regressions in the path that actually ships.

---

## 4. Verification checklist (before commit)

- [ ] `npx tsc` clean (use `npx tsc`, not `npm run build`).
- [ ] New + existing backup/restore tests pass; new NDJSON round-trip test passes.
- [ ] Manual: create a rule, back up, wipe, restore → rule returns and the switch state
      is consistent.
- [ ] Manual: restore a pre-change backup (no `text-replacement-rules.json`) → succeeds.
- [ ] `grep` confirms the ten dead export functions are gone and nothing references them.
- [ ] `docs/CHANGELOG.md` updated (terse voice); backup help doc updated (house voice,
      correct `url` + `help_navigate`).
- [ ] No package version bumps needed (this is app code, not a `packages/` package; no
      plugin touched).
- [ ] Run the `/commit` flow (handles lint/test/type-check/version) per project process.

## 5. Out of scope (recorded decisions)

- `terminal_sessions` — intentionally not backed up (transient PTY metadata).
- `text_replacement_rules` in `.qtap` — intentionally excluded (global config, not a
  portable entity; consistent with `chat_settings`/`instance_settings`).
- `users`, `api_keys`, `background_jobs`, `help_docs` — correctly excluded from backup
  already (identity, secrets, transient queue, built-in content). No change.
