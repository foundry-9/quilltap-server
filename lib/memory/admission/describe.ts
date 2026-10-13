/**
 * One debug-log line for an admission, built from its outcome and trace — the
 * extraction debug log stores this rather than strings each writer assembled.
 *
 * Pure; safe anywhere.
 *
 * @module memory/admission/describe
 */

import type { AdmissionOutcome, NeighbourAssessment } from './types'

function neighbourNote(a: NeighbourAssessment): string {
  const verdict = a.verdict === 'excluded' ? `excluded:${a.excludedBy}` : a.verdict
  return `${a.id.slice(0, 8)} ${a.cosine.toFixed(3)} ${verdict}${a.via ? ` via ${a.via.slice(0, 8)}` : ''}`
}

/** `[Memory] <what happened> <label> … — <summary> · <neighbours>` */
export function describeAdmission(outcome: AdmissionOutcome, label: string, summary: string): string {
  const { action, memory, trace } = outcome
  const prefix = outcome.dryRun ? '[Memory] DRY-RUN' : '[Memory]'
  const id = memory?.id ?? (('into' in action && action.into) || 'unknown')
  let head: string
  switch (action.kind) {
    case 'insert':
      head = `Created ${label}`
      break
    case 'insert-linked':
      head = `Created ${label} (linked to ${outcome.linkedIds.length || action.linkTo.length} related, ${action.reason})`
      break
    case 'reinforce':
      head = `REINFORCED ${label}: ${id} (count ${memory?.reinforcementCount ?? '?'}, +${outcome.novelDetails.length} details)`
      break
    case 'promote-and-reinforce':
      head = `REINFORCED ${label}: ${id} (promoted from cold, count ${memory?.reinforcementCount ?? '?'})`
      break
    case 'absorb': {
      const best = trace.assessments.find((a) => a.id === action.into)
      head =
        `SKIPPED near-duplicate ${label}: absorbed into ${id} ` +
        `(similarity ${best ? best.cosine.toFixed(3) : 'n/a'}${action.redirectedFrom ? `, via ${action.redirectedFrom}` : ''})`
      break
    }
    case 'reject':
      head =
        action.reason === 'embedding-failed'
          ? `SKIPPED ${label} — embedding generation failed: ${trace.notes.at(-1) ?? 'unknown'}`
          : `SKIPPED ${label} — no usable text`
      break
  }
  const neighbours = trace.assessments.filter((a) => a.verdict !== 'below').map(neighbourNote)
  return `${prefix} ${head} — ${summary}${neighbours.length > 0 ? ` · ${neighbours.join('; ')}` : ''}`
}
