/**
 * Questions asked of an admission outcome. Pure; safe anywhere.
 *
 * @module memory/admission/outcome
 */

import type { AdmissionThresholds } from '../settings-defaults'
import type { AdmissionDecision, AdmissionOutcome } from './types'

/** True when the outcome wrote a new row. */
export function admissionInserted(outcome: Pick<AdmissionOutcome, 'action'>): boolean {
  return outcome.action.kind === 'insert' || outcome.action.kind === 'insert-linked'
}

/** True when the outcome counted the observation on an existing row. */
export function admissionReinforced(outcome: Pick<AdmissionOutcome, 'action'>): boolean {
  const kind = outcome.action.kind
  return kind === 'reinforce' || kind === 'absorb' || kind === 'promote-and-reinforce'
}

/**
 * True when the decision takes the candidate in as a near-duplicate: its
 * target sits at or above the near-duplicate threshold, whether it is absorbed
 * outright or is a cold row promoted and absorbed. A digest reached through a
 * superseded member in the reinforce band is absorbed by count but is not a
 * near-duplicate.
 */
export function isNearDuplicateDecision(decision: AdmissionDecision, thresholds: AdmissionThresholds): boolean {
  const action = decision.action
  if (!('into' in action)) return false
  const target = decision.assessments.find((a) => a.id === action.into)
  return !!target && target.cosine >= thresholds.nearDuplicate
}
