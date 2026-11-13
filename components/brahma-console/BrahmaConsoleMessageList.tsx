'use client'

/**
 * BrahmaConsoleMessageList
 *
 * Renders the Brahma Console transcript. A single character-less assistant
 * voice (rendered with the console mark as its avatar) and the operator's own
 * messages. No character names, no navigation/suggested links. Reuses the
 * shared `qt-help-*` chat-bubble styling for visual consistency.
 *
 * In a Writing Assistant conversation the assistant's side is drawn by what
 * each message is, never by its position: a `systemKind: 'writing-output'`
 * message is an output card with its own toolbar; prose a model wrote beside
 * its tool calls is working notes, small and muted; an unmarked final message
 * (a budget salvage, an error) is a notice with no controls.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import MessageContent from '@/components/chat/MessageContent'
import { ThinkingBlock } from '@/components/chat/ThinkingBlock'
import { BrahmaToolCall, parseBrahmaSqlToolMessage, type BrahmaSqlToolCallData } from './BrahmaToolCall'
import { segmentLiveRun } from './brahma-sql-tool-call'
import type { StreamingToolBatchMark, StreamingToolCall } from './hooks/useBrahmaConsoleStreaming'
import { WritingOutputCard } from './WritingOutputCard'
import { ConsoleMessageAttachments, type ConsoleAttachmentView } from './ConsoleMessageAttachments'
import { WRITING_OUTPUT_KIND, writingOutputFilename } from '@/lib/brahma-console/writing-output'

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
  /** `'writing-output'` marks a Writing Assistant output. */
  systemKind?: string | null
  /** Operator attachments, resolved by the messages route. */
  attachments?: ConsoleAttachmentView[] | string[] | null
}

function attachmentViews(m: BrahmaMessage): ConsoleAttachmentView[] {
  return (m.attachments ?? []).filter(
    (a): a is ConsoleAttachmentView => typeof a === 'object' && a !== null,
  )
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
  /** A Writing Assistant conversation. */
  writing?: boolean
  /** The conversation (for an output's Save). */
  chatId?: string | null
  /** The conversation's title (for an output's filename). */
  chatTitle?: string | null
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
  writing = false,
  chatId = null,
  chatTitle = null,
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
    | { kind: 'output'; msg: BrahmaMessage; ordinal: number }
    | { kind: 'notes'; msg: BrahmaMessage }
    | { kind: 'notice'; msg: BrahmaMessage }

  const renderItems: RenderItem[] = []
  let outputOrdinal = 0
  messages.forEach((m, index) => {
    // `getMessages` can return non-message events with no `role` (and old chats
    // predate some fields) — coerce defensively so a missing role just skips.
    const role = (m.role ?? '').toUpperCase()
    if (role === 'USER') {
      renderItems.push({ kind: 'bubble', msg: m, isUser: true })
    } else if (role === 'ASSISTANT') {
      const hasProse = !!m.content && m.content.trim().length > 0
      if (writing && m.systemKind === WRITING_OUTPUT_KIND) {
        outputOrdinal++
        renderItems.push({ kind: 'output', msg: m, ordinal: outputOrdinal })
      } else if (writing && hasProse) {
        // Prose beside tool calls is working notes; an unmarked final
        // message (salvage, error) is a notice.
        const next = messages[index + 1]
        const followedByTools = (next?.role ?? '').toUpperCase() === 'TOOL'
        renderItems.push(followedByTools ? { kind: 'notes', msg: m } : { kind: 'notice', msg: m })
      } else if (hasProse) {
        renderItems.push({ kind: 'bubble', msg: m, isUser: false })
      } else if (m.reasoningContent?.trim()) {
        renderItems.push({ kind: 'thinking', id: m.id, content: m.reasoningContent })
      }
    } else if (role === 'TOOL') {
      const sqlData = parseBrahmaSqlToolMessage(m.content ?? '')
      if (sqlData) renderItems.push({ kind: 'tool', id: m.id, data: sqlData })
    }
  })

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
          {writing
            ? 'Describe the piece you need. What comes back is the piece itself, ready to copy or file.'
            : 'A direct line to the engine of your choosing. Pose a question to begin.'}
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

        if (item.kind === 'output') {
          return (
            <div key={item.msg.id} className="flex flex-row pl-1">
              <div className="min-w-0 w-full">
                <WritingOutputCard
                  chatId={chatId}
                  messageId={item.msg.id}
                  content={item.msg.content}
                  filename={writingOutputFilename(chatTitle, item.ordinal)}
                  reasoningContent={item.msg.reasoningContent}
                />
              </div>
            </div>
          )
        }

        if (item.kind === 'notes') {
          return (
            <div key={item.msg.id} className="flex flex-row pl-1">
              <div className="min-w-0 w-full qt-console-notes" style={{ maxWidth: '92%' }}>
                {item.msg.reasoningContent && (
                  <ThinkingBlock content={item.msg.reasoningContent} collapsedByDefault align="start" />
                )}
                <span className="sr-only">Working notes: </span>
                <MessageContent content={item.msg.content} />
              </div>
            </div>
          )
        }

        if (item.kind === 'notice') {
          return (
            <div key={item.msg.id} className="flex flex-row pl-1">
              <div className="min-w-0 w-full qt-console-notice" role="note" style={{ maxWidth: '92%' }}>
                {item.msg.reasoningContent && (
                  <ThinkingBlock content={item.msg.reasoningContent} collapsedByDefault align="start" />
                )}
                <MessageContent content={item.msg.content} />
              </div>
            </div>
          )
        }

        const { msg, isUser } = item
        const sentAttachments = isUser ? attachmentViews(msg) : []

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
              {msg.content.trim().length > 0 && (
                <div
                  className={isUser ? 'qt-help-msg-user' : 'qt-help-msg-assistant'}
                  style={{ maxWidth: '100%' }}
                >
                  <MessageContent content={msg.content} />
                </div>
              )}
              {sentAttachments.length > 0 && <ConsoleMessageAttachments attachments={sentAttachments} />}
              {msg.content.trim().length > 0 && <CopyMarkdownButton content={msg.content} />}
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
            {streamingContent && (writing ? (
              // A provisional card: settles as an output or a notice on `done`,
              // or is cleared (and reloads as working notes) if tools follow.
              <div className="w-full">
                <WritingOutputCard
                  chatId={chatId}
                  messageId={null}
                  content={streamingContent}
                  filename={writingOutputFilename(chatTitle, outputOrdinal + 1)}
                  draft
                />
              </div>
            ) : (
              <div className="qt-help-msg-assistant" style={{ maxWidth: '100%' }}>
                <MessageContent content={streamingContent} />
              </div>
            ))}
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
