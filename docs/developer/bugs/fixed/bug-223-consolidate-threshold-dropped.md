# Bug 223 — Manual `?action=consolidate` accepts `clusterThreshold` and drops it

| | |
|---|---|
| **Status** | Fixed 2026-10-12 (targeted fix ahead of Phase F) |
| **Found** | 2026-10-12, code audit for the memory system refactor (appendix D) |
| **Fixed** | 2026-10-12 |
| **Severity** | Low — a real consolidation run silently uses the saved threshold instead of the one asked for, so it can fold more or less than the dry run that preceded it showed |
| **Who it bites** | operators running `quilltap memories consolidate --threshold` without `--dry-run`, or posting `clusterThreshold` to the API with `dryRun: false` |
| **Provenance** | Original to v4. Came in with consolidation and hot/cold tiers |
| **Defect site** | `app/api/v1/memories/route.ts:982-986` (`handleConsolidate`, job branch); `lib/background-jobs/queue-service.ts:650-658` (`MemoryConsolidationPayload`) |
| **Fix site** | `lib/background-jobs/queue-service.ts` (`MemoryConsolidationPayload.clusterThreshold`, dedupe adopts it on a pending job); `lib/background-jobs/handlers/memory-consolidation.ts`; `app/api/v1/memories/route.ts` (`handleConsolidate` job branch) |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-12).** `MemoryConsolidationPayload` gains `clusterThreshold`; the `?action=consolidate` job branch puts the requested threshold on the payload, and the handler passes it to `runConsolidation` as `settings: { clusterThreshold }` and logs both the requested and the used threshold. When an enqueue dedupes onto a PENDING job for the character, that job adopts the requested threshold; a PROCESSING job is left alone with a warning. The CLI's `--threshold` therefore applies to real runs as well as dry runs. Tests: `__tests__/unit/api/memories-consolidation-actions.test.ts` (real run carries the threshold), `__tests__/unit/lib/background-jobs/handlers/memory-consolidation.test.ts` (payload threshold reaches the run), `__tests__/unit/background-jobs/memory-maintenance-enqueue.test.ts` (payload; pending job adopts it; running job untouched).

## Symptom

`POST /api/v1/memories?action=consolidate` with `{ characterId, clusterThreshold: 0.65 }` enqueues
a job and returns `{ jobId }`. The job clusters at the saved `memoryConsolidation.clusterThreshold`
(default 0.72), not 0.65. The same body with `dryRun: true` does use 0.65, so a dry run and the
real run that follows it disagree.

## Root cause

`consolidateSchema` accepts `clusterThreshold` (`route.ts:157`) and `handleConsolidate` destructures
it (`:948`). The dry-run branch passes it as `settings: { clusterThreshold }` to `runConsolidation`
(`:969`). The job branch (`:982-986`) enqueues `{ characterId, maxClustersPerRun, trigger }` only;
`MemoryConsolidationPayload` (`queue-service.ts:650-658`) has no field for it, and the handler
(`lib/background-jobs/handlers/memory-consolidation.ts:60-62`) passes only `dryRun` and
`maxClustersPerRun`.

The CLI sets the field whenever `--threshold` is given (`packages/quilltap/lib/memories-consolidate-command.js:64-69`),
dry run or not.

## Why it survived

Dry runs are the common use of a custom threshold, and they work. The real run's report goes to the
job log, not back to the caller, so the threshold it used is not shown next to the one requested.

## Fix

Spec §3.9: one `MEMORY_MAINTENANCE` job whose `MaintenanceRequest` carries
`settings?: Partial<…>`, so `clusterThreshold` rides in the request to the `consolidate` phase
whether or not it is a dry run. `?action=consolidate` becomes `?action=maintain`.

## Verify

Request a real (non-dry) consolidate with an explicit `clusterThreshold` and confirm the job's
report or debug log records that threshold. Test: a request's `settings` reaches the consolidate
phase unchanged.
