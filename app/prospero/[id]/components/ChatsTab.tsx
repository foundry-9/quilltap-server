'use client'

/**
 * Chats Tab
 *
 * Displays project chats with remove functionality.
 */

import Link from 'next/link'
import type { ProjectChat } from '../types'
import { CloseIcon } from '@/components/ui/icons'

interface ChatsTabProps {
  projectId: string
  chats: ProjectChat[]
  onRemoveChat: (chatId: string) => void
}

export function ChatsTab({ projectId, chats, onRemoveChat }: ChatsTabProps) {
  if (chats.length === 0) {
    return (
      <div className="text-center py-12 qt-text-secondary">
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
            className="qt-text-secondary hover:qt-text-destructive"
            title="Remove from project"
          >
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>
      ))}
    </div>
  )
}
