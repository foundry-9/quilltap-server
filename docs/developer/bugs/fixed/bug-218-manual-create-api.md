# Bug 218 — `POST /memories` trusts the client's source and gate flags and misreports reinforcement

| | |
|---|---|
| **Status** | Fixed 2026-10-12 (targeted fix ahead of Phase G) |
| **Found** | 2026-10-12, code audit for the memory system refactor (appendix A) |
| **Fixed** | 2026-10-12 |
| **Severity** | Low — a hand-written memory can be mis-provenanced or bypass the gate, and the caller is told a row was created when an existing one was reinforced; the in-app editor sends safe values |
| **Who it bites** | API and script callers of `POST /api/v1/memories`; the in-app memory editor only through the 201-on-reinforce response and the missing `witnessedContext` / `projectId` |
| **Provenance** | Original to v4 |
| **Defect site** | `app/api/v1/memories/route.ts:76-88` (`createMemorySchema`), `:491-536` (`handleCreateMemory`) |
| **Fix site** | `app/api/v1/memories/route.ts` (`createMemorySchema`, `handleCreateMemory`); `components/memory/memory-editor.tsx` (toast on 200) |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-12).** `createMemorySchema` no longer has `source` or `skipGate` (Zod strips them if sent), and gains `projectId`, `kind`, `occurredAt` and `entities`. `handleCreateMemory` now calls `createMemoryWithGate` directly with `source: 'MANUAL'` and `witnessedContext: 'manual'` and no gate bypass, so the AUTO-only heuristics never run on a hand-written row and nothing inserts around the gate. `projectId` is the explicit one (404 if unknown) or else the supplied chat's project (404 for an unknown chat). The response is `{ memory, action }`: 201 on `INSERT` / `INSERT_RELATED`, 200 with the existing row on `REINFORCE` / `SKIP_NEAR_DUPLICATE`. The in-app editor stops sending `source` and shows a "reinforced instead" toast on a 200. `when` phrase resolution and `admitCandidate` remain Phase C/G work. Tests: `__tests__/unit/api/memories-manual-create.test.ts`. Review follow-up: the route passes `promoteOnMatch`, so a manual write the gate folds into an existing row promotes that row (`promoteMatchedMemory` in `memory-gate.ts`): AUTO becomes MANUAL and `importance` becomes the higher of the two, `reinforcedImportance` recomputed; a digest keeps CONSOLIDATED. Tests: `__tests__/unit/lib/memory/memory-gate-manual-promote.test.ts`.

**Memory refactor Phase C (2026-10-13).** The route calls `admitCandidate` (`lib/memory/admission`). `promoteOnMatch` / `promoteMatchedMemory` are gone: a hand-written memory never folds into an extracted row (it is inserted and linked); folded into a MANUAL row or a digest it raises that row's importance and the row keeps its source. `action` in the response is the action kind (`insert`, `insert-linked`, `reinforce`, `absorb`, `promote-and-reinforce`). Tests: `__tests__/unit/lib/memory/admission-admit.test.ts`; `memory-gate-manual-promote.test.ts` was removed.

## Symptom

- A client can create a memory with `source: 'AUTO'`. The row is then treated as model-extracted:
  the name-presence check may rewrite its `aboutCharacterId`, the episodic fallback may invent
  `occurredAt` / `entities`, and housekeeping and consolidation may demote or absorb it.
- A client can pass `skipGate: true` and insert around the gate (see also
  [bug 220](bug-220-direct-create-no-embedding.md)).
- Every manual memory has `witnessedContext: null` and `projectId: null`, and the body cannot set
  `kind`, `occurredAt` or `entities`.
- When the gate reinforces or absorbs into an existing row, the response is still
  `201 { memory }` with the existing row, so the caller cannot tell "created" from "merged".

## Root cause

`createMemorySchema` (`route.ts:76-88`) accepts `source: z.enum(['AUTO', 'MANUAL'])` and
`skipGate: z.boolean().optional()`, and has no `projectId`, `witnessedContext`, `kind`,
`occurredAt` or `entities`. `handleCreateMemory` (`:491`) passes `source` and `skipGate` straight
to `createMemoryWithEmbedding` (`:505-519`), which returns only `outcome.memory`
(`lib/memory/memory-service.ts:359-365`), discarding the gate action. The handler then returns
status 201 unconditionally (`:535`).

The AUTO-only heuristics the client can switch on are `applyNamePresenceCheck`
(`memory-service.ts:149`) and `applyEpisodicFallbackAnchors` (`:196`), both skipped only when
`source !== 'AUTO'`. `skipGate` routes to `createMemoryDirect` (`:398-401`).

The in-app editor (`components/memory/memory-editor.tsx:58-76`) sends `source: 'MANUAL'` and no
`skipGate`, so it is not exposed to the first two items.

## Why it survived

The only in-app caller sends safe values, and the gate's outcome is invisible in the editor (it
just closes). The schema was written when the endpoint was the only way in and has not been
narrowed since extraction moved to the job path.

## Fix

Spec §3.11 and locked decision 13: `POST /memories` forces `source: 'MANUAL'`, sets
`witnessedContext: 'manual'`, accepts `kind` / `when` / `entities` / `projectId`, drops `skipGate`,
and goes through `admitCandidate`. It returns 201 with the row on insert and 200 with
`{ action, memory }` otherwise.

## Verify

POST with `source: 'AUTO'`: the stored row is MANUAL. POST with `skipGate: true`: rejected by the
schema or ignored. POST a near-duplicate of an existing row: 200 with `action` naming the
reinforcement. POST with `projectId`: the row carries it, and `witnessedContext` is `'manual'`.
