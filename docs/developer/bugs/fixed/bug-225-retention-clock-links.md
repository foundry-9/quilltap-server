# Bug 225 — Retention ages cold rows by `updatedAt`, and deletes leave `consolidatedFrom` dangling

| | |
|---|---|
| **Status** | Fixed 2026-10-12 (targeted fix ahead of Phase B) |
| **Found** | 2026-10-12, code audit for the memory system refactor (appendix D) |
| **Fixed** | 2026-10-12 |
| **Severity** | Low — superseded members can outlive `coldRetentionDays` indefinitely when links keep touching them, and a digest's member count overstates what survives (shown to the model as "from N notes") |
| **Who it bites** | users with `memoryConsolidation.coldRetentionDays` set; any digest whose members have been deleted |
| **Provenance** | Original to v4. Came in with consolidation and hot/cold tiers |
| **Defect site** | `lib/database/repositories/memories.repository.ts:947-965` (`findExpiredColdIds`); `lib/memory/memory-gate.ts:782-930` (`deleteMemoryWithUnlink`, `deleteMemoriesWithUnlinkBatch`) |
| **Fix site** | `lib/database/repositories/memories.repository.ts` (`updateTierBulk`, `findExpiredColdIds`); `lib/schemas/memory.types.ts`; `migrations/scripts/add-memory-superseded-at-v1.ts`; `lib/memory/memory-gate.ts` (`scrubDigestLinks` in both delete chokepoints); `lib/import/quilltap-import/import-entities.ts`; `public/schemas/qtap-export.schema.json`; `docs/developer/DDL.md` |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-12).** New column `memories.supersededAt` (migration `add-memory-superseded-at-v1`, backfilled from `updatedAt` for rows that already have a `supersededById`). `updateTierBulk` stamps it whenever it sets `supersededById` and clears it when the link is cut; a tier move that says nothing about the digest leaves it alone. `findExpiredColdIds` ages by `COALESCE(supersededAt, updatedAt)`, so link rewrites no longer reset the retention clock. Both delete chokepoints (`deleteMemoryWithUnlink`, `deleteMemoriesWithUnlinkBatch`) now also run `scrubDigestLinks`: deleted ids are removed from surviving digests' `consolidatedFrom`, and surviving members of a deleted digest have `supersededById` (and `supersededAt`) cleared through `updateTierBulk`, leaving them as cap-demoted cold rows. Export schema, importer and DDL.md carry the column; backups copy whole rows. A digest whose `consolidatedFrom` empties is left in place (retiring it with its last member is Phase B's `retireMemories`), and existing dangling ids are not repaired (`memories validate --repair` is Phase B). Tests: `__tests__/unit/lib/memory/memory-retention-clock.test.ts` (real SQLite: retention by `supersededAt` after a link rewrite, the stamp/clear rules, all three scrubs), `__tests__/unit/lib/database/migration/add-memory-superseded-at-v1.test.ts`. Review follow-up (2026-10-12): the `consolidatedFrom` scrub is now a removal delta (`MemoriesRepository.removeConsolidatedMembers`, `json_each` in SQL), not a whole-array write built from a raw read, so two deletes from one digest in one child job compose on replay; the digest and orphaned-member lookups (`findDigestsContainingMembers`, `findIdsSupersededByAny`) are scoped to the doomed rows' holders, read through the repository (so the per-job overlay applies), and backed by `idx_memories_supersededById` (migration `add-memories-superseded-by-index-v1`). Tests: `__tests__/unit/lib/memory/memory-delete-digest-chokepoint.test.ts`.

## Symptom

1. A superseded cold member that should have expired under `coldRetentionDays` is not deleted,
   because something rewrote one of its fields recently.
2. After retention (or any delete) removes members of a digest, the digest's `consolidatedFrom`
   still lists them. The memory card's digest size and the model-facing provenance
   (`formatDigestProvenance`) count members that no longer exist.

## Root cause

**Clock.** `findExpiredColdIds` (`memories.repository.ts:947`) selects cold, superseded, non-MANUAL
rows with `updatedAt < ?` (`:956`). `updatedAt` is the row's last write of any kind, not the moment
it was superseded. The base repository stamps it on every update (`base.repository.ts:526-534`), so
it is reset by consolidation's link rewrites (`lib/memory/consolidation.ts:626-627`, an
`updateForCharacter` of `relatedMemoryIds`) and by the delete helpers' neighbour scrubs
(`memory-gate.ts:804-806`, `:887-889`). A cold member that keeps being re-linked never ages out.

**Dangling members.** `deleteMemoryWithUnlink` (`memory-gate.ts:782`) and
`deleteMemoriesWithUnlinkBatch` (`:843`) scrub the deleted ids from neighbours'
`relatedMemoryIds` only. Neither touches `consolidatedFrom` on surviving digests. Readers that count
it: `formatDigestProvenance` (`lib/chat/context/memory-injector.ts:194-196`),
`components/memory/memory-card.tsx:64`, and the chat wipe's surviving-member check in
`deleteMemoriesByChatIdWithVectors` (`memory-service.ts`). The reverse case — a deleted digest
leaving its members with a dangling `supersededById` — is closed for the chat wipe and the dedup tool
by [bug 201](bug-201-wipe-deletes-protected-rows.md); the per-row delete can still do it, and
`retireMemories` (Phase B) closes it everywhere.

## Why it survived

`coldRetentionDays` defaults to null (never), so retention rarely runs. The `relatedMemoryIds` scrub
was written before tiers existed, and the tier work added two new link columns without extending it.
The CLI's `memories validate` checks only `relatedMemoryIds`.

## Fix

Spec §3.9–§3.10: a `supersededAt` column, set when a row goes cold under a digest
(`add-memory-superseded-at-v1`, backfilled from `updatedAt` for rows with a `supersededById`); the
`retire` phase ages by `supersededAt`. `retireMemories` becomes the one deletion chokepoint and
scrubs `relatedMemoryIds`, `consolidatedFrom` on surviving digests, and `supersededById` on surviving
members of a deleted digest. `quilltap memories validate --repair` covers existing dangling ids.

## Verify

Test: `retireMemories` scrubs all three link columns. Supersede a member, rewrite one of its links,
and confirm the retire phase still expires it once `supersededAt` passes the cutoff.
