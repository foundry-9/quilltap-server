'use client'

import { useState, useCallback } from 'react'
import { useAsyncOperation } from '@/hooks/useAsyncOperation'
import { useAutoAssociate } from '@/hooks/useAutoAssociate'
import { fetchJson } from '@/lib/fetch-helpers'
import { getErrorMessage } from '@/lib/error-utils'
import type { ConnectionProfile, Tag, ApiKey, ProviderConfig } from '../types'

/**
 * Hook for managing connection profiles data
 * Handles fetching, deletion, and message counting
 */
export function useConnectionProfiles() {
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([])
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [providers, setProviders] = useState<ProviderConfig[]>([])
  const [cheapDefaultProfileId, setCheapDefaultProfileId] = useState<string | null>(null)

  const fetchOp = useAsyncOperation<ConnectionProfile[]>()
  const deleteOp = useAsyncOperation<any>()
  const triggerAutoAssociate = useAutoAssociate()

  const countMessagesPerProfile = useCallback(
    async (profilesList: ConnectionProfile[]) => {
      try {
        // Initialize message counts for all profiles
        const messageCounts: Record<string, number> = {}
        profilesList.forEach((p) => {
          messageCounts[p.id] = 0
        })

        // Fetch all chats to analyze message usage
        const chatsRes = await fetch('/api/v1/chats')
        if (!chatsRes.ok) return messageCounts

        const chatsData = await chatsRes.json()
        const chats = chatsData.chats || []
        if (!Array.isArray(chats)) return messageCounts

        // For each chat, count messages by profile
        await Promise.all(
          chats.map(async (chat: any) => {
            try {
              // Get chat with messages from v1 API
              const chatRes = await fetch(`/api/v1/chats/${chat.id}`)
              if (!chatRes.ok) return

              const chatData = await chatRes.json()
              const messages = chatData.chat?.messages
              if (!Array.isArray(messages)) return

              // Get CHARACTER participants with their connection profiles
              const characterParticipants = (chat.participants || []).filter(
                (p: any) => p.type === 'CHARACTER'
              )

              if (characterParticipants.length === 0) return

              // Count ASSISTANT messages
              // Distribute messages among character participants based on conversation flow
              const assistantMessages = messages.filter((m: any) => m.role === 'ASSISTANT')

              if (assistantMessages.length === 0) return

              // Simple strategy: if only one character, assign all assistant messages to them
              // If multiple characters, assign based on alternating pattern or message order
              if (characterParticipants.length === 1) {
                const profileId = characterParticipants[0].connectionProfileId
                if (profileId && profileId in messageCounts) {
                  messageCounts[profileId] += assistantMessages.length
                }
              } else {
                // For multiple participants, use a round-robin approach based on message index
                assistantMessages.forEach((msg: any, index: number) => {
                  const participantIndex = index % characterParticipants.length
                  const profileId = characterParticipants[participantIndex].connectionProfileId
                  if (profileId && profileId in messageCounts) {
                    messageCounts[profileId]++
                  }
                })
              }
            } catch (err) {
              console.error(`Error processing chat ${chat.id}`, { error: getErrorMessage(err) })
            }
          })
        )

        return messageCounts
      } catch (err) {
        console.error('Error counting messages per profile', { error: getErrorMessage(err) })
        return {}
      }
    },
    []
  )

  const fetchProfiles = useCallback(async () => {
    return await fetchOp.execute(async () => {
      // Add cache busting timestamp to force fresh data
      const result = await fetchJson<{ profiles: ConnectionProfile[], count: number }>(`/api/v1/connection-profiles?t=${Date.now()}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
        },
      })

      if (!result.ok) {
        throw new Error(result.error || 'Failed to fetch profiles')
      }

      const data = result.data?.profiles || []

      // Tags are already included in the profile response from /api/profiles
      // No need to fetch them separately
      setProfiles(data)
      return data
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // fetchOp.execute is stable (empty deps in useAsyncOperation)

  const fetchApiKeys = useCallback(async () => {
    try {
      const result = await fetchJson<{ apiKeys: ApiKey[], count: number }>('/api/v1/api-keys')
      if (result.ok) {
        setApiKeys(result.data?.apiKeys || [])
      } else {
        throw new Error(result.error)
      }
    } catch (err) {
      console.error('Failed to fetch API keys', { error: getErrorMessage(err) })
    }
  }, [])

  const fetchProviders = useCallback(async () => {
    try {
      const result = await fetchJson<{ providers: ProviderConfig[], count: number }>('/api/v1/providers')
      if (result.ok) {
        const providerList = result.data?.providers || []
        setProviders(providerList)
      } else {
        throw new Error(result.error)
      }
    } catch (err) {
      console.error('Failed to fetch providers', { error: getErrorMessage(err) })
    }
  }, [])

  const fetchChatSettings = useCallback(async () => {
    try {
      const result = await fetchJson<any>('/api/v1/settings/chat')
      if (result.ok) {
        setCheapDefaultProfileId(result.data?.cheapLLMSettings?.defaultCheapProfileId || null)
      }
    } catch (err) {
      console.error('Error fetching chat settings', { error: getErrorMessage(err) })
    }
  }, [])

  const handleDelete = useCallback(
    async (id: string) => {
      const result = await deleteOp.execute(async () => {
        const fetchResult = await fetchJson(`/api/v1/connection-profiles/${id}`, { method: 'DELETE' })
        if (!fetchResult.ok) throw new Error(fetchResult.error || 'Failed to delete profile')
        return fetchResult.data
      })

      if (result) {
        await fetchProfiles()
      }

      return result
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [] // deleteOp.execute and fetchProfiles are stable
  )

  return {
    profiles,
    apiKeys,
    providers,
    cheapDefaultProfileId,
    fetchOp,
    deleteOp,
    fetchProfiles,
    fetchApiKeys,
    fetchProviders,
    fetchChatSettings,
    handleDelete,
    triggerAutoAssociate,
  }
}
