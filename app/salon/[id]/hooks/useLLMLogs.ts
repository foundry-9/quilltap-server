'use client'

import { useState, useEffect, useCallback } from 'react'
import useSWR from 'swr'
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
  // Inspector panel state
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [inspectorScrollToMessageId, setInspectorScrollToMessageId] = useState<string | null>(null)

  // Derive which messages have logs from the full dataset
  const [messagesWithLogs, setMessagesWithLogs] = useState<Set<string>>(new Set())

  // Fetch all logs for this chat using the combined endpoint (only fetch when messages exist)
  const { data: logsData, isLoading, mutate: mutateLogs } = useSWR<{ logs: LLMLog[] }>(
    messages.length > 0 ? `/api/v1/llm-logs?chatId=${chatId}&includeMessages=true` : null
  )

  const allChatLogs = logsData?.logs || []

  // Derive messagesWithLogs whenever logs change
  useEffect(() => {
    const messageIdsWithLogs = new Set<string>(
      allChatLogs
        .filter((log: LLMLog) => log.messageId)
        .map((log: LLMLog) => log.messageId!)
    )
    setMessagesWithLogs(messageIdsWithLogs)
  }, [allChatLogs])

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
    mutateLogs()
  }, [mutateLogs])

  return {
    messagesWithLogs,
    handleViewLLMLogs,
    // Inspector panel state
    allChatLogs,
    loading: isLoading,
    inspectorOpen,
    inspectorScrollToMessageId,
    toggleInspector,
    closeInspector,
    refreshLogs,
  }
}
