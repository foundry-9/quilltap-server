'use client'

import { useState, useCallback } from 'react'
import { useAsyncOperation } from '@/hooks/useAsyncOperation'
import { useAutoAssociate } from '@/hooks/useAutoAssociate'
import { fetchJson } from '@/lib/fetch-helpers'
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

  const triggerAutoAssociate = useAutoAssociate()

  const loadData = useCallback(async () => {
    await executeLoad(async () => {
      const [profilesRes, keysRes, modelsRes] = await Promise.all([
        fetchJson<{ profiles: EmbeddingProfile[]; count: number }>('/api/v1/embedding-profiles'),
        fetchJson<{ apiKeys: ApiKey[]; count: number }>('/api/v1/api-keys'),
        fetchJson<Record<string, EmbeddingModel[]>>('/api/v1/embedding-profiles?action=list-models'),
      ])

      if (!profilesRes.ok) {
        throw new Error(profilesRes.error || 'Failed to fetch profiles')
      }
      if (!keysRes.ok) {
        console.error('Failed to fetch API keys', { error: keysRes.error })
      } else if (keysRes.data?.apiKeys) {
        setApiKeys(keysRes.data.apiKeys)
      }
      if (!modelsRes.ok) {
        console.error('Failed to fetch embedding models', { error: modelsRes.error })
      } else if (modelsRes.data) {
        setEmbeddingModels(modelsRes.data)
      }

      if (profilesRes.data?.profiles) {
        setProfiles(profilesRes.data.profiles)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // executeLoad is stable (empty deps in useAsyncOperation)

  const fetchProfiles = useCallback(async () => {
    const result = await fetchJson<{ profiles: EmbeddingProfile[]; count: number }>('/api/v1/embedding-profiles')
    if (!result.ok) {
      throw new Error(result.error || 'Failed to fetch profiles')
    }
    if (result.data?.profiles) {
      setProfiles(result.data.profiles)
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
