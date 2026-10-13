/**
 * A stand-in for `@/lib/memory/admission` in tests of the code that produces
 * candidates (the extraction passes, the episode pass).
 *
 *   jest.mock('@/lib/memory/admission', () =>
 *     require('../../../helpers/admission-mock').admissionModuleMock())
 *
 * `mockAdmitRow` receives each admission as `(row, opts)` — the row the
 * candidate becomes (`toAdmissionRow`) — so a test asserts on the fields that
 * would be written. Its resolved value is the outcome; build one with
 * {@link admissionOutcome}. The pure helpers (`admissionInserted`,
 * `describeAdmission`) are the real ones.
 */

import type { Memory } from '@/lib/schemas/types'
import type { AdmissionAction, AdmissionOutcome } from '@/lib/memory/admission/types'
import { ADMISSION_THRESHOLDS } from '@/lib/memory/settings-defaults'

export const mockAdmitRow = jest.fn()

export function admissionModuleMock() {
  const { toAdmissionRow } = jest.requireActual('@/lib/memory/candidate')
  const outcome = jest.requireActual('@/lib/memory/admission/outcome')
  const { describeAdmission } = jest.requireActual('@/lib/memory/admission/describe')
  return {
    admitCandidate: jest.fn((candidate: unknown, resolved: unknown, opts: unknown) =>
      mockAdmitRow(toAdmissionRow(candidate, resolved), opts),
    ),
    admissionInserted: outcome.admissionInserted,
    admissionReinforced: outcome.admissionReinforced,
    describeAdmission,
  }
}

/** An outcome for `mockAdmitRow` to resolve with. */
export function admissionOutcome(
  kind: AdmissionAction['kind'],
  memory: Partial<Memory> | null,
  extra: { linkTo?: string[]; novelDetails?: string[] } = {},
): AdmissionOutcome {
  const into = memory?.id ?? 'unknown'
  const action: AdmissionAction =
    kind === 'insert'
      ? { kind }
      : kind === 'insert-linked'
        ? { kind, linkTo: extra.linkTo ?? [], reason: 'band' }
        : kind === 'reinforce'
          ? { kind, into }
          : kind === 'absorb'
            ? { kind, into }
            : kind === 'promote-and-reinforce'
              ? { kind, into, withFootnotes: true }
              : { kind: 'reject', reason: 'embedding-failed' }
  return {
    action,
    memory: memory as Memory | null,
    novelDetails: extra.novelDetails ?? [],
    linkedIds: extra.linkTo ?? [],
    dryRun: false,
    trace: {
      thresholds: ADMISSION_THRESHOLDS,
      assessments: [],
      embeddingAttempts: 1,
      orphansIgnored: 0,
      searchedK: 5,
      notes: kind === 'reject' ? ['embedding failed after retry (provider down)'] : [],
    },
  }
}
