# Bug 202 — Entity-anchor hits face the cosine floor on the per-turn paths

| | |
|---|---|
| **Status** | **FIXED in v4 (2026-10-12)** — as *not a defect*. The floor on anchor hits is R5 of the recall retuning, working as decided. The defect was the comment that said otherwise; it is corrected |
| **Found** | 2026-10-12, code audit for the [memory system refactor](../../features/complete/memory-system-refactor.md) (appendix C) |
| **Fixed** | 2026-10-12 (comment only; no behaviour change) |
| **Severity** | **None**. The audit's "Medium" read the comment as the contract |
| **Who it bites** | nobody |
| **Provenance** | Original to v4. The entity-anchor union came in with the recall relevance fix; R5 of [recall-multiplier-retuning.md](../../features/recall-multiplier-retuning.md) (2026-10-08) later made related expansion the only path exempt from the floor |
| **Defect site** | the comments on `entityAnchors` and above the hybrid step in `searchMemoriesSemantic` (`lib/memory/memory-service.ts`, were lines 817-818 and 1018) |
| **Fix site** | same comments |
| **v5 status** | Unaffected |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-12), as not a defect.** On the per-turn paths, entity-anchor hits are unioned
into the candidate pool but get no literal boost. So a hit below the cosine floor is removed, and the
comments said "a verbatim place name must not be sliced off by the cosine floor". The refactor spec
asked Phase 0 to boost anchor hits or exempt them from the floor, whichever the comment intended.

Neither was done. R5 of the recall retuning (2026-10-08) decided the contrary: "expansion may stay
exempt by design, but nothing else should be". Its test, `R5 — the cosine floor`
(`__tests__/unit/lib/memory/memory-service-recall-tuning.test.ts:298`), pins anchor hits to the floor.
Exempting them was built and broke that test. Either change would also move the `cap14` probe scores,
which the refactor's locked decision 14 forbids. Charlie chose to keep R5 (2026-10-12).

The comments now say what the union is for: a verbatim name buried below the vector store's top-K
cap still reaches ranking. Anchor hits are scored at raw cosine and face the floor.

## Symptom

As filed: a memory containing a place name the turn mentions, with a cosine below the provider floor,
is not recalled.

## Root cause

Intended. See above.

## Why it survived

The comment predates R5 and was not updated when R5 pinned the opposite contract.

## Fix

Comment only. Any change to the floor's exemptions is a tuning change: a separate commit with a new
probe-fixture row and Charlie's sign-off (refactor spec §5.1).

## Verify

`npx jest __tests__/unit/lib/memory/memory-service-recall-tuning.test.ts` passes, R5 included.
