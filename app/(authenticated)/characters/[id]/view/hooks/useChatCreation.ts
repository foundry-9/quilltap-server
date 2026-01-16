'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { clientLogger } from '@/lib/client-logger'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import type { TimestampConfig } from '@/lib/schemas/types'

interface UseChatCreationReturn {
  creatingChat: boolean
  handleCreateChat: (props: {
    characterId: string
    characterName: string | undefined
    selectedProfileId: string
    selectedUserCharacterId: string
    selectedImageProfileId: string | null
    scenario: string
    timestampConfig?: TimestampConfig | null
  }) => Promise<void>
}

export function useChatCreation(): UseChatCreationReturn {
  const router = useRouter()
  const [creatingChat, setCreatingChat] = useState(false)

  const handleCreateChat = useCallback(async (props: {
    characterId: string
    characterName: string | undefined
    selectedProfileId: string
    selectedUserCharacterId: string
    selectedImageProfileId: string | null
    scenario: string
    timestampConfig?: TimestampConfig | null
  }) => {
    const {
      characterId,
      characterName,
      selectedProfileId,
      selectedUserCharacterId,
      selectedImageProfileId,
      scenario,
      timestampConfig,
    } = props

    if (!selectedProfileId) {
      showErrorToast('Please select a connection profile')
      clientLogger.warn('Chat creation attempted without profile selection', { characterId })
      return
    }

    setCreatingChat(true)
    clientLogger.debug('Starting chat creation', {
      characterId,
      profileId: selectedProfileId,
      hasScenario: !!scenario,
      hasTimestampConfig: !!timestampConfig,
    })

    try {
      const participants: any[] = [
        {
          type: 'CHARACTER',
          characterId,
          connectionProfileId: selectedProfileId,
          imageProfileId: selectedImageProfileId || undefined,
        },
      ]

      if (selectedUserCharacterId) {
        participants.push({
          type: 'CHARACTER',
          characterId: selectedUserCharacterId,
          controlledBy: 'user',
        })
      }

      const res = await fetch('/api/v1/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          participants,
          title: `Chat with ${characterName}`,
          ...(scenario && { scenario }),
          ...(timestampConfig && timestampConfig.mode !== 'NONE' && { timestampConfig }),
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
