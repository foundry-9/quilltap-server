'use client'

import { useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAutoAssociate } from '@/hooks/useAutoAssociate'
import { apiErrorMessage, apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { useApiKeysQuery, useEmbeddingProfilesQuery } from '@/lib/hooks/use-profiles'
import type { ApiKey, EmbeddingModel, EmbeddingProfile, EmbeddingProvider } from '../types'

/**
 * Provider info returned from the API
 */
export interface EmbeddingProviderInfo {
  name: EmbeddingProvider
  displayName: string
  requiresApiKey: boolean
  requiresBaseUrl: boolean
  description?: string
}

interface UseEmbeddingProfilesResult {
  profiles: EmbeddingProfile[]
  apiKeys: ApiKey[]
  embeddingModels: Record<string, EmbeddingModel[]>
  /** Available embedding providers from the plugin system */
  embeddingProviders: EmbeddingProviderInfo[]
  loading: boolean
  error: string | null
  /** Re-read the profile list everywhere it is shown. */
  refreshProfiles: () => Promise<void>
  triggerAutoAssociate: () => Promise<void>
}

/**
 * Static provider metadata (used when API doesn't provide full details)
 * This is a fallback - ideally the API would return this information
 */
const PROVIDER_METADATA: Record<string, Omit<EmbeddingProviderInfo, 'name'>> = {
  BUILTIN: {
    displayName: 'Built-in (TF-IDF)',
    requiresApiKey: false,
    requiresBaseUrl: false,
    description: 'Offline embeddings using TF-IDF with BM25 enhancement - no API keys required',
  },
  OPENAI: {
    displayName: 'OpenAI',
    requiresApiKey: true,
    requiresBaseUrl: false,
    description: 'OpenAI text embeddings (text-embedding-3-small, text-embedding-3-large)',
  },
  OPENROUTER: {
    displayName: 'OpenRouter',
    requiresApiKey: true,
    requiresBaseUrl: false,
    description: 'Access multiple embedding models through OpenRouter',
  },
  NANOGPT: {
    displayName: 'NanoGPT',
    requiresApiKey: true,
    requiresBaseUrl: false,
    description: 'OpenAI, BGE, Jina, Qwen, and Gemini embedding models through NanoGPT',
  },
  OLLAMA: {
    displayName: 'Ollama (Local)',
    requiresApiKey: false,
    requiresBaseUrl: true,
    description: 'Local embedding models via Ollama',
  },
}

/**
 * Provider names (from `?action=list-providers`, or the keys of the models map)
 * as the modal's provider picker wants them.
 */
export function toEmbeddingProviderInfo(names: string[]): EmbeddingProviderInfo[] {
  return names.map(name => ({
    name: name as EmbeddingProvider,
    ...PROVIDER_METADATA[name] || {
      displayName: name,
      requiresApiKey: true,
      requiresBaseUrl: false,
    },
  }))
}

const EMPTY_PROFILES: EmbeddingProfile[] = []
const EMPTY_KEYS: ApiKey[] = []
const EMPTY_MODELS: Record<string, EmbeddingModel[]> = {}

/**
 * The Settings "by kind" embedding-profiles tab's data. Every list is a
 * shared query (the same keys the by-provider card and the chat-settings
 * pickers read), so a profile created or deleted here shows everywhere.
 */
export function useEmbeddingProfiles(): UseEmbeddingProfilesResult {
  const queryClient = useQueryClient()
  const profilesQuery = useEmbeddingProfilesQuery<EmbeddingProfile>({ refetchOnMount: 'always' })
  const { data: apiKeys = EMPTY_KEYS } = useApiKeysQuery<ApiKey>()
  const { data: embeddingModels = EMPTY_MODELS } = useQuery({
    queryKey: queryKeys.embeddingProfiles.models,
    queryFn: ({ signal }) =>
      apiFetch<Record<string, EmbeddingModel[]>>('/api/v1/embedding-profiles?action=list-models', { signal }),
  })
  const { data: providerNames } = useQuery({
    queryKey: queryKeys.embeddingProfiles.providerNames,
    queryFn: ({ signal }) =>
      apiFetch<{ providers: string[] }>('/api/v1/embedding-profiles?action=list-providers', { signal }),
    select: (data) => data.providers,
  })
  // The provider list, or (when it cannot be read) the models catalogue's keys.
  const embeddingProviders = useMemo(
    () => toEmbeddingProviderInfo(providerNames ?? Object.keys(embeddingModels)),
    [providerNames, embeddingModels],
  )

  const triggerAutoAssociate = useAutoAssociate()

  const refreshProfiles = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.embeddingProfiles.all })
  }, [queryClient])

  return {
    profiles: profilesQuery.data ?? EMPTY_PROFILES,
    apiKeys,
    embeddingModels,
    embeddingProviders,
    loading: profilesQuery.isPending,
    error: profilesQuery.error ? apiErrorMessage(profilesQuery.error, 'Failed to fetch profiles') : null,
    refreshProfiles,
    triggerAutoAssociate,
  }
}
