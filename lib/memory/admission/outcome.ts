/**
 * Questions asked of an admission outcome. Pure; safe anywhere.
 *
 * @module memory/admission/outcome
 */

import type { AdmissionOutcome } from './types'

/** True when the outcome wrote a new row. */
export function admissionInserted(outcome: Pick<AdmissionOutcome, 'action'>): boolean {
  return outcome.action.kind === 'insert' || outcome.action.kind === 'insert-linked'
}

/** True when the outcome counted the observation on an existing row. */
export function admissionReinforced(outcome: Pick<AdmissionOutcome, 'action'>): boolean {
  const kind = outcome.action.kind
  return kind === 'reinforce' || kind === 'absorb' || kind === 'promote-and-reinforce'
}
