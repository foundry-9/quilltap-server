'use client'

/**
 * Calliope's side of the conversation and the author's (Spec J Stage 3): the
 * author's messages, her answers (reasoning above, prose below, in the shared
 * help-chat bubbles), a quiet line for each tool she used, and a proposal card
 * where she proposed. A proposal the engine refused is a quiet line too: the
 * author is never shown it as a proposal.
 *
 * @module components/theme-editor/calliope/CalliopeMessages
 */

import { useEffect, useRef } from 'react'
import MessageContent from '@/components/chat/MessageContent'
import { ThinkingBlock } from '@/components/chat/ThinkingBlock'
import { ConsoleMessageAttachments, type ConsoleAttachmentView } from '@/components/brahma-console/ConsoleMessageAttachments'
import type { StreamingToolCall } from '@/components/brahma-console/hooks/useBrahmaConsoleStreaming'
import type { CalliopeMessage, ProposalView } from './api'
import { CalliopeAvatar } from './CalliopeAvatar'

/** What each of her tools is called in the transcript. */
const TOOL_LINES: Record<string, string> = {
  theme_read_draft: 'Read the draft',
  theme_lookup_tokens: 'Looked up tokens',
  theme_lookup_hooks: 'Looked up hooks',
  theme_check_contrast: 'Measured a contrast',
  theme_propose: 'Set down a proposal',
}

interface ToolRow {
  toolName: string
  success: boolean
}

function toolRowOf(message: CalliopeMessage): ToolRow | null {
  if (message.role !== 'TOOL' || !message.content) return null
  try {
    const parsed = JSON.parse(message.content) as { toolName?: unknown; success?: unknown }
    return typeof parsed.toolName === 'string' ? { toolName: parsed.toolName, success: parsed.success === true } : null
  } catch {
    return null
  }
}

function toolLine(row: ToolRow): string {
  if (row.toolName === 'theme_propose' && !row.success) return 'A proposal did not pass her checks; she mended it'
  if (row.toolName === 'submit_final_response') return ''
  return TOOL_LINES[row.toolName] ?? row.toolName
}

function attachmentViews(m: CalliopeMessage): ConsoleAttachmentView[] {
  return (m.attachments ?? []).filter((a): a is ConsoleAttachmentView => typeof a === 'object' && a !== null)
}

function Bubble({ side, children }: { side: 'user' | 'assistant'; children: React.ReactNode }) {
  const isUser = side === 'user'
  return (
    <div className={`flex items-start gap-1 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {!isUser && <CalliopeAvatar />}
      <div className={`flex flex-col gap-1 min-w-0 ${isUser ? 'items-end' : 'items-start'}`} style={{ maxWidth: '88%' }}>
        {children}
      </div>
    </div>
  )
}

export interface CalliopeMessagesProps {
  messages: CalliopeMessage[]
  proposals: ProposalView[]
  renderProposal: (proposal: ProposalView) => React.ReactNode
  isStreaming: boolean
  isExecutingTools: boolean
  streamingContent: string
  streamingReasoning: string
  streamingToolCalls: StreamingToolCall[]
}

export function CalliopeMessages({
  messages,
  proposals,
  renderProposal,
  isStreaming,
  isExecutingTools,
  streamingContent,
  streamingReasoning,
  streamingToolCalls,
}: CalliopeMessagesProps) {
  const endRef = useRef<HTMLDivElement>(null)
  const byId = new Map(proposals.map((p) => [p.id, p]))

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, streamingContent, streamingToolCalls.length, isStreaming])

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3" aria-live="polite" aria-busy={isStreaming}>
      {messages.length === 0 && !isStreaming && (
        <p className="qt-text-small qt-text-secondary">
          Tell her the look you are after &mdash; a mood, a palette, a period, a picture &mdash; and she will set
          down proposals for you to try, keep or discard.
        </p>
      )}
      {messages.map((m) => {
        if (m.type !== 'message') return null
        const tool = toolRowOf(m)
        if (tool) {
          const proposal = byId.get(m.id)
          if (proposal) return <div key={m.id}>{renderProposal(proposal)}</div>
          const line = toolLine(tool)
          return line ? (
            <p key={m.id} className="qt-text-xs qt-text-muted pl-10">{line}</p>
          ) : null
        }
        if (m.role !== 'USER' && m.role !== 'ASSISTANT') return null
        const content = m.content ?? ''
        const sent = attachmentViews(m)
        const isUser = m.role === 'USER'
        if (!content.trim() && sent.length === 0 && !m.reasoningContent) return null
        return (
          <Bubble key={m.id} side={isUser ? 'user' : 'assistant'}>
            {!isUser && m.reasoningContent && <ThinkingBlock content={m.reasoningContent} collapsedByDefault align="start" />}
            {content.trim() && (
              <div className={isUser ? 'qt-help-msg-user' : 'qt-help-msg-assistant'} style={{ maxWidth: '100%' }}>
                <span className="sr-only">{isUser ? 'You: ' : 'Calliope: '}</span>
                <MessageContent content={content} />
              </div>
            )}
            {sent.length > 0 && <ConsoleMessageAttachments attachments={sent} />}
          </Bubble>
        )
      })}

      {isStreaming && (
        <Bubble side="assistant">
          {streamingReasoning.trim() && <ThinkingBlock content={streamingReasoning} streaming={!streamingContent} align="start" />}
          {streamingToolCalls.map((tc, i) =>
            TOOL_LINES[tc.name] ? (
              <p key={`live-${i}`} className="qt-text-xs qt-text-muted">{TOOL_LINES[tc.name]}</p>
            ) : null,
          )}
          {streamingContent ? (
            <div className="qt-help-msg-assistant" style={{ maxWidth: '100%' }}>
              <MessageContent content={streamingContent} />
            </div>
          ) : (
            <div className="qt-help-msg-assistant qt-text-secondary">{isExecutingTools ? 'Consulting the swatches…' : 'Considering…'}</div>
          )}
        </Bubble>
      )}
      <div ref={endRef} />
    </div>
  )
}
