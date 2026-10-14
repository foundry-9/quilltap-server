# Bug 156 — overwriting a database-store document leaves its old chunks, and the rescan that claims to catch this does not

**FIXED in v4 (2026-09-21)** — the overwrite now announces itself. When
`linkDocumentContent`'s UPDATE branch repoints a link at a different `fileId`
it deletes that link's rows from `doc_mount_chunks` and sets `chunkCount = 0`
(and `fanOutGroupFileId` does the same for exactly the hard-link siblings whose
content moved), then invalidates the affected mounts' chunk caches. The
existing rescan predicate — `chunkCount === 0 || conversionStatus !==
'converted'` — therefore catches every un-re-chunked overwrite, including the
in-child `doc_write_file` writes that defer chunking to it by design, with no
new column and no new query. Writers that re-chunk immediately set the real
count back moments later. Deleting the rows as well as zeroing the count was
step 2 of the recommended fix and is kept: a search between the write and the
re-chunk now returns nothing rather than the previous revision.
`rescanDatabaseMountPoint`'s docstring describes the predicate that exists
instead of a sha-drift check that was never written, and says why the predicate
is now sufficient. The post-write re-chunk block is factored out of
`writeDatabaseDocument` into `lib/mount-index/post-write-reindex.ts`
(`reindexAfterDatabaseWrite`) and `file-ops.writeDestBytes` — which had none —
now calls it. Regression tests in
`__tests__/unit/lib/database/repositories/doc-mount-write-metadata.integration.test.ts`.

| | |
|---|---|
| **Status** | **FIXED** |
| **Found** | 2026-09-21, while planning the [document-store sync verb](../../features/complete/cli-document-store-sync.md); not reported live |
| **Fixed** | 2026-09-21, in the same change as [bug 155](bug-155-byte-write-blanks-caption.md), ahead of `quilltap sync` |
| **Severity** | **Medium** — no data loss; the document is correct on read. But semantic search, `doc_grep`'s chunk fallback, and every character's RAG context keep serving the *previous* revision of an edited document indefinitely, and nothing heals it short of `docs reindex --force` |
| **Who it bites** | anyone who overwrites an existing text document in a database store through a path that does not re-chunk: the Scriptorium file manager's upload onto an existing path (SVAR → `?action=write-file`), `quilltap docs write --force`, cross-storage `copy --force`/`move` onto an existing path, and every `doc_write_file` issued from inside the forked job child (autonomous turns), which by design defers chunking "to the next database rescan" |
| **Provenance** | Original to v4. The rescan predicate predates the content/link split; the docstring describes a sha-drift check that was never written |
| **Fix site** | `lib/mount-index/database-store.ts` (`rescanDatabaseMountPoint`, `:646-695`); `lib/database/repositories/doc-mount-file-links.repository.ts` (`linkDocumentContent` update branch, `:1093-1106`); `lib/mount-index/file-ops.ts` (`writeDestBytes`, `:716-728`) |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

## Symptom

A Markdown document in a database store has been chunked and embedded. It
is overwritten with new content by one of the paths above. `docs read`
shows the new text; `docs grep --semantic` and a character's document
recall keep returning passages from the old text. `docs status` shows the
link with `chunkCount > 0` and `conversionStatus = 'converted'`, so a plain
`docs scan` or `docs reindex` (without `--force`) does nothing, and a
server restart does nothing either.

## Root cause

Three pieces that agree with each other and are wrong together.

**The repository marks an overwrite as fully processed.** The update
branch of `linkDocumentContent`
(`doc-mount-file-links.repository.ts:1093-1106`) repoints the link at the
new content row and forces `conversionStatus = 'converted'` while leaving
`chunkCount` untouched:

```ts
`UPDATE doc_mount_file_links SET
   fileId = ?, folderId = ?,
   plainTextLength = ?,
   conversionStatus = 'converted', conversionError = NULL,
   allowEmbed = ?, allowCharacterRead = ?, allowCharacterWrite = ?,
   lastModified = ?, updatedAt = ?
 WHERE id = ?`
```

Chunks are keyed by `linkId` and cascade only on link *deletion*, so the
old revision's rows in `doc_mount_chunks` survive the repoint.

**Not every writer re-chunks afterwards.** `writeDatabaseDocument`
(`database-store.ts:170-195`) follows the write with `reindexSingleFile` and
`reindexLinkGroupSiblings` on the parent process, so the PUT files route
and the `doc_*` tools on the parent are fine. But `file-ops.writeDestBytes`
(`file-ops.ts:716-728`) calls `linkDocumentContent` and then only
`emitDocumentWritten`, whose sole subscriber schedules **embedding** of
null-vector chunks (`watcher.ts:113-115`) — it never re-chunks. And
`writeDatabaseDocument` itself skips the reindex inside the job child by
design (`:165-169`), on the stated assumption that "in-child writers …
leave chunking to the next database rescan".

**The rescan does not do what its docstring says.** The comment on
`rescanDatabaseMountPoint` (`database-store.ts:646-653`) promises to
"re-chunk every document whose content sha has drifted from its file-record
sha". The predicate (`:670-672`) is:

```ts
const needsRechunk =
  link.chunkCount === 0 ||
  link.conversionStatus !== 'converted';
```

No sha is consulted. After an overwrite the link has `chunkCount > 0` and
`conversionStatus = 'converted'`, so the rescan — at startup via
`scanAllMountPoints`, and on `?action=scan` — walks straight past it. The
in-child deferral therefore defers to a pass that will never run. There is
no other mount-index content reconcile at startup; the reconciles that exist
cover the main `files` table, orphaned rows, and embedding dimensions.

Nothing on the link records which content the chunks were built from —
`extractedTextSha256` is the sha of *extracted* text for pdf/docx, not of
the bytes, and is `NULL` for native text — so a sha-drift check has nothing
to compare against even if written.

## Why it survived

- The most-used write paths (the Salon's `doc_*` tools on the parent, the
  Scriptorium editor's PUT) *do* re-chunk, so the common case is correct.
- A stale chunk set still answers searches plausibly; there is no error,
  no log line, and nothing in `docs status` distinguishes "chunked from this
  revision" from "chunked from some revision".
- The docstring's claim is exactly what a reader expects the function to
  do, so a code review that reads the comment and the predicate separately
  finds nothing amiss.

## The fix

1. **Make the overwrite say so.** In `linkDocumentContent`'s update branch,
   when the link's `fileId` actually changes, set `chunkCount = 0` (and do
   the same in `fanOutGroupFileId`'s text variant for the siblings). The
   existing rescan predicate then catches every overwrite that nobody
   re-chunked, including the in-child ones, with no new column and no new
   query. Writers that re-chunk immediately (`writeDatabaseDocument` on the
   parent) set it back to the real count moments later, as they do for a
   fresh insert today.
2. **Optionally delete the stale rows at the same moment**
   (`docMountChunks.deleteByLinkId`) so a search between the write and the
   re-chunk returns nothing rather than the old revision. This is the safer
   default for the byte-preserving writer, which has no re-chunk step of its
   own.
3. **Fix the docstring** on `rescanDatabaseMountPoint` to describe the
   predicate that exists, or — if a sha-drift reconcile is genuinely wanted
   as belt-and-braces — record the content sha the chunks were built from
   on the link (a new `chunkedSha256` column, with DDL, export, and backup
   consequences) and compare it. Step 1 makes this unnecessary; recommend
   the docstring fix alone.
4. Give `writeDestBytes` the same parent-process re-chunk block that
   `writeDatabaseDocument` runs, factored into one shared helper (the
   [sync plan](../../features/complete/cli-document-store-sync.md) wants the same
   helper).

## How to verify

1. Create a Markdown document in a database store; let it chunk and embed
   (`docs status`).
2. `quilltap docs write --force <store> <path> <new-content.md>`.
3. Before the fix: `docs grep --semantic` for a phrase unique to the *old*
   content still hits; `docs scan` and a restart change nothing. After the
   fix: the old phrase no longer hits, and the new content's chunks appear
   without `--force`.
4. Repeat with a `doc_write_file` from an autonomous turn, then
   `docs scan`: the rescan now re-chunks it.
5. Regression tests: overwrite via `file-ops.writeFile` and assert
   `chunkCount === 0` (or the fresh count, if step 4 is taken) and that no
   chunk row carries the old content; a `rescanDatabaseMountPoint` case with
   a link at `chunkCount > 0`/`converted` whose `fileId` was repointed
   asserts it is re-chunked.
