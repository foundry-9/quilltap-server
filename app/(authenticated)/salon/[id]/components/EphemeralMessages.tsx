'use client'

import { EphemeralMessage, type EphemeralMessageData } from '@/components/chat/EphemeralMessage'

interface EphemeralMessagesProps {
  messages: EphemeralMessageData[]
  onDismiss: (messageId: string) => void
}

export function EphemeralMessages({ messages, onDismiss }: EphemeralMessagesProps) {
  if (messages.length === 0) {
    return null
  }

  return (
    <>
      {messages.map((em) => (
        <EphemeralMessage
          key={em.id}
          message={em}
          onDismiss={onDismiss}
        />
      ))}
    </>
  )
}
