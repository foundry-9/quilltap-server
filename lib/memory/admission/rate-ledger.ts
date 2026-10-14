/**
 * The extraction rate limit's memory of recent admissions (memory refactor
 * §3.7).
 *
 * The limiter used to count a character's rows by `createdAt` over the last
 * hour, but `createdAt` is the source message's time — a regenerate's rows are
 * dated to their messages and never counted. Admission runs in the parent, so
 * the parent remembers when each AUTO row it inserted landed, and the limiter
 * asks it (over host-RPC from the job child). The ledger lives in memory: a
 * restart forgets the last hour, which only ever errs towards admitting.
 *
 * @module memory/admission/rate-ledger
 */

import { logger } from '@/lib/logger'
import { processSingleton } from '@/lib/utils/process-singleton'

/** How far back the ledger keeps insert times. */
export const RATE_LEDGER_WINDOW_MS = 60 * 60 * 1000

/** characterId → insert times (ms), oldest first. */
const inserts = processSingleton('memory.admission.rateLedger', () => new Map<string, number[]>())

function isJobChild(): boolean {
  return process.env.QUILLTAP_JOB_CHILD === '1'
}

function prune(characterId: string, now: number): number[] {
  const times = (inserts.get(characterId) ?? []).filter(t => now - t <= RATE_LEDGER_WINDOW_MS)
  if (times.length > 0) inserts.set(characterId, times)
  else inserts.delete(characterId)
  return times
}

/** Note an AUTO row admission just inserted. Parent only. */
export function recordAdmissionInsert(characterId: string, at: number = Date.now()): void {
  if (isJobChild()) return
  const times = prune(characterId, at)
  times.push(at)
  inserts.set(characterId, times)
}

/** AUTO rows inserted for a character since `sinceMs`, as the parent saw them land. */
export function countRecentAdmissionsLocal(characterId: string, sinceMs: number, now: number = Date.now()): number {
  return prune(characterId, now).filter(t => t >= sinceMs).length
}

/** {@link countRecentAdmissionsLocal} from either process (host-RPC from the job child). */
export async function countRecentAdmissions(characterId: string, sinceMs: number): Promise<number> {
  if (!isJobChild()) return countRecentAdmissionsLocal(characterId, sinceMs)
  try {
    const { callHost } = await import('@/lib/background-jobs/child/host-rpc-client')
    return await callHost<number>('countRecentAdmissions', characterId, sinceMs)
  } catch (error) {
    logger.warn('[Memory] Could not read the admission rate ledger; counting none', {
      characterId,
      error: error instanceof Error ? error.message : String(error),
    })
    return 0
  }
}

/** Test hook. */
export function resetRateLedgerForTests(): void {
  inserts.clear()
}
