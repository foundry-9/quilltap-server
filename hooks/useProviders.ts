'use client'

import { useProvidersQuery } from '@/lib/hooks/use-profiles'
import type { PluginIconData } from '@/components/image-profiles/ProviderIcon'

interface ProviderInfo {
  id: string
  name: string
  displayName: string
  abbreviation: string
  icon: PluginIconData | null
  type: string
}

function mapProviders(rows: Array<Record<string, unknown>>): ProviderInfo[] {
  return rows.map((p) => ({
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
 * The list of available providers with their icon data — a narrowing `select`
 * over the shared providers list (`useProvidersQuery`); a long staleTime keeps
 * its "fetch once, share everywhere" reference-data feel.
 */
export function useProviders() {
  const { data: providers = EMPTY_PROVIDERS, isLoading: loading } = useProvidersQuery<
    Record<string, unknown>,
    ProviderInfo[]
  >({ select: mapProviders, staleTime: Infinity })

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
