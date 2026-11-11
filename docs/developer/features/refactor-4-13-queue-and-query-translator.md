# Refactor 4.13 — The job queue's dedupe rule and the query translator's quiet failures

**Status:** Implemented (2026-11-11) except §6 phase 6 — see [§9](#9-outcome). Originally proposed 2026-11-10, written against `HEAD` = 167d06503. Part of the [4.13 refactor set](refactor-4-13.md). Fixes #192, #194 and #196, and closes the defects traced in §4.2.

Line numbers are from the audit and will drift. Re-locate each site by name before editing.

## 1. The problem

Two pieces of the data backend share a habit: a rule exists, most call sites follow it, and the sites that do not fail without an error.

### 1.1 The query translator

`lib/database/backends/sqlite/query-translator.ts` turns the Mongo-style filter objects the repositories still use into SQL. Three of its translations are wrong in ways that return an empty result instead of throwing:

| Operator | Translation | Consequence |
|---|---|---|
| `$regex` (`:235-257`) | `.*` → `%`, every other `.` → `_`, then `LIKE ?` with no `ESCAPE` | An escaped user string (`Mr\. Darcy \(the elder\)`) becomes a `LIKE` pattern with literal backslashes: no rows. `%` and `_` in a query are live wildcards. Memory search, search-and-replace, recall's keyword fallback and admission's neighbour search all go through it (#192). `chats-search.ops.ts:103-106` documents the flaw and works around it for messages only. |
| `$eq: null` (`:148-151`) | `= ?` bound to NULL | Matches nothing. `LLMLogsRepository.findStandalone` can never return a row (#196). |
| sort (`translateSort`, `:407-420`) | `"${field}" ${dir}` with no check | A field name that is not a column is a string literal to SQLite, so the result is silently unsorted. Field names are not validated at all (see the [index](refactor-4-13.md) on what is held back from tracked files). |

Around it, the sweep counted about 40 `as any` casts in `lib/database/repositories/` that exist to push `{ $set, sort }` objects and mutated filters past the types: `background-jobs.repository.ts` (about 20), `chats-messages.ops.ts` (9), `chats-search.ops.ts`, `chats.repository.ts`, `chats-tokens.ops.ts`, `memories.repository.ts:258-267`. The casts are why the compiler did not catch any of the above.

### 1.2 The job queue

`lib/background-jobs/queue-service.ts` has about 15 hand-rolled "find pending → filter → reuse or enqueue" bodies (`:420-516`, `:567-700`, `:848-1060`, `:1145-1166`, `:1283-1312`, `:1463-1632`). They disagree on the one thing that matters: whether an enqueue may be absorbed by a job that is already **PROCESSING**.

The codebase knows the rule. The avatar, wardrobe-image and wardrobe-announcement enqueues (`:1470-1479`, `:1520-1525`, `:1583-1595`) dedupe on PENDING only, with a comment that a job already running has "missed the bus": it read its inputs before this change. `CONVERSATION_RENDER`, `SCENE_STATE_TRACKING`, `CHAT_DANGER_CLASSIFICATION`, `STORY_BACKGROUND_GENERATION` and `EMBEDDING_GENERATE` still dedupe on PENDING and PROCESSING.

And the reaper: `cleanupOldJobsByStatus` (`background-jobs.repository.ts:605-632`) deletes DEAD rows by `completedAt`, which no path that sets DEAD ever writes (#194).

## 2. Goal

- The translator refuses what it cannot translate correctly, and translates null and `LIKE` correctly.
- Repositories reach the collection through typed helpers; the `as any` casts in the listed files are gone.
- One `enqueueDeduped` with the absorption rule as a required, named option.
- Finished jobs of every terminal status are reaped.

## 3. Non-goals

- Replacing the Mongo-style filter layer. It stays; it becomes honest.
- The forked child, the write applier and the partitioning. See §4.2 for one applier defect that is in scope.
- FTS5 message search (`chat-message-fts.ts`, `fts-query.ts`): audited and sound.

## 4. Known state

### 4.1 Verified by reading (2026-11-10)

The three translations in §1.1; `findStandalone`'s filter (`llm-logs.repository.ts:216-221`); `cleanupOldJobsByStatus` and `markFailed` (no `completedAt` on DEAD).

### 4.2 Traced by the audit, not independently re-verified

Confirm each with a failing test; file what reproduces (confirm with the human before filing).

- **A stale embedding from a deduped job.** `queue-service.ts:1145-1166` returns an existing PENDING or PROCESSING `EMBEDDING_GENERATE` job; `handlers/embedding-generate.ts:255-263` writes its vector with no check that the row's text is still what it embedded. Sequence: job E for chunk X is processing; a re-render rewrites X; the re-embed request dedupes onto E; E commits a vector of the old text; the `!chunk.embedding` gate never fires again. V4test's error log has "Doc mount chunk not found for embedding update" apply failures, the same race made visible on rows that are deleted rather than updated.
- **The applier's transaction spans a real await.** `lib/background-jobs/host/job-dispatcher.ts:546-570` runs `BEGIN IMMEDIATE` … `await result` … `COMMIT`. A replayed `docMountFileLinks.linkBlobContent` awaits an image transcode (`doc-mount-file-links.repository.ts`, about `:983`) inside it. While that runs, any other parent-side mount-index write joins the open transaction; if a later write in the batch throws, the rollback erases those unrelated writes after their callers were told they succeeded.
- **`findByCharacterIdInBatches`** (`memories.repository.ts:179-203`) stops at the first page shorter than the batch size, measured after rows failing Zod were dropped. One invalid memory truncates the corpus `MEMORY_MAINTENANCE` sees. OFFSET paging over random UUIDs can also skip rows as other jobs commit.
- **`resetStuckJobs`** (`background-jobs.repository.ts:866-880`) sets FAILED without looking at attempts, so a stuck job at max attempts stays FAILED.
- **Unchunked `IN` lists** in `memories.findByIds`, `llmLogs.findAllForChat` and others fail soft to `[]` past SQLite's variable limit.
- **`sweepOrphanedTranscripts`** (`terminal-sessions.repository.ts:222-229`) unlinks transcript files after a `findAll()` that returns `[]` on failure.
- **Find → update-or-create with no unique index** behind it: `embedding-status.repository.ts:254-281`, `chat-settings.repository.ts:327-345` (the class of #120).

## 5. Design

### 5.1 Translator

- `$eq` / `$ne` with `null` or `undefined` emit `IS NULL` / `IS NOT NULL`.
- Add `$contains` (and `$startsWith` if a caller needs it): `LIKE ? ESCAPE '\'` with the value escaped by `like-escape.ts`. Move every caller that builds a `RegExp` from user text (`memories.repository.ts:315-321`, `:1940-1948`, `:1986-1994`, `:2024-2031`, and any other `escapeRegex` → `$regex` site) to `$contains`. `$regex` keeps working for the hand-written patterns that rely on it, and **throws** on a pattern containing a backslash, since that is always an escaped string it would mistranslate.
- `translateSort` takes the table's column set (the translator already has `jsonColumns`; give it the column list from the same schema source) and throws on a field that is not a column. Callers that take a sort key from a request validate it against an allowlist before the repository; the translator check is the backstop.

A translator that throws surfaces through `safeQuery`'s fallback as an empty result in some repositories. Sweep for `safeQuery` calls whose fallback would hide a translator error and make those rethrow; a programming error must not look like "no rows".

### 5.2 Typed collection helpers

Give the collection interface typed `updateOne(filter, { set })`, `insertOne(row)`, `find(filter, { sort, limit, offset })` signatures generic over the row type, so `{ $set: … } as any` and `(filter as any).userId = …` are unnecessary. Work file by file through the list in §1.1; each file's cast count goes to zero. Where a cast was hiding a column not in the type (`sortIndex` on connection profiles, `chatType` / `helpPageUrl` on help chats, the terminal repository missing from the typed `getRepositories()`), fix the type.

### 5.3 `enqueueDeduped`

```ts
enqueueDeduped(type, payload, {
  key: (p) => string,                 // what makes two jobs "the same"
  absorbs: 'pending' | 'active',      // required; no default
})
```

`'pending'` for any handler that reads state when it runs, which on inspection should be all five listed in §1.2. `'active'` only where a running job provably covers a later request. Each of the 15 bodies becomes one call. For `EMBEDDING_GENERATE`, also make the write conditional: the job carries a hash of the text it embedded and `updateEmbedding` applies only if the row's current text hashes the same (the applier is in the parent and can check).

### 5.4 Reaping

Every path that sets a terminal status writes `completedAt`; the reaper keys DEAD on `completedAt`. A small migration backfills `completedAt = updatedAt` for existing DEAD rows (pretty label in `lib/startup/prettify.ts`; a single UPDATE needs no progress reporting). `resetStuckJobs` sends a job at max attempts to DEAD.

### 5.5 The applier

Pre-normalise blob arguments before `BEGIN` (run the transcode in `applyPartition` ahead of the transaction), so the transaction body has no real-I/O await. Add an assertion in development builds that the body completes within one macrotask.

## 6. Phases

1. **Failing tests against real SQLite** for #192, #194, #196 (require `better-sqlite3` by absolute root path, per the repo's Jest notes).
2. **Translator**: null, `$contains`, the sort check; callers moved; `safeQuery` sweep.
3. **Reaping** and the backfill migration.
4. **`enqueueDeduped`**; the conditional embedding write.
5. **Typed collection helpers**, one repository file per change.
6. **§4.2 items** that reproduced, each with its issue.

## 7. Tests and gates

- `query-translator.test.ts` gains execution tests (run the SQL), not only shape assertions.
- Expected size: about 250 lines removed from the queue service; the typed helpers are roughly neutral in lines and remove about 40 casts. Low risk for the queue; medium for the translator, because a now-throwing path may have been silently returning empty somewhere that "worked".
- DDL.md if the backfill migration changes anything it documents. CHANGELOG cites `#192`, `#194`, `#196`.

## 8. Decisions for the human

1. `$regex` with a backslash: throw (proposed), or translate escaped strings correctly and keep accepting them?
2. Should `base.repository.ts`'s `_update` write only the columns the patch names? Today it rebuilds the whole row from a snapshot, which is why `patchOnlyFields()`, the out-of-schema columns (`transcriptVersion`, the refusal ledger, the opening-state columns) and their bespoke setters exist. Changing it would retire a standing CLAUDE.md rule, but any caller relying on `_update` to materialise schema defaults into old rows would change behaviour. Not proposed here; noted for a decision on whether it deserves its own spec.

## 9. Outcome

- **§5.1** done. #196 landed first (#198). `$contains` / `$startsWith` added; the four memory search sites moved; `$regex` throws on a backslash (decision 8.1 taken as proposed). Sort fields are checked against the live table (`PRAGMA table_info`, cached per connection, re-read on a miss) rather than the Zod schema, so migration-added columns count. Unknown operators throw too. The `safeQuery` sweep is one rule in `safe-query.ts`: a `QueryTranslationError` is always rethrown.
- **§5.2** done for the listed files and the three named type gaps.
- **§5.3** done. Seventeen bodies (not fifteen) became `enqueueDeduped` calls; maintenance keeps its widening logic but reads through `findAbsorbers`. Five types moved to `'pending'` as proposed. Memory extraction stays `'active'` because a second job for the same turn would count its memories twice — not strictly "provably covers"; worth a look if per-turn admission ever gets a turn-level idempotency key. The conditional write covers conversation and mount chunks; memory vectors are written through `memoryIndex.upsert`, which was not audited for the same race and is unchanged.
- **§5.4** done, migration `backfill-dead-job-completed-at-v1`.
- **§5.5** done (`preNormalizeWrites`, `watchForEventLoopYield` in `job-dispatcher.ts`).
- **Not done (phase 6):** `findByCharacterIdInBatches` truncation, unchunked `IN` lists, `sweepOrphanedTranscripts` after a failing `findAll`, and the find → update-or-create pairs without a unique index. Each needs a reproducing test and an issue filed after confirmation.
