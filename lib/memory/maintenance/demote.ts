/**
 * Phase 3 — demote, and Phase 4 — retire (memory refactor §3.9). Both pure
 * planners over the run's corpus; `run.ts` issues the writes.
 *
 * **Demote.** The cap applies to **demotable** rows only — hot AUTO rows; MANUAL
 * rows and digests are never demoted and never counted (bug 210, decision 3).
 * When demotable rows exceed the cap, exactly the excess goes cold, lowest
 * `protection` first (ties to the oldest). Age and inactivity live in
 * protection's content term; the old retention pass and its three
 * never-persisted knobs are gone (decision 7).
 *
 * **Retire.** Cold, superseded AUTO rows whose `supersededAt` (when they went
 * cold under a digest, bug 225) is older than `coldRetentionDays` →
 * `retireMemories(…, { reason: 'retention' })`, which never takes a digest with
 * its last member.
 *
 * @module memory/maintenance/demote
 */

import type { Memory } from '@/lib/schemas/types'
import { protection } from '../scoring'
import { tierOf } from './corpus'
import type { DemotePhaseReport } from './types'

const DAY_MS = 86_400_000

/** The rows the cap measures and may demote: hot AUTO rows. */
export function isDemotable(memory: Memory): boolean {
  return tierOf(memory) === 'hot' && memory.source === 'AUTO' && !memory.keystone
}

/** Which rows to demote so the demotable count fits the cap. */
export function planDemotion(rows: readonly Memory[], cap: number, nowMs: number): DemotePhaseReport {
  const hot = rows.filter((m) => tierOf(m) === 'hot')
  const demotable = hot.filter(isDemotable)
  const excess = Math.max(0, demotable.length - cap)
  const report: DemotePhaseReport = {
    cap,
    hotTotal: hot.length,
    demotable: demotable.length,
    protected: hot.length - demotable.length,
    excess,
    demoted: 0,
    demotedIds: [],
    highestScoreDemoted: null,
  }
  if (excess === 0) return report

  const scored = demotable
    .map((memory) => ({ memory, score: protection(memory, { nowMs }).score }))
    .sort((a, b) => a.score - b.score || Date.parse(a.memory.createdAt) - Date.parse(b.memory.createdAt))
    .slice(0, excess)
  report.demotedIds = scored.map((s) => s.memory.id)
  report.demoted = report.demotedIds.length
  report.highestScoreDemoted = scored[scored.length - 1]?.score ?? null
  return report
}

/** Cold, superseded AUTO rows past the retention window, by `supersededAt`. */
export function planRetention(rows: readonly Memory[], retentionDays: number, nowMs: number): string[] {
  const cutoffMs = nowMs - retentionDays * DAY_MS
  return rows
    .filter((m) => {
      if (tierOf(m) !== 'cold' || !m.supersededById || m.source !== 'AUTO') return false
      // Rows superseded before the column existed were backfilled from updatedAt.
      const at = Date.parse(m.supersededAt ?? m.updatedAt)
      return Number.isFinite(at) && at < cutoffMs
    })
    .map((m) => m.id)
}
