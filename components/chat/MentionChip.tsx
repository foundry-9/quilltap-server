'use client'

/**
 * A chip on an absent character's name, at its first mention in a chat.
 *
 * Hovering it shows their card — name, aliases, pronouns and identity — the
 * same particulars the model is given in its referent ledger. Click pins the
 * card open so a long identity can be scrolled and read. The chips replace the
 * Host's old introduction card in the conversation.
 *
 * Marked runs reach here from `MessageContent` through
 * {@link MentionChipsContext}; see `lib/chat/mention-markers.ts` for how a
 * name is marked without breaking the roleplay styling around it.
 */

import { createContext, useContext, type ReactNode } from 'react'
import { Tooltip } from '@/components/ui/Tooltip'
import { MENTION_OPEN, splitMentionMarkers } from '@/lib/chat/mention-markers'

/** One chip, as `?action=absent-mentions` returns it (less the message id). */
export interface AbsentMentionChip {
  characterId: string
  /** The name or alias exactly as written in the message. */
  text: string
  card: {
    name: string
    aliases: string[]
    pronouns: string | null
    body: string
  }
}

/** The chips for the message being rendered, indexed as the markers number them. */
export const MentionChipsContext = createContext<ReadonlyArray<AbsentMentionChip> | null>(null)

function MentionCard({ card }: { card: AbsentMentionChip['card'] }) {
  return (
    <div className="qt-tooltip-body">
      <div className="qt-tooltip-title">{card.name}</div>
      {card.aliases.length > 0 && (
        <div className="qt-tooltip-section">
          <div className="qt-tooltip-section-label">Also known as</div>
          <div>{card.aliases.join(', ')}</div>
        </div>
      )}
      {card.pronouns && (
        <div className="qt-tooltip-section">
          <div className="qt-tooltip-section-label">Pronouns</div>
          <div>{card.pronouns}</div>
        </div>
      )}
      {card.body && (
        <div className="qt-tooltip-section">
          <div className="qt-tooltip-quote">{card.body}</div>
        </div>
      )}
      <div className="qt-tooltip-hint">Not in this conversation · click to pin</div>
    </div>
  )
}

export function MentionChip({ mention, children }: { mention: AbsentMentionChip; children: ReactNode }) {
  return (
    <Tooltip content={<MentionCard card={mention.card} />} interactive pinnable delay={250}>
      <span
        className="qt-mention-chip"
        tabIndex={0}
        role="button"
        aria-label={`${mention.card.name}, not in this conversation`}
      >
        {children}
      </span>
    </Tooltip>
  )
}

/** Renders marked text: plain runs as text, marked names as chips. */
function MentionText({ text }: { text: string }) {
  const chips = useContext(MentionChipsContext)
  const runs = splitMentionMarkers(text)
  return (
    <>
      {runs.map((run, i) => {
        if (typeof run === 'string') return run
        const mention = chips?.[run.index]
        return mention
          ? <MentionChip key={i} mention={mention}>{run.text}</MentionChip>
          : run.text
      })}
    </>
  )
}

/**
 * A text run for the message renderer: unchanged unless it carries a mention
 * marker, in which case the marked names become chips.
 */
export function withMentionChips(text: string, key?: string | number): ReactNode {
  return text.includes('') ? <MentionText key={key} text={text} /> : text
}
