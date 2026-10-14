# Bug 167 — a full re-embed rolls back whenever a help doc has changed

| | |
|---|---|
| **Status** | **FIXED in v4 (2026-09-24)** |
| **Found** | 2026-09-24, reading `Friday`'s logs for recurring help-indexing errors |
| **Fixed** | 2026-09-24, v4.10-dev |
| **Severity** | High — the whole `EMBEDDING_REINDEX_ALL` batch is lost, not just the help rows: its embedding clears and every embedding job it queued for memories, conversation chunks and mount chunks roll back with it. The job retries identically and goes DEAD |
| **Who it bites** | any instance whose help docs differ from the database when a full re-embed runs — i.e. the first reindex after any upgrade that changed a help file, including the one an embedding-profile switch triggers. On `Friday`: job `60d0e552` DEAD after three attempts on 2026-08-15, `help_doc_chunks` empty since |
| **Provenance** | Original to v4. The child's buffered `upsert*` result predates `help_doc_chunks`; the chunk table added the first consumer of that result's id |
| **Fix site** | `lib/help/help-doc-sync.ts` (`syncHelpDocs`); `HelpDocsRepository.upsertByPath` removed |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

**FIXED in v4 (2026-09-24).** `syncHelpDocs` no longer takes a doc id from a write's return
value. An existing row's id comes from the table read it already makes; a new row's id is minted
with `randomUUID()` and passed to `helpDocs.create(fields, { id })`, which the child proxy and
the repository both honour. `upsertByPath`, whose only caller this was, is gone.

## Symptom

`error.log`, 2026-08-15, three times over three minutes:

```
SQLite insertOne error  table: help_doc_chunks  FOREIGN KEY constraint failed
Failed to apply child writes; marking job failed  type: EMBEDDING_REINDEX_ALL
```

Afterwards: the reindex job DEAD with `FOREIGN KEY constraint failed`, `help_doc_chunks` empty,
no help doc updated since the previous day, and none of the reindex's embedding work done.

## Root cause

`EMBEDDING_REINDEX_ALL` runs in the forked job child and calls `syncHelpDocs()`
(`lib/background-jobs/handlers/embedding-reindex.ts:202`). For each changed file the sync called
`repos.helpDocs.upsertByPath(relPath, fields)` and then
`repos.helpDocChunks.replaceForDoc(doc.id, chunks)`.

In the child, `upsert*` is a buffered write. `syntheticWriteResult`
(`lib/background-jobs/child/child-repositories-proxy.ts`) looks for an `id` on `args[0]`; for
`upsertByPath` that is the path string, so it returned `{ id: crypto.randomUUID() }`. The parent's
replay of `upsertByPath` updated the existing row under its real id (or created a new one under an
id of its own), while the replayed chunk inserts carried the random id. Every one failed the
`docId → help_docs.id` foreign key, and because the parent commits each target database's writes
in one transaction, the whole main-DB batch rolled back.

## Why it survived

The sync's unit tests mocked `upsertByPath` to return a consistent id, and the sync is exercised
in the parent process on every help-search call, where writes are real and the id is correct.
Only the reindex runs it in the child, and only a changed or new help file reaches the upsert.

## Verify

`__tests__/unit/lib/help/help-doc-sync.test.ts` mocks `create` / `update` the way the child
proxy behaves (`create` returns a different id, `update` returns nothing) and asserts that chunks
are keyed to the existing row id and to the id passed to `create`. On an affected instance the
startup help reconcile (`reconcileHelpDocs`) slices every page with no sections and queues its
embedding on the next restart — help docs only, no full reindex. Verified on `V4test` on
2026-09-24: a partial reindex that had rolled back completed on its first attempt with 129 docs,
729 sections, no orphans.
