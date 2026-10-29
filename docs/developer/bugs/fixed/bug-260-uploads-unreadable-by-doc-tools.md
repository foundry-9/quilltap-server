# Bug 260 — a chat upload is shelved in the project store but the doc tools cannot read, grep or search it

| | |
|---|---|
| **Status** | FIXED |
| **Found** | 2026-10-23, reported by the operator on `Friday` (chat `772f89bf-0158-47ca-a214-41711d8437f0`) |
| **Fixed** | 2026-10-23 |
| **Severity** | Medium. Nothing is lost, but an uploaded document is invisible to every doc tool, so a character told "it's in the project" searches, fails, and concludes the file does not exist |
| **Who it bites** | anyone who uploads a text, JSON, PDF or DOCX file to a chat and later asks a character to find it; every upload since the 4.7 upload bridges |
| **Provenance** | The upload bridges (`project-store-bridge.ts`, `user-uploads-bridge.ts`) store every upload as a blob with `extractText: false` and `enqueueEmbedding: false`, since the canonical write pipeline (`c528dba47`, 2026-06-10) |
| **Fix site** | `lib/mount-index/store-file.ts` (`extractBlobText`), `lib/mount-index/path-utils.ts` (`isExtractableBlobPath`, `EXTRACTABLE_BLOB_EXTENSIONS`), `lib/mount-index/database-store.ts` (`readDatabaseBlobText`, `listDatabaseBlobTexts`), `lib/file-storage/project-store-bridge.ts`, `lib/file-storage/user-uploads-bridge.ts`, `lib/tools/handlers/doc-edit/text-handlers.ts` (`doc_read_file`, `doc_grep`), `lib/database/repositories/doc-mount-blobs.repository.ts` (`listUnextractedByExtensions`), `lib/startup/backfill-upload-blob-text.ts`, `instrumentation.ts`, `help/file-uploads.md`, `help/document-editing-tools.md` |
| **v5 status** | Owed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-23).** Uploads stay blobs (the `files` row still addresses them by
`mount-blob:` key), but their text is now extracted and indexed on arrival, and the read tools
look at it:

- `extractBlobText` (`store-file.ts`) is the one place blob text is derived: PDF/DOCX through the
  converter, native text (`.md`, `.markdown`, `.txt`, `.json`, `.jsonl`, `.ndjson`) as the bytes
  themselves. It records `extractedText` / `extractionStatus` on the link. `storeMountFile` calls it
  for every extractable blob when `extractText` is on, then chunks and queues embeddings.
- The project and Quilltap Uploads bridges now pass `extractText: true` and
  `enqueueEmbedding: true`. The character-vault, Lantern and wardrobe bridges write only images and
  are unchanged.
- `doc_read_file` falls back to a blob's extracted text when a database store has no document at a
  text path (`readTextFileOrUploadedBlob`). Read-only: the edit tools still see no document there.
  The existing PDF/DOCX branch now uses the same `readDatabaseBlobText`.
- `doc_grep` searches `listDatabaseBlobTexts` beside `doc_mount_documents` for each database store.
- `backfillUploadBlobText` runs at boot after the document-store scan. Its worklist is every blob
  link in a database store at `extractionStatus = 'none'` with an extractable extension
  (`listUnextractedByExtensions`). A file leaves the list once `converted` or `failed`, so no flag
  is needed and steady-state boots cost one query. On `Friday` it picks up 87 files (~4 MB),
  including this chat's `CHANGELOG.md` and `4.11.0.md`.

Tests: `lib/doc-edit/__tests__/uploaded-blob-reads.test.ts` (read, grep, list against the real
resolver), `lib/startup/__tests__/backfill-upload-blob-text.test.ts`,
`lib/mount-index/__tests__/extractable-blob-paths.test.ts`, and new cases in
`__tests__/unit/lib/mount-index/store-file.test.ts`.

## Symptom

The operator uploaded `4.11.0.md` and `CHANGELOG.md` to a project chat, then asked Friday to look
for the changelog in the project. Amy (`gpt-5.6-sol`) tried:

- `doc_read_file qtap://project/CHANGELOG.md` → `Error: ENOENT: database document not found at CHANGELOG.md`
- `doc_list_files scope=project pattern=**/CHANGELOG.md` → `No files found.` (that half is bug 261)
- `doc_grep CHANGELOG` → hits in her own vault's conversation summaries only

and reported that `CHANGELOG.md` "isn't on any project shelf". It was: at the root of
`Project Files: Quilltap Plans`, link `109ec920…`, `fileType: blob`, `conversionStatus: skipped`,
`extractionStatus: none`, 0 chunks.

## Root cause

`storeMountFile` has two database paths: native text goes to `doc_mount_documents`; everything
else goes to `doc_mount_blobs`, with text extracted only for PDF and DOCX. The upload bridges pass
`treatNativeTextAsDocument: false`, because the attachment's `files` row locates its bytes by
`mount-blob:<mountPointId>:<blobId>` and a document has no blob id. That much was deliberate. But
they also passed `extractText: false` and `enqueueEmbedding: false`, so an uploaded `.md` (or PDF)
became bytes with no text anywhere.

The readers only know documents and extracted text:

- `doc_read_file` on a text path calls `readFileWithMtime` → `readDatabaseDocument`, which reads
  only `doc_mount_documents` (`path-resolver.ts:762` turns its miss into ENOENT). Its blob branch
  ran only for non-text extensions, and needs `extractedText` anyway.
- `doc_grep` on a database store iterated `docMountDocuments.findByMountPointId` only.
- Semantic search reads chunks, and a blob with no extracted text is never chunked.

## Why it survived

Uploads were always shown to the model inline on the turn they were sent (and since bug 121 to
each later speaker), so nobody needed the tools to reach them. The store's file list in the
Scriptorium shows the blob, which made the file look present. Only a later request to go and find
it exposed the gap.

## How to verify

Upload a `.md` file to a project chat. Its link should show `extractionStatus: converted` and a
non-zero `chunkCount` shortly after. A character's `doc_read_file qtap://project/<name>.md` should
return its text, and `doc_grep` for a phrase in it should find it. After the first boot on this
build, `npx quilltap db --instance <name> --mount-points` with the worklist query in
`listUnextractedByExtensions` should return no rows.
