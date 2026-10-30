'use client'

/**
 * RaisedHandChip — where the operator's raised hand stands.
 *
 * Sits in the composer's chip row beside the pending Informs. While the hand
 * is up it says so (and, once the server has taken it, who is weighing it);
 * afterwards it says how it was answered — a yield, a decline, or a room that
 * fell quiet before anyone was asked — until the operator dismisses it or
 * speaks again. The state lives in `useSSEStreaming` (`RaisedHandStatus`).
 */

import { Icon } from '@/components/ui/icon'
import { Tooltip } from '@/components/ui/Tooltip'
import type { RaisedHandStatus } from '../hooks/useSSEStreaming'

interface RaisedHandChipProps {
  status: RaisedHandStatus | null
  /** Lower a hand that is still up. */
  onLower: () => void
  /** Put away an outcome note. */
  onDismiss: () => void
}

/** The chip's line, and whether its × lowers the hand or dismisses a note. */
function describe(status: RaisedHandStatus): { label: string; lowers: boolean } {
  switch (status.kind) {
    case 'raised':
      return { label: 'Hand raised — the next speaker will be asked to yield', lowers: true }
    case 'asked':
      return { label: `${status.characterName} is weighing your raised hand…`, lowers: false }
    case 'yielded':
      return { label: `${status.characterName} yields the floor — it is yours`, lowers: false }
    case 'declined':
      return { label: `${status.characterName} carried on regardless; your hand is lowered`, lowers: false }
    case 'unasked':
      return { label: 'The room fell quiet before anyone was asked — the floor is yours', lowers: false }
  }
}

export function RaisedHandChip({ status, onLower, onDismiss }: Readonly<RaisedHandChipProps>) {
  // The live region stays mounted so each step is announced as it changes.
  return (
    <div aria-live="polite">
      {status && (() => {
        const { label, lowers } = describe(status)
        const waiting = status.kind === 'asked'
        return (
          <div className="qt-chat-attachment-list mb-2">
            <div className="qt-chat-tool-result-chip" data-hand-state={status.kind}>
              <Icon
                name="hand-raised"
                className="qt-chat-attachment-chip-icon qt-chat-attachment-chip-icon-info"
              />
              <span className="text-foreground">{label}</span>
              {!waiting && (
                <Tooltip content={lowers ? 'Lower your hand' : 'Dismiss'}>
                  <button
                    type="button"
                    onClick={lowers ? onLower : onDismiss}
                    className="qt-chat-attachment-chip-remove"
                    aria-label={lowers ? 'Lower your hand' : 'Dismiss the raised-hand note'}
                  >
                    <Icon name="close" className="w-4 h-4" />
                  </button>
                </Tooltip>
              )}
            </div>
          </div>
        )
      })()}
    </div>
  )
}

export default RaisedHandChip
