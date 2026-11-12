'use client'

/**
 * The chat sidebar's "Things named" card: every Atlas entry the chat has
 * named so far, in the order they were first named.
 *
 * A thing's chip sits only on its first mention, which may be hundreds of
 * messages back or inside the Host's collapsed scenario row; this card is the
 * way to find them all without scrolling. Each row shows the entry's picture
 * and name (and the word it was named by, when that is not the name), opens
 * the entry's card on hover or focus, and on click asks the Salon to reveal
 * the first mention (`requestMessageReveal`, which also expands a collapsed
 * announcement).
 *
 * The list is the same `?action=atlas-mentions` read the chips use (see
 * `hooks/useAtlasMentions.ts`), passed in by the sidebar so the card is drawn
 * only when there is something in it.
 */

import { Icon } from '@/components/ui/icon'
import { Tooltip } from '@/components/ui/Tooltip'
import { AtlasCardView } from '@/components/chat/MentionChip'
import { requestMessageReveal } from '@/lib/chat/message-navigation'
import type { AtlasMention } from '@/lib/schemas/atlas.types'

/** True when the term as written differs from the entry's name (ignoring case). */
function namedOtherwise(mention: AtlasMention): boolean {
  return mention.text.trim().toLocaleLowerCase() !== mention.card.name.trim().toLocaleLowerCase()
}

export function ChatThingsNamed({
  chatId,
  mentions,
  onRevealed,
}: {
  chatId: string
  /** The chat's Atlas mentions, first mention per entry, in message order. */
  mentions: ReadonlyArray<AtlasMention>
  /** Called after a reveal is requested (an overlay sidebar closes itself). */
  onRevealed?: () => void
}) {
  if (mentions.length === 0) return null
  return (
    <ul className="qt-chat-things-list" aria-label="Things from the Atlas named in this chat">
      {mentions.map((mention) => (
        <li key={mention.entryId}>
          <Tooltip
            content={<AtlasCardView card={mention.card} hint="click to go to its first mention" />}
            delay={250}
            anchorClassName="qt-chat-things-anchor"
          >
            <button
              type="button"
              className="qt-chat-things-item"
              onClick={() => {
                requestMessageReveal(chatId, mention.messageId)
                onRevealed?.()
              }}
              aria-label={`${mention.card.name}: go to where it is first named`}
            >
              {mention.card.imageFileId ? (
                <img
                  className="qt-chat-things-thumb"
                  src={`/api/v1/files/${mention.card.imageFileId}?action=thumbnail`}
                  alt=""
                />
              ) : (
                <span className="qt-chat-things-thumb qt-chat-things-thumb-empty" aria-hidden="true">
                  <Icon name="atlas" className="w-4 h-4" />
                </span>
              )}
              <span className="qt-chat-things-text">
                <span className="qt-chat-things-name">{mention.card.name}</span>
                {namedOtherwise(mention) && (
                  <span className="qt-chat-things-term">as “{mention.text}”</span>
                )}
              </span>
            </button>
          </Tooltip>
        </li>
      ))}
    </ul>
  )
}

export default ChatThingsNamed
