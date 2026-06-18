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
import { ThinkingBlock } from '@/components/chat/ThinkingBlock'
import { BrahmaToolCall, parseBrahmaSqlToolMessage, type BrahmaSqlToolCallData } from './BrahmaToolCall'
import type { StreamingToolCall } from './hooks/useBrahmaConsoleStreaming'

interface BrahmaMessage {
  id: string
  role: string
  content: string
  createdAt: string
  provider?: string | null
  modelName?: string | null
  /** Reasoning ("thinking") for the turn — DISPLAY ONLY. Rendered as a single
   *  leading, collapsible block above the answer. */
  reasoningContent?: string | null
}

interface BrahmaConsoleMessageListProps {
  messages: BrahmaMessage[]
  streamingContent?: string
  /** Live cumulative reasoning ("thinking") for the in-flight turn. */
  streamingReasoning?: string
  /** Tool calls observed live this turn (run_sql cards rendered as they land). */
  streamingToolCalls?: StreamingToolCall[]
  isStreaming?: boolean
  isExecutingTools?: boolean
}

/** Normalize a live-streamed tool call into the shape BrahmaToolCall renders. */
function streamingToolCallToData(tc: StreamingToolCall): BrahmaSqlToolCallData {
  const args = tc.arguments ?? {}
  const sql = typeof args.sql === 'string' ? args.sql : null
  const database = typeof args.database === 'string' ? args.database : 'main'
  const envelope = (tc.result && typeof tc.result === 'object')
    ? (tc.result as BrahmaSqlToolCallData['envelope'])
    : null
  return {
    success: tc.success ?? false,
    sql,
    database,
    envelope,
    errorText: tc.pending ? null : (tc.success ? null : 'The query failed.'),
    pending: tc.pending,
  }
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
  streamingReasoning,
  streamingToolCalls,
  isStreaming,
  isExecutingTools,
}: BrahmaConsoleMessageListProps) {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, streamingContent, streamingReasoning, streamingToolCalls])

  // Render items, in transcript order: user + assistant bubbles (assistant only
  // when it carries prose, hiding empty intermediate agent turns) plus a card
  // for each run_sql TOOL message. Other tools stay silent, as before.
  type RenderItem =
    | { kind: 'bubble'; msg: BrahmaMessage; isUser: boolean }
    | { kind: 'tool'; id: string; data: BrahmaSqlToolCallData }

  const renderItems: RenderItem[] = []
  for (const m of messages) {
    // `getMessages` can return non-message events with no `role` (and old chats
    // predate some fields) — coerce defensively so a missing role just skips.
    const role = (m.role ?? '').toUpperCase()
    if (role === 'USER') {
      renderItems.push({ kind: 'bubble', msg: m, isUser: true })
    } else if (role === 'ASSISTANT') {
      if (m.content && m.content.trim().length > 0) {
        renderItems.push({ kind: 'bubble', msg: m, isUser: false })
      }
    } else if (role === 'TOOL') {
      const sqlData = parseBrahmaSqlToolMessage(m.content ?? '')
      if (sqlData) renderItems.push({ kind: 'tool', id: m.id, data: sqlData })
    }
  }

  // Live run_sql cards for the in-flight turn. When present, they supersede the
  // generic "Consulting the stacks…" indicator (each card shows its own state).
  const liveSqlCalls = (streamingToolCalls ?? []).filter(tc => tc.name === 'run_sql')

  return (
    <div className="flex flex-col gap-3 p-4 overflow-y-auto flex-1">
      {renderItems.length === 0 && !isStreaming && (
        <div className="text-center qt-text-secondary text-sm py-8">
          A direct line to the engine of your choosing. Pose a question to begin.
        </div>
      )}

      {renderItems.map(item => {
        if (item.kind === 'tool') {
          return (
            <div key={item.id} className="flex flex-row pl-1">
              <div className="min-w-0 w-full" style={{ maxWidth: '92%' }}>
                <BrahmaToolCall data={item.data} />
              </div>
            </div>
          )
        }

        const { msg, isUser } = item

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
              {!isUser && msg.reasoningContent && (
                <ThinkingBlock content={msg.reasoningContent} collapsedByDefault />
              )}
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

      {/* Streaming message — live reasoning above the prose as it arrives, with
          a status indicator while the engine works or before anything lands. */}
      {isStreaming && (
        <div className="flex items-start flex-row">
          <ConsoleAvatar />
          <svg className="qt-help-tail qt-help-tail-assistant" viewBox="0 0 10 16" fill="currentColor">
            <path d="M10 0 L0 8 L10 16 Z" />
          </svg>
          <div className="flex flex-col gap-2 min-w-0 items-start" style={{ maxWidth: '80%' }}>
            {streamingReasoning?.trim() && (
              <ThinkingBlock content={streamingReasoning} streaming />
            )}
            {liveSqlCalls.map((tc, i) => (
              <div key={i} className="w-full">
                <BrahmaToolCall data={streamingToolCallToData(tc)} />
              </div>
            ))}
            {streamingContent && (
              <div className="qt-help-msg-assistant" style={{ maxWidth: '100%' }}>
                <MessageContent content={streamingContent} />
              </div>
            )}
            {isExecutingTools && liveSqlCalls.length === 0 ? (
              <div className="qt-help-msg-assistant italic">Consulting the stacks…</div>
            ) : (!streamingContent && !streamingReasoning?.trim() && liveSqlCalls.length === 0) ? (
              <div className="qt-help-msg-assistant italic">Thinking…</div>
            ) : null}
          </div>
        </div>
      )}

      <div ref={endRef} />
    </div>
  )
}
