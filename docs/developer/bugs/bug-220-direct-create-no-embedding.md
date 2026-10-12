# Bug 220 — `createMemoryDirect` keeps a row with no embedding when embedding fails

| | |
|---|---|
| **Status** | Open — closed by Phase C of the [memory system refactor](../features/memory-system-refactor.md) |
| **Found** | 2026-10-12, code audit for the memory system refactor (appendix B) |
| **Fixed** | — |
| **Severity** | Low — the row is invisible to recall and to the gate until an embedding backfill runs, and the API reports success; reachable only through `skipGate` on the API |
| **Who it bites** | API callers that pass `skipGate: true` while the embedding provider is failing |
| **Provenance** | Original to v4 |
| **Defect site** | `lib/memory/memory-service.ts:540-587` (`createMemoryDirect`; catch at `:579-586`) |
| **Fix site** | Phase C of the refactor — `admission/` (`createMemoryDirect` deleted; `admitCandidate` rejects on embedding failure) |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../bugs.md) |

---

## Symptom

A memory created with the gate skipped is inserted first and embedded second. If embedding throws,
the row stays in the table with `embedding` null and the caller receives it as a success.
`POST /api/v1/memories` with `skipGate: true` returns 201.

## Root cause

`createMemoryDirect` (`memory-service.ts:540`) calls `repos.memories.create` (`:546-549`), then
tries `generateEmbeddingForUser` and the vector-store write (`:556-578`). The `catch` (`:579-586`)
logs a warning and `return memory`. The gated path is built the other way round: it embeds first
and returns `SKIP_EMBEDDING_FAILED` with no write (`memory-gate.ts:142`,
`memory-service.ts:434-441`), precisely because a row with no vector is invisible to every later
gate check and to semantic recall. `handleCreateMemory`'s own comment
(`app/api/v1/memories/route.ts:522-526`) describes that guarantee, but the `skipGate` branch does
not honour it.

Reachability: `createMemoryDirect` runs when `options.skipGate || options.skipEmbedding`
(`memory-service.ts:398`). No caller sets `skipEmbedding`; the only caller that can set `skipGate`
is the API (`route.ts:518`, see [bug 218](bug-218-manual-create-api.md)). The in-app editor
never sends it.

## Why it survived

The only path to it is an API flag no in-app caller uses, and embedding failures are rare in
development. The embedding backfill (`findIdsWithoutEmbedding`) eventually repairs such rows, which
hides them further.

## Fix

Phase C (spec §3.6): `createMemoryDirect` and `skipGate` are deleted. Every non-import insert goes
through `admitCandidate`, which returns `reject` with `embedding-failed` when embedding fails twice
(invariant 4, spec §5). Import, restore and consolidation's digest writes use `repos.memories.create`
plus `memoryIndex.upsert` explicitly.

## Verify

With the embedding provider forced to fail, admit a candidate: no row is written and the outcome
is a rejection. Grep: `createMemoryDirect` no longer exists.
