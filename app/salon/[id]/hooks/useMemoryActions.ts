'use client'

import { useCallback } from 'react'
import { showConfirmation } from '@/lib/alert'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { confirmAndReextractChatMemories } from '@/lib/chat-utils'

interface UseMemoryActionsParams {
  chatId: string
  chatMemoryCount: number
  setChatMemoryCount: (count: number) => void
}

export function useMemoryActions({ chatId, chatMemoryCount, setChatMemoryCount }: UseMemoryActionsParams) {
  const handleDeleteChatMemories = useCallback(async () => {
    // Re-read before confirming. The rendered count is a subscription that a
    // dropped socket can leave behind, and a stale zero used to swallow this
    // click outright — no dialog, no toast, no log line. Ask the server, so
    // the dialog can never quote a number that is no longer true and a socket
    // that was down does not cost the user the action.
    let count = chatMemoryCount
    try {
      const countRes = await fetch(`/api/v1/memories?chatId=${chatId}`, { cache: 'no-store' })
      if (countRes.ok) {
        const countData = await countRes.json()
        count = countData.memoryCount || 0
        setChatMemoryCount(count)
      }
    } catch {
      // Fall through on the rendered count: a failed probe is not a reason to
      // refuse a delete the user asked for.
    }

    if (count === 0) {
      showErrorToast('This chat has no memories to delete')
      return
    }

    const confirmed = await showConfirmation(
      `Delete the memories extracted from this chat (${count} on record)? Hand-written entries, archived entries and consolidated digests stay on the shelf. This action cannot be undone.`
    )

    if (!confirmed) {
      return
    }

    try {
      const res = await fetch(`/api/v1/memories?chatId=${chatId}`, { method: 'DELETE' })

      if (res.ok) {
        const data = await res.json()
        // Manual, cold and digest rows are spared by the wipe (bug 201).
        const spared = typeof data.sparedCount === 'number' ? data.sparedCount : 0
        setChatMemoryCount(spared)
        showSuccessToast(spared > 0
          ? `Deleted ${data.deletedCount} memories; kept ${spared} hand-written, archived or digest entries`
          : `Deleted ${data.deletedCount} memories`)
      } else {
        const errorData = await res.json()
        showErrorToast(`Failed to delete memories: ${errorData.error}`)
      }
    } catch {
      showErrorToast('Failed to delete memories')
    }
  }, [chatId, chatMemoryCount, setChatMemoryCount])

  // The same wipe-and-rebuild as the Salon list and the Conversations tab
  // (#242): it used to queue extraction over the old rows without deleting.
  const handleReextractMemories = useCallback(async () => {
    await confirmAndReextractChatMemories(chatId)
  }, [chatId])

  return {
    handleDeleteChatMemories,
    handleReextractMemories,
  }
}
