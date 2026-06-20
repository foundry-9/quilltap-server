'use client'

import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'

interface ConnectionProfileInfo {
  id: string
  name: string
  provider: string
  modelName: string
}

interface ConnectionProfilesResponse {
  profiles?: Array<Record<string, unknown>>
}

function mapProfiles(data: ConnectionProfilesResponse): ConnectionProfileInfo[] {
  return (data.profiles || []).map((p) => ({
    id: p.id as string,
    name: (p.name as string) || '',
    provider: (p.provider as string) || '',
    modelName: (p.modelName as string) || '',
  }))
}

const EMPTY_PROFILES: ConnectionProfileInfo[] = []

/**
 * Hook to fetch and cache connection profiles, resolving a profile ID to its
 * provider/model info. Backed by the shared TanStack Query cache (dedups by key);
 * a long staleTime preserves its reference-data "fetch once, share everywhere" feel.
 */
export function useConnectionProfiles() {
  const { data: profiles = EMPTY_PROFILES, isLoading: loading } = useQuery({
    queryKey: queryKeys.connectionProfiles.all,
    queryFn: ({ signal }) => apiFetch<ConnectionProfilesResponse>('/api/v1/connection-profiles', { signal }),
    select: mapProfiles,
    staleTime: Infinity,
  })

  return {
    profiles,
    loading,
    getProfileProvider(id: string): { provider: string; modelName: string; name: string } | null {
      const profile = profiles.find(p => p.id === id)
      if (!profile) return null
      return { provider: profile.provider, modelName: profile.modelName, name: profile.name }
    },
  }
}
