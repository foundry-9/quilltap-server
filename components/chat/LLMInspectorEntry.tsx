'use client'

import { useState } from 'react'
import type { LLMLog, LLMLogType } from '@/lib/schemas/types'

interface LLMInspectorEntryProps {
  log: LLMLog
  isHighlighted?: boolean
}

type TabType = 'request' | 'response' | 'usage'

const TYPE_BADGE_CLASSES: Record<string, string> = {
  CHAT_MESSAGE: 'qt-bg-primary/15 qt-text-primary',
  TOOL_CONTINUATION: 'qt-bg-primary/15 qt-text-primary',
  MEMORY_EXTRACTION: 'qt-bg-info/15 qt-text-info',
  TITLE_GENERATION: 'qt-bg-secondary/50 qt-text-secondary',
  SUMMARIZATION: 'qt-bg-secondary/50 qt-text-secondary',
  CONTEXT_COMPRESSION: 'qt-bg-secondary/50 qt-text-secondary',
  IMAGE_PROMPT_CRAFTING: 'qt-bg-warning/15 qt-text-warning',
  IMAGE_DESCRIPTION: 'qt-bg-warning/15 qt-text-warning',
  APPEARANCE_RESOLUTION: 'qt-bg-warning/15 qt-text-warning',
  DANGER_CLASSIFICATION: 'qt-bg-destructive/15 qt-text-destructive',
  CHARACTER_WIZARD: 'qt-bg-success/15 qt-text-success',
  AI_IMPORT: 'qt-bg-success/15 qt-text-success',
}

const TYPE_LABELS: Record<string, string> = {
  CHAT_MESSAGE: 'Chat',
  TOOL_CONTINUATION: 'Tool',
  MEMORY_EXTRACTION: 'Memory',
  TITLE_GENERATION: 'Title',
  SUMMARIZATION: 'Summary',
  CONTEXT_COMPRESSION: 'Compress',
  IMAGE_PROMPT_CRAFTING: 'Img Prompt',
  IMAGE_DESCRIPTION: 'Img Desc',
  APPEARANCE_RESOLUTION: 'Appearance',
  DANGER_CLASSIFICATION: 'Safety',
  CHARACTER_WIZARD: 'Wizard',
  AI_IMPORT: 'Import',
}

function formatTokens(log: LLMLog): string {
  if (!log.usage) return ''
  return `${log.usage.promptTokens.toLocaleString()} \u2192 ${log.usage.completionTokens.toLocaleString()}`
}

function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return ''
  return `${(ms / 1000).toFixed(1)}s`
}

function formatTimestamp(ts: string | Date): string {
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}


export default function LLMInspectorEntry({ log, isHighlighted }: Readonly<LLMInspectorEntryProps>) {
  const [expanded, setExpanded] = useState(false)
  const [activeTab, setActiveTab] = useState<TabType>('request')

  const badgeClass = TYPE_BADGE_CLASSES[log.type] || 'qt-bg-muted qt-text-secondary'
  const typeLabel = TYPE_LABELS[log.type] || log.type

  return (
    <div
      data-log-id={log.id}
      className={`qt-inspector-entry ${isHighlighted ? 'qt-inspector-entry-highlight' : ''}`}
    >
      {/* Collapsed summary - always visible */}
      <button
        type="button"
        className="w-full text-left px-3 py-2.5 flex items-center gap-2 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        {/* Timestamp */}
        <span className="text-xs font-mono qt-text-secondary flex-shrink-0">
          {formatTimestamp(log.createdAt)}
        </span>

        {/* Type badge */}
        <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${badgeClass} flex-shrink-0`}>
          {typeLabel}
        </span>

        {/* Provider/model */}
        <span className="text-xs qt-text-secondary truncate min-w-0 flex-shrink">
          {log.provider}/{log.modelName}
        </span>

        {/* Spacer */}
        <span className="flex-1" />

        {/* Token summary */}
        {log.usage && (
          <span className="text-xs font-mono qt-text-secondary flex-shrink-0">
            {formatTokens(log)}
          </span>
        )}

        {/* Duration */}
        {log.durationMs != null && (
          <span className="text-xs qt-text-secondary flex-shrink-0">
            {formatDuration(log.durationMs)}
          </span>
        )}

        {/* Message link indicator */}
        {log.messageId && (
          <span className="text-xs qt-text-muted flex-shrink-0" title="Linked to a message">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </span>
        )}

        {/* Error indicator */}
        {log.response.error && (
          <span className="qt-text-destructive flex-shrink-0" title={log.response.error}>
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          </span>
        )}

        {/* Chevron */}
        <svg
          className={`w-4 h-4 qt-text-secondary transition-transform duration-150 flex-shrink-0 ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expanded detail - lazy rendered */}
      {expanded && (
        <div className="border-t qt-border">
          {/* Tabs */}
          <div className="flex border-b qt-border">
            {(['request', 'response', 'usage'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-2 text-xs font-medium transition-colors border-b-2 ${
                  activeTab === tab
                    ? 'qt-border-primary qt-text'
                    : 'border-transparent qt-text-secondary hover:qt-text'
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="px-3 py-3 max-h-80 overflow-y-auto text-xs">
            {activeTab === 'request' && <RequestTab log={log} />}
            {activeTab === 'response' && <ResponseTab log={log} />}
            {activeTab === 'usage' && <UsageTab log={log} />}
          </div>
        </div>
      )}
    </div>
  )
}

function RequestTab({ log }: { log: LLMLog }) {
  return (
    <div className="space-y-3">
      <div className="qt-surface-alt p-2 rounded space-y-1">
        <div className="flex justify-between">
          <span className="qt-text-secondary">Provider:</span>
          <span className="qt-text font-mono">{log.provider}</span>
        </div>
        <div className="flex justify-between">
          <span className="qt-text-secondary">Model:</span>
          <span className="qt-text font-mono">{log.modelName}</span>
        </div>
        <div className="flex justify-between">
          <span className="qt-text-secondary">Type:</span>
          <span className="qt-text font-mono">{log.type}</span>
        </div>
      </div>

      <div className="qt-surface-alt p-2 rounded space-y-1">
        <div className="flex justify-between">
          <span className="qt-text-secondary">Messages:</span>
          <span className="qt-text font-mono">{log.request.messageCount}</span>
        </div>
        <div className="flex justify-between">
          <span className="qt-text-secondary">Temperature:</span>
          <span className="qt-text font-mono">
            {log.request.temperature != null ? log.request.temperature : 'default'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="qt-text-secondary">Max Tokens:</span>
          <span className="qt-text font-mono">
            {log.request.maxTokens != null ? log.request.maxTokens : 'default'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="qt-text-secondary">Tools:</span>
          <span className="qt-text font-mono">{log.request.toolCount}</span>
        </div>
      </div>

      <div className="space-y-1.5">
        <h4 className="font-medium qt-text">Messages</h4>
        {log.request.messages.map((msg, idx) => (
          <MessageContentBlock key={idx} role={msg.role} contentLength={msg.contentLength} hasAttachments={msg.hasAttachments}>
            {msg.content || msg.contentPreview || ''}
          </MessageContentBlock>
        ))}
      </div>
    </div>
  )
}

function ResponseTab({ log }: { log: LLMLog }) {
  // Backward compat: use content, fall back to fullContent, then contentPreview for old entries
  const responseContent = log.response.content || log.response.fullContent || log.response.contentPreview || ''

  return (
    <div className="space-y-3">
      {log.response.error ? (
        <div className="p-2 qt-bg-destructive/10 border qt-border-destructive/20 rounded">
          <h4 className="font-medium qt-text-destructive mb-1">Error</h4>
          <p className="qt-text">{log.response.error}</p>
        </div>
      ) : (
        <div className="p-2 qt-bg-success/10 border qt-border-success/20 rounded">
          <p className="qt-text font-medium">Request completed successfully</p>
        </div>
      )}

      <div>
        <h4 className="font-medium qt-text mb-1">
          Response ({log.response.contentLength} chars)
        </h4>
        <ExpandableContent content={responseContent} />
      </div>
    </div>
  )
}

/** UI truncation threshold for display (full content is stored in DB) */
const UI_TRUNCATE_LENGTH = 500

function ExpandableContent({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false)
  const needsTruncation = content.length > UI_TRUNCATE_LENGTH

  return (
    <div>
      <pre className="font-mono whitespace-pre-wrap overflow-auto max-h-60 p-2 qt-surface-alt rounded">
        {expanded || !needsTruncation ? content : content.slice(0, UI_TRUNCATE_LENGTH) + '...'}
      </pre>
      {needsTruncation && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-primary hover:underline mt-1"
        >
          {expanded ? 'Show less' : `Show all ${content.length.toLocaleString()} chars`}
        </button>
      )}
    </div>
  )
}

function MessageContentBlock({ role, contentLength, hasAttachments, children }: {
  role: string
  contentLength: number
  hasAttachments: boolean
  children: string
}) {
  const [expanded, setExpanded] = useState(false)
  const needsTruncation = children.length > UI_TRUNCATE_LENGTH

  return (
    <div className="qt-surface-alt p-2 rounded">
      <div className="flex justify-between mb-1">
        <span className="qt-text-secondary font-mono">{role}</span>
        <span className="qt-text-secondary">
          {contentLength} chars
          {hasAttachments && ' (attachments)'}
        </span>
      </div>
      <p className="qt-text whitespace-pre-wrap break-words">
        {expanded || !needsTruncation ? children : children.slice(0, UI_TRUNCATE_LENGTH) + '...'}
      </p>
      {needsTruncation && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-primary hover:underline mt-1"
        >
          {expanded ? 'Show less' : `Show all ${contentLength.toLocaleString()} chars`}
        </button>
      )}
    </div>
  )
}

function UsageTab({ log }: { log: LLMLog }) {
  return (
    <div className="space-y-3">
      {log.usage && (
        <div className="qt-surface-alt p-3 rounded grid grid-cols-3 gap-3">
          <div className="text-center">
            <p className="qt-heading-4 qt-text">{log.usage.promptTokens.toLocaleString()}</p>
            <p className="qt-text-secondary mt-0.5">Prompt</p>
          </div>
          <div className="text-center">
            <p className="qt-heading-4 qt-text">{log.usage.completionTokens.toLocaleString()}</p>
            <p className="qt-text-secondary mt-0.5">Completion</p>
          </div>
          <div className="text-center">
            <p className="qt-heading-4 qt-text">{log.usage.totalTokens.toLocaleString()}</p>
            <p className="qt-text-secondary mt-0.5">Total</p>
          </div>
        </div>
      )}

      {log.cacheUsage && (
        <div className="qt-surface-alt p-2 rounded space-y-1">
          {log.cacheUsage.cacheCreationInputTokens !== undefined && (
            <div className="flex justify-between">
              <span className="qt-text-secondary">Cache Creation:</span>
              <span className="qt-text font-mono">{log.cacheUsage.cacheCreationInputTokens.toLocaleString()} tokens</span>
            </div>
          )}
          {log.cacheUsage.cacheReadInputTokens !== undefined && (
            <div className="flex justify-between">
              <span className="qt-text-secondary">Cache Read:</span>
              <span className="qt-text font-mono">{log.cacheUsage.cacheReadInputTokens.toLocaleString()} tokens</span>
            </div>
          )}
        </div>
      )}

      {log.durationMs != null && (
        <div className="qt-surface-alt p-2 rounded">
          <div className="flex justify-between">
            <span className="qt-text-secondary">Duration:</span>
            <span className="qt-text font-mono">{(log.durationMs / 1000).toFixed(2)}s</span>
          </div>
        </div>
      )}

      {!log.usage && !log.cacheUsage && log.durationMs == null && (
        <p className="qt-text-secondary p-2 qt-surface-alt rounded text-center">
          No usage data available for this log
        </p>
      )}
    </div>
  )
}
