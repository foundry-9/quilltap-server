'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { clientLogger } from '@/lib/client-logger'
import { showErrorToast, showSuccessToast } from '@/lib/toast'

interface UseChatCreationReturn {
  creatingChat: boolean
  handleCreateChat: (props: {
    characterId: string
    characterName: string | undefined
    selectedProfileId: string
    selectedPersonaId: string
    selectedImageProfileId: string | null
  }) => Promise<void>
}

export function useChatCreation(): UseChatCreationReturn {
  const router = useRouter()
  const [creatingChat, setCreatingChat] = useState(false)

  const handleCreateChat = useCallback(async (props: {
    characterId: string
    characterName: string | undefined
    selectedProfileId: string
    selectedPersonaId: string
    selectedImageProfileId: string | null
  }) => {
    const {
      characterId,
      characterName,
      selectedProfileId,
      selectedPersonaId,
      selectedImageProfileId,
    } = props

    if (!selectedProfileId) {
      showErrorToast('Please select a connection profile')
      clientLogger.warn('Chat creation attempted without profile selection', { characterId })
      return
    }

    setCreatingChat(true)
    clientLogger.debug('Starting chat creation', { characterId, profileId: selectedProfileId })

    try {
      const participants: any[] = [
        {
          type: 'CHARACTER',
          characterId,
          connectionProfileId: selectedProfileId,
          imageProfileId: selectedImageProfileId || undefined,
        },
      ]

      if (selectedPersonaId) {
        participants.push({
          type: 'PERSONA',
          personaId: selectedPersonaId,
        })
      }

      const res = await fetch('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          participants,
          title: `Chat with ${characterName}`,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to create chat')
      }

      const data = await res.json()
      showSuccessToast('Chat created successfully')
      clientLogger.info('Chat created successfully', { chatId: data.chat.id, characterId })
      router.push(`/chats/${data.chat.id}`)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to start chat'
      showErrorToast(errorMsg)
      clientLogger.error('Failed to create chat', {
        error: errorMsg,
        characterId,
      })
    } finally {
      setCreatingChat(false)
    }
  }, [router])

  return { creatingChat, handleCreateChat }
}
