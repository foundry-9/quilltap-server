/**
 * Memory maintenance — one job, ordered phases, a parent-side ledger
 * (memory refactor §3.9).
 *
 * @module memory/maintenance
 */

export * from './types'
export { loadCorpus, MaintenanceCorpus, CORPUS_PAGE_SIZE } from './corpus'
export { planNearDuplicateFolds, applyNearDuplicateFolds, isFoldEligible } from './fold-near-duplicates'
export { bucketCandidates, CONSOLIDATION_MAX_BUCKET_ROWS } from './consolidate'
export { planDemotion, planRetention, isDemotable } from './demote'
export { runMaintenance, resolvePhases, summarizeMaintenance, announceMaintenance } from './run'
export {
  shouldEnqueue,
  recordMaintenanceOutcome,
  getMaintenanceLedgerStatus,
  resetMaintenanceLedgerForTests,
  type LedgerStatus,
} from './ledger'
export { maybeEnqueueMaintenance, maybeEnqueueMaintenanceAfterCommit, characterIdsFromMemoryWrites } from './triggers'
export { scheduleMemoryMaintenance, stopMemoryMaintenanceScheduler, runScheduledMemoryMaintenance } from './scheduler'
