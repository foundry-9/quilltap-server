/**
 * The shapes admission speaks in (memory refactor §3.6).
 *
 * Pure type declarations — safe to import from the job child, the parent and
 * the host-RPC wire alike.
 *
 * @module memory/admission/types
 */

import type { Memory } from '@/lib/schemas/types'
import type { AdmissionThresholds } from '../settings-defaults'

/**
 * A candidate as the row it would become: the candidate's text, subject and
 * provenance with its resolved event time and its targeting tags written into
 * `keywords` (`toAdmissionRow` in `../candidate.ts` builds it). Plain data, so
 * it crosses the host-RPC boundary unchanged.
 */
export interface AdmissionRow {
  /** The holder: whose Commonplace Book the memory enters. */
  characterId: string
  content: string
  summary: string
  keywords?: string[]
  /** Group-level tags (UUIDs), never targeting tags. */
  tags?: string[]
  importance?: number
  /** Whom the memory is about; null (or the holder's own id) for a self memory. */
  aboutCharacterId?: string | null
  chatId?: string | null
  /** The source chat's project, for recall-time scope comparisons. */
  projectId?: string | null
  source?: 'AUTO' | 'MANUAL' | 'CONSOLIDATED'
  sourceMessageId?: string | null
  /** Overrides the row's createdAt/updatedAt with the source message's time. */
  sourceMessageTimestamp?: string
  witnessedContext?: 'user_present' | 'autonomous_room' | 'manual' | null
  /** ISO wall-clock event time (not the write clock). */
  occurredAt?: string | null
  /** Free-text in-story time, for chats on a fictional timeline. */
  narrativeTime?: string | null
  /** Proper nouns of the episode. */
  entities?: string[]
  kind?: 'semantic' | 'episodic'
}

/**
 * What admission does with a candidate. Decided by `decideAdmission` (pure),
 * applied by `admitCandidate` in the parent.
 *
 *  - `insert` — a new row, nothing near it.
 *  - `insert-linked` — a new row, linked both ways to `linkTo`: neighbours in
 *    the related band, and closer ones it may not fold into (a different
 *    occasion, subject or kind, or an extracted row a hand-written memory
 *    must not disappear into). `reason` names the strongest of those.
 *  - `reinforce` — fold the candidate into `into` (footnotes, anchors, count).
 *  - `absorb` — count the observation on `into` and change nothing else: a
 *    near-duplicate, or a reinforcement redirected from a superseded member
 *    to its digest (`redirectedFrom` names the member).
 *  - `promote-and-reinforce` — `into` is a cold row nothing supersedes; the
 *    world asked for it again, so it returns to the hot tier, then reinforces
 *    (`withFootnotes`) or is absorbed into (near-duplicate).
 *  - `reject` — nothing is written.
 */
export type AdmissionAction =
  | { kind: 'insert' }
  | { kind: 'insert-linked'; linkTo: string[]; reason: 'band' | 'date-guard' | 'mismatch' }
  | { kind: 'reinforce'; into: string }
  | { kind: 'absorb'; into: string; redirectedFrom?: string }
  | { kind: 'promote-and-reinforce'; into: string; withFootnotes: boolean }
  | { kind: 'reject'; reason: 'embedding-failed' | 'empty' }

export type AdmissionActionKind = AdmissionAction['kind']

/**
 * One neighbour as the decider sees it: a live row and its cosine to the
 * candidate. A cold member superseded by a digest arrives already replaced by
 * the digest (`via` names the member it was reached through); a cold row
 * whose digest is gone arrives as itself with `danglingDigest` set.
 */
export interface AdmissionNeighbour {
  memory: Memory
  cosine: number
  via?: string
  danglingDigest?: boolean
}

/** Why a close neighbour (≥ the reinforce threshold) could not take the candidate. */
export type NeighbourExclusion = 'subject' | 'kind' | 'manual-over-auto' | 'date-guard'

/** The decider's verdict on one neighbour, for the trace. */
export interface NeighbourAssessment {
  id: string
  cosine: number
  via?: string
  /** below: under the related band · band: linkable · excluded: close but ineligible · eligible: could fold. */
  verdict: 'below' | 'band' | 'excluded' | 'eligible'
  excludedBy?: NeighbourExclusion
}

/** What `decideAdmission` returns: the action and how each neighbour was read. */
export interface AdmissionDecision {
  action: AdmissionAction
  assessments: NeighbourAssessment[]
}

/** Everything about one admission a debug log or a replay would want. */
export interface AdmissionTrace {
  thresholds: AdmissionThresholds
  assessments: NeighbourAssessment[]
  /** Embedding attempts made for the candidate (0 when the caller supplied one). */
  embeddingAttempts: number
  /** Vectors whose row is gone, ignored by the search (bug 200). */
  orphansIgnored: number
  /** How wide the search went to see past orphans. */
  searchedK: number
  /** Free-form notes from preparation and apply (name-presence flips, failures). */
  notes: string[]
}

/** The result of admitting one candidate. */
export interface AdmissionOutcome {
  action: AdmissionAction
  /**
   * The row as it now stands: the new row for an insert (with its links), the
   * reinforced or absorbing row otherwise, null for a reject. Never carries
   * its embedding.
   */
  memory: Memory | null
  /** Details appended to `memory` as `[+]` footnotes. */
  novelDetails: string[]
  /** Neighbours the new row was linked to (insert-linked only). */
  linkedIds: string[]
  trace: AdmissionTrace
}
