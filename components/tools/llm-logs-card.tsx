'use client'

import { useState, useEffect, useCallback } from 'react'
import type { LLMLog } from '@/lib/schemas/types'
import LLMLogViewerModal from '@/components/chat/LLMLogViewerModal'

export default function LLMLogsCard() {
  const [logs, setLogs] = useState<LLMLog[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedLog, setSelectedLog] = useState<LLMLog | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      // Fetch recent logs (all types)
      const res = await fetch('/api/v1/llm-logs?limit=20')
      if (!res.ok) throw new Error('Failed to fetch LLM logs')
      const data = await res.json()
      setLogs(data.logs || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch logs')
      setLogs([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  const handleViewLog = (log: LLMLog) => {
    setSelectedLog(log)
    setIsModalOpen(true)
  }

  const handleCloseModal = () => {
    setIsModalOpen(false)
    setSelectedLog(null)
  }

  const formatDate = (dateString: string): string => {
    try {
      return new Date(dateString).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    } catch {
      return dateString
    }
  }

  const getTypeLabel = (type: string): string => {
    const labels: Record<string, string> = {
      'CHAT_MESSAGE': 'Chat',
      'TOOL_CONTINUATION': 'Tool',
      'MEMORY_EXTRACTION': 'Memory',
      'TITLE_GENERATION': 'Title',
      'CONTEXT_COMPRESSION': 'Compression',
      'SUMMARIZATION': 'Summary',
      'IMAGE_PROMPT_CRAFTING': 'Image Prompt',
      'CHARACTER_WIZARD': 'Wizard',
      'IMAGE_DESCRIPTION': 'Image Desc',
    }
    return labels[type] || type
  }

  return (
    <div className="qt-card p-6">
      {/* Header */}
      <div className="flex items-start gap-4 mb-6">
        <div className="flex-1">
          <h2 className="text-2xl font-bold text-foreground mb-1">
            LLM Logs
          </h2>
          <p className="qt-text-small">
            Recent LLM API requests and responses
          </p>
        </div>
        <div className="flex-shrink-0 text-primary">
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
          </svg>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-destructive/10 border border-destructive text-destructive px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      {/* Refresh Button */}
      <div className="mb-4">
        <button
          onClick={fetchLogs}
          disabled={loading}
          className="qt-button qt-button-secondary flex items-center gap-2"
        >
          <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh
        </button>
      </div>

      {/* Logs List */}
      {loading ? (
        <div className="text-center py-6 text-muted-foreground">
          <svg className="animate-spin h-6 w-6 mx-auto mb-2" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Loading logs...
        </div>
      ) : logs.length === 0 ? (
        <div className="qt-card p-6 text-center">
          <svg className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
          </svg>
          <p className="qt-text-small">No LLM logs yet. Send a message or use other LLM features to generate logs.</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[300px] overflow-y-auto">
          {logs.map((log) => (
            <div
              key={log.id}
              onClick={() => handleViewLog(log)}
              className="qt-card p-3 flex items-center justify-between hover:bg-muted/50 transition-colors cursor-pointer"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 text-xs rounded bg-primary/10 text-primary">
                    {getTypeLabel(log.type)}
                  </span>
                  <span className="qt-text-primary truncate text-sm">
                    {log.provider}/{log.modelName}
                  </span>
                </div>
                <div className="flex gap-4 mt-1 qt-text-small">
                  <span>{formatDate(log.createdAt)}</span>
                  {log.usage && (
                    <span>{log.usage.totalTokens.toLocaleString()} tokens</span>
                  )}
                  {log.durationMs && (
                    <span>{(log.durationMs / 1000).toFixed(1)}s</span>
                  )}
                </div>
              </div>
              <div className="ml-4">
                <svg className="w-5 h-5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Log Viewer Modal */}
      <LLMLogViewerModal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        logs={selectedLog ? [selectedLog] : []}
      />
    </div>
  )
}
