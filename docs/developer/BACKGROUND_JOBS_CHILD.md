# Background Jobs Child Process

The background-job processor runs in a forked child process (`child_process.fork`), not on the main Next.js Node thread. This document describes the parent/child split, the IPC protocol, the per-job write batching, and the handler audit that shaped the proxy.

## Why a child process

Eighteen background-job handlers run through `lib/background-jobs/processor.ts`. Before this refactor, that processor was a `setInterval` polling loop on the same Node thread that serves Next.js HTTP. Heavy handlers — most notably `MEMORY_HOUSEKEEPING` on a character with tens of thousands of memories — pinned the event loop and blocked HTTP responses for minutes. The `Promise.race` timeout in `executeJob` could not fire because its `setTimeout` was starved on the same loop.

Moving the processor into a child process means the HTTP event loop is free regardless of what handlers are doing. Native modules (`better-sqlite3-multiple-ciphers`, `sharp`) load cleanly in a forked Node process, crash isolation is total (a SIGSEGV in `sharp` only kills the child), and `child_process.fork` has less surface area against the packaged Electron shell than `worker_threads` would.

## Architecture

```
┌─ main (HTTP + Next.js) ──────────────────────┐         ┌─ child (jobs) ───────────────────┐
│ - SQLCipher RW connection (sole writer)      │         │ - SQLCipher READONLY connection  │
│ - instance lock holder                       │         │ - vectorStoreManager (warm)      │
│ - vectorStoreManager (warm, for chat reads)  │  ◄IPC►  │ - mount-chunk cache (warm)       │
│ - mount-chunk cache (warm, for chat reads)   │         │ - all 18 handlers                │
│ - logger (single file writer)                │         │ - parses jobs, returns writes    │
│ - claim loop + write-applier + ack           │         │ - file-system writes are staged  │
└──────────────────────────────────────────────┘         └──────────────────────────────────┘
```

The parent owns the only RW SQLite connection, the instance lock at `<dataDir>/data/quilltap.lock`, and the only file logger. The child opens its own readonly SQLCipher connection using the same `ENCRYPTION_MASTER_PEPPER` from inherited environment.

## IPC protocol

Parent → child:

| Type | Payload | Purpose |
|------|---------|---------|
| `job` | `{ id, jobType, payload, attempt, deadline }` | Dispatch a claimed job to the child |
| `invalidate` | `{ target: 'vectorStore' \| 'mountPoint', key }` | Tell the child to drop a cached entry after the parent applied a related write |
| `shutdown` | `{}` | Drain in-flight, exit cleanly |

Child → parent:

| Type | Payload | Purpose |
|------|---------|---------|
| `job-result` | `{ id, ok, writes, error? }` | Job finished; `writes` is the batched list of repository write calls accumulated during the handler run (`{ method, args }[]`) |
| `log` | `{ record }` | Forwards a log record to the parent's file transport (single writer; no rotation races) |
| `status` | `{ inFlight, completedSinceLast, ... }` | Periodic snapshot for `getProcessorStatus()` |

## Job lifecycle

1. Parent's claim loop calls `repos.backgroundJobs.claimNextJob()` against its RW connection.
2. Parent posts `{ type: 'job', ... }` to the child.
3. Child runs the handler. The handler imports `getRepositories()`, which returns a proxy in the child runtime: read methods hit the readonly DB directly; write methods append `{ method, args }` to a per-job buffer in `AsyncLocalStorage` and return a synthetic result synchronously.
4. Child posts `{ type: 'job-result', ok, writes }` when the handler resolves.
5. Parent applies the entire batch in a single `db.transaction(() => writes.forEach(applyWrite))`, then marks the job COMPLETED. If the transaction throws, parent marks FAILED with the error and lets the existing retry policy in `lib/database/repositories/background-jobs.repository.ts` handle requeueing.

## Concurrency

A single global cap of 4 in-flight jobs of any type, enforced in the dispatcher. This replaced per-type caps and the user-configurable memory-extraction slider.

**Trade-off**: a flat global cap means a burst of one job type starves others. Concretely, four concurrent housekeeping jobs (long-running, read-heavy) will queue all memory-extraction work behind them. Memory extraction produces the memories that the next conversation will recall, so housekeeping bursts can delay future memory availability by seconds-to-minutes. This is acceptable because (a) housekeeping is rarely concurrent in normal operation, (b) the chat path doesn't depend on extraction completion to assemble its prompt, (c) per the design guidance, the chat path is OK getting "a little ahead of memory extraction." If this trade-off bites in practice, the fix is per-category caps (deferred follow-up), not raising the global cap.

## Batched writes and read-your-writes

Writes are batched at job end. The proxy resolves write calls immediately with **client-generated IDs** (string UUIDs via `crypto.randomUUID()`, matching the existing schema convention — every Quilltap table uses string UUIDs). Subsequent reads inside the same handler cannot see those uncommitted rows. If a handler genuinely needs read-your-writes within a single job, the handler must be restructured to compute everything from in-memory state before flushing.

The proxy logs a runtime warning when a read method hits a key recently appended to the pending-writes buffer. This is a cheap diagnostic for read-your-writes regressions.

## Deferred-file-write pattern

Two handlers (`story-background` and `character-avatar`) write image files to `<dataDir>/files/` *before* the DB write. In a streaming model this would mean: child writes the file, child sends writes batch, parent's transaction fails, file is now an orphan with no DB row referencing it.

The fix is the **deferred-file-write pattern**: the child stages files in `<dataDir>/files/.staging/<jobId>/` and includes a `{ method: '__finalizeFile', args: { stagingPath, finalPath } }` entry in the writes batch. The parent applies it inside the transaction body via `fs.renameSync` (atomic on the same volume). If the transaction throws, the parent cleans up `.staging/<jobId>/`. This narrows the orphan window to "child wrote file, then died before sending job-result" — the same as the pre-refactor worst case, not wider.

## Handler audit

| Handler | Read-your-writes? | Idempotent under retry? | External side effects | Expected RPC writes |
|---------|-------------------|-------------------------|-----------------------|---------------------|
| memory-extraction | No | Yes (memories upserted by content hash) | LLM extraction call (before-batch) | `memories.create`, `memories.upsert`, `chats.updateMessage` |
| inter-character-memory | No | Yes (legacy drain — no-op handler) | None | None |
| context-summary | No | Yes (deterministic summary) | LLM call (before-batch) | `chats.update`, `createContextSummaryEvent`, enqueue danger classification |
| memory-housekeeping | No | Yes (decisions made from upfront reads) | None | `memories.delete`, `memories.update` (bulk) |
| memory-regenerate-chat | No | Yes (idempotent re-run) | Memory deletion before-batch | `deleteMemoriesByChatIdWithVectors`, enqueue extraction |
| memory-regenerate-all | No | Yes (dedup snapshot prevents duplicates) | None | `enqueueMemoryRegenerateChat` |
| embedding-generate | No | Yes (hash-keyed) | LLM embedding call (before-batch) | `memories.updateForCharacter`, `embeddingStatus.markAsEmbedded`, `embeddingStatus.markAsFailed`, `vectorRepo.addEntry`, `vectorRepo.updateEntryEmbedding`, `vectorRepo.saveMeta` |
| embedding-refit | No | Yes (deterministic refit) | TF-IDF corpus fitting | `tfidfVocabularies.upsertByProfileId`, enqueue reindex-all |
| embedding-reindex | No | Yes (idempotent) | Help-doc sync | `backgroundJobs.cancelByType`, `embeddingStatus.markAllPendingByProfileId`, `backgroundJobs.createBatch`, `helpDocs.clearAllEmbeddings`, `vectorStoreManager.deleteStore` |
| embedding-reapply-profile | No | Yes (pure rewrite) | None | `reapplyEmbeddingProfile` (internal) |
| title-update | No | Yes (deterministic) | LLM call (before-batch) | `chats.update`, enqueue story-background |
| llm-log-cleanup | No | Yes (delete-by-date) | None | `llmLogs.cleanupOldLogs` |
| **story-background** | No | **Requires deferred-file-write** | LLM appearance + prompt + image generation; file upload (before-batch) | `folders.create`, `folders.findByPath`, `files.create`, `chats.update`, `projects.update`, `__finalizeFile` |
| chat-danger-classification | No | Yes (sticky classification) | LLM call (before-batch) | `createSystemEvent`, `chats.update`, enqueue concierge announcement |
| scene-state-tracking | No | Yes (deterministic derivation) | LLM call (before-batch) | `createSystemEvent`, `chats.update` |
| **character-avatar** | No | **Requires deferred-file-write** | Danger classification LLM, image generation, file upload (before-batch) | `folders.create`, `folders.findByPath`, `files.create`, `chats.update`, `characters.update`, `__finalizeFile` |
| conversation-render | No | Yes (deterministic upsert) | None | `chats.update`, `conversationChunks.upsert`, enqueue embedding-generate |
| wardrobe-outfit-announcement | No | Yes (deterministic) | None | `postOutfitChangeWhisper` (notify) |

## Method-name overrides

Most methods match the standard read prefix (`find*`, `get*`, `list*`, `count*`, `search*`, `has*`, `exists*`) or write prefix (`create*`, `update*`, `delete*`, `upsert*`, `bulk*`, `set*`). The audit identified these non-conforming names that need explicit overrides in the proxy:

**Read overrides**: `getMessages`, `getEquippedOutfitForCharacter`, `findByPath`, `findByInterchangeIndex`, `findByUserId` (background jobs), `findDistinctChatIds`.

**Write overrides**: `markAsEmbedded`, `markAsFailed`, `markAllPendingByProfileId`, `cleanupOldLogs`, `upsertByProfileId`, `createBatch` (background jobs), `clearAllEmbeddings`, `cancelByType`, `updateMessage` (chats), `updateForCharacter` (memories), `addEntry`, `updateEntryEmbedding`, `saveMeta`, `deleteStore`, `deleteMemoriesByChatIdWithVectors`.

**Service-level methods** (called directly on child, not routed through the repository proxy): `reapplyEmbeddingProfile`, `enqueue*`, `post*Notification`, `post*Whisper`, `createSystemEvent`, `createContextSummaryEvent`, `createMemoryExtractionEvent`. Enqueue helpers append a `backgroundJobs.create` write to the batch; system-event helpers append the corresponding events table write.

**Built-in RPC methods** (provided by the parent applier, not by any repository): `__finalizeFile` (deferred-file-write rename + cleanup-on-rollback).

## Crash and restart policy

On non-zero child exit, the parent logs the failure, backs off 5 seconds, and respawns. The cap is 5 restarts in 60 seconds; past that, the parent leaves the child dead and surfaces the failure via `getProcessorStatus().childCrashed = true`. Operators see this in `/api/v1/system/jobs`. PROCESSING jobs left behind by a dying child are returned to PENDING by `resetOrphanedJobs` on the next claim cycle.

## Dev hot-reload

The Next.js dev server reloads the module graph; if the host module re-evaluates, it could try to spawn a second child. The host caches its `ChildProcess` reference on `globalThis` (the same trick used by the dev-only repository singleton) so a single child survives module reloads.

## Cache invalidation flow

Both parent and child build their own per-character vector stores and mount-chunk caches lazily. After the parent applies an embedding write that affects character X, it calls `unloadStore(X)` locally and posts `{ type: 'invalidate', target: 'vectorStore', key: characterId }` to the child. The child's RPC handler unloads its copy. Stale reads on the child are bounded to the IPC round-trip (~ms).

The same pattern applies to `mount-chunk-cache` after `doc-mount-chunks` writes.
