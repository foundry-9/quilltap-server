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
  /** Links extracted from help_search results — suggested pages based on search relevance */
  suggestedLinks?: NavigationLink[]
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
  suggestedLinks,
  onNavigate,
}: HelpChatMessageListProps) {
  const endRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom on new messages or streaming
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, streamingContent, navigationLinks?.length, suggestedLinks?.length])

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

  // Suggested links from search results — exclude any that duplicate explicit nav links
  const navUrls = new Set(navigationLinks?.map(l => l.url) || [])
  const filteredSuggestions = suggestedLinks?.filter(l => !navUrls.has(l.url)) || []
  const showSuggestions = filteredSuggestions.length > 0 && !isStreaming

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
            className={`flex items-start ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
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

            {/* Bubble tail */}
            <svg className={`qt-help-tail ${isUser ? 'qt-help-tail-user' : 'qt-help-tail-assistant'}`} viewBox="0 0 10 16" fill="currentColor">
              {isUser ? (
                <path d="M0 0 L10 8 L0 16 Z" />
              ) : (
                <path d="M10 0 L0 8 L10 16 Z" />
              )}
            </svg>

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
        <div className="flex items-start flex-row">
          <div className="qt-help-avatar">
            {(() => {
              const char = getCharacterForParticipant(streamingParticipantId)
              if (char?.avatarUrl) {
                return <img src={char.avatarUrl} alt={char.name} className="w-full h-full object-cover" />
              }
              return <span className="text-xs text-muted-foreground">{char?.name?.[0] || '?'}</span>
            })()}
          </div>
          <svg className="qt-help-tail qt-help-tail-assistant" viewBox="0 0 10 16" fill="currentColor">
            <path d="M10 0 L0 8 L10 16 Z" />
          </svg>
          <div className="qt-help-msg-assistant">
            <MessageContent content={streamingContent} />
          </div>
        </div>
      )}

      {/* Streaming indicator (no content yet, or executing tools) */}
      {isStreaming && !streamingContent && (
        <div className="flex items-start flex-row">
          <div className="qt-help-avatar">
            {(() => {
              const char = getCharacterForParticipant(streamingParticipantId)
              if (char?.avatarUrl) {
                return <img src={char.avatarUrl} alt={char.name} className="w-full h-full object-cover" />
              }
              return <span className="text-xs text-muted-foreground">{char?.name?.[0] || '...'}</span>
            })()}
          </div>
          <svg className="qt-help-tail qt-help-tail-assistant" viewBox="0 0 10 16" fill="currentColor">
            <path d="M10 0 L0 8 L10 16 Z" />
          </svg>
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

      {/* Suggested links from search results — always shown when search returned relevant pages */}
      {showSuggestions && (
        <div className="qt-help-suggested-links">
          <div className="qt-help-suggested-links-label">Related pages</div>
          <div className="flex flex-wrap gap-1.5">
            {filteredSuggestions.map(link => (
              <button
                key={link.url}
                type="button"
                onClick={() => onNavigate?.(link.url)}
                className="qt-help-suggested-link"
              >
                <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 5l7 7-7 7" />
                </svg>
                {link.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div ref={endRef} />
    </div>
  )
}
