'use client'

import { useState, useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
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

  // Fetch all logs for this chat using the combined endpoint (only fetch when messages exist)
  const { data: logsData, isLoading, refetch: refetchLogs } = useQuery({
    queryKey: queryKeys.llmLogs.byChat(chatId),
    queryFn: ({ signal }) =>
      apiFetch<{ logs: LLMLog[] }>(`/api/v1/llm-logs?chatId=${chatId}&includeMessages=true`, { signal }),
    enabled: messages.length > 0,
  })

  const allChatLogs = useMemo(() => logsData?.logs || [], [logsData])

  // Derive which messages have logs from the full dataset
  const messagesWithLogs = useMemo(() => {
    return new Set<string>(
      allChatLogs
        .filter((log: LLMLog) => log.messageId)
        .map((log: LLMLog) => log.messageId!)
    )
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
    refetchLogs()
  }, [refetchLogs])

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
