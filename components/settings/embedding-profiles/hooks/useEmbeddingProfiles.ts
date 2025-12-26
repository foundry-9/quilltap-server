'use client'

import { useState, useCallback } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { useAsyncOperation } from '@/hooks/useAsyncOperation'
import { fetchJson } from '@/lib/fetch-helpers'
import { showSuccessToast } from '@/lib/toast'
import type { ApiKey, EmbeddingModel, EmbeddingProfile } from '../types'

interface UseEmbeddingProfilesResult {
  profiles: EmbeddingProfile[]
  apiKeys: ApiKey[]
  embeddingModels: Record<string, EmbeddingModel[]>
  loading: boolean
  error: string | null
  loadData: () => Promise<void>
  fetchProfiles: () => Promise<void>
  triggerAutoAssociate: () => Promise<void>
}

/**
 * Hook to manage embedding profiles data fetching and state
 */
export function useEmbeddingProfiles(): UseEmbeddingProfilesResult {
  const [profiles, setProfiles] = useState<EmbeddingProfile[]>([])
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [embeddingModels, setEmbeddingModels] = useState<Record<string, EmbeddingModel[]>>({})

  const {
    loading,
    error,
    execute: executeLoad,
  } = useAsyncOperation<void>()

  const loadData = useCallback(async () => {
    clientLogger.debug('Loading embedding profiles tab data')
    await executeLoad(async () => {
      const [profilesRes, keysRes, modelsRes] = await Promise.all([
        fetchJson<EmbeddingProfile[]>('/api/embedding-profiles'),
        fetchJson<ApiKey[]>('/api/keys'),
        fetchJson<Record<string, EmbeddingModel[]>>('/api/embedding-profiles/models'),
      ])

      if (!profilesRes.ok) {
        throw new Error(profilesRes.error || 'Failed to fetch profiles')
      }
      if (!keysRes.ok) {
        clientLogger.error('Failed to fetch API keys', { error: keysRes.error })
      } else if (keysRes.data) {
        setApiKeys(keysRes.data)
      }
      if (!modelsRes.ok) {
        clientLogger.error('Failed to fetch embedding models', { error: modelsRes.error })
      } else if (modelsRes.data) {
        setEmbeddingModels(modelsRes.data)
      }

      if (profilesRes.data) {
        setProfiles(profilesRes.data)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // executeLoad is stable (empty deps in useAsyncOperation)

  const fetchProfiles = useCallback(async () => {
    clientLogger.debug('Fetching embedding profiles')
    const result = await fetchJson<EmbeddingProfile[]>('/api/embedding-profiles')
    if (!result.ok) {
      throw new Error(result.error || 'Failed to fetch profiles')
    }
    if (result.data) {
      setProfiles(result.data)
    }
  }, [])

  const triggerAutoAssociate = useCallback(async () => {
    clientLogger.debug('Triggering auto-association on embedding profiles tab mount')
    try {
      const response = await fetchJson<{
        success: boolean
        associations: Array<{ profileName: string; keyLabel: string }>
      }>('/api/keys/auto-associate', { method: 'POST' })
      if (response.ok && response.data?.associations?.length) {
        clientLogger.info('Auto-associated profiles with API keys', {
          count: response.data.associations.length,
        })
        // Show toast for each association
        response.data.associations.forEach((assoc) => {
          showSuccessToast(
            `${assoc.profileName} linked to API key "${assoc.keyLabel}"`,
            4000
          )
        })
      }
    } catch (error) {
      clientLogger.debug('Auto-association failed (non-critical)', { error })
    }
  }, [])

  return {
    profiles,
    apiKeys,
    embeddingModels,
    loading,
    error,
    loadData,
    fetchProfiles,
    triggerAutoAssociate,
  }
}
