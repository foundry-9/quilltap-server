'use client'

import { useState, useEffect, useCallback } from 'react'
import { showErrorToast } from '@/lib/toast'
import type { LLMLog } from '@/lib/schemas/types'
import type { Message } from '../types'

interface UseLLMLogsParams {
  chatId: string
  messages: Message[]
}

export function useLLMLogs({
  chatId,
  messages,
}: UseLLMLogsParams) {
  // All logs for this chat (both chatId-linked and messageId-linked)
  const [allChatLogs, setAllChatLogs] = useState<LLMLog[]>([])
  const [loading, setLoading] = useState(false)

  // Inspector panel state
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [inspectorScrollToMessageId, setInspectorScrollToMessageId] = useState<string | null>(null)

  // Derive which messages have logs from the full dataset
  const [messagesWithLogs, setMessagesWithLogs] = useState<Set<string>>(new Set())

  // Fetch all logs for this chat using the combined endpoint
  const fetchLogs = useCallback(async () => {
    if (!chatId) return

    setLoading(true)
    try {
      const res = await fetch(`/api/v1/llm-logs?chatId=${chatId}&includeMessages=true`)
      if (res.ok) {
        const data = await res.json()
        const logs: LLMLog[] = data.logs || []
        setAllChatLogs(logs)

        // Derive messagesWithLogs from the full log set
        const messageIdsWithLogs = new Set<string>(
          logs
            .filter((log: LLMLog) => log.messageId)
            .map((log: LLMLog) => log.messageId!)
        )
        setMessagesWithLogs(messageIdsWithLogs)
      }
    } catch {
      // Silent fail - logging is not critical
    } finally {
      setLoading(false)
    }
  }, [chatId])

  // Fetch on mount and when messages change
  useEffect(() => {
    if (messages.length > 0) {
      fetchLogs()
    }
  }, [fetchLogs, messages.length])

  // Open inspector panel, optionally scrolled to a specific message's logs
  const handleViewLLMLogs = useCallback((messageId: string) => {
    setInspectorScrollToMessageId(messageId)
    setInspectorOpen(true)
  }, [])

  // Toggle inspector panel (for toolbar button / keyboard shortcut)
  const toggleInspector = useCallback(() => {
    setInspectorOpen(prev => {
      if (!prev) {
        // Opening - clear any previous scroll target
        setInspectorScrollToMessageId(null)
      }
      return !prev
    })
  }, [])

  // Close inspector
  const closeInspector = useCallback(() => {
    setInspectorOpen(false)
    setInspectorScrollToMessageId(null)
  }, [])

  // Refresh logs (e.g., after streaming completes)
  const refreshLogs = useCallback(() => {
    fetchLogs()
  }, [fetchLogs])

  return {
    messagesWithLogs,
    handleViewLLMLogs,
    // Inspector panel state
    allChatLogs,
    loading,
    inspectorOpen,
    inspectorScrollToMessageId,
    toggleInspector,
    closeInspector,
    refreshLogs,
  }
}
