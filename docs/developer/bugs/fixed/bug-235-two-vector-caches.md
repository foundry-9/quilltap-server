# Bug 235 — The server kept two memory-vector caches, and a reindex refreshed only one

| | |
|---|---|
| **Status** | Fixed 2026-10-13 |
| **Found** | 2026-10-13, live on `V4test` while dogfooding the memory refactor (Phases A–D) |
| **Fixed** | 2026-10-13 |
| **Severity** | High — after any reindex (or any vector a background job writes), chat recall searches stale vectors: it degrades to text search ("Embedding dimension mismatch — recall is degraded to TEXT search") or misses new memories, and admission from the API sees no neighbours, so near-duplicates are inserted |
| **Who it bites** | every instance; most visibly the built-in TF-IDF profile, whose vocabulary refits after hand edits and re-embeds every memory |
| **Provenance** | The module-level singleton is old; Phase B (`af48f6cc2`) made the dispatcher's post-commit `memoryIndex.reload` the only thing that refreshes a parent cache after a child's vector writes, which exposed it |
| **Defect site** | `lib/embedding/vector-store.ts` (`let vectorStoreManager` — one manager per evaluated copy of the module) |
| **Fix site** | `lib/utils/process-singleton.ts` (new); `lib/embedding/vector-store.ts` (`getVectorStoreManager`); the same treatment for `lib/memory/frozen-archive-cache.ts`, `lib/memory/admission/admit.ts` (per-character locks, idempotency ledger), `lib/memory/admission/rate-ledger.ts`, `lib/memory/housekeeping-outcome-cache.ts`, `lib/embedding/embedding-job-scheduler.ts` (refit debounce), `lib/embedding/embedding-service.ts` (interactive counter) |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-13).** Process-wide state now lives on `globalThis` through
`processSingleton(key, create)` (`lib/utils/process-singleton.ts`), so every copy of a module in one
process shares it. The vector store manager is the headline case; the frozen-archive cache, the
admission locks and idempotency ledger, the rate ledger, the housekeeping outcome cache, the refit
debounce timers and the interactive-embedding counter had the same shape and get the same fix.
Test: `__tests__/unit/lib/embedding/vector-store-process-singleton.test.ts` (two
`jest.isolateModules` copies share one manager; a reload through one drops the store the other
searches).

## Symptom

On `V4test`, after three vocabulary refits, every memory row held 102,603-dimension vectors and
queries were embedded at 102,603 — yet recall for Lorian logged `storedDimensions: 100703`, the
vocabulary from boot, and fell back to text search. The anchor-gate probe skipped every row for the
same reason, and a hand-written memory identical to an existing one was inserted with no neighbours.

## Root cause

Next.js evaluates a source module once per bundle: the instrumentation bundle (where the job
dispatcher, its commit hook and the host-RPC admission handler run) and each route bundle (chat
recall, the memories API) each get their own copy of `lib/embedding/vector-store.ts`, and with it
their own `let vectorStoreManager`. The log showed it plainly: Lorian's store was loaded in the
parent at 13:52:17 (chat recall) and again at 13:53:42 (admission) with no drop in between; of 348
parent-side `Dropped memory index cache` calls, 345 found nothing to drop. The dispatcher's
`memoryIndex.reload` emptied its own copy's cache while the route copy kept serving vectors loaded
before the reindex, indefinitely.

## Why it survived

Every unit test loads one copy of the module. Before Phase B a reindex also cleared state up
front, and the `vector_entries` mirror papered over some staleness; Phase B made the post-commit
reload the sole refresh path. The realtime bus, the plugin registries and the job dispatcher had
already moved to `globalThis` for the same reason (HMR), but the memory caches had not.

## Fix

`processSingleton` keys a registry on `globalThis` by `Symbol.for('quilltap.processSingletons')`;
the first copy to ask creates the value and every later copy gets the same one.

## Verify

Restart the server, edit a memory by hand on a TF-IDF instance (a refit and reindex follow), then
run `quilltap recall-replay <chatId> --instance <name>`: no "dimension mismatch" warning, and the
new memory scores by cosine.
