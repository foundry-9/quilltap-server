'use client'

import { useState, useEffect } from 'react'
import type { PluginIconData } from '@/components/image-profiles/ProviderIcon'

interface ProviderInfo {
  id: string
  name: string
  displayName: string
  abbreviation: string
  icon: PluginIconData | null
  type: string
}

// Module-level cache so multiple components don't re-fetch
let cachedProviders: ProviderInfo[] | null = null
let fetchPromise: Promise<ProviderInfo[]> | null = null

async function fetchProviders(): Promise<ProviderInfo[]> {
  if (cachedProviders) return cachedProviders

  if (fetchPromise) return fetchPromise

  try {
    fetchPromise = fetch('/api/v1/providers')
      .then(res => res.json())
      .then(data => {
        const providers = (data.providers || []).map((p: Record<string, unknown>) => ({
          id: p.id as string,
          name: p.name as string,
          displayName: (p.displayName as string) || (p.name as string),
          abbreviation: (p.abbreviation as string) || '',
          icon: (p.icon as PluginIconData) || null,
          type: (p.type as string) || 'llm',
        }))
        cachedProviders = providers
        fetchPromise = null
        return providers
      })
      .catch(() => {
        fetchPromise = null
        return [] as ProviderInfo[]
      })

    return fetchPromise
  } catch {
    fetchPromise = null
    return []
  }
}

/**
 * Hook to fetch and cache the list of available providers with their icon data.
 * Uses module-level caching so multiple components share the same data.
 */
export function useProviders() {
  const [providers, setProviders] = useState<ProviderInfo[]>(cachedProviders || [])
  const [loading, setLoading] = useState(!cachedProviders)

  useEffect(() => {
    // If cache was populated between render and effect, skip fetch
    if (cachedProviders) return

    let cancelled = false
    fetchProviders().then(result => {
      if (!cancelled) {
        setProviders(result)
        setLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [])

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
