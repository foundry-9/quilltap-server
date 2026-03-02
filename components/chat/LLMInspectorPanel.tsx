'use client'

import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { SlideOverPanel } from '@/components/ui/SlideOverPanel'
import LLMInspectorEntry from './LLMInspectorEntry'
import type { LLMLog, LLMLogType } from '@/lib/schemas/types'

type FilterCategory = 'all' | 'chat' | 'memory' | 'system' | 'image' | 'safety' | 'other'

const FILTER_GROUPS: Record<FilterCategory, LLMLogType[] | null> = {
  all: null,
  chat: ['CHAT_MESSAGE', 'TOOL_CONTINUATION'],
  memory: ['MEMORY_EXTRACTION'],
  system: ['TITLE_GENERATION', 'SUMMARIZATION', 'CONTEXT_COMPRESSION'],
  image: ['IMAGE_PROMPT_CRAFTING', 'IMAGE_DESCRIPTION', 'APPEARANCE_RESOLUTION'],
  safety: ['DANGER_CLASSIFICATION'],
  other: ['CHARACTER_WIZARD', 'AI_IMPORT'],
}

const FILTER_LABELS: Record<FilterCategory, string> = {
  all: 'All',
  chat: 'Chat Messages',
  memory: 'Memory',
  system: 'System Ops',
  image: 'Image',
  safety: 'Safety',
  other: 'Other',
}

interface LLMInspectorPanelProps {
  isOpen: boolean
  onClose: () => void
  chatId: string
  logs: LLMLog[]
  loading: boolean
  scrollToMessageId?: string | null
  onRefresh: () => void
  loggingEnabled: boolean
}

export default function LLMInspectorPanel({
  isOpen,
  onClose,
  logs,
  loading,
  scrollToMessageId,
  onRefresh,
  loggingEnabled,
}: Readonly<LLMInspectorPanelProps>) {
  const [filter, setFilter] = useState<FilterCategory>('all')
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Chronological order (oldest first) - logs come sorted DESC, so reverse
  const chronologicalLogs = useMemo(() => [...logs].reverse(), [logs])

  // Filter logs client-side
  const filteredLogs = useMemo(() => {
    const types = FILTER_GROUPS[filter]
    if (!types) return chronologicalLogs
    return chronologicalLogs.filter(log => types.includes(log.type))
  }, [chronologicalLogs, filter])

  // Scroll to entry when opened from a per-message button
  // Uses data-log-message-id attribute on DOM elements instead of refs
  useEffect(() => {
    if (!isOpen || !scrollToMessageId || filteredLogs.length === 0) return

    // Find the target log to confirm it exists in filtered results
    const targetLog = filteredLogs.find(log => log.messageId === scrollToMessageId)
    if (!targetLog) return

    // Delay to allow panel animation and render to complete
    const timer = setTimeout(() => {
      const container = scrollContainerRef.current
      if (!container) return

      const targetEl = container.querySelector(`[data-log-id="${targetLog.id}"]`)
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [isOpen, scrollToMessageId, filteredLogs])

  const headerActions = (
    <div className="flex items-center gap-2">
      {/* Entry count */}
      <span className="text-xs qt-text-secondary">
        {filteredLogs.length} {filteredLogs.length === 1 ? 'entry' : 'entries'}
      </span>

      {/* Filter select */}
      <select
        value={filter}
        onChange={(e) => setFilter(e.target.value as FilterCategory)}
        className="qt-input text-xs py-1 px-2 h-auto"
        aria-label="Filter log entries"
      >
        {Object.entries(FILTER_LABELS).map(([key, label]) => (
          <option key={key} value={key}>{label}</option>
        ))}
      </select>

      {/* Refresh button */}
      <button
        type="button"
        onClick={onRefresh}
        className="text-muted-foreground hover:text-foreground transition-colors p-1"
        aria-label="Refresh logs"
        title="Refresh logs"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      </button>
    </div>
  )

  return (
    <SlideOverPanel
      isOpen={isOpen}
      onClose={onClose}
      title="LLM Inspector"
      headerActions={headerActions}
      ariaLabel="LLM Inspector Panel"
    >
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto px-3 py-3"
      >
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
          </div>
        ) : !loggingEnabled ? (
          <div className="text-center py-12 px-4">
            <svg className="w-10 h-10 mx-auto mb-3 qt-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
            <p className="text-sm qt-text-secondary">LLM logging is disabled.</p>
            <p className="text-xs qt-text-muted mt-1">Enable it in Chat Settings to record API interactions.</p>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="text-center py-12 px-4">
            <svg className="w-10 h-10 mx-auto mb-3 qt-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-sm qt-text-secondary">No log entries yet.</p>
            <p className="text-xs qt-text-muted mt-1">Send a message to start recording LLM interactions.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredLogs.map((log) => (
              <LLMInspectorEntry
                key={log.id}
                log={log}
                isHighlighted={scrollToMessageId ? log.messageId === scrollToMessageId : false}
              />
            ))}
          </div>
        )}
      </div>
    </SlideOverPanel>
  )
}
