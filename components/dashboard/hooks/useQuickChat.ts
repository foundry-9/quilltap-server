'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import type { TimestampConfig } from '@/lib/schemas/types'

interface ConnectionProfile {
  id: string
  name: string
}

interface UserControlledCharacter {
  id: string
  name: string
  title: string | null
}

interface UseQuickChatReturn {
  loading: boolean
  profiles: ConnectionProfile[]
  userControlledCharacters: UserControlledCharacter[]
  selectedProfileId: string
  selectedPartnerId: string
  selectedImageProfileId: string | null
  scenario: string
  timestampConfig: TimestampConfig | null
  creatingChat: boolean
  setSelectedProfileId: (id: string) => void
  setSelectedPartnerId: (id: string) => void
  setSelectedImageProfileId: (id: string | null) => void
  setScenario: (scenario: string) => void
  setTimestampConfig: (config: TimestampConfig) => void
  fetchData: (characterId: string) => Promise<void>
  handleCreateChat: (characterId: string, characterName: string) => Promise<void>
  reset: () => void
}

export function useQuickChat(): UseQuickChatReturn {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([])
  const [userControlledCharacters, setUserControlledCharacters] = useState<UserControlledCharacter[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [selectedPartnerId, setSelectedPartnerId] = useState('')
  const [selectedImageProfileId, setSelectedImageProfileId] = useState<string | null>(null)
  const [scenario, setScenario] = useState('')
  const [timestampConfig, setTimestampConfig] = useState<TimestampConfig | null>(null)
  const [creatingChat, setCreatingChat] = useState(false)

  const reset = useCallback(() => {
    setSelectedProfileId('')
    setSelectedPartnerId('')
    setSelectedImageProfileId(null)
    setScenario('')
    setTimestampConfig(null)
  }, [])

  const fetchData = useCallback(async (characterId: string) => {
    setLoading(true)

    try {
      // Fetch profiles, user-controlled characters, character details, and default partner in parallel
      const [profilesRes, userCharsRes, characterRes, defaultPartnerRes] = await Promise.all([
        fetch('/api/v1/connection-profiles'),
        fetch('/api/v1/characters?controlledBy=user'),
        fetch(`/api/v1/characters/${characterId}`),
        fetch(`/api/v1/characters/${characterId}?action=default-partner`),
      ])

      let fetchedProfiles: ConnectionProfile[] = []
      if (profilesRes.ok) {
        const data = await profilesRes.json()
        const profiles = data.profiles || []
        fetchedProfiles = profiles.map((p: any) => ({ id: p.id, name: p.name }))
        setProfiles(fetchedProfiles)
      }

      if (userCharsRes.ok) {
        const data = await userCharsRes.json()
        const characters = data.characters || []

        setUserControlledCharacters(characters.map((c: any) => ({
          id: c.id,
          name: c.name,
          title: c.title || null,
        })))
      } else {
        console.warn('[useQuickChat] Failed to fetch user-controlled characters', {
          status: userCharsRes.status,
          statusText: userCharsRes.statusText,
        })
      }

      // Set default profile from character or first available
      if (characterRes.ok) {
        const { character } = await characterRes.json()
        if (character.defaultConnectionProfileId) {
          setSelectedProfileId(character.defaultConnectionProfileId)
        } else if (fetchedProfiles.length > 0) {
          setSelectedProfileId(fetchedProfiles[0].id)
        }
      }

      // Set default partner if available
      if (defaultPartnerRes.ok) {
        const data = await defaultPartnerRes.json()
        if (data.partnerId) {
          setSelectedPartnerId(data.partnerId)
        }
      }
    } catch (err) {
      console.error('Failed to fetch quick chat data', {
        error: err instanceof Error ? err.message : String(err),
        characterId,
      })
    } finally {
      setLoading(false)
    }
  }, [])

  const handleCreateChat = useCallback(async (characterId: string, characterName: string) => {
    if (!selectedProfileId) {
      showErrorToast('Please select a connection profile')
      console.warn('Quick chat creation attempted without profile selection', { characterId })
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
        },
      ]

      // Add user-controlled character as partner (not persona)
      if (selectedPartnerId) {
        participants.push({
          type: 'CHARACTER',
          characterId: selectedPartnerId,
          // User-controlled characters don't need a connection profile
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
      router.push(`/chats/${data.chat.id}`)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to start chat'
      showErrorToast(errorMsg)
      console.error('Failed to create quick chat', {
        error: errorMsg,
        characterId,
      })
    } finally {
      setCreatingChat(false)
    }
  }, [router, selectedProfileId, selectedPartnerId, selectedImageProfileId, scenario, timestampConfig])

  return {
    loading,
    profiles,
    userControlledCharacters,
    selectedProfileId,
    selectedPartnerId,
    selectedImageProfileId,
    scenario,
    timestampConfig,
    creatingChat,
    setSelectedProfileId,
    setSelectedPartnerId,
    setSelectedImageProfileId,
    setScenario,
    setTimestampConfig,
    fetchData,
    handleCreateChat,
    reset,
  }
}
