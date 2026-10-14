# Bug 216 — A fresh memory's reinforced importance disagrees with the formula at count 1

| | |
|---|---|
| **Status** | Fixed 2026-10-12 (targeted fix ahead of Phase A) |
| **Found** | 2026-10-12, code audit for the memory system refactor (appendix C) |
| **Fixed** | 2026-10-12 |
| **Severity** | Low — the first reinforcement over-credits a row by about 0.05, and a fresh row ranks 0.05 below a count-1 digest of equal importance; small, systematic skew in ranking, protection and band filters |
| **Who it bites** | every memory, on its first reinforcement; consolidation digests with a summed count of 1 compared with ordinary rows |
| **Provenance** | Original to v4. Came in with the Memory Gate fields (`add-memory-gate-fields`), which introduced `reinforcementCount` and `reinforcedImportance` |
| **Defect site** | `lib/memory/memory-service.ts:520-522` (`memoryRowFromOptions`); `lib/memory/reinforced-importance.ts:12-14` (`calculateReinforcedImportance`); also `lib/services/ai-import.service.ts:580-582` |
| **Fix site** | `lib/memory/reinforced-importance.ts`, `lib/memory/memory-service.ts` (`memoryRowFromOptions`), `lib/services/ai-import.service.ts`, `lib/schemas/memory.types.ts` (comment), `migrations/scripts/recompute-reinforced-importance-v1.ts` (+ `index.ts`, `lib/startup/prettify.ts`) |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-12).** Targeted fix ahead of Phase A. `calculateReinforcedImportance` is now `min(1, importance + log2(count) × 0.05)` (locked decision 6), with a count below 1 treated as 1, so count 1 equals importance. It was already the one function every recompute uses — the repository's atomic `incrementReinforcement`, the gate's child-local `countReinforcement`, `planMemoryMerge` and consolidation digests — and the two fresh-row writers (`memoryRowFromOptions`, the AI import service) now call it at count 1 instead of copying `importance`. Migration `recompute-reinforced-importance-v1` rewrites `memories.reinforcedImportance` for every row from `importance` and `reinforcementCount` (NULLs read as 0.5 and 1), in transactions of 500 with `reportProgress` per batch, writing only rows whose value changes; it has a loading-screen label. Recall weighting (`memory-weighting.ts`'s own reinforcement coefficient) is untouched (decision 14). Tests: `memory-gate.test.ts` (count 1 equals importance across a table of `i`; one step per doubling; count < 1), `__tests__/unit/lib/database/migration/recompute-reinforced-importance-v1.test.ts` (real SQLite, 605 rows across two batches, idempotent second pass, label present).

**Memory refactor Phase C (2026-10-13).** The create path's row builder moved to `insertRow` in `lib/memory/admission/apply.ts`; the formula itself is `lib/memory/scoring/reinforced-importance.ts`.

## Symptom

A new memory with importance 0.60 is stored with `reinforcementCount: 1` and
`reinforcedImportance: 0.60`. The formula every other writer uses gives 0.65 at count 1. On its
first reinforcement the row jumps to about 0.679, a step of 0.079 instead of the 0.029 the curve
implies. A consolidation digest with importance 0.60 and a summed member count of 1 is stored at
0.65, so it outranks an equal fresh row by 0.05 for no reason.

## Root cause

`calculateReinforcedImportance` (`lib/memory/reinforced-importance.ts:12`) is
`min(1, base + log2(count + 1) × 0.05)`. At count 1 that is `base + 0.05`.

New rows bypass it: `memoryRowFromOptions` (`memory-service.ts:505-523`) writes
`reinforcementCount: 1` and `reinforcedImportance: importance` (`:520`, `:522`). The AI import
service does the same (`ai-import.service.ts:580-582`). Every other writer calls the formula with
the row's count:

- the repository's atomic `incrementReinforcement` (`memories.repository.ts:589`), count + 1;
- `countReinforcement`'s child-local view (`memory-gate.ts:544`);
- `planMemoryMerge` (`memory-merge.ts:120`);
- consolidation digests (`consolidation-plan.ts:335`), including digests whose count is 1.

So the same `(importance, count = 1)` pair is stored two ways depending on who wrote it, and the
first recompute of a fresh row is a discontinuity. The Zod schema comment
(`lib/schemas/memory.types.ts:134`) documents the formula, not the stored value.

## Why it survived

The offset is constant and small. Nothing compares a fresh row's stored value with the formula,
and ranking tests build rows by hand with whatever `reinforcedImportance` they need.

## Fix

Locked decision 6 (spec §7): the formula becomes `min(1, i + log2(n) × 0.05)`, so count 1 equals
importance and fresh rows already agree with it. It lives once in `scoring/` and the repository's
`incrementReinforcement` calls it. Migration `recompute-reinforced-importance-v1` rewrites the
column for every row (`reportProgress` per 500 rows, pretty label).

## Verify

Unit test: `reinforcedImportance(i, 1) === i` for a table of `i`, and a row created through
admission stores the same value the formula gives. After the migration, `SELECT` any row and
check `reinforcedImportance = min(1, importance + log2(reinforcementCount) × 0.05)`.
