'use client'

/**
 * Chats Tab
 *
 * Displays project chats with remove functionality.
 */

import Link from 'next/link'
import type { ProjectChat } from '../types'

interface ChatsTabProps {
  projectId: string
  chats: ProjectChat[]
  onRemoveChat: (chatId: string) => void
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

export function ChatsTab({ projectId, chats, onRemoveChat }: ChatsTabProps) {
  if (chats.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p>No chats in this project yet.</p>
        <p className="text-sm mt-2">
          <Link
            href={`/salon/new?projectId=${projectId}`}
            className="text-primary hover:underline"
          >
            Create a new chat
          </Link>{' '}
          or add existing chats from chat settings.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {chats.map((chat) => (
        <div key={chat.id} className="qt-entity-card flex items-center justify-between">
          <div>
            <Link href={`/salon/${chat.id}`} className="font-medium hover:text-primary">
              {chat.title || 'Untitled Chat'}
            </Link>
            <p className="qt-text-small">
              {chat.messageCount} message{chat.messageCount !== 1 ? 's' : ''} &bull;{' '}
              {chat.participants.map(p => p.name).join(', ')}
            </p>
          </div>
          <button
            onClick={() => onRemoveChat(chat.id)}
            className="text-muted-foreground hover:text-destructive"
            title="Remove from project"
          >
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>
      ))}
    </div>
  )
}
