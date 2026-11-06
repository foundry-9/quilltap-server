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
import { segmentLiveRun } from './brahma-sql-tool-call'
import type { StreamingToolBatchMark, StreamingToolCall } from './hooks/useBrahmaConsoleStreaming'

interface BrahmaMessage {
  id: string
  role: string
  content: string
  createdAt: string
  provider?: string | null
  modelName?: string | null
  /** Reasoning ("thinking") — DISPLAY ONLY. On a tool-call turn it is the
   *  thinking that led to that turn's SQL; on the answer, the thinking since. */
  reasoningContent?: string | null
}

interface BrahmaConsoleMessageListProps {
  messages: BrahmaMessage[]
  streamingContent?: string
  /** Live cumulative reasoning ("thinking") for the in-flight turn. */
  streamingReasoning?: string
  /** Tool calls observed live this turn (run_sql cards rendered as they land). */
  streamingToolCalls?: StreamingToolCall[]
  /** Where each live tool batch fell in the reasoning chain. */
  streamingToolBatchMarks?: StreamingToolBatchMark[]
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
    errorText: tc.pending
      ? null
      : tc.success
        ? null
        : (typeof tc.error === 'string' && tc.error.trim() ? tc.error : 'The query failed.'),
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
  streamingToolBatchMarks,
  isStreaming,
  isExecutingTools,
}: BrahmaConsoleMessageListProps) {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, streamingContent, streamingReasoning, streamingToolCalls])

  // Render items, in transcript order: user + assistant bubbles (assistant only
  // when it carries prose), the thinking of an intermediate tool-call turn as a
  // standalone block, and a card for each run_sql TOOL message — so thinking
  // and SQL interleave as they happened. Other tools stay silent, as before.
  type RenderItem =
    | { kind: 'bubble'; msg: BrahmaMessage; isUser: boolean }
    | { kind: 'thinking'; id: string; content: string }
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
      } else if (m.reasoningContent?.trim()) {
        renderItems.push({ kind: 'thinking', id: m.id, content: m.reasoningContent })
      }
    } else if (role === 'TOOL') {
      const sqlData = parseBrahmaSqlToolMessage(m.content ?? '')
      if (sqlData) renderItems.push({ kind: 'tool', id: m.id, data: sqlData })
    }
  }

  // Live run for the in-flight turn: thinking and run_sql cards interleaved in
  // the order they happened. When any card is present it supersedes the
  // generic "Consulting the stacks…" indicator (each card shows its own state).
  const liveToolCalls = streamingToolCalls ?? []
  const liveSqlCount = liveToolCalls.filter(tc => tc.name === 'run_sql').length
  const liveSegments = segmentLiveRun(
    streamingReasoning ?? '',
    streamingToolBatchMarks ?? [],
    liveToolCalls.length,
  )

  return (
    <div className="flex flex-col gap-3 p-4 overflow-y-auto flex-1">
      {renderItems.length === 0 && !isStreaming && (
        <div className="text-center qt-text-secondary text-sm py-8">
          A direct line to the engine of your choosing. Pose a question to begin.
        </div>
      )}

      {renderItems.map(item => {
        if (item.kind === 'thinking') {
          return (
            <div key={item.id} className="flex flex-row pl-1">
              <div className="min-w-0 w-full" style={{ maxWidth: '92%' }}>
                <ThinkingBlock content={item.content} collapsedByDefault align="start" />
              </div>
            </div>
          )
        }

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
                <ThinkingBlock content={msg.reasoningContent} collapsedByDefault align="start" />
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
            {liveSegments.map((seg, idx) => {
              if (seg.kind === 'thinking') {
                // Only the trailing stretch is still streaming (held open);
                // thinking that already led to SQL settles collapsed.
                return seg.isLast && !streamingContent ? (
                  <ThinkingBlock key="thinking-live" content={seg.text} streaming align="start" />
                ) : (
                  <ThinkingBlock key={`thinking-${idx}`} content={seg.text} collapsedByDefault align="start" />
                )
              }
              return liveToolCalls.slice(seg.start, seg.end).map((tc, j) =>
                tc.name === 'run_sql' ? (
                  <div key={`tool-${seg.start + j}`} className="w-full">
                    <BrahmaToolCall data={streamingToolCallToData(tc)} />
                  </div>
                ) : null,
              )
            })}
            {streamingContent && (
              <div className="qt-help-msg-assistant" style={{ maxWidth: '100%' }}>
                <MessageContent content={streamingContent} />
              </div>
            )}
            {isExecutingTools && liveSqlCount === 0 ? (
              <div className="qt-help-msg-assistant italic">Consulting the stacks…</div>
            ) : (!streamingContent && !streamingReasoning?.trim() && liveSqlCount === 0) ? (
              <div className="qt-help-msg-assistant italic">Thinking…</div>
            ) : null}
          </div>
        </div>
      )}

      <div ref={endRef} />
    </div>
  )
}
