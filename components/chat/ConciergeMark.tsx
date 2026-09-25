'use client'

/**
 * ConciergeMark — the little asterisk that marks a chat's Concierge state on
 * every list in the house: the homepage's Recent Chats, the Salon list, a
 * character's Conversations, a Prospero project's chats.
 *
 * It reads the derived state, never a stored column, so the two states other
 * than Moderated each get their own tone: red for the uncensored desk, grey
 * for a chat locked to the ordinary desks. Who set Unmoderated — you or the
 * Concierge — is in the bubble, never the colour. Moderated is the default and
 * wears nothing — the mark means "something other than the default is in
 * force," exactly as the Salon header's pill does.
 *
 * The words come from the presentation table, so the mark, the pill and the
 * sidebar all say the same thing. The bubble is Quilltap's own Tooltip rather
 * than a native `title`: under the Electron shell the OS widget is unreliable,
 * which is why the Salon's message buttons already moved off it.
 */

import { Tooltip } from '@/components/ui/Tooltip'
import {
  CONCIERGE_STATE_PRESENTATION,
  conciergeToneSuffix,
  describeConciergeState,
  type ConciergeStateDescription,
} from '@/lib/services/dangerous-content/concierge-state-presentation'
import type { ConciergeProvenance, ConciergeState } from '@/lib/services/dangerous-content/chat-override'
import type { ConciergeModeReason } from '@/lib/schemas/chat.types'

/**
 * The tooltip's contents — title, the full sentence, the classifier's
 * categories when there are any, and where to change the state. Exported so
 * the Salon header's badge can put the identical bubble on the identical
 * words.
 */
export function ConciergeTooltipBody({ title, detail, categories, hint }: ConciergeStateDescription) {
  return (
    <div className="qt-tooltip-body">
      <p className="qt-tooltip-title">{title}</p>
      <p>{detail}</p>
      {categories && (
        <div className="qt-tooltip-section">
          <p className="qt-tooltip-section-label">Categories</p>
          <p className="qt-tooltip-quote">{categories.join(', ')}</p>
        </div>
      )}
      <p className="qt-tooltip-hint">{hint}</p>
    </div>
  )
}

export interface ConciergeMarkProps {
  /** The derived state. Moderated renders nothing at all. */
  conciergeState: ConciergeState
  /** Who set the state; picks the bubble's sentence for Unmoderated. */
  conciergeSetBy?: ConciergeProvenance
  /** Why the state was set; the Concierge's sentence names it. */
  conciergeReason?: ConciergeModeReason | null
  /** The classifier's categories; surfaced on the bubble when the classifier moved the chat. */
  dangerCategories?: string[]
  /** Extra classes for the mark itself (sizing, flex behaviour). */
  className?: string
}

export function ConciergeMark({ conciergeState, conciergeSetBy, conciergeReason, dangerCategories, className = '' }: ConciergeMarkProps) {
  if (conciergeState === 'moderated') {
    return null
  }

  const { label, tone } = CONCIERGE_STATE_PRESENTATION[conciergeState]
  const description = describeConciergeState(
    conciergeState,
    { setBy: conciergeSetBy, reason: conciergeReason },
    dangerCategories,
  )
  // Danger is the base rule, so its suffix is empty — don't emit the base
  // class twice for it.
  const toneSuffix = conciergeToneSuffix(tone)
  const classes = [
    'qt-concierge-mark',
    toneSuffix ? `qt-concierge-mark${toneSuffix}` : '',
    className,
  ].filter(Boolean).join(' ')

  return (
    <Tooltip content={<ConciergeTooltipBody {...description} />} placement="top">
      {/*
        Deliberately not focusable and not pinnable: the mark sits inside a
        <Link>, so a click must reach the link and navigate, and a focusable
        child of a link is worse than the tooltip gap it would close. Keyboard
        users get the aria-label; the sidebar's Chat section is the full-text
        home of the same words.
      */}
      <span
        role="img"
        aria-label={`Concierge: ${label}`}
        className={classes}
      >
        *
      </span>
    </Tooltip>
  )
}

export default ConciergeMark
