/**
 * Admission: how a memory enters or changes in the Commonplace Book (memory
 * refactor §3.6).
 *
 *  - `admitCandidate` — the one way a candidate becomes (or reinforces) a row;
 *    decides in the parent, over host-RPC from the job child.
 *  - `decideAdmission` — the pure decision.
 *  - `foldInto` / `applyFold` — the one combine, and its writes.
 *  - `updateMemory` — a hand edit.
 *
 * @module memory/admission
 */

export {
  admitCandidate,
  admitRow,
  admitPrepared,
  admissionContentKey,
  type AdmitOptions,
  type AdmitPreparedRequest,
} from './admit'
export { admissionInserted, admissionReinforced, isNearDuplicateDecision } from './outcome'
export { decideAdmission, occasionsAreDistinct, type AdmissionCandidateView } from './decide'
export { foldInto, FOLD_CAPS, type FoldPlan, type FoldSource, type FoldSurvivor, type FoldCaps } from './fold'
export { applyFold } from './apply'
export { linkBothWays } from './links'
export { countRecentAdmissions, RATE_LEDGER_WINDOW_MS } from './rate-ledger'
export { extractNovelDetails } from './novel-details'
export { describeAdmission } from './describe'
export type {
  AdmissionAction,
  AdmissionActionKind,
  AdmissionDecision,
  AdmissionNeighbour,
  AdmissionOutcome,
  AdmissionRow,
  AdmissionTrace,
  NeighbourAssessment,
  NeighbourExclusion,
} from './types'
export {
  updateMemory,
  type MemoryEditPatch,
  type UpdateMemoryResult,
} from './update-memory'
