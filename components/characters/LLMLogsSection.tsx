'use client'

import { useState } from 'react'
import useSWR from 'swr'
import type { LLMLog } from '@/lib/schemas/types'
import LLMLogViewerModal from '@/components/chat/LLMLogViewerModal'

interface LLMLogsSectionProps {
  characterId: string
}

export default function LLMLogsSection({ characterId }: LLMLogsSectionProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [selectedLog, setSelectedLog] = useState<LLMLog | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)

  const { data, isLoading } = useSWR<{ logs: LLMLog[] }>(
    isExpanded ? `/api/v1/llm-logs?characterId=${characterId}&limit=10` : null
  )
  const logs = data?.logs ?? []

  const handleViewLog = (log: LLMLog) => {
    setSelectedLog(log)
    setIsModalOpen(true)
  }

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div className="mt-8 border qt-border-default rounded-lg overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between qt-bg-muted/30 hover:qt-bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"
            />
          </svg>
          <span className="font-medium">LLM Logs</span>
          {logs.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full qt-bg-primary/10 text-primary">{logs.length}</span>
          )}
        </div>
        <svg
          className={`w-5 h-5 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isExpanded && (
        <div className="p-4">
          {isLoading ? (
            <div className="text-center py-4 qt-text-secondary">
              <svg className="animate-spin h-5 w-5 mx-auto mb-2" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              Loading...
            </div>
          ) : logs.length === 0 ? (
            <p className="text-center py-4 qt-text-secondary text-sm">
              No LLM logs for this character yet. Use the AI wizard to generate character content.
            </p>
          ) : (
            <div className="space-y-2">
              {logs.map((log) => (
                <div
                  key={log.id}
                  onClick={() => handleViewLog(log)}
                  className="p-3 border qt-border-default rounded hover:qt-bg-muted/30 cursor-pointer transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 text-xs rounded qt-bg-primary/10 text-primary">
                        {log.type === 'CHARACTER_WIZARD' ? 'Wizard' : log.type}
                      </span>
                      <span className="text-sm">
                        {log.provider}/{log.modelName}
                      </span>
                    </div>
                    <span className="text-xs qt-text-secondary">{formatDate(log.createdAt)}</span>
                  </div>
                  {log.usage && (
                    <div className="mt-1 text-xs qt-text-secondary">
                      {log.usage.totalTokens.toLocaleString()} tokens
                      {log.durationMs && ` • ${(log.durationMs / 1000).toFixed(1)}s`}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <LLMLogViewerModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false)
          setSelectedLog(null)
        }}
        logs={selectedLog ? [selectedLog] : []}
      />
    </div>
  )
}
