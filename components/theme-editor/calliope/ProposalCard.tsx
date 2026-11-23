'use client'

/**
 * One of Calliope's proposals, as the author decides it (Spec J Stage 3): its
 * title and reason, each operation in words (`changeLineText`), what it brings
 * in and mends, and three actions — Try (the live preview wears its result;
 * the draft is untouched), Keep (the editor applies it through its own edit
 * path, one undo step) and Discard. A stale proposal says why and offers to
 * ask her again; a decided one shows its decision.
 *
 * @module components/theme-editor/calliope/ProposalCard
 */

import { useId } from 'react'
import { Icon } from '@/components/ui/icon'
import { changeLineText } from '@/lib/themes/assist/change-set'
import type { ProposalView } from './api'

export interface ProposalCardProps {
  proposal: ProposalView
  /** This proposal is what the preview is wearing. */
  trying: boolean
  /** An action on this card is under way. */
  busy: boolean
  onTry: () => void
  onStopTrying: () => void
  onKeep: () => void
  onDiscard: () => void
  onAskAgain: () => void
}

const STATE_LABEL: Record<ProposalView['state'], string> = {
  offered: 'Proposed',
  kept: 'Kept',
  discarded: 'Discarded',
  stale: 'No longer applies',
}

function ratio(r?: number): string {
  return r === undefined ? 'unchecked' : `${r}:1`
}

export function ProposalCard({ proposal, trying, busy, onTry, onStopTrying, onKeep, onDiscard, onAskAgain }: ProposalCardProps) {
  const titleId = useId()
  const { review, state } = proposal
  const decided = state === 'kept' || state === 'discarded'

  return (
    <article
      aria-labelledby={titleId}
      data-proposal-state={state}
      className={`qt-card p-3 space-y-2 ${trying ? 'qt-border-primary' : ''}`}
    >
      <header className="flex items-start justify-between gap-2">
        <h4 id={titleId} className="qt-text-label">{proposal.title}</h4>
        <span className={`qt-badge ${trying ? 'qt-badge-primary' : state === 'stale' ? 'qt-badge-outline' : state === 'kept' ? 'qt-badge-success' : 'qt-badge-secondary'} flex-shrink-0`}>
          {trying ? 'Trying' : STATE_LABEL[state]}
        </span>
      </header>

      {!decided && <p className="qt-text-xs qt-text-secondary">{proposal.reason}</p>}

      {review && (
        <>
          <ul className="qt-text-xs space-y-0.5 list-disc pl-4" aria-label="What it does">
            {review.lines.map((line, i) => (
              <li key={i} className="break-words">{changeLineText(line)}</li>
            ))}
          </ul>
          {review.contrastWorse.length > 0 && (
            <div className="qt-alert-warning qt-text-xs" role="note">
              <p className="qt-text-label-xs">Contrast it breaks</p>
              <ul className="list-disc pl-4">
                {review.contrastWorse.map((c) => (
                  <li key={`${c.foreground}|${c.background}|${c.mode}`}>
                    {c.foreground} on {c.background} ({c.mode}): {ratio(c.before.ratio)} → {ratio(c.after.ratio)}, needs {c.threshold}:1
                  </li>
                ))}
              </ul>
            </div>
          )}
          {review.warnings.length > 0 && (
            <div className="qt-alert-warning qt-text-xs" role="note">
              <p className="qt-text-label-xs">Warnings it brings in</p>
              <ul className="list-disc pl-4">
                {review.warnings.map((w, i) => (
                  <li key={i} className="break-words">{w.message}</li>
                ))}
              </ul>
            </div>
          )}
          {(review.contrastFixed.length > 0 || review.removed.length > 0) && (
            <p className="qt-text-xs qt-text-success">
              Mends {review.contrastFixed.length > 0 ? `${review.contrastFixed.length} contrast ${review.contrastFixed.length === 1 ? 'pair' : 'pairs'}` : ''}
              {review.contrastFixed.length > 0 && review.removed.length > 0 ? ' and ' : ''}
              {review.removed.length > 0 ? `${review.removed.length} ${review.removed.length === 1 ? 'issue' : 'issues'}` : ''}.
            </p>
          )}
          {proposal.draftChanged && (
            <p className="qt-text-xs qt-text-muted">The draft has changed since she proposed this; it still applies.</p>
          )}
        </>
      )}

      {state === 'stale' && (
        <div className="space-y-2">
          <p className="qt-text-xs qt-text-secondary">The draft has changed and this no longer applies: {proposal.staleReason}</p>
          <button type="button" className="qt-button qt-button-secondary qt-button-sm" onClick={onAskAgain}>
            Ask her again
          </button>
        </div>
      )}

      {state === 'offered' && (
        <div className="flex flex-wrap gap-2" role="group" aria-label={`Decide on ${proposal.title}`}>
          {trying ? (
            <button type="button" className="qt-button qt-button-secondary qt-button-sm" onClick={onStopTrying} disabled={busy}>
              <Icon name="eye-off" className="w-4 h-4" />
              <span className="ml-1">Stop trying</span>
            </button>
          ) : (
            <button type="button" className="qt-button qt-button-secondary qt-button-sm" onClick={onTry} disabled={busy}>
              <Icon name="eye" className="w-4 h-4" />
              <span className="ml-1">Try</span>
            </button>
          )}
          <button type="button" className="qt-button qt-button-primary qt-button-sm" onClick={onKeep} disabled={busy}>
            <Icon name="check" className="w-4 h-4" />
            <span className="ml-1">Keep</span>
          </button>
          <button type="button" className="qt-button qt-button-ghost qt-button-sm" onClick={onDiscard} disabled={busy}>
            Discard
          </button>
        </div>
      )}
    </article>
  )
}
