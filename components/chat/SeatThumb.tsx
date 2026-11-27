'use client'

/**
 * A seat's round avatar thumbnail, and the seat shape the Salon's
 * audience pickers (Inform, Insert Announcement) offer.
 *
 * The thumbnail honours quick-hide: with images hidden, or no avatar, it is
 * a plain disc of the same size.
 */

import { useImagesHidden } from '@/components/quick-hide/images-hidden-context'

/** A current participant of the chat, offered as an audience target. */
export interface AudienceCandidate {
  /** CHAT PARTICIPANT id — never a character id. This is what gets persisted as a target. */
  participantId: string
  name: string
  controlledBy: 'llm' | 'user'
  avatarUrl?: string | null
  status?: 'active' | 'silent' | 'absent' | 'removed'
}

interface SeatThumbProps {
  avatarUrl?: string | null
  /** Tailwind width and height, e.g. `w-6 h-6`. */
  sizeClass: string
}

export function SeatThumb({ avatarUrl, sizeClass }: Readonly<SeatThumbProps>) {
  const imagesHidden = useImagesHidden()
  return avatarUrl && !imagesHidden ? (
    <img src={avatarUrl} alt="" className={`${sizeClass} rounded-full object-cover flex-shrink-0`} />
  ) : (
    <div className={`${sizeClass} rounded-full qt-bg-secondary flex-shrink-0`} />
  )
}
