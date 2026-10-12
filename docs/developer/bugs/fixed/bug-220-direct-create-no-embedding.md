# Bug 220 — `createMemoryDirect` keeps a row with no embedding when embedding fails

| | |
|---|---|
| **Status** | Fixed 2026-10-12 (targeted fix ahead of Phase C) |
| **Found** | 2026-10-12, code audit for the memory system refactor (appendix B) |
| **Fixed** | 2026-10-12 |
| **Severity** | Low — the row is invisible to recall and to the gate until an embedding backfill runs, and the API reports success; reachable only through `skipGate` on the API |
| **Who it bites** | API callers that pass `skipGate: true` while the embedding provider is failing |
| **Provenance** | Original to v4 |
| **Defect site** | `lib/memory/memory-service.ts:540-587` (`createMemoryDirect`; catch at `:579-586`) |
| **Fix site** | `lib/memory/memory-service.ts` (`createMemoryDirect`, `createMemoryWithGate`) |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-12).** `createMemoryDirect` now embeds first (one retry after 500 ms, as the gate does) and writes the row with its embedding in the same insert, then adds it to the vector store. If both attempts fail it writes nothing and returns null; `createMemoryWithGate` reports that as `SKIP_EMBEDDING_FAILED` with `memory: null`, so `POST /api/v1/memories` with `skipGate: true` answers with the existing "no row was created" error instead of a 201. The explicit `skipEmbedding` option still writes a bare row (no caller sets it). Removing `createMemoryDirect` and `skipGate` stays with Phase C. Tests: `createMemoryWithEmbedding` cases in `__tests__/unit/lib/memory/memory-service.test.ts`. Review follow-up: `createMemoryDirect` now embeds and delegates to `createMemoryDirectWithEmbedding`, the one persist tail, which writes the embedding in the `create` call itself (the gate path used to create then update) and stamps the new vector hot.

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
