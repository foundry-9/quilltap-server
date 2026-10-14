# Bug 210 — The housekeeping cap counts rows housekeeping may never demote

| | |
|---|---|
| **Status** | Fixed 2026-10-12 (targeted fix ahead of Phase F) |
| **Found** | 2026-10-12, code audit for the memory system refactor (appendix D) |
| **Fixed** | 2026-10-12 |
| **Severity** | Medium — on a mature character the cap can become unreachable, so sweeps keep firing and demote nothing useful; the settings card flags characters as over cap using a count that includes cold rows the cap does not measure |
| **Who it bites** | characters with many MANUAL rows, many consolidation digests or many protected AUTO rows (Friday's long-running characters); anyone reading the per-character counts on the Housekeeping card |
| **Provenance** | Original to v4. The cap predates digests; came in with consolidation and hot/cold tiers (`d585480`, 2026-10-08), which made the cap hot-only, added CONSOLIDATED digests to the never-demoted set, and added the counts route's cold rows |
| **Defect site** | `lib/memory/housekeeping.ts:222-224` (hot total), `:312-356` (cap pass), `:123-131` (`isProtectedMemory`); `app/api/v1/memories/route.ts:995-1009` (`character-memory-counts`, `countByCharacterId` at `:1004`); `lib/database/repositories/memories.repository.ts:738-748`; `components/tools/memory-housekeeping-card.tsx:238-239` |
| **Fix site** | `lib/memory/housekeeping.ts` (cap pass, report fields, `needsHousekeeping`); `lib/database/repositories/memories.repository.ts` (`countCapBreakdown`, replaces the now-unused `countHotByCharacterId`); `lib/memory/memory-service.ts` (watermark); `lib/background-jobs/handlers/memory-housekeeping.ts` (outcome cache fed the demotable count); `app/api/v1/memories/route.ts` (`character-memory-counts`, `housekeep` response); `components/tools/memory-housekeeping-card.tsx` |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-12).** Per locked decision 3, the cap now counts demotable rows only — hot AUTO rows. `runHousekeeping` reports `hotTotal`, `demotable` and `protected` (hot MANUAL rows and digests) alongside the old fields; the cap pass demotes exactly `demotable − cap` rows, lowest `calculateProtectionScore` first (so a score-protected AUTO row can go under cap pressure, last), instead of skipping every score-protected row and ordering by the floored effective weight. A character whose MANUAL rows and digests alone exceed the cap is no longer "over cap" and proposes no demotions. The watermark (`maybeEnqueueHousekeeping`) and `needsHousekeeping` read the demotable count from the new `MemoriesRepository.countCapBreakdown` (one aggregate query); the outcome cache is judged against the demotable count. `?action=character-memory-counts` returns `hotTotal` / `demotable` / `protected` / `cold` (plus the old `memoryCount` total), sorted by `demotable`, and the Housekeeping card shows "N counted · M protected" and colours the row by the demotable count. Tests: `__tests__/unit/lib/memory/housekeeping-demotion.test.ts` (protected rows do not count; exact excess demoted lowest protection first), `__tests__/unit/lib/database/repositories/memories-cap-breakdown.test.ts` (real SQLite binding), `__tests__/unit/api/memories-consolidation-actions.test.ts` (counts action).

## Symptom

A character with a cap of 2,000 has 2,300 hot rows, of which 900 are MANUAL or digests and 1,500
are AUTO rows that pass the protection threshold. Every sweep reports it over the cap, scores the
whole hot tier, and demotes nothing, because every candidate is protected. The watermark trigger
(90% of the cap) keeps queuing sweeps, and the "ineffective sweep" backoff in
`housekeeping-outcome-cache.ts` exists to throttle exactly this.

On the Housekeeping card, a character's count is shown in red as over its cap when its total rows,
hot and cold, exceed the cap, though the cap governs the hot tier only.

## Root cause

`runHousekeeping` filters to the hot tier (`housekeeping.ts:222`) and measures the cap against all
of it. In the cap pass:

```ts
const remainingAfterDemotion = memories.filter(m => !demoteSet.has(m.id))        // :312
const hasDemotionCandidate =
  remainingAfterDemotion.length > opts.maxMemories &&                             // :314
  remainingAfterDemotion.some(m => !(protectedMap.get(m.id) ?? isProtectedMemory(m, now)))
...
const excessCount = remainingAfterDemotion.length - opts.maxMemories              // :324
```

`isProtectedMemory` (`:123-131`) returns true for every MANUAL and CONSOLIDATED row and for AUTO
rows scoring ≥ 0.5. Those rows count toward the total but are skipped by the demotion loop
(`:334`), so when protected rows alone exceed the cap the loop can never close the gap. Every
consolidation run adds hot digests, so the protected share grows over time.

The card's count comes from `handleCharacterMemoryCounts` (`app/api/v1/memories/route.ts:995`),
which calls `countByCharacterId` (`:1004`) — a plain count over every tier
(`memories.repository.ts:738-748`). The repository has `countHotByCharacterId` (`:758`) and the
route does not use it. The card compares that total to the hot-only cap
(`memory-housekeeping-card.tsx:238-239`).

## Why it survived

Before tiers and digests, nearly everything was AUTO and the cap behaved. The backoff cache hid the
repeated no-op sweeps, and the card's count is labelled "memories", which is true.

## Fix

Phase F applies the cap to demotable rows only (hot, AUTO, non-digest). The maintenance report
carries `hotTotal`, `demotable` and `protected` separately; demotion order is protection ascending.
The counts route and the card compare the demotable count to the cap. The backoff cache is
removed with `housekeeping-outcome-cache.ts`.

## Verify

On a character whose protected rows exceed its cap, a maintenance dry run reports `demotable`
below the cap and proposes no demotions, and no further watermark jobs are queued for it. On the
Maintenance card, the over-cap colour follows the demotable count.
