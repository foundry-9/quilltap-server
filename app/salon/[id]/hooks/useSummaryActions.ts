'use client'

import { useCallback } from 'react'
import { showConfirmation } from '@/lib/alert'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { notifyQueueChange } from '@/components/layout/queue-status-badges'

interface UseSummaryActionsParams {
  chatId: string
}

/**
 * Salon actions over the chat's running context summary.
 *
 * Rebuilding discards the summary the moment it is confirmed and refills it
 * over the next few folds, so the confirm is not decoration — there is a
 * stretch where the chat has no summary at all.
 */
export function useSummaryActions({ chatId }: UseSummaryActionsParams) {
  const handleRebuildSummary = useCallback(async () => {
    const confirmed = await showConfirmation(
      'Discard this chat’s running summary and rebuild it from the beginning? The summary will be empty until the next few folds refill it.'
    )

    if (!confirmed) {
      return
    }

    try {
      const res = await fetch(`/api/v1/chats/${chatId}?action=rebuild-summary`, {
        method: 'POST',
      })

      if (res.ok) {
        showSuccessToast('Summary cleared — the Librarian is rebuilding it.')
        notifyQueueChange()
      } else {
        const errorData = await res.json().catch(() => ({}))
        showErrorToast(`Failed to rebuild the summary: ${errorData.error ?? res.statusText}`)
      }
    } catch {
      showErrorToast('Failed to rebuild the summary')
    }
  }, [chatId])

  return {
    handleRebuildSummary,
  }
}
