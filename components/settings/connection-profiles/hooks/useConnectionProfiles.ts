'use client'

import { useState, useCallback } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { useAsyncOperation } from '@/hooks/useAsyncOperation'
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

  const countMessagesPerProfile = useCallback(
    async (profilesList: ConnectionProfile[]) => {
      try {
        // Initialize message counts for all profiles
        const messageCounts: Record<string, number> = {}
        profilesList.forEach((p) => {
          messageCounts[p.id] = 0
        })

        // Fetch all chats to analyze message usage
        const chatsRes = await fetch('/api/chats')
        if (!chatsRes.ok) return messageCounts

        const chats = await chatsRes.json()
        if (!Array.isArray(chats)) return messageCounts

        // For each chat, count messages by profile
        await Promise.all(
          chats.map(async (chat: any) => {
            try {
              // Get messages for this chat
              const messagesRes = await fetch(`/api/chats/${chat.id}/messages`)
              if (!messagesRes.ok) return

              const messages = await messagesRes.json()
              if (!Array.isArray(messages.messages)) return

              // Get CHARACTER participants with their connection profiles
              const characterParticipants = (chat.participants || []).filter(
                (p: any) => p.type === 'CHARACTER'
              )

              if (characterParticipants.length === 0) return

              // Count ASSISTANT messages
              // Distribute messages among character participants based on conversation flow
              const assistantMessages = messages.messages.filter((m: any) => m.role === 'ASSISTANT')

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
              clientLogger.error(`Error processing chat ${chat.id}`, { error: getErrorMessage(err) })
            }
          })
        )

        return messageCounts
      } catch (err) {
        clientLogger.error('Error counting messages per profile', { error: getErrorMessage(err) })
        return {}
      }
    },
    []
  )

  const fetchProfiles = useCallback(async () => {
    return await fetchOp.execute(async () => {
      clientLogger.debug('Fetching connection profiles')
      // Add cache busting timestamp to force fresh data
      const result = await fetchJson<ConnectionProfile[]>(`/api/profiles?t=${Date.now()}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
        },
      })

      if (!result.ok) {
        throw new Error(result.error || 'Failed to fetch profiles')
      }

      const data = result.data || []

      // Tags are already included in the profile response from /api/profiles
      // No need to fetch them separately
      setProfiles(data)
      clientLogger.debug('Profiles loaded successfully', { count: data.length })
      return data
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // fetchOp.execute is stable (empty deps in useAsyncOperation)

  const fetchApiKeys = useCallback(async () => {
    try {
      clientLogger.debug('Fetching API keys')
      const result = await fetchJson<ApiKey[]>('/api/keys')
      if (result.ok) {
        setApiKeys(result.data || [])
        clientLogger.debug('API keys loaded', { count: result.data?.length })
      } else {
        throw new Error(result.error)
      }
    } catch (err) {
      clientLogger.error('Failed to fetch API keys', { error: getErrorMessage(err) })
    }
  }, [])

  const fetchProviders = useCallback(async () => {
    try {
      clientLogger.debug('Fetching providers configuration')
      const result = await fetchJson<{ providers: ProviderConfig[] }>('/api/providers')
      if (result.ok) {
        const providerList = result.data?.providers || []
        setProviders(providerList)
        clientLogger.debug('Providers loaded', {
          count: providerList.length,
          providers: providerList.map((p: ProviderConfig) => p.name),
        })
      } else {
        throw new Error(result.error)
      }
    } catch (err) {
      clientLogger.error('Failed to fetch providers', { error: getErrorMessage(err) })
    }
  }, [])

  const fetchChatSettings = useCallback(async () => {
    try {
      const result = await fetchJson<any>('/api/chat-settings')
      if (result.ok) {
        setCheapDefaultProfileId(result.data?.cheapLLMSettings?.defaultCheapProfileId || null)
      }
    } catch (err) {
      clientLogger.error('Error fetching chat settings', { error: getErrorMessage(err) })
    }
  }, [])

  const handleDelete = useCallback(
    async (id: string) => {
      const result = await deleteOp.execute(async () => {
        clientLogger.debug('Deleting connection profile', { profileId: id })
        const fetchResult = await fetchJson(`/api/profiles/${id}`, { method: 'DELETE' })
        if (!fetchResult.ok) throw new Error(fetchResult.error || 'Failed to delete profile')
        clientLogger.debug('Profile deleted successfully', { profileId: id })
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
  }
}
