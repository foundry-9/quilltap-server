'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import type { TimestampConfig } from '@/lib/schemas/types'
import type { OutfitSelection } from '@/components/wardrobe'

interface UseChatCreationReturn {
  creatingChat: boolean
  handleCreateChat: (props: {
    characterId: string
    characterName: string | undefined
    selectedProfileId: string
    selectedUserCharacterId: string
    selectedImageProfileId: string | null
    selectedSystemPromptId?: string
    scenario: string
    scenarioId?: string
    timestampConfig?: TimestampConfig | null
    avatarGenerationEnabled?: boolean
    outfitSelections?: OutfitSelection[]
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
    selectedSystemPromptId?: string
    scenario: string
    scenarioId?: string
    timestampConfig?: TimestampConfig | null
    avatarGenerationEnabled?: boolean
    outfitSelections?: OutfitSelection[]
  }) => {
    const {
      characterId,
      characterName,
      selectedProfileId,
      selectedUserCharacterId,
      selectedImageProfileId,
      selectedSystemPromptId,
      scenario,
      scenarioId,
      timestampConfig,
      avatarGenerationEnabled,
      outfitSelections,
    } = props

    if (!selectedProfileId) {
      showErrorToast('Please select a connection profile')
      return
    }

    setCreatingChat(true)

    try {
      const participants: any[] = [
        {
          type: 'CHARACTER',
          characterId,
          connectionProfileId: selectedProfileId,
          imageProfileId: selectedImageProfileId || undefined,
          selectedSystemPromptId: selectedSystemPromptId || undefined,
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
          ...(scenarioId ? { scenarioId } : scenario ? { scenario } : {}),
          ...(timestampConfig && timestampConfig.mode !== 'NONE' && { timestampConfig }),
          ...(avatarGenerationEnabled && { avatarGenerationEnabled }),
          ...(outfitSelections && outfitSelections.length > 0 && { outfitSelections }),
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to create chat')
      }

      const data = await res.json()
      showSuccessToast('Chat created successfully')
      router.push(`/salon/${data.chat.id}`)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to start chat'
      showErrorToast(errorMsg)
      console.error('Failed to create chat', {
        error: errorMsg,
        characterId,
      })
    } finally {
      setCreatingChat(false)
    }
  }, [router])

  return { creatingChat, handleCreateChat }
}
