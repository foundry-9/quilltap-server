# Refactor 4.13 — One delete path and one projection in the mount-index repositories

**Status:** Proposed (2026-11-10), written against `HEAD` = 167d06503. Part of the [4.13 refactor set](refactor-4-13.md). Fixes #189 and #191 by construction.

Line numbers are from the audit and will drift. Re-locate each site by name before editing.

## 1. The problem

A file in a document store is four kinds of row: a link (`doc_mount_file_links`), a file (`doc_mount_files`), content (`doc_mount_documents` or a blob), and chunks with embeddings (`doc_mount_chunks`). Content is shared across stores by sha, by design. "Remove this file from this store" therefore has rules: drop the link, dissolve a link group of one, collect the file row and its content only when the last link is gone, drop the chunks, invalidate the mount-chunk cache, emit the delete event.

`deleteWithGC` (`doc-mount-file-links.repository.ts:857-903`) and `lib/mount-index/delete-store-cascade.ts` know most of those rules. Five other functions delete beside them and each knows fewer:

| Site | What it skips |
|---|---|
| `doc-mount-file-links.repository.ts:910-955` | No caller. Dead. |
| `doc-mount-blobs.repository.ts:620-648` (`deleteByMountPointAndPath`) | Link-group dissolve, cache invalidation, `emitDocumentDeleted`; matches the path with exact `=` while its sibling read uses `LOWER()`; selects from links with no join to blobs, so it deletes a document at that path too |
| `doc-mount-blobs.repository.ts:654-689` | As above |
| `doc-mount-files.repository.ts:123-158` | Bare `DELETE FROM doc_mount_files` instead of `gcOrphanedFileRow` |
| `doc-mount-documents.repository.ts:302-318` (`deleteByMountPointId`) | Shared-content safety: deletes content linked from other stores (#191) |

And `deleteWithGC` itself relies on a foreign key for chunks that instances created by the schema translator do not have (#189): `lib/database/schema-translator.ts` emits no `REFERENCES`, and `lib/mount-index/orphan-store-reaper.ts:57-62` says as much but compensates for documents and blobs only.

The same family has a second copy problem. The joined link + file SELECT is spelled about eight times (`doc-mount-file-links` `:701-756`, `:1556-1617`; `doc-mount-files` `:160+`; five copies in `doc-mount-blobs` `:400-604`; four in `doc-mount-documents` `:118-285`). Bug 15 was a column missing from one copy. And "same path" is spelled three ways: `LOWER(a) = LOWER(b)`, `COLLATE NOCASE`, and exact `=`. Only `NOCASE` can use the unique index; #147 was a case mismatch of this kind.

## 2. Goal

- One function removes a link and everything that hangs from it; every delete in the family is a caller.
- Chunks are deleted explicitly, never by an assumed cascade.
- One projection constant for the joined link + file row, and one path-equality fragment.

## 3. Non-goals

- `lib/documents/core/` (the document core from the 4.12 set). It already calls `deleteWithGC` through `deleteDocument`; this spec changes what is beneath it.
- The chunking and embedding pipeline.
- Adding foreign keys to existing databases. Explicit deletes make the cascade unnecessary; §8 asks whether to add it anyway.

## 4. Known state

### 4.1 Verified by reading (2026-11-10)

- `deleteWithGC` deletes the link, dissolves a group of one, calls `gcOrphanedFileRow`, invalidates the mount; it does not touch `doc_mount_chunks` and its comment says they cascade.
- `rg "REFERENCES|FOREIGN KEY" lib/database/schema-translator.ts` finds nothing.
- `dropChunksForLinks(db, linkIds)` exists in the same file (about `:92`).
- `deleteByMountPointId` in the documents repository has no cross-mount check.

### 4.2 Traced by the audit, not independently re-verified

- **`doc_delete_blob` and the write policy.** `lib/tools/handlers/doc-edit/blob-handlers.ts:314-336` calls `deleteByMountPointAndPath` without `assertCharacterMayWrite`, and because that repository method selects by path from links alone, a character can delete a `character_write: false` document through the blob tool. In the job child the method classifies as a write and returns `undefined`, so the handler reports "Blob not found" for a delete that then commits. Confirm with a test; if it reproduces, it is a policy bypass and should be filed and fixed in Phase 1 (see the note on disclosure in the [index](refactor-4-13.md)).
- `findAllWithEmbeddingsByMountPointIds` (`doc-mount-chunks.repository.ts:220-245`) selects by `mountPointId` with no join to links, which is why an orphaned chunk still reaches search.
- V4test's error log has "Doc mount chunk not found for embedding update" apply failures, consistent with chunks and links getting out of step.

## 5. Design

### 5.1 `removeLink`

In `doc-mount-file-links.repository.ts`, one synchronous function used inside a transaction:

```ts
function removeLinkTx(db, linkId): { fileId: string; fileCollected: boolean; mountPointId: string } | null
```

It deletes the link's chunks (`dropChunksForLinks`), the link, dissolves a group of one, and calls `gcOrphanedFileRow`. `deleteWithGC` becomes a wrapper that runs it in a transaction and invalidates the cache. A bulk form (`removeLinksTx(db, linkIds)`) serves store-level deletes.

Every site in §1's table is rewritten as "resolve the link(s), call `removeLinksTx`", or deleted:

- `deleteByMountPointAndPath` (blobs): removed. Its two callers resolve the link with `docMountFileLinks.findByMountPointAndPath`, apply the write-policy gate, and go through the document core's `deleteDocument`.
- `deleteByMountPointId` (documents): removed in favour of `delete-store-cascade.ts`, which already collects shared content correctly; `import-document-stores.ts` and `conversion.ts` call the cascade's "empty this store" form.
- The no-caller copy at `:910-955`: removed.

### 5.2 Orphans already on disk

`reapOrphanedStoreChildren` gains a chunks arm: delete `doc_mount_chunks` rows whose `linkId` names no link. It already runs at boot. Report the count through the existing logger; if the arm can take long on a large index, it needs a startup label and progress.

### 5.3 Projection and path equality

- `LINK_FILE_COLUMNS` (one constant, one row mapper) replaces the hand-written SELECT lists.
- `pathEquals(column)` returns the `COLLATE NOCASE` form; every path comparison in the family uses it. Check each site's index usage with `EXPLAIN QUERY PLAN` in a test (not `db.explain()`, which is v13-only driver API the Electron shell may not have).

### 5.4 DDL.md

`docs/developer/DDL.md` documents a foreign key on `doc_mount_chunks` that fresh installs lack. Correct it to describe what the translator emits.

## 6. Phases

1. **Failing tests** against a mount-index database created by `generateDDL` (not the migration): delete a chunked document, assert no chunk rows remain (#189); two stores share a file, empty one, assert the other still reads it (#191); the `doc_delete_blob` policy test (§4.2).
2. **`removeLinkTx`**; `deleteWithGC` on it; chunks deleted explicitly.
3. **The other delete sites** onto it or removed; the grep-test in `__tests__/unit/lib/documents/core-chokepoint.test.ts` extended to forbid `DELETE FROM doc_mount_` outside the links repository and the cascade.
4. **The reaper's chunks arm.**
5. **Projection and path equality.**
6. DDL.md.

## 7. Tests and gates

- Real-SQLite repository tests (require `better-sqlite3` by absolute root path; see the Jest notes in the repo).
- Expected size: about 330 lines removed (150 delete paths, 180 projections); low–medium risk.
- CHANGELOG cites `#189`, `#191`. No help-doc change.

## 8. Decisions for the human

1. Add the foreign keys to databases that lack them, as defence in depth (a table rebuild, which drops triggers and needs care), or rely on explicit deletes only (proposed)?
2. `doc_delete_blob` on a path that holds a document: refuse with "that is a document, use the document tools" (proposed), or delete it subject to the write policy?
