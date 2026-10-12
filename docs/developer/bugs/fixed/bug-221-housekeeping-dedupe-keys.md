# Bug 221 — Per-character and user-wide housekeeping jobs can sweep one character at once

| | |
|---|---|
| **Status** | Fixed 2026-10-12 (targeted fix ahead of Phase F) |
| **Found** | 2026-10-12, code audit for the memory system refactor (appendix D) |
| **Fixed** | 2026-10-12 |
| **Severity** | Low — duplicated sweep work on one character, both computed against the same pre-commit snapshot; demotions and retention deletes mostly coincide, so the visible effect is wasted time and possible extra demotion |
| **Who it bites** | users with auto-housekeeping on, when a watermark sweep for a character overlaps the daily scheduled sweep or a manual "sweep all" |
| **Provenance** | Original to v4. Came in with the watermark-triggered housekeeping sweep |
| **Defect site** | `lib/background-jobs/queue-service.ts:614-622` (`enqueueMemoryHousekeeping` dedupe); `lib/memory/memory-service.ts:105-114` (`maybeEnqueueHousekeeping` throttle) |
| **Fix site** | `lib/background-jobs/queue-service.ts` (`enqueueMemoryHousekeeping`, new `enqueueMemoryHousekeepingSweep`); `lib/background-jobs/scheduled-housekeeping.ts`; `app/api/v1/memories/route.ts` (`housekeep-sweep`) |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-12).** Housekeeping now dedupes on `characterId` whatever the reason. A user-wide sweep (the daily scheduled pass, `?action=housekeep-sweep`, or `enqueueMemoryHousekeeping` with no character) fans out at enqueue time into one job per character through `enqueueMemoryHousekeepingSweep`, and every per-character enqueue returns the id of any PENDING/PROCESSING housekeeping job for that character — so a watermark job and the daily sweep collide on the same key. A legacy user-wide job still in flight (no `characterId`) absorbs any per-character enqueue for that user; the handler still accepts such payloads. Because every job now carries `characterId`, `maybeEnqueueHousekeeping`'s durable throttle matches the scheduled and manual sweeps as well. `housekeep-sweep` returns `jobIds` (and `jobId`, the first). Tests: `__tests__/unit/background-jobs/memory-maintenance-enqueue.test.ts` (fan-out; watermark ↔ scheduled collision both ways; legacy job), `__tests__/unit/api/memories-consolidation-actions.test.ts` (sweep action). Review follow-up: the sweep reads the PENDING/PROCESSING job lists once (`findInFlightHousekeeping`) and dedupes in memory, instead of twice per character.

## Symptom

A watermark-triggered housekeeping job for character A and a user-wide housekeeping job (the daily
sweep, or `?action=housekeep-sweep`) can be pending or running together, and both sweep A.

## Root cause

Two jobs carry different payload shapes: a watermark job has `characterId`; the scheduled sweep
(`lib/background-jobs/scheduled-housekeeping.ts:169-171`) and the manual sweep
(`app/api/v1/memories/route.ts:686`) enqueue `{ reason }` with no `characterId`, and the handler
then visits every character the user owns.

- `enqueueMemoryHousekeeping` dedupes on `existingCharId === payload.characterId`
  (`queue-service.ts:618-621`). `'A' !== undefined`, so neither job blocks the other.
- `maybeEnqueueHousekeeping`'s durable throttle (`memory-service.ts:105-114`) skips only when a
  recent job's `payload.characterId === characterId`; a user-wide job does not match.

The dispatcher runs up to `maxConcurrentJobs` jobs of any type at once
(`lib/background-jobs/host/job-dispatcher.ts:10-15`), so the two can overlap. Each child sweep
reads the committed snapshot and buffers its writes; the second commit re-applies demotions and
deletes computed without seeing the first.

## Why it survived

The overlap needs a watermark crossing during the daily sweep's run on that user. The outcome is
mostly idempotent (same rows demoted, already-deleted ids deleted again), so nothing visibly breaks.

## Fix

Spec §3.9: one `MEMORY_MAINTENANCE` job type whose dedupe key is
`characterId` only. A user-wide sweep enqueues one job per character, so a scheduled run and a
watermark run collide on the same key. One scheduler and one parent-side `shouldEnqueue` replace
the two throttles.

## Verify

Enqueue a scheduled sweep for the user, then a watermark job for one of their characters before the
first finishes: the second enqueue returns the existing job id for that character. Test: per-character
dedupe across `scheduled` and `watermark` reasons.
