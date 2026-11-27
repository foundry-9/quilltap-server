'use client'

/**
 * ConsoleBubble — one row of a console transcript in the shared `qt-help-*`
 * chat-bubble style: the speaker's avatar (assistant side only), the bubble's
 * tail, then whatever the bubble holds. The Help chat and the Brahma Console
 * draw their rows through it; each supplies its own avatar and contents.
 *
 * @module components/help-chat/ConsoleBubble
 */

import type { ReactNode } from 'react'

interface ConsoleBubbleProps {
  side: 'user' | 'assistant'
  /** Drawn before the tail on the assistant side; ignored for the user. */
  avatar?: ReactNode
  children: ReactNode
}

export function ConsoleBubble({ side, avatar, children }: ConsoleBubbleProps) {
  const isUser = side === 'user'
  return (
    <div className={`flex items-start ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {!isUser && avatar}
      <svg
        className={`qt-help-tail ${isUser ? 'qt-help-tail-user' : 'qt-help-tail-assistant'}`}
        viewBox="0 0 10 16"
        fill="currentColor"
      >
        {isUser ? <path d="M0 0 L10 8 L0 16 Z" /> : <path d="M10 0 L0 8 L10 16 Z" />}
      </svg>
      {children}
    </div>
  )
}
