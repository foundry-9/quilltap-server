# Fix: content-addressed blob sha256 mismatch (vault `doc_mount_blobs`)

**Status:** planned
**Audience:** Claude Code (implementer)
**Origin:** discovered while testing the "Save to character gallery" hard-link + dedup path.

---

## 1. Problem statement

A character/user-gallery photo can end up stored in the content-addressed vault store
(`doc_mount_blobs` / `doc_mount_files`) with a **recorded `sha256` that does not match the
bytes actually stored**. Content addressing and hard-link dedup key off that sha, so a wrong
value silently defeats dedup and makes the gallery list advertise a hash that won't match the
servable bytes.

### Concrete reproduction (observed)

Source vault photo link `37a04277-…` (Friday's vault, mount `76fb388c-…`), content row
`07140f81-…`:

- `doc_mount_files.sha256` / `doc_mount_blobs.sha256` = `f77ecd3e…`, `sizeBytes` = 7108, `dataLen` = 7108
- but `sha256(actual blob bytes)` = `40083e5b…`

Saving that link into another character's gallery re-hashes the real bytes and stores the
**correct** sha (`40083e5b…`), so the "saved" copy diverges from the "source" — i.e. the save
path already *heals* the value, which is how the mismatch surfaced.

### Root cause

1. `lib/images-v2.ts` `uploadImage` computes `sha256` from the **pre-transcode input buffer**
   (~line 116) and stamps that onto the `files` FileEntry (~line 168), while the storage bridge
   (`writeUserUploadToMountStore`) transcodes bitmaps to **WebP**. So `FileEntry.sha256` is the
   *input* hash, not the stored-bytes hash.

   > **This is intentional for the `files` table.** See the docstring of
   > `migrations/scripts/repair-files-mime-and-size-from-mount-blob.ts` (lines 27–30):
   > `files.sha256` is the input-bytes hash on purpose — `findBySha256` runs *before* the
   > transcode so re-uploading the same source file dedups. **Do not change `files.sha256`.**

2. The bug is the **propagation of that input-hash sha into the content-addressed vault store.**
   The photo-save services pass `fileEntry.sha256` straight to `linkBlobContent({ sha256, data })`
   while `data` is the post-transcode WebP read back via `readImageBuffer(...)`:
   - `lib/photos/save-image-to-album.ts` (~line 276: `sha256: fileEntry.sha256`)
   - `lib/photos/user-gallery-service.ts` (~line 195)

   `linkBlobContent` (`lib/database/repositories/doc-mount-file-links.repository.ts`, line 501)
   **trusts the caller's sha verbatim** — it dedups via `SELECT … doc_mount_files WHERE sha256 = ?`
   (line 521) and writes both `doc_mount_files.sha256` and `doc_mount_blobs.sha256` from
   `input.sha256` (lines 536, 576). Its `data` param is documented "Already-transcoded bytes."
   `upsertByFileId` in `doc-mount-blobs.repository.ts` (~line 223) has the same trust.

   `lib/photos/character-gallery-service.ts` already does it **right**: `saveToCharacterGallery`
   recomputes `createHash('sha256').update(data)` from the actual bytes (line 124). That is the
   pattern the other two services should match — or, better, enforce centrally.

### Scope

- **In scope:** the content-addressed mount store (`doc_mount_blobs`, `doc_mount_files`) where the
  invariant `sha256 == sha256(stored bytes)` must hold.
- **Out of scope / do not touch:** `files.sha256` (intentional input-hash for upload dedup),
  `extractedTextSha256` (hash of the markdown sidecar, unrelated), filesystem-source mounts
  (their links already compute sha from disk bytes).

---

## 2. Part A — code fix (prevent new mismatches)

**Primary fix — enforce the invariant at the single chokepoint.** Make the content-addressed
store authoritative about its own hashes instead of trusting callers (SRP / single-source-of-truth).

In `lib/database/repositories/doc-mount-file-links.repository.ts` `linkBlobContent`:

- Recompute `const computed = sha256OfBuffer(input.data)` at the top and use `computed` for
  **both** the dedup lookup (line 521) and the inserts into `doc_mount_files` (line 536) and
  `doc_mount_blobs` (line 576). Reuse the existing helper used in `lib/mount-index/conversion.ts`
  (`sha256OfBuffer`) rather than hand-rolling.
- When `input.sha256 !== computed`, emit `logger.warn` (with `mountPointId`, `relativePath`,
  `passedSha`, `computedSha`) so the upstream caller bug is visible in logs, then proceed with
  `computed`. Keep `sha256` in `LinkBlobInput` for now (callers still pass it) but update its
  doc comment to "advisory; the store recomputes from `data`."
- Apply the identical treatment to `doc-mount-blobs.repository.ts` `upsertByFileId` (~line 223),
  which also takes `{ sha256, data }`.

Why this is safe for existing correct callers:
- The bridges (`project-store-bridge`, `user-uploads-bridge`, `lantern-store-bridge`,
  `character-vault-bridge`) already pass `transcoded.sha256` → recompute is a **no-op**.
- `conversion.ts` / `file-ops.ts` already pass `sha256OfBuffer(bytes)` → **no-op**.
- `character-gallery-service` already recomputes from bytes → **no-op**.
- Only the two buggy callers (`save-image-to-album`, `user-gallery-service`) change behaviour —
  to the correct one.

Dedup implication (intended): dedup now keys on the real content hash, so genuinely-identical
stored bytes dedup even when their original upload formats differed. This is the desired
content-addressed semantics.

**Secondary (clarity, optional but recommended):** in `save-image-to-album.ts` and
`user-gallery-service.ts`, stop passing `fileEntry.sha256` and pass a freshly computed
`sha256OfBuffer(buffer)` (or drop the field once it is advisory). Leaves intent obvious at the
call site even though the chokepoint now guarantees correctness.

**Logging:** per repo convention, add `logger.debug` around the recompute (sha in/out, byte
length) and keep the mismatch `logger.warn`.

---

## 3. Part B — repair migration (fix existing data)

New migration, modelled closely on `migrations/scripts/repair-files-mime-and-size-from-mount-blob.ts`
(same cross-DB plumbing, batching, idempotency, `reportProgress`, `shouldRun` guard).

**ID:** `repair-mount-blob-sha256-from-bytes-v1`
**File:** `migrations/scripts/repair-mount-blob-sha256-from-bytes.ts`

### Behaviour

Operate on the **mount-index DB** (open via `getMountIndexDatabasePath()` + the
`ENCRYPTION_MASTER_PEPPER` key pragma — copy `openMountIndexDb()` from the template). For each
`doc_mount_blobs` row:

1. Recompute `actual = sha256(data)`.
2. If `actual === sha256` (recorded) → skip (idempotent; most rows, incl. already-healed ones).
3. Else, in one transaction:
   - `UPDATE doc_mount_blobs SET sha256 = :actual, updatedAt = … WHERE id = :id`
   - `UPDATE doc_mount_files SET sha256 = :actual, updatedAt = … WHERE id = :fileId`
     (the blob's `fileId` is the content-identity row).

`doc_mount_files.sha256` index is **NOT UNIQUE** (`doc-mount-files.repository.ts` lines 53–58 —
"Not UNIQUE — existing instances may carry duplicates"), so the in-place update cannot throw on
collision. If the corrected sha now duplicates another content row, that is tolerated by the
existing design (`findBySha256` → first match); a follow-up consolidation pass is **out of scope**
for v1 — note it as a possible `-v2`.

### Memory / performance

Blob `data` can be multi-MB. Do **not** `SELECT data` for 500 rows at once. Select **ids only**
in keyset-paginated batches (`WHERE id > ? ORDER BY id LIMIT N`), then read+hash each row's `data`
individually. `reportProgress(scanned, total, 'blobs')` against an upfront `COUNT(*)`.

### Guards / edges

- `shouldRun`: `isSQLiteBackend()` && mount-index DB file exists && `doc_mount_blobs` has rows.
- Rows with NULL/empty `data` → skip + `logger.warn` (orphan; separate problem).
- `files.sha256` (main DB) is **not** touched — restate this in the migration docstring with a
  pointer to `repair-files-mime-and-size-from-mount-blob-v1`.
- Return `MigrationResult` with `itemsAffected = corrected`, and a message tallying
  scanned/corrected/skipped/orphaned.

### Registration & required companions (commit will block without these)

- Add to `migrations/scripts/index.ts` (export + ordered registration). `dependsOn`:
  `['relink-files-to-mount-blobs-v1']` (and after `repair-files-mime-and-size-from-mount-blob-v1`
  if ordering matters).
- **`lib/startup/prettify.ts`** — add a `PRETTY_LABELS` entry in the steampunk/Wodehouse voice
  (e.g. "Reconciling photo fingerprints with their actual likenesses"). Missing label blocks commit.
- It iterates a collection → `reportProgress(...)` in the loop is mandatory (already covered above).

---

## 4. Cross-cutting checklist (repo conventions)

- **`docs/CHANGELOG.md`** — terse, plain American-English dev entry (changelog is exempt from the
  steampunk voice). E.g. "Fixed: vault blob writes now record sha256 from stored bytes, not the
  caller-supplied (pre-transcode) hash; added `repair-mount-blob-sha256-from-bytes-v1` to correct
  existing rows."
- **`docs/developer/DDL.md`** — note the now-enforced invariant on `doc_mount_files` /
  `doc_mount_blobs` (`sha256` == hash of stored bytes, recomputed at write).
- **`.qtap` export / import & backups** — verify, don't assume:
  - Export (`lib/export/ndjson-writer.ts` `streamDocumentStores`) emits `doc_mount_blob.sha256`;
    after repair these are correct. Blob chunk reassembly is unaffected.
  - Import (`lib/import/quilltap-import/*`) dedups by sha — corrected shas make dedup behave; check
    no importer assumes the old (input-hash) value.
  - Confirm `public/schemas/qtap-export.schema.json` needs no change (sha is still just a string).
- **Help docs** — this is internal data integrity, not user-visible UI/behaviour, so `help/*.md`
  likely needs no change. Double-check the gallery help text makes no sha claims.
- **No `packages/` changes** expected (the `quilltap` CLI is unaffected). If a CLI audit verb is
  added there, follow the publish-first rule.

---

## 5. Tests

- **Unit — `linkBlobContent` / `upsertByFileId`:** passing a deliberately wrong `sha256` with known
  `data` stores `sha256(data)` and logs a warn. Passing the correct sha is a no-op.
- **Unit/integration — the two services:** `save-image-to-album` and `user-gallery-service` over a
  transcoded FileEntry produce a blob whose recorded sha equals the stored bytes' hash.
- **Migration test** (model on `__tests__/unit/lib/database/migration/cutover-characters-to-vault.test.ts`):
  seed a `doc_mount_blobs` + matching `doc_mount_files` row with a deliberately wrong sha, run the
  migration, assert both corrected and idempotent on a second run; assert NULL-data rows skipped.
- **Tool-definitions snapshot:** N/A (no new tool).
- **`npx tsc`** clean (not `npm run build`).

---

## 6. Live verification (Friday instance)

1. **Before:** read-only audit of how many rows are affected. The `quilltap` CLI can't hash in SQL,
   so add a tiny throwaway node script (or temporary `db` repl helper) that opens the mount-index DB
   and counts rows where `sha256(data) != sha256`. Record the count.
2. Run the migration (it executes at startup; or use `npx quilltap migrations run --dry-run` to list
   it pending, then start the dev server to apply). Watch `combined.log` for the prettify label and
   the migration's tally.
3. **After:** re-run the audit → expect 0 mismatches.
4. **Re-run Test 4** end-to-end: save Friday's source photo (`linkId 37a04277-…`) into a fresh
   disposable character; the saved copy's sha should now **equal** the source's reported sha, and
   same-vault dedup still yields `Image already in …'s photo album`.

---

## 7. Suggested execution split (per CLAUDE.md: plan in Opus, delegate to agents)

- Agent 1 — Part A code fix + unit tests for the repository chokepoint and the two services.
- Agent 2 — Part B migration + migration test + `index.ts`/`prettify.ts` registration.
- Agent 3 — docs (CHANGELOG, DDL), export/import audit, live audit script.
- Reconcile, `npx tsc`, run the migration on Friday, then the `/commit` flow.

Do **not** use `git stash`/worktrees with agents.
