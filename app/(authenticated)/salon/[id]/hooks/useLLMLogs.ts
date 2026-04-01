'use client'

import { useState, useEffect, useCallback } from 'react'
import { showErrorToast } from '@/lib/toast'
import type { LLMLog } from '@/lib/schemas/types'
import type { Message } from '../types'

interface UseLLMLogsParams {
  chatId: string
  messages: Message[]
  setLLMLogsForViewer: (logs: LLMLog[]) => void
  setSelectedMessageIdForLogs: (messageId: string | null) => void
  setLLMLogViewerOpen: (open: boolean) => void
}

export function useLLMLogs({
  chatId,
  messages,
  setLLMLogsForViewer,
  setSelectedMessageIdForLogs,
  setLLMLogViewerOpen,
}: UseLLMLogsParams) {
  // Track which messages have logs (for showing the button)
  const [messagesWithLogs, setMessagesWithLogs] = useState<Set<string>>(new Set())

  // Check which messages have LLM logs
  const checkMessagesForLogs = useCallback(async () => {
    if (!chatId || !messages.length) return

    // Get assistant message IDs
    const assistantMessageIds = messages
      .filter(m => m.role === 'ASSISTANT')
      .map(m => m.id)

    if (assistantMessageIds.length === 0) return

    try {
      // Batch check - get all logs for this chat and extract message IDs
      const res = await fetch(`/api/v1/llm-logs?chatId=${chatId}&limit=1000`)
      if (res.ok) {
        const data = await res.json()
        const messageIdsWithLogs = new Set<string>(
          data.logs
            .filter((log: LLMLog) => log.messageId)
            .map((log: LLMLog) => log.messageId!)
        )
        setMessagesWithLogs(messageIdsWithLogs)
      }
    } catch {
      // Silent fail - logging is not critical
    }
  }, [chatId, messages])

  // Call on mount and when messages change
  useEffect(() => {
    checkMessagesForLogs()
  }, [checkMessagesForLogs])

  // Handle viewing LLM logs
  const handleViewLLMLogs = useCallback(async (messageId: string) => {
    try {
      const res = await fetch(`/api/v1/llm-logs?messageId=${messageId}`)
      if (!res.ok) throw new Error('Failed to fetch logs')

      const data = await res.json()
      if (data.logs && data.logs.length > 0) {
        setLLMLogsForViewer(data.logs)
        setSelectedMessageIdForLogs(messageId)
        setLLMLogViewerOpen(true)
      }
    } catch (error) {
      console.error('Failed to fetch LLM logs:', error)
      showErrorToast('Failed to load LLM logs')
    }
  }, [setLLMLogsForViewer, setSelectedMessageIdForLogs, setLLMLogViewerOpen])

  return {
    messagesWithLogs,
    handleViewLLMLogs,
  }
}
