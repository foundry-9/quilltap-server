/**
 * `decideAdmission` — what to do with a candidate, given its neighbours.
 *
 * Pure: no I/O, no writes, no clock. The neighbours arrive already hydrated
 * (live rows, superseded members replaced by their digest — see
 * `neighbours.ts`), so promoting a cold row is an *action* the caller applies,
 * never a side effect of deciding.
 *
 * The rules, in order (memory refactor §3.6):
 *
 *  1. A neighbour under `related` is ignored; one in [`related`, `reinforce`)
 *     is a link target.
 *  2. A neighbour at or above `reinforce` may take the candidate only when it
 *     shares the candidate's **subject** (`aboutCharacterId`, a self memory
 *     reading as the holder) and **kind**, is not an extracted (AUTO) row
 *     under a hand-written (MANUAL) candidate, and is not a **different
 *     occasion** (both carry an `occurredAt`, more than `dateGuardDays` apart).
 *     Every such neighbour is checked, not only the closest; an ineligible
 *     one becomes a link target.
 *  3. The closest eligible neighbour takes the candidate: a cold row nothing
 *     supersedes is promoted first; a digest reached through a superseded
 *     member absorbs by count only; at or above `nearDuplicate` the candidate
 *     is absorbed; otherwise it reinforces.
 *  4. With no eligible neighbour, the candidate is inserted, linked to every
 *     link target when there are any.
 *
 * @module memory/admission/decide
 */

import type { AdmissionThresholds } from '../settings-defaults'
import type {
  AdmissionAction,
  AdmissionDecision,
  AdmissionNeighbour,
  NeighbourAssessment,
  NeighbourExclusion,
} from './types'

/** The parts of a candidate the decider reads. */
export interface AdmissionCandidateView {
  holderId: string
  aboutId: string | null | undefined
  kind: 'semantic' | 'episodic' | undefined
  source: 'AUTO' | 'MANUAL' | 'CONSOLIDATED' | undefined
  occurredAt: string | null | undefined
}

/**
 * True when both timestamps parse and sit more than `dateGuardDays` apart:
 * the same activity on a different occasion, which must persist as its own row.
 */
export function occasionsAreDistinct(
  candidateOccurredAt: string | null | undefined,
  existingOccurredAt: string | null | undefined,
  dateGuardDays: number,
): boolean {
  if (!candidateOccurredAt || !existingOccurredAt) return false
  const a = Date.parse(candidateOccurredAt)
  const b = Date.parse(existingOccurredAt)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false
  return Math.abs(a - b) > dateGuardDays * 86_400_000
}

/** The subject a memory is about, a self memory reading as its holder. */
function subjectOf(holderId: string, aboutId: string | null | undefined): string {
  return aboutId || holderId
}

function exclusionFor(
  candidate: AdmissionCandidateView,
  neighbour: AdmissionNeighbour,
  thresholds: AdmissionThresholds,
): NeighbourExclusion | null {
  const m = neighbour.memory
  if (subjectOf(m.characterId, m.aboutCharacterId) !== subjectOf(candidate.holderId, candidate.aboutId)) {
    return 'subject'
  }
  if ((m.kind ?? 'semantic') !== (candidate.kind ?? 'semantic')) return 'kind'
  if (candidate.source === 'MANUAL' && (m.source ?? 'MANUAL') === 'AUTO') return 'manual-over-auto'
  if (occasionsAreDistinct(candidate.occurredAt, m.occurredAt, thresholds.dateGuardDays)) return 'date-guard'
  return null
}

/**
 * Decide what admission does with a candidate. `neighbours` may arrive in any
 * order; ties keep their given order.
 */
export function decideAdmission(input: {
  candidate: AdmissionCandidateView
  neighbours: readonly AdmissionNeighbour[]
  thresholds: AdmissionThresholds
}): AdmissionDecision {
  const { candidate, thresholds } = input
  const neighbours = [...input.neighbours].sort((a, b) => b.cosine - a.cosine)

  const assessments: NeighbourAssessment[] = []
  let target: AdmissionNeighbour | null = null
  const linkTo: string[] = []
  const exclusions = new Set<NeighbourExclusion>()

  for (const n of neighbours) {
    const base = { id: n.memory.id, cosine: n.cosine, ...(n.via ? { via: n.via } : {}) }
    if (n.cosine < thresholds.related) {
      assessments.push({ ...base, verdict: 'below' })
      continue
    }
    if (n.cosine < thresholds.reinforce) {
      assessments.push({ ...base, verdict: 'band' })
      if (!linkTo.includes(n.memory.id)) linkTo.push(n.memory.id)
      continue
    }
    const excludedBy = exclusionFor(candidate, n, thresholds)
    if (excludedBy) {
      assessments.push({ ...base, verdict: 'excluded', excludedBy })
      exclusions.add(excludedBy)
      if (!linkTo.includes(n.memory.id)) linkTo.push(n.memory.id)
      continue
    }
    assessments.push({ ...base, verdict: 'eligible' })
    if (!target) target = n
  }

  let action: AdmissionAction
  if (target) {
    const m = target.memory
    const near = target.cosine >= thresholds.nearDuplicate
    const coldUnsuperseded = m.tier === 'cold' && (!m.supersededById || target.danglingDigest === true)
    if (coldUnsuperseded) {
      action = { kind: 'promote-and-reinforce', into: m.id, withFootnotes: !near }
    } else if (target.via) {
      // A digest is reinforced by count only: the next consolidation folds any
      // novel detail in.
      action = { kind: 'absorb', into: m.id, redirectedFrom: target.via }
    } else if (near) {
      action = { kind: 'absorb', into: m.id }
    } else {
      action = { kind: 'reinforce', into: m.id }
    }
  } else if (linkTo.length > 0) {
    const reason = exclusions.has('date-guard') ? 'date-guard' : exclusions.size > 0 ? 'mismatch' : 'band'
    action = { kind: 'insert-linked', linkTo, reason }
  } else {
    action = { kind: 'insert' }
  }

  return { action, assessments }
}
