'use client'

/**
 * The chat sidebar's "Concepts Named" card: every character not in the chat
 * and every Atlas entry the chat has named so far — the same people and
 * things that wear a chip in the transcript — each in the order first named.
 *
 * A chip sits only on its first mention, which may be hundreds of messages
 * back or inside the Host's collapsed scenario row; this card is the way to
 * find them all without scrolling. Each row shows a picture (the character's
 * portrait or the entry's current picture) and the name, plus the word it was
 * named by when that is not the name; it opens the same card as the chip on
 * hover or focus, and on click asks the Salon to reveal the first mention
 * (`requestMessageReveal`, which also expands a collapsed announcement).
 *
 * The lists are the chips' own reads (`useChatAbsentMentions`,
 * `useChatAtlasMentions`), passed in by the sidebar so the card is drawn only
 * when there is something in it.
 */

import type { ReactNode } from 'react'
import { Icon } from '@/components/ui/icon'
import { Tooltip } from '@/components/ui/Tooltip'
import { AbsentCharacterCardView, AtlasCardView } from '@/components/chat/MentionChip'
import { requestMessageReveal } from '@/lib/chat/message-navigation'
import type { ChatAbsentMention } from '@/hooks/useAbsentMentions'
import type { AtlasMention } from '@/lib/schemas/atlas.types'

const REVEAL_HINT = 'click to go to its first mention'

/** True when the term as written differs from the name (ignoring case). */
function namedOtherwise(text: string, name: string): boolean {
  return text.trim().toLocaleLowerCase() !== name.trim().toLocaleLowerCase()
}

/** One row: a picture, the name, the word it went by; hover for the card, click to go. */
function ConceptRow({
  chatId,
  messageId,
  name,
  text,
  imageSrc,
  fallbackIcon,
  card,
  onRevealed,
}: {
  chatId: string
  messageId: string
  name: string
  text: string
  /** The picture's URL, if there is one. */
  imageSrc: string | null | undefined
  fallbackIcon: 'atlas' | 'user'
  card: ReactNode
  onRevealed?: () => void
}) {
  return (
    <li>
      <Tooltip content={card} delay={250} anchorClassName="qt-chat-concepts-anchor">
        <button
          type="button"
          className="qt-chat-concepts-item"
          onClick={() => {
            requestMessageReveal(chatId, messageId)
            onRevealed?.()
          }}
          aria-label={`${name}: go to where it is first named`}
        >
          {imageSrc ? (
            <img
              className="qt-chat-concepts-thumb"
              src={imageSrc}
              alt=""
            />
          ) : (
            <span className="qt-chat-concepts-thumb qt-chat-concepts-thumb-empty" aria-hidden="true">
              <Icon name={fallbackIcon} className="w-4 h-4" />
            </span>
          )}
          <span className="qt-chat-concepts-text">
            <span className="qt-chat-concepts-name">{name}</span>
            {namedOtherwise(text, name) && <span className="qt-chat-concepts-term">as “{text}”</span>}
          </span>
        </button>
      </Tooltip>
    </li>
  )
}

/** A labelled group of rows; nothing when empty. */
function ConceptGroup({ label, children, count }: { label: string; children: ReactNode; count: number }) {
  if (count === 0) return null
  return (
    <section className="qt-chat-concepts-group" aria-label={label}>
      <div className="qt-chat-concepts-group-label" aria-hidden="true">{label}</div>
      <ul className="qt-chat-concepts-list">{children}</ul>
    </section>
  )
}

export function ChatConceptsNamed({
  chatId,
  people,
  things,
  onRevealed,
}: {
  chatId: string
  /** Characters not in the chat whom it names, first mention each, in message order. */
  people: ReadonlyArray<ChatAbsentMention>
  /** Atlas entries the chat names, first mention each, in message order. */
  things: ReadonlyArray<AtlasMention>
  /** Called after a reveal is requested (an overlay sidebar closes itself). */
  onRevealed?: () => void
}) {
  if (people.length === 0 && things.length === 0) return null
  return (
    <div className="qt-chat-concepts">
      <ConceptGroup label="Characters not here" count={people.length}>
        {people.map((m) => (
          <ConceptRow
            key={`person-${m.characterId}`}
            chatId={chatId}
            messageId={m.messageId}
            name={m.card.name}
            text={m.text}
            imageSrc={m.avatarUrl}
            fallbackIcon="user"
            card={<AbsentCharacterCardView card={m.card} hint={REVEAL_HINT} />}
            onRevealed={onRevealed}
          />
        ))}
      </ConceptGroup>
      <ConceptGroup label="From the Atlas" count={things.length}>
        {things.map((m) => (
          <ConceptRow
            key={`thing-${m.entryId}`}
            chatId={chatId}
            messageId={m.messageId}
            name={m.card.name}
            text={m.text}
            imageSrc={m.card.imageFileId ? `/api/v1/files/${m.card.imageFileId}?action=thumbnail` : null}
            fallbackIcon="atlas"
            card={<AtlasCardView card={m.card} hint={REVEAL_HINT} />}
            onRevealed={onRevealed}
          />
        ))}
      </ConceptGroup>
    </div>
  )
}

export default ChatConceptsNamed
