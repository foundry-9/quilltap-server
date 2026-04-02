'use client'

import { useCallback } from 'react'
import { showConfirmation } from '@/lib/alert'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { notifyQueueChange } from '@/components/layout/queue-status-badges'
import type { Chat } from '../types'

interface UseMemoryActionsParams {
  chatId: string
  chatMemoryCount: number
  setChatMemoryCount: (count: number) => void
  chat: Chat | null
}

export function useMemoryActions({ chatId, chatMemoryCount, setChatMemoryCount, chat }: UseMemoryActionsParams) {
  const handleDeleteChatMemories = useCallback(async () => {
    if (chatMemoryCount === 0) {
      return
    }

    const confirmed = await showConfirmation(
      `Delete all ${chatMemoryCount} memories created from this chat? This action cannot be undone.`
    )

    if (!confirmed) {
      return
    }

    try {
      const res = await fetch(`/api/v1/memories?chatId=${chatId}`, { method: 'DELETE' })

      if (res.ok) {
        const data = await res.json()
        setChatMemoryCount(0)
        showSuccessToast(`Deleted ${data.deletedCount} memories`)
      } else {
        const errorData = await res.json()
        showErrorToast(`Failed to delete memories: ${errorData.error}`)
      }
    } catch {
      showErrorToast('Failed to delete memories')
    }
  }, [chatId, chatMemoryCount, setChatMemoryCount])

  const handleReextractMemories = useCallback(async () => {
    const characterParticipant = chat?.participants.find(p => p.type === 'CHARACTER' && p.isActive)
    if (!characterParticipant?.character) {
      showErrorToast('Cannot re-extract memories: no active character in chat')
      return
    }

    const confirmed = await showConfirmation(
      `Queue memory extraction jobs for all messages in this chat? This will process the entire conversation history.`
    )

    if (!confirmed) {
      return
    }

    try {
      const res = await fetch(`/api/v1/chats/${chatId}?action=queue-memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          characterId: characterParticipant.character.id,
          characterName: characterParticipant.character.name,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        showSuccessToast(`Queued ${data.jobCount} memory extraction jobs`)
        notifyQueueChange()
      } else {
        const errorData = await res.json()
        showErrorToast(`Failed to queue memory extraction: ${errorData.error}`)
      }
    } catch {
      showErrorToast('Failed to queue memory extraction')
    }
  }, [chatId, chat])

  return {
    handleDeleteChatMemories,
    handleReextractMemories,
  }
}
