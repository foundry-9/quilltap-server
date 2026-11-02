# Refactor 4.12 — One document core for the operator's routes and the `doc_*` tools

**Status:** Proposed (2026-11-02). Part of the [4.12 refactor set](refactor-4-12.md). Fixes two behavioural divergences on the way (§4.3), which should each get a bug issue before the work starts.

## 1. The problem

Document Mode's server side grew in 4.12 (`documentViewTargetFor`, `readEditableDocument`, `readDatabaseBlobAsDocument`, `resolveGeneralLibrary`, `LibraryTarget`, the resolved-file helpers) and in the process acquired a clear shape: `lib/documents/operator-doc-actions.ts` (668 lines) does the file work, `lib/documents/operator-doc-http.ts` (380 lines) maps outcomes to HTTP, and two routes (the chat route, `app/api/v1/chats/[id]/actions/documents.ts`, 914 lines; the standalone route, `app/api/v1/documents/route.ts`, 363 lines) call them.

The `doc_*` tools do the same jobs and use none of it. `lib/tools/handlers/doc-edit/` (`text-handlers.ts` 1,197 lines, `file-management-handlers.ts` 910, `document-ui-handlers.ts` 345, `markdown-handlers.ts` 281, `shared.ts` 533) calls the `lib/doc-edit` primitives directly and has its own read-with-blob-fallback, delete, move/rename, re-index-after-write and open/create. Nothing under `lib/tools/` imports `operator-doc-actions`.

Two implementations of "read, write, rename, delete, open a document in a store" have already drifted:

| Job | Operator path | Tool path | Divergence |
|---|---|---|---|
| Read an uploaded blob as a document | `readEditableDocument` (`operator-doc-actions.ts:301-313`) → `readDatabaseBlobAsDocument` (`database-store.ts:129`): raw bytes, native-text extensions only | `readTextFileOrUploadedBlob` (`text-handlers.ts:85-102`) → `readDatabaseBlobText` (`database-store.ts:107`): the blob's `extractedText`, only when `extractionStatus === 'converted'` | **The editor and `doc_read_file` can return different text for the same uploaded `.md`.** Only `doc_read_file` falls back at all; `doc_str_replace` (`:405`) and the markdown handlers (`:117, :235`) call `readFileWithMtime` and see nothing. |
| Re-index after a write | `scheduleDocumentStoreRefresh` (`:205-223`), gated on `params.scope === 'document_store'` (`:434, :528`) | `triggerReindexIfNeeded` (`shared.ts:509-533`), gated on `mountPointId`, and also re-indexes hard-link siblings (`reindexLinkGroupSiblings`) | **An editor save or rename in `project` scope (the chat route's default, `documents.ts:78`) into a project's official store skips the chunk/embed pass** that the same write from a tool gets; the tool's docstring (`shared.ts:499-507`) explains exactly why the gate must be `mountPointId`. Operator saves also never re-index link siblings. |
| Delete | `deleteDocumentFile` (`:544-568`) | `handleDeleteFile` (`file-management-handlers.ts:532+`), own database/filesystem branch, `fs.stat` directly | Two copies of the branch. |
| Move / rename | `renameDocumentFile` (`:486-537`) + `sweepRenamedDocumentTracking` (`operator-doc-http.ts:287`) | `handleMoveFile` (`:144-215+`) + `syncChatDocumentsAfterFileMove` (`:69`); `operator-doc-http.ts`'s docstring says it "mirrors" the tool's | Two copies of the `chat_documents` sweep. |
| Open / create | `openDocumentFile` (`:320-379`): blob fallback, `documentViewTargetFor` for read-only kinds | `handleOpenDocument` (`document-ui-handlers.ts:74-170`): `databaseDocumentExists` (no blob fallback), a blank file created with raw `fs.mkdir` / `fs.writeFile` on `resolved.absolutePath` (`:143-144`) rather than `writeFileWithMtimeCheck`, no viewer handling | A character's `doc_open_document` cannot open an uploaded `.md` the operator can; creating a blank document into a database-backed store through raw `fs` is at best accidental. |

And between the two operator routes, about 100–130 lines of glue repeat (the `open` try/catch and response literal, the `write` block, the rename sequence, the delete call, the recent-documents mapping) plus 55 lines in the chat route's `accessible-stores` default branch that build `AccessibleStoreOption` objects by hand in the shape `listAllEnabledStores` (`:650-665`) already builds. The chat route also resolves the target path twice on rename and delete (`:753-757, :860-864`, then again inside the helper).

## 2. Goal

One `lib/documents/` core that both the operator routes and the `doc_*` tools call for every file-level job: read (with the one blob fallback), write (with the one re-index policy), rename/move (with the one `chat_documents` sweep), delete, open/create, view-target classification. Route and tool handlers keep only what is theirs: parsing, authorisation context, Librarian posts, `chat_documents` tracking, response shapes.

## 3. Non-goals

- Changing the `doc_*` tool schemas, names or effects. Tool definitions in `lib/tools/` stay the single source of truth for their inputs; this spec changes handlers only.
- Changing any API response shape. Both routes return exactly what they return today.
- Merging the two routes. They have different authorisation contexts (`documentAccessContextForChat` vs `STANDALONE_ACCESS_CONTEXT`) and the chat route has seven actions the standalone route does not. The shared *glue* collapses (§5.3); the routes stay.
- Touching `lib/doc-edit/` primitives (`resolveDocEditPath`, `readFileWithMtime`, `writeFileWithMtimeCheck`, `path-resolver.ts`). They are the layer *below* the core and are already shared.

## 4. Known state (verified 2026-11-02)

### 4.1 Layers today

```
app/api/v1/chats/[id]/actions/documents.ts   app/api/v1/documents/route.ts     lib/tools/handlers/doc-edit/*.ts
            │                                           │                                │
            └──────────► lib/documents/operator-doc-http.ts ◄───────────┘                │
                                      │                                                  │
                         lib/documents/operator-doc-actions.ts                           │
                                      │                                                  │
                         lib/doc-edit/* , lib/mount-index/database-store.ts ◄────────────┘
```

### 4.2 Exports of `operator-doc-actions.ts` and their callers

Both routes: `DocumentMissingError`, `openDocumentFile`, `resolveGeneralLibrary`, `listAllEnabledStores`. Chat route only: `documentAccessContextForChat` (also `qtap-target/route.ts`), `resolveOperatorDocPath` (also `qtap-target`, `operator-doc-http`), `resolvedPathExists`, `classifyResolvedTarget`, `AccessibleStoreKind` / `AccessibleStoreOption`, `LibraryTarget` (also `DocumentPickerModal.tsx`). Standalone only: `STANDALONE_ACCESS_CONTEXT`. `operator-doc-http` only: `DocumentConflictError`, `DocumentReadOnlyError`, `documentViewTargetFor`, `readEditableDocument`, `writeDocumentFile`, `computeRenameTarget`, `renameDocumentFile`, `deleteDocumentFile`. Exported with no outside caller: `pickUntitledDocumentPath`, `scheduleDocumentStoreRefresh`, the types `OpenDocumentFileParams`, `OpenedDocumentFile`, `RenameTarget`.

### 4.3 Divergences that are bugs

File before starting (CLAUDE.md: filing is outward-facing; confirm with the human first):

1. **Operator saves in `project` scope skip re-index.** Fix site: the gate in `writeDocumentFile` / `renameDocumentFile` becomes `resolved.mountPointId`, as `triggerReindexIfNeeded` already is. Verify: save a document from Document Mode into a project's official store, run a Scriptorium search for a word in it before the next periodic scan.
2. **Two blob readers.** Decide which is right (§8) and use it in both places. Verify: upload a `.md` to a database store, open it in Document Mode and `doc_read_file` it; same text.

### 4.4 Tests that pin behaviour

`lib/doc-edit/__tests__/resolved-file-ops.test.ts`, `operator-doc-view-targets.test.ts`, `documents/route.test.ts`, the doc-edit handler tests under `__tests__/unit/lib/tools/handlers/doc-edit/`, and the `.qtap`/restore tests that touch `chat_documents`.

## 5. Design

### 5.1 The core: `lib/documents/core/`

Move the file-level functions out of `operator-doc-actions.ts` into a module that knows nothing about operators or tools:

| Function | From | Notes |
|---|---|---|
| `readDocument(resolved)` | `readEditableDocument` | The one blob fallback (§8 decides the reader). |
| `writeDocument(resolved, content, mtime)` | `writeDocumentFile` | Calls `afterDocumentWrite(resolved)`. |
| `afterDocumentWrite(resolved)` | `triggerReindexIfNeeded` (the tool version, which is the correct one) | Replaces `scheduleDocumentStoreRefresh`. Gate `mountPointId`; re-index link siblings; embed; refresh stats. |
| `renameDocument(resolved, target)` | `renameDocumentFile` + `computeRenameTarget` | Returns what moved; the sweep is separate. |
| `sweepChatDocumentsAfterMove(from, to)` | `sweepRenamedDocumentTracking` / `syncChatDocumentsAfterFileMove` | One copy. |
| `deleteDocument(resolved)` | `deleteDocumentFile` + the branch in `handleDeleteFile` | |
| `ensureDocument(resolved)` | the create half of `openDocumentFile` and `handleOpenDocument` | Creates through `writeFileWithMtimeCheck`, never raw `fs`. |
| `viewTargetFor(resolved)` | `documentViewTargetFor` | |
| `statDocument`, `documentExists` | `resolvedPathExists`, `databaseDocumentExists` callers | |

Errors stay as they are (`DocumentMissingError`, `DocumentConflictError`, `DocumentReadOnlyError`), moved with the functions. `operator-doc-actions.ts` keeps what is operator-specific: access contexts, `resolveOperatorDocPath`, `openDocumentFile` as a thin composition of `ensureDocument` + `viewTargetFor` + `readDocument`, `pickUntitledDocumentPath`, the library and store listing. Expected size after: about 300 lines.

### 5.2 The tools

`doc_read_file`, `doc_str_replace`, the markdown handlers, `doc_write_file`, `doc_move_file`, `doc_delete_file` and `doc_open_document` call the core. The handlers keep their own path resolution (`resolveDocEditPath` with the character's context, which already differs from the operator's by design), their Librarian announcements, their tool-result shapes and their logging. Expected removal from `lib/tools/handlers/doc-edit/`: `readTextFileOrUploadedBlob`, `triggerReindexIfNeeded`, `syncChatDocumentsAfterFileMove`, the delete branch, the create block in `handleOpenDocument`; roughly 150–250 lines, and `doc_str_replace` and the markdown tools gain the blob fallback for free.

### 5.3 The routes

`operator-doc-http.ts` already owns the outcome-to-HTTP mapping. Extend it with the three pieces still copied between the routes: an `openDocumentResponse` (the try/catch and the response literal), a `recentDocumentsResponse` (the mapping), and `storeOptionFor(mountPoint, kind)` so the chat route's `accessible-stores` default branch builds options the same way `listAllEnabledStores` does. Pass the already-resolved path into rename and delete instead of resolving twice. Expected removal: about 150 lines from the chat route, 60 from the standalone route.

### 5.4 Chokepoint

A grep-test, `__tests__/unit/lib/documents/core-chokepoint.test.ts`: under `lib/tools/handlers/doc-edit/` and `app/api/v1/**/documents*`, no call to `readFileWithMtime`, `writeFileWithMtimeCheck`, `readDatabaseBlobText`, `readDatabaseBlobAsDocument`, `moveDatabaseDocument`, `deleteDatabaseDocument`, `reindexSingleFile`, or `fs.writeFile`; those names appear only under `lib/documents/core/` and `lib/doc-edit/`. Add a CLAUDE.md chokepoint line: "A document in a store is read, written, renamed, deleted or created only through `lib/documents/core/`; the operator routes and the `doc_*` tools are both callers."

## 6. Phases

1. **Fix the two bugs in place** (small, reviewable, each with its own `Fixes #N`): the re-index gate, and the blob reader choice. This lands the behaviour change before any code moves, so the move itself is behaviour-neutral.
2. **Extract the core** from `operator-doc-actions.ts`; routes unchanged in behaviour; `operator-doc-http.ts` gains the three shared responses; route tests pass unchanged.
3. **Point the tools at the core**, one tool per commit, each with its handler test updated to assert the shared behaviour (blob fallback now present in `doc_str_replace`; link siblings re-indexed on operator writes). Add the grep-test and the CLAUDE.md line.

## 7. Verification

- Unit: every test in §4.4 unchanged except where Phase 1 changes behaviour; the new grep-test; a core test per function with both store kinds (database, filesystem).
- Live (V4test): the two scenarios in §4.3, plus rename-and-reopen from Document Mode and from `doc_move_file` with the document open in another chat (the sweep).

## 8. Decisions needed from the human

1. **Which blob reader.** `readDatabaseBlobAsDocument` (raw bytes; only native-text extensions) matches what the editor must save back. `readDatabaseBlobText` (`extractedText`, converted blobs only) is what search indexed. Recommendation: the core reads raw bytes for native-text kinds and falls back to `extractedText` for converted kinds, so both the editor and the tools see the best available text and the editor never saves converted text back over a binary.
2. **Whether `doc_open_document` should create through the core when the path does not exist**, or refuse (the operator's open creates; a character's open creating files may be more than intended). Recommendation: keep creating, through the core, since the tool's own docstring promises it.
