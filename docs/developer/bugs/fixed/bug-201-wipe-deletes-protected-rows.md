# Bug 201 — The chat wipe and the dedup tool delete MANUAL rows, digests and cold rows

| | |
|---|---|
| **Status** | **FIXED in v4 (2026-10-12)** |
| **Found** | 2026-10-12, code audit for the [memory system refactor](../../features/complete/memory-system-refactor.md) (appendix D) |
| **Fixed** | 2026-10-12, v4.10-dev (Phase 0 of the refactor) |
| **Severity** | High. Data loss: hand-written memories were deleted by Re-extract / Delete Memories, and deleting a digest left its cold members with a dangling `supersededById` |
| **Who it bites** | anyone who used Delete Memories or Re-extract Memories on a chat, Regenerate Memories, or the Memory Deduplication tool |
| **Provenance** | Original to v4. Both paths predate consolidation and tiers; neither learned about digests or the cold tier when those arrived. `help/memory-regenerate.md` already promised MANUAL rows were spared |
| **Defect site** | `lib/memory/memory-service.ts` `deleteMemoriesByChatIdWithVectors` (was line 1768: every row with that `chatId`); `lib/tools/memory-dedup.ts` `deduplicateCharacterMemories` (was line 168: `findByCharacterId`, every tier and source) |
| **Fix site** | `lib/memory/policy-protection.ts` (new); `lib/memory/memory-service.ts:1780`; `lib/tools/memory-dedup.ts:173` |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-12).** One predicate, `policyProtectionOf` / `partitionByPolicyProtection`
(`lib/memory/policy-protection.ts`), names what a bulk policy path must spare: MANUAL rows, digests
(`source: 'CONSOLIDATED'`) and cold rows.

- **The chat wipe** (`DELETE /memories?chatId=`, `MEMORY_REGENERATE_CHAT`) deletes only hot AUTO rows.
  A digest is also wiped once none of its members survive, per locked decision 4 of the refactor spec.
  A member survives only if this wipe is not deleting it and its `supersededById` still names the
  digest; all spared digests' members are read in one query.
  The result and the API response carry a `spared` / `sparedCount`, and the Salon's toast and
  confirmations say what is kept.
- **The dedup tool** folds only hot AUTO rows, and reports the rest per character as `sparedCount`
  (the preview's "Kept aside" column).
- The per-row delete is unchanged, and remains the true purge.

Tests: `__tests__/unit/lib/memory/policy-protection.test.ts`.

## Symptom

Re-extract Memories on a chat deleted the memories the operator had written by hand about that chat.
Running Memory Deduplication could pick a digest or a MANUAL row as a discard and delete it.

## Root cause

`deleteMemoriesByChatIdWithVectors` read `findByChatId(chatId)` and deleted every row it returned.
`deduplicateCharacterMemories` read `findByCharacterId(characterId)` (all tiers, all sources),
clustered by cosine, and deleted every non-survivor. Neither checked `source` or `tier`.

## Why it survived

Consolidation and tiers (4.9) added digests and the cold tier after both paths were written. The help
page described the intended behaviour, so nobody looked at the code.

## Fix

As above. Phase F replaces the dedup tool with `maintenance/` near-duplicate folding, under the same
rule.

## Verify

Write a manual memory against a chat, then use Delete Memories on that chat. The toast reports one
entry kept, and the manual memory is still in the Commonplace Book.
