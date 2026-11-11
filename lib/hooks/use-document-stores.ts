'use client'

/**
 * `useDocumentStoresQuery` — the one read of the document-store list
 * (`GET /api/v1/mount-points`).
 *
 * Keyed by `queryKeys.mountPoints.list()`, under the `mountPoints.lists`
 * prefix the `mountPoints` realtime topic invalidates, so a scan, embedding
 * pass or conversion finishing in the background refreshes the Scriptorium
 * and every store picker. Callers type the row and narrow with `select`.
 *
 * @module lib/hooks/use-document-stores
 */

import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import type { EntityListOptions, EntityRow } from './use-profiles'

/** The list response's envelope, for callers that edit the cached entry. */
export interface DocumentStoresResponse<S> {
  mountPoints?: S[]
}

export function useDocumentStoresQuery<S = EntityRow, R = S[]>(options?: EntityListOptions<S, R>) {
  const select = options?.select
  return useQuery({
    queryKey: queryKeys.mountPoints.list(),
    queryFn: ({ signal }) => apiFetch<DocumentStoresResponse<S>>('/api/v1/mount-points', { signal }),
    select: (data) => {
      const rows = data.mountPoints ?? []
      return select ? select(rows) : (rows as unknown as R)
    },
    enabled: options?.enabled,
    staleTime: options?.staleTime,
    refetchOnMount: options?.refetchOnMount,
  })
}
