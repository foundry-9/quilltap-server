# Bug 155 — writing a binary's bytes over an existing path blanks its caption

| | |
|---|---|
| **Status** | **OPEN** |
| **Found** | 2026-09-21, while planning the [document-store sync verb](../features/cli-document-store-sync.md); not reported live |
| **Fixed** | — |
| **Severity** | **Medium** — silent data loss of operator- or LLM-authored text. The bytes are fine; the `description` (and, with it, the `extractedText` caption the auto-describer wrote) is gone, and nothing tells anyone |
| **Who it bites** | anyone who re-uploads an image over an existing path in the Scriptorium file manager (SVAR upload → `?action=write-file`), runs `quilltap docs write --force` on an image, `docs copy --force` onto one, or moves/copies a described image from a filesystem store into a database store |
| **Provenance** | Original to v4: the `description` column arrived with the link table and `linkBlobContent` has always upserted it unconditionally |
| **Fix site** | `lib/mount-index/file-ops.ts` (`writeDestBytes`, `:731-748`), and/or `lib/database/repositories/doc-mount-file-links.repository.ts` (`linkBlobContent`, `:921-945`) |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../bugs.md) |

---

## Symptom

An image in a database-backed store carries a description — typed in the
Scriptorium, set by `doc_set_blob_description`, or written by the image
auto-captioner (`lib/photos/auto-describe-attachment.ts:123-155`, which
writes the same text to `description` *and* `extractedText` and chunks it).
The operator drops a corrected copy of the image onto the same path through
the file manager, or runs:

```
quilltap docs write --force Lore images/harbour.png ~/fixed-harbour.png
```

The bytes update. The description is now the empty string,
`descriptionUpdatedAt` is `NULL`, `extractedText` is `NULL`, and
`extractionStatus` is back to `none`. The chunks built from the old caption
survive (they are per link and nothing deleted them), so semantic search
still finds the image by a caption that no longer exists on the row, while
`list_blobs` and the Scriptorium show no description at all.

## Root cause

Two layers, each reasonable alone.

`linkBlobContent` treats every optional metadata field as "the new value",
defaulting to blank, and writes all of them on the **update** branch as well
as the insert
(`lib/database/repositories/doc-mount-file-links.repository.ts:921-945`):

```ts
const description = input.description ?? '';
const descriptionUpdatedAt = description ? now : null;
const extractionStatus = input.extractionStatus ?? 'none';
const extractedText = input.extractedText ?? null;
…
`UPDATE doc_mount_file_links SET
   fileId = ?, folderId = ?,
   originalFileName = ?, originalMimeType = ?,
   description = ?, descriptionUpdatedAt = ?,
   extractedText = ?, extractedTextSha256 = ?, extractionStatus = ?,
   lastModified = ?, updatedAt = ?
 WHERE id = ?`
```

There is no distinction between "the caller supplied an empty description"
and "the caller has no opinion about the description".

`file-ops.writeDestBytes` — the byte-preserving writer behind the
`write-file` action, cross-storage `copy`/`move`, and `copy --force` — has
no opinion and says nothing (`lib/mount-index/file-ops.ts:736-747`):

```ts
await repos.docMountFileLinks.linkBlobContent({
  mountPointId: destMount.id,
  relativePath: destRel,
  fileName: destFileName,
  folderId,
  fileType,
  originalFileName: destFileName,
  originalMimeType: originalMime,
  storedMimeType: originalMime,
  sha256: sha,
  data: bytes,
});
```

So a byte update is also a metadata wipe. The one writer that gets this
right is `hardLinkDbToDb` (`file-ops.ts:836`), which copies the source
link's description across explicitly — and the blob upload route
(`app/api/v1/mount-points/[id]/blobs/route.ts:64`), which passes the form's
`description` through, so a re-upload *with* a new description works and
a re-upload *without* one blanks it.

## Why it survived

- The common path for a *new* image is the blob upload route or
  `keep_image`, both of which supply the description on insert; the update
  branch is only reached by an overwrite, which is rarer.
- The auto-captioner skips links that already have `extractedText`
  (`auto-describe-attachment.ts:134-135`), so a blanked caption is never
  regenerated — but also never noticed, since the chunks still answer
  searches.
- No test covers "overwrite the bytes of a described blob"; the file-ops
  suite checks sha end to end and nothing about link metadata.

## The fix

Make the repository honour "no opinion". In `linkBlobContent`, on the
**update** branch, only write `description`/`descriptionUpdatedAt`,
`extractedText`/`extractedTextSha256`/`extractionStatus` when the
corresponding input field is `!== undefined`; otherwise keep the existing
values (`COALESCE` is not enough, because an explicit empty string must
still clear). The insert branch keeps its blank defaults. `writeDestBytes`
then needs no change and every other caller that omits the fields —
including the future sync verb — inherits the right behaviour.

Two consequences to decide alongside:

- When the bytes change under a caption the auto-describer wrote, the
  caption is now *stale* rather than *gone*. That is the better failure,
  and it is what happens today for text documents' `description`. If a
  re-caption on byte change is wanted, it belongs in the callers that know
  the bytes changed (`writeDestBytes` can compare `existingLink.fileId` to
  the new content row), not in the repository.
- The `PATCH …/blobs/<path>` route passes `description` defaulting to `''`
  (`blobs/[...path]/route.ts:146-168`) — that is a deliberate "set", and it
  goes through `updateDescription`, not this path, so it is unaffected.

## How to verify

1. Upload an image to a database store with a description; confirm
   `description` on its link row.
2. `quilltap docs write --force <store> <path> <other-image>`; confirm the
   sha changed **and** the description is intact.
3. Repeat through the Scriptorium file manager's upload onto the same path.
4. Regression test in the file-ops suite: overwrite a described blob and
   assert `description`, `descriptionUpdatedAt`, `extractedText`, and
   `extractionStatus` are unchanged; a second case passes an explicit
   `description: ''` and asserts it clears.
