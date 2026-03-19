'use client'

/**
 * HelpChatMessageList
 *
 * Renders messages in a help chat. Simple list (no virtualization —
 * help chats are typically short). Reuses MessageContent for markdown.
 */

import { useEffect, useRef } from 'react'
import MessageContent from '@/components/chat/MessageContent'

interface HelpMessage {
  id: string
  role: string
  content: string
  participantId?: string | null
  createdAt: string
  provider?: string | null
  modelName?: string | null
}

interface CharacterInfo {
  id: string
  name: string
  avatarUrl: string | null
}

interface HelpChatMessageListProps {
  messages: HelpMessage[]
  characterMap: Map<string, CharacterInfo>
  participantToCharacter: Map<string, string>
  streamingContent?: string
  streamingParticipantId?: string | null
  isStreaming?: boolean
}

export function HelpChatMessageList({
  messages,
  characterMap,
  participantToCharacter,
  streamingContent,
  streamingParticipantId,
  isStreaming,
}: HelpChatMessageListProps) {
  const endRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom on new messages or streaming
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, streamingContent])

  const getCharacterForParticipant = (participantId: string | null | undefined): CharacterInfo | null => {
    if (!participantId) return null
    const charId = participantToCharacter.get(participantId)
    if (!charId) return null
    return characterMap.get(charId) || null
  }

  // Filter to visible messages (user + assistant only)
  const visibleMessages = messages.filter(m =>
    m.role === 'USER' || m.role === 'ASSISTANT' || m.role === 'user' || m.role === 'assistant'
  )

  return (
    <div className="flex flex-col gap-3 p-4 overflow-y-auto flex-1">
      {visibleMessages.length === 0 && !isStreaming && (
        <div className="text-center text-muted-foreground text-sm py-8">
          Ask a question to get started
        </div>
      )}

      {visibleMessages.map(msg => {
        const isUser = msg.role === 'USER' || msg.role === 'user'
        const character = getCharacterForParticipant(msg.participantId)

        return (
          <div
            key={msg.id}
            className={`flex gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
          >
            {/* Avatar */}
            {!isUser && (
              <div className="qt-help-avatar">
                {character?.avatarUrl ? (
                  <img
                    src={character.avatarUrl}
                    alt={character.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {character?.name?.[0] || '?'}
                  </span>
                )}
              </div>
            )}

            {/* Message bubble */}
            <div className={isUser ? 'qt-help-msg-user' : 'qt-help-msg-assistant'}>
              {!isUser && character && visibleMessages.filter(m => m.role !== 'USER' && m.role !== 'user').length > 0 && (
                <div className="qt-help-msg-character-name">
                  {character.name}
                </div>
              )}
              <MessageContent content={msg.content} />
            </div>
          </div>
        )
      })}

      {/* Streaming message */}
      {isStreaming && streamingContent && (
        <div className="flex gap-2 flex-row">
          <div className="qt-help-avatar">
            {(() => {
              const char = getCharacterForParticipant(streamingParticipantId)
              if (char?.avatarUrl) {
                return <img src={char.avatarUrl} alt={char.name} className="w-full h-full object-cover" />
              }
              return <span className="text-xs text-muted-foreground">{char?.name?.[0] || '?'}</span>
            })()}
          </div>
          <div className="qt-help-msg-assistant">
            <MessageContent content={streamingContent} />
          </div>
        </div>
      )}

      {/* Streaming indicator (no content yet) */}
      {isStreaming && !streamingContent && (
        <div className="flex gap-2 flex-row">
          <div className="qt-help-avatar">
            <span className="text-xs text-muted-foreground">...</span>
          </div>
          <div className="qt-help-msg-assistant italic">
            Thinking...
          </div>
        </div>
      )}

      <div ref={endRef} />
    </div>
  )
}
