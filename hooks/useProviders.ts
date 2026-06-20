'use client'

import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import type { PluginIconData } from '@/components/image-profiles/ProviderIcon'

interface ProviderInfo {
  id: string
  name: string
  displayName: string
  abbreviation: string
  icon: PluginIconData | null
  type: string
}

interface ProvidersResponse {
  providers?: Array<Record<string, unknown>>
}

function mapProviders(data: ProvidersResponse): ProviderInfo[] {
  return (data.providers || []).map((p) => ({
    id: p.id as string,
    name: p.name as string,
    displayName: (p.displayName as string) || (p.name as string),
    abbreviation: (p.abbreviation as string) || '',
    icon: (p.icon as PluginIconData) || null,
    type: (p.type as string) || 'llm',
  }))
}

const EMPTY_PROVIDERS: ProviderInfo[] = []

/**
 * Hook to fetch and cache the list of available providers with their icon data.
 * Backed by the shared TanStack Query cache (dedups by key across components);
 * a long staleTime keeps its "fetch once, share everywhere" reference-data feel.
 */
export function useProviders() {
  const { data: providers = EMPTY_PROVIDERS, isLoading: loading } = useQuery({
    queryKey: queryKeys.providers.all,
    queryFn: ({ signal }) => apiFetch<ProvidersResponse>('/api/v1/providers', { signal }),
    select: mapProviders,
    staleTime: Infinity,
  })

  return {
    providers,
    loading,
    getProviderIcon(name: string): PluginIconData | null {
      const provider = providers.find(p => p.name === name)
      return provider?.icon || null
    },
    getProviderDisplayName(name: string): string {
      const provider = providers.find(p => p.name === name)
      return provider?.displayName || name
    },
  }
}
