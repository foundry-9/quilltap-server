'use client'

import { memo } from 'react'
import { Icon } from '@/components/ui/icon'
import { MentionChip } from '@/components/chat/MentionChip'
import { useAbsentMentions } from '@/hooks/useAbsentMentions'
import { useAtlasMentions } from '@/hooks/useAtlasMentions'
import { formatMessageTime } from '@/lib/format-time'
import {
  getAnnouncementSenderName,
  getSystemKindDisplayLabel,
  getInterventionSummary,
  getAnnouncementImportance,
  getAnnouncementOutcomeState,
  getAnnouncementAccentClasses,
} from './system-message-labels'
import type { Message } from '../types'

/**
 * Render the whisper audience of an announcement as a compact "to Alice, Bob"
 * tag, or nothing at all when the announcement is public. Collapsed to a chip,
 * an announcement shows none of the message body's whisper chrome — without
 * this the operator cannot tell a private aside from a public proclamation
 * until they expand it, which is precisely the distinction they need at a
 * glance.
 */
function WhisperTag({
  message,
  participantNames,
}: {
  message: Message
  participantNames?: Record<string, string>
}) {
  const targets = message.targetParticipantIds
  if (!targets || targets.length === 0) return null
  const names = targets.map(id => participantNames?.[id] || 'unknown').join(', ')
  return (
    <span className="qt-chat-system-bar-whisper" title={`Whispered to ${names}`}>
      <span className="sr-only">whispered </span>
      to {names}
    </span>
  )
}

/**
 * Shared inner contents of a Staff-authored announcement summary: an importance
 * dot, the sender name, an optional kind label, an optional whisper audience,
 * the timestamp, and a chevron. Rendered both inside packed collapsed chips
 * ({@link AnnouncementChip}) and at the top of an expanded announcement
 * (MessageRow's expanded header), so the dot/sender/kind/time line stays
 * defined in exactly one place.
 *
 * A Pascal roll outcome swaps the importance dot for the outcome's own state —
 * the reader wants to know whether the table dealt a success or a failure, not
 * that Pascal is generically important.
 */
export const AnnouncementBarContents = memo(function AnnouncementBarContents({
  message,
  expanded = false,
  participantNames,
  announcerNames,
}: {
  message: Message
  /** When true, render the down-chevron (collapse affordance) instead of the right-chevron. */
  expanded?: boolean
  /** Participant id → display name, for naming a whisper's audience. */
  participantNames?: Record<string, string>
  /** Character id → name, for naming a `customAnnouncer` in place of the Staff member. */
  announcerNames?: Record<string, string>
}) {
  const senderName = getAnnouncementSenderName(message, announcerNames)
  const kindLabel = getSystemKindDisplayLabel(message)
  const outcomeState = getAnnouncementOutcomeState(message)
  const adjusted = getInterventionSummary(message)
  const importance = getAnnouncementImportance(message)
  const dotModifier = outcomeState
    ? `qt-chat-announcement-dot-outcome-${outcomeState}`
    : `qt-chat-announcement-dot-${importance}`
  return (
    <>
      <span className={`qt-chat-announcement-dot ${dotModifier}`} aria-hidden="true" />
      <span className="qt-chat-system-bar-sender">{senderName}</span>
      {/* The state is carried by colour alone in the bar; name it for readers
          who can't see the accent (and for anyone skimming with a screen reader). */}
      {outcomeState && <span className="sr-only">{outcomeState}</span>}
      {kindLabel && <span className="qt-chat-system-bar-kind">{kindLabel}</span>}
      {adjusted && (
        <span className="qt-intervention-badge" title={adjusted}>
          <Icon name="hand-raised" className="w-3 h-3" aria-hidden="true" />
          <span className="sr-only">{adjusted}</span>
        </span>
      )}
      <WhisperTag message={message} participantNames={participantNames} />
      <span className="qt-chat-system-bar-time">{formatMessageTime(message.createdAt)}</span>
      <Icon
        name={expanded ? 'chevron-down' : 'chevron-right'}
        className={`qt-chat-system-bar-chevron${expanded ? ' qt-chat-system-bar-chevron-down' : ''}`}
        aria-hidden="true"
      />
    </>
  )
})

/**
 * The name chips whose first mention in the chat falls in a collapsed
 * announcement — most often the Host's scenario row, where a thing or an
 * absent character is usually first named. The body is hidden, so the chips
 * would be too; they are drawn beside the bar instead, each labelled with the
 * name on its card. They are siblings of the bar's button, never inside it (a
 * chip is a control of its own).
 */
function CollapsedMentionChips({
  people,
  things,
}: {
  people: ReturnType<typeof useAbsentMentions>
  things: ReturnType<typeof useAtlasMentions>
}) {
  return (
    <>
      {people.map(m => (
        <MentionChip key={`person-${m.characterId}`} mention={m}>{m.card.name}</MentionChip>
      ))}
      {things.map(m => (
        <MentionChip key={`thing-${m.entryId}`} mention={m}>{m.card.name}</MentionChip>
      ))}
    </>
  )
}

/**
 * A single collapsed announcement rendered as a content-width chip. Keeps the
 * `id` / `data-message-id` so deep-link and delete-next-focus scroll-to-message
 * (page.tsx, useMessageActions) still resolve. Clicking expands it. Name chips
 * first mentioned in it ride beside it (see {@link CollapsedMentionChips}).
 */
export const AnnouncementChip = memo(function AnnouncementChip({
  message,
  chatId,
  onToggleExpanded,
  participantNames,
  announcerNames,
}: {
  message: Message
  /** The chat, for the name chips first mentioned in this announcement. */
  chatId?: string
  onToggleExpanded: (messageId: string) => void
  participantNames?: Record<string, string>
  announcerNames?: Record<string, string>
}) {
  const accent = getAnnouncementAccentClasses(message)
  const isWhisper = !!message.targetParticipantIds?.length
  const people = useAbsentMentions(chatId, message.id)
  const things = useAtlasMentions(chatId, message.id)
  const bar = (
    <button
      type="button"
      id={`message-${message.id}`}
      data-message-id={message.id}
      onClick={() => onToggleExpanded(message.id)}
      className={`qt-chat-announcement-chip${accent ? ` ${accent}` : ''}${
        isWhisper ? ' qt-chat-announcement-chip-whisper' : ''
      }`}
      aria-expanded={false}
    >
      <AnnouncementBarContents
        message={message}
        participantNames={participantNames}
        announcerNames={announcerNames}
      />
    </button>
  )
  // No chips: the bar alone, exactly as before.
  if (people.length === 0 && things.length === 0) return bar
  return (
    <span className="qt-chat-announcement-chip-wrap">
      {bar}
      <CollapsedMentionChips people={people} things={things} />
    </span>
  )
})

/**
 * A run of consecutive collapsed announcements, packed into a single flex-wrap
 * row of chips. Occupies one virtualized render-item.
 */
export const AnnouncementGroup = memo(function AnnouncementGroup({
  members,
  chatId,
  onToggleSystemMessageExpanded,
  participantNames,
  announcerNames,
}: {
  members: { message: Message }[]
  /** The chat, for the name chips first mentioned in a collapsed announcement. */
  chatId?: string
  onToggleSystemMessageExpanded: (messageId: string) => void
  participantNames?: Record<string, string>
  announcerNames?: Record<string, string>
}) {
  return (
    <div className="qt-chat-announcement-group">
      {members.map(({ message }) => (
        <AnnouncementChip
          key={message.id}
          message={message}
          chatId={chatId}
          onToggleExpanded={onToggleSystemMessageExpanded}
          participantNames={participantNames}
          announcerNames={announcerNames}
        />
      ))}
    </div>
  )
})
