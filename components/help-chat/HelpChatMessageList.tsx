'use client'

/**
 * HelpChatMessageList
 *
 * Renders messages in a help chat. Simple list (no virtualization —
 * help chats are typically short). Reuses MessageContent for markdown.
 */

import { useEffect, useRef } from 'react'
import MessageContent from '@/components/chat/MessageContent'
import type { NavigationLink } from './hooks/useHelpChatStreaming'

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
  isExecutingTools?: boolean
  navigationLinks?: NavigationLink[]
  onNavigate?: (url: string) => void
}

export function HelpChatMessageList({
  messages,
  characterMap,
  participantToCharacter,
  streamingContent,
  streamingParticipantId,
  isStreaming,
  isExecutingTools,
  navigationLinks,
  onNavigate,
}: HelpChatMessageListProps) {
  const endRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom on new messages or streaming
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, streamingContent, navigationLinks?.length])

  const getCharacterForParticipant = (participantId: string | null | undefined): CharacterInfo | null => {
    if (!participantId) return null
    const charId = participantToCharacter.get(participantId)
    if (!charId) return null
    return characterMap.get(charId) || null
  }

  // Filter to visible messages: user + assistant, excluding intermediate
  // tool-using turns (empty content from agent mode iterations)
  const visibleMessages = messages.filter(m => {
    if (m.role === 'USER' || m.role === 'user') return true
    if (m.role === 'ASSISTANT' || m.role === 'assistant') {
      // Hide intermediate agent mode messages with no user-visible content
      return m.content && m.content.trim().length > 0
    }
    return false
  })

  // Check if navigation links should be shown after the last assistant message
  const showNavLinks = navigationLinks && navigationLinks.length > 0 && !isStreaming

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

      {/* Streaming indicator (no content yet, or executing tools) */}
      {isStreaming && !streamingContent && (
        <div className="flex gap-2 flex-row">
          <div className="qt-help-avatar">
            {(() => {
              const char = getCharacterForParticipant(streamingParticipantId)
              if (char?.avatarUrl) {
                return <img src={char.avatarUrl} alt={char.name} className="w-full h-full object-cover" />
              }
              return <span className="text-xs text-muted-foreground">{char?.name?.[0] || '...'}</span>
            })()}
          </div>
          <div className="qt-help-msg-assistant italic">
            {isExecutingTools ? 'Consulting the archives...' : 'Thinking...'}
          </div>
        </div>
      )}

      {/* Navigation links from help_navigate tool calls */}
      {showNavLinks && (
        <div className="flex flex-wrap gap-2 pl-10">
          {navigationLinks.map(link => (
            <button
              key={link.url}
              type="button"
              onClick={() => onNavigate?.(link.url)}
              className="qt-help-nav-button"
            >
              <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
              </svg>
              {link.label}
            </button>
          ))}
        </div>
      )}

      <div ref={endRef} />
    </div>
  )
}
