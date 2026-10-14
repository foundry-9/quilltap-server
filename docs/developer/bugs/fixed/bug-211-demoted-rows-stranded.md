# Bug 211 — Rows demoted by housekeeping are never digested and never expire

| | |
|---|---|
| **Status** | Fixed 2026-10-12 (targeted fix ahead of Phase F) |
| **Found** | 2026-10-12, code audit for the memory system refactor (appendix D) |
| **Fixed** | 2026-10-12 |
| **Severity** | Medium — every housekeeping demotion creates a row that consolidation will never summarise and retention will never remove; the archive grows without bound and the demoted content is reachable only by drill-down search |
| **Who it bites** | every character whose hot tier has reached its cap or has rows old, inactive and low enough for pass 1; grows with each sweep |
| **Provenance** | Original to v4. Came in with consolidation and hot/cold tiers (`d585480`, 2026-10-08), which introduced demotion to cold, consolidation and retention together |
| **Defect site** | `lib/memory/housekeeping.ts:377-381` (demotion without `supersededById`); `lib/memory/consolidation.ts:348` (loader skips non-hot rows); `lib/database/repositories/memories.repository.ts:947-965` (`findExpiredColdIds` requires `supersededById`) |
| **Fix site** | `lib/memory/consolidation.ts` (`loadCorpus` takes cold, unsuperseded AUTO rows as candidates; `stats.demotedCandidates`) |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-12).** Consolidation's loader now takes cold AUTO rows with no `supersededById` — the rows housekeeping demoted under cap pressure — as candidates alongside the hot tier (cold rows a digest superseded, cold digests and MANUAL rows stay out). A demoted row that clusters is folded into a hot digest and moved under it with `supersededById`, so retention (`findExpiredColdIds`) can retire it like any other superseded row; one too distinct to fold is stamped `consolidatedAt` like a hot standalone. The report counts them as `stats.demotedCandidates`. Housekeeping still demotes without a successor; the gate's `resolveColdForAbsorb` re-promotion is unchanged. The triggers still count unconsidered hot rows only, so demoted rows ride along with the next run a character's hot growth triggers (housekeeping only demotes when the hot tier has grown). Test: `lib/memory/__tests__/consolidation-service.test.ts` (a demoted cold row joins the cluster, is folded into the digest and superseded; a superseded cold row is not a candidate).

## Symptom

A character over its cap has 300 AUTO rows demoted to cold. Over the following weeks consolidation
runs and produces digests from the hot rows, but none of the 300 is ever clustered or summarised.
With `coldRetentionDays` set, cold rows superseded by digests age out, but the 300 do not. They
remain cold, unsuperseded and permanent: recall (hot-only) never surfaces them, and no digest
carries what they said.

## Root cause

Three rules that each make sense alone:

- **Housekeeping demotes without a successor.** Pass 1 and the cap pass move rows to cold with
  `repos.memories.updateTierBulk(characterId, demotedIds, 'cold')` (`housekeeping.ts:378`), with
  no `supersededById` (the `extra` argument is omitted; `memories.repository.ts:874-904`).
- **Consolidation reads hot rows only.** Its loader skips every non-hot row before bucketing
  (`consolidation.ts:348`: `if ((memory.tier ?? 'hot') !== 'hot') continue`), so a demoted row is
  never a candidate.
- **Retention deletes superseded rows only.** `findExpiredColdIds` selects
  `tier = 'cold' AND supersededById IS NOT NULL AND source != 'MANUAL' AND updatedAt < ?`
  (`memories.repository.ts:951-956`).

A cap-demoted row matches neither consolidation's loader nor retention's query.

One way out exists and is narrow: if extraction later re-observes the same fact, the gate's
`resolveColdForAbsorb` promotes an unsuperseded cold neighbour back to hot when it absorbs or
reinforces into it. Rows that are never re-observed stay stranded.

## Why it survived

Housekeeping and consolidation were specified as separate jobs with separate owners of "cold".
Each test covers its own job: housekeeping that rows go cold, consolidation that hot rows are
digested, retention that superseded rows expire. No test follows a demoted row through all three.

## Fix

Phase F merges both jobs into one `MEMORY_MAINTENANCE` job with ordered phases. The `consolidate`
phase takes hot AUTO rows **and** cold rows demoted by cap pressure (`supersededById IS NULL`), so
demotion feeds consolidation. The `retire` phase keys on a new `supersededAt` column (set when a row
goes cold under a digest), not `updatedAt` (bug 225). Demoted rows that consolidation then digests
become superseded and can expire like any other.

## Verify

On a character over cap, run maintenance: the `demote` phase moves rows to cold, and a following
`consolidate` phase lists some of those ids as cluster members; after it, those rows carry
`supersededById` and a `supersededAt`. With `coldRetentionDays` set and the clock advanced, the
`retire` phase removes them.
