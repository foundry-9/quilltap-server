'use client'

import { memo } from 'react'
import { formatMessageTime } from '@/lib/format-time'
import {
  getSystemSenderDisplayName,
  getSystemKindDisplayLabel,
  getAnnouncementImportance,
} from './system-message-labels'
import type { Message } from '../types'

/**
 * Shared inner contents of a Staff-authored announcement summary: an importance
 * dot, the sender name, an optional kind label, the timestamp, and a chevron.
 * Rendered both inside packed collapsed chips ({@link AnnouncementChip}) and at
 * the top of an expanded announcement (MessageRow's expanded header), so the
 * dot/sender/kind/time line stays defined in exactly one place.
 */
export const AnnouncementBarContents = memo(function AnnouncementBarContents({
  message,
  expanded = false,
}: {
  message: Message
  /** When true, render the down-chevron (collapse affordance) instead of the right-chevron. */
  expanded?: boolean
}) {
  const senderName = getSystemSenderDisplayName(message.systemSender)
  const kindLabel = getSystemKindDisplayLabel(message)
  const importance = getAnnouncementImportance(message)
  return (
    <>
      <span
        className={`qt-chat-announcement-dot qt-chat-announcement-dot-${importance}`}
        aria-hidden="true"
      />
      <span className="qt-chat-system-bar-sender">{senderName}</span>
      {kindLabel && <span className="qt-chat-system-bar-kind">{kindLabel}</span>}
      <span className="qt-chat-system-bar-time">{formatMessageTime(message.createdAt)}</span>
      <svg
        className={`qt-chat-system-bar-chevron${expanded ? ' qt-chat-system-bar-chevron-down' : ''}`}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        {expanded ? (
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        ) : (
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        )}
      </svg>
    </>
  )
})

/**
 * A single collapsed announcement rendered as a content-width chip. Keeps the
 * `id` / `data-message-id` so deep-link and delete-next-focus scroll-to-message
 * (page.tsx, useMessageActions) still resolve. Clicking expands it.
 */
export const AnnouncementChip = memo(function AnnouncementChip({
  message,
  onToggleExpanded,
}: {
  message: Message
  onToggleExpanded: (messageId: string) => void
}) {
  const senderName = getSystemSenderDisplayName(message.systemSender)
  const kindLabel = getSystemKindDisplayLabel(message)
  return (
    <button
      type="button"
      id={`message-${message.id}`}
      data-message-id={message.id}
      onClick={() => onToggleExpanded(message.id)}
      className="qt-chat-announcement-chip"
      aria-expanded={false}
      aria-label={`Expand ${senderName}${kindLabel ? ` ${kindLabel}` : ''} message`}
    >
      <AnnouncementBarContents message={message} />
    </button>
  )
})

/**
 * A run of consecutive collapsed announcements, packed into a single flex-wrap
 * row of chips. Occupies one virtualized render-item.
 */
export const AnnouncementGroup = memo(function AnnouncementGroup({
  members,
  onToggleSystemMessageExpanded,
}: {
  members: { message: Message }[]
  onToggleSystemMessageExpanded: (messageId: string) => void
}) {
  return (
    <div className="qt-chat-announcement-group">
      {members.map(({ message }) => (
        <AnnouncementChip
          key={message.id}
          message={message}
          onToggleExpanded={onToggleSystemMessageExpanded}
        />
      ))}
    </div>
  )
})
