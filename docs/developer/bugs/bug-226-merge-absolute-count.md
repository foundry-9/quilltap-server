# Bug 226 — `planMemoryMerge` writes an absolute, uncapped reinforcement count

| | |
|---|---|
| **Status** | Open — closed by Phase C of the [memory system refactor](../features/memory-system-refactor.md) |
| **Found** | 2026-10-12, code audit for the memory system refactor (appendix B) |
| **Fixed** | — |
| **Severity** | Low — a dedup merge can overwrite a concurrent reinforcement (the lost update bug 182 fixed in the gate), and its uncapped sum can exceed the cap consolidation applies to the same quantity |
| **Who it bites** | users who run the memory dedup tool while extraction jobs are reinforcing the same character's rows |
| **Provenance** | Original to v4. Came in with `memory-merge.ts` for the dedup tool; bug 182's fix covered the gate and not this path |
| **Defect site** | `lib/memory/memory-merge.ts:97-100`, `:118-121` (`planMemoryMerge`); applied through `patchMemory` → `updateForCharacter` (`lib/memory/memory-gate.ts:469-471`) |
| **Fix site** | Phase C of the refactor — `admission/` (`foldInto` applies the count as a delta through `incrementReinforcement(by: n)`; `memory-merge.ts` deleted) |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../bugs.md) |

---

## Symptom

When the dedup tool folds losers into a survivor, the survivor's `reinforcementCount`,
`reinforcedImportance` and `lastReinforcedAt` are written as absolute values computed from rows
read at the start of the run. A reinforcement that lands between that read and the write is lost.
The summed count has no ceiling.

## Root cause

`planMemoryMerge` (`memory-merge.ts:75`) sums the survivor's and every loser's count
(`:97-100`) and, when it changed, puts `reinforcementCount` and a recomputed
`reinforcedImportance` in the patch (`:118-121`), plus `lastReinforcedAt` (`:124-126`).
`applyMemoryMerge` writes the patch through `patchMemory` (`:149`), which is
`repos.memories.updateForCharacter` (`memory-gate.ts:471`).

The repository states the rule this breaks (`memories.repository.ts:562-564`): callers must not
write these three fields through `updateForCharacter`, because an absolute count taken from an
earlier read is the lost update `incrementReinforcement` exists to prevent (bug 182,
[fixed](fixed/bug-182-reinforcement-count-race.md)).

The only caller is the dedup tool (`lib/tools/memory-dedup.ts:305-306`), which runs synchronously
in the parent request (`app/api/v1/system/tools/route.ts`, `?action=memory-dedup`) while extraction
jobs may commit atomic increments to the same rows. Consolidation sums the same quantity but caps
it at 50 (`DIGEST_REINFORCEMENT_CAP`, `consolidation-plan.ts:331-334`); the merge does not.

The file header (`memory-merge.ts:4-7`) still says housekeeping's similarity pass calls it; that
pass is retired and does not.

## Why it survived

Bug 182 was found and fixed on the gate path, where concurrent jobs made the race visible. The dedup
tool is run by hand and rarely, so its window seldom overlaps an extraction commit.

## Fix

Spec §3.6: `foldInto` is the one combine for reinforce, near-duplicate folding and consolidation.
It applies `reinforcementCount` as a delta through an extended `incrementReinforcement(by: n)` and
recomputes `reinforcedImportance` atomically; the digest cap stays where consolidation applies it.
`memory-merge.ts` and the dedup tool are deleted (the tool becomes the `fold-near-duplicates`
maintenance phase in Phase F). Invariant 6 (spec §5): no path writes an absolute count except
`create` and import/restore.

## Verify

Test: `foldInto` pins delta counts — a survivor at count 3 folding a loser at count 2, with a
concurrent `incrementReinforcement` committed between read and write, ends at 6. Grep-test: no
`updateForCharacter` call carries `reinforcementCount`.
