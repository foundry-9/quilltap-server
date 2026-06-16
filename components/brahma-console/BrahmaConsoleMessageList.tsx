'use client'

/**
 * BrahmaConsoleMessageList
 *
 * Renders the Brahma Console transcript. A single character-less assistant
 * voice (rendered with the console mark as its avatar) and the operator's own
 * messages. No character names, no navigation/suggested links. Reuses the
 * shared `qt-help-*` chat-bubble styling for visual consistency.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import MessageContent from '@/components/chat/MessageContent'

interface BrahmaMessage {
  id: string
  role: string
  content: string
  createdAt: string
  provider?: string | null
  modelName?: string | null
}

interface BrahmaConsoleMessageListProps {
  messages: BrahmaMessage[]
  streamingContent?: string
  isStreaming?: boolean
  isExecutingTools?: boolean
}

function ConsoleAvatar() {
  return (
    <div className="qt-help-avatar">
      <Icon name="brahma-console" className="w-4 h-4" />
    </div>
  )
}

/**
 * Small "copy as Markdown" affordance shown beneath each settled bubble. It
 * copies the message's raw content (already Markdown) to the clipboard and
 * flips to a checkmark for a beat as confirmation. Self-contained per-button
 * state mirrors the code-block copy control in MessageContent, so the dialog
 * doesn't need the Salon's toast plumbing. Rendered outside the bubble (on the
 * dialog background) to stay legible regardless of the bubble fill.
 */
function CopyMarkdownButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy message', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }, [content])

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="qt-chat-message-action-icon opacity-50 hover:opacity-100"
      title={copied ? 'Copied!' : 'Copy as Markdown'}
      aria-label={copied ? 'Copied' : 'Copy message as Markdown'}
    >
      <Icon name={copied ? 'check' : 'copy'} />
    </button>
  )
}

export function BrahmaConsoleMessageList({
  messages,
  streamingContent,
  isStreaming,
  isExecutingTools,
}: BrahmaConsoleMessageListProps) {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, streamingContent])

  // Visible messages: user + assistant with non-empty content (hide
  // intermediate tool-using agent turns).
  const visibleMessages = messages.filter(m => {
    if (m.role === 'USER' || m.role === 'user') return true
    if (m.role === 'ASSISTANT' || m.role === 'assistant') {
      return m.content && m.content.trim().length > 0
    }
    return false
  })

  return (
    <div className="flex flex-col gap-3 p-4 overflow-y-auto flex-1">
      {visibleMessages.length === 0 && !isStreaming && (
        <div className="text-center qt-text-secondary text-sm py-8">
          A direct line to the engine of your choosing. Pose a question to begin.
        </div>
      )}

      {visibleMessages.map(msg => {
        const isUser = msg.role === 'USER' || msg.role === 'user'

        return (
          <div
            key={msg.id}
            className={`flex items-start ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
          >
            {!isUser && <ConsoleAvatar />}

            <svg className={`qt-help-tail ${isUser ? 'qt-help-tail-user' : 'qt-help-tail-assistant'}`} viewBox="0 0 10 16" fill="currentColor">
              {isUser ? (
                <path d="M0 0 L10 8 L0 16 Z" />
              ) : (
                <path d="M10 0 L0 8 L10 16 Z" />
              )}
            </svg>

            <div
              className={`flex flex-col gap-0.5 min-w-0 ${isUser ? 'items-end' : 'items-start'}`}
              style={{ maxWidth: '80%' }}
            >
              <div
                className={isUser ? 'qt-help-msg-user' : 'qt-help-msg-assistant'}
                style={{ maxWidth: '100%' }}
              >
                <MessageContent content={msg.content} />
              </div>
              <CopyMarkdownButton content={msg.content} />
            </div>
          </div>
        )
      })}

      {/* Streaming message */}
      {isStreaming && streamingContent && (
        <div className="flex items-start flex-row">
          <ConsoleAvatar />
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
          <ConsoleAvatar />
          <svg className="qt-help-tail qt-help-tail-assistant" viewBox="0 0 10 16" fill="currentColor">
            <path d="M10 0 L0 8 L10 16 Z" />
          </svg>
          <div className="qt-help-msg-assistant italic">
            {isExecutingTools ? 'Consulting the stacks…' : 'Thinking…'}
          </div>
        </div>
      )}

      <div ref={endRef} />
    </div>
  )
}
