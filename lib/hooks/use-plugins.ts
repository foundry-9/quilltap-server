'use client'

/**
 * `usePluginsQuery` — the one read of the plugin registry (`GET /api/v1/plugins`).
 *
 * The response carries the plugin rows, the registry's stats and its load
 * errors, so the hook keeps the envelope and callers narrow with `select`.
 * Keyed by `queryKeys.plugins.list()`, under `queryKeys.plugins.all`, which a
 * plugin write and the workspace tab refetch sweep.
 *
 * @module lib/hooks/use-plugins
 */

import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'

export interface PluginStats {
  total: number
  enabled: number
  disabled: number
  errors: number
  initialized: boolean
}

export interface PluginsResponse<P> {
  plugins?: P[]
  stats?: PluginStats | null
  errors?: unknown[]
}

export function usePluginsQuery<P = { name: string }, R = PluginsResponse<P>>(options?: {
  select?: (data: PluginsResponse<P>) => R
  enabled?: boolean
}) {
  return useQuery({
    queryKey: queryKeys.plugins.list(),
    queryFn: ({ signal }) => apiFetch<PluginsResponse<P>>('/api/v1/plugins', { signal }),
    select: options?.select,
    enabled: options?.enabled,
  })
}
