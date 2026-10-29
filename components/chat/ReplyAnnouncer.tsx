'use client'

/**
 * Reply Announcer
 *
 * A visually hidden polite live region that tells a screen reader when a
 * character's reply lands in the Salon (WCAG 4.1.3). The message list itself
 * is virtualized — rows mount and unmount as you scroll — so marking it
 * `role="log"` would re-announce old messages; this region speaks only for
 * replies that arrive after the chat has loaded.
 *
 * @module components/chat/ReplyAnnouncer
 */

import { useEffect, useRef, useState } from 'react'

const MAX_SPOKEN_CHARS = 300

interface AnnounceableMessage {
  id: string
  role: string
  content: string
  participantId?: string | null
  systemSender?: string | null
}

interface ReplyAnnouncerProps {
  messages: readonly AnnounceableMessage[]
  /** Display name for a participant id, or undefined when unknown. */
  nameFor: (participantId: string | null | undefined) => string | undefined
}

function spokenText(content: string): string {
  const flat = content.replace(/\s+/g, ' ').trim()
  return flat.length > MAX_SPOKEN_CHARS ? `${flat.slice(0, MAX_SPOKEN_CHARS)}…` : flat
}

export function ReplyAnnouncer({ messages, nameFor }: ReplyAnnouncerProps) {
  const [announcement, setAnnouncement] = useState('')
  // undefined until the first render with messages, so the history that is
  // already there when the chat opens is never read out.
  const lastSeenIdRef = useRef<string | null | undefined>(undefined)

  let latest: AnnounceableMessage | undefined
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'ASSISTANT' && !m.systemSender) {
      latest = m
      break
    }
  }

  useEffect(() => {
    const latestId = latest?.id ?? null
    if (lastSeenIdRef.current === undefined) {
      lastSeenIdRef.current = latestId
      return
    }
    if (!latest || latestId === lastSeenIdRef.current) return
    lastSeenIdRef.current = latestId
    const name = nameFor(latest.participantId) ?? 'A character'
    setAnnouncement(`${name} replied: ${spokenText(latest.content)}`)
  }, [latest, nameFor])

  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {announcement}
    </div>
  )
}
