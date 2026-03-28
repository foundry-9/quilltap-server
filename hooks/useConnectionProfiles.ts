'use client'

import { useState, useEffect } from 'react'

interface ConnectionProfileInfo {
  id: string
  name: string
  provider: string
  modelName: string
}

// Module-level cache
let cachedProfiles: ConnectionProfileInfo[] | null = null
let fetchPromise: Promise<ConnectionProfileInfo[]> | null = null

async function fetchProfiles(): Promise<ConnectionProfileInfo[]> {
  if (cachedProfiles) return cachedProfiles

  if (fetchPromise) return fetchPromise

  try {
    fetchPromise = fetch('/api/v1/connection-profiles')
      .then(res => res.json())
      .then(data => {
        const profiles = (data.profiles || []).map((p: Record<string, unknown>) => ({
          id: p.id as string,
          name: (p.name as string) || '',
          provider: (p.provider as string) || '',
          modelName: (p.modelName as string) || '',
        }))
        cachedProfiles = profiles
        fetchPromise = null
        return profiles
      })
      .catch(() => {
        fetchPromise = null
        return [] as ConnectionProfileInfo[]
      })

    return fetchPromise
  } catch {
    fetchPromise = null
    return []
  }
}

/**
 * Hook to fetch and cache connection profiles.
 * Used to resolve a connection profile ID to its provider/model info.
 */
export function useConnectionProfiles() {
  const [profiles, setProfiles] = useState<ConnectionProfileInfo[]>(cachedProfiles || [])
  const [loading, setLoading] = useState(!cachedProfiles)

  useEffect(() => {
    // If cache was populated between render and effect, skip fetch
    if (cachedProfiles) return

    let cancelled = false
    fetchProfiles().then(result => {
      if (!cancelled) {
        setProfiles(result)
        setLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [])

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
