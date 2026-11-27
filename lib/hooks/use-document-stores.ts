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

import { queryKeys } from '@/lib/query/keys'
import { useEnvelopeListQuery, type EntityListOptions, type EntityRow } from './use-profiles'

/** The list response's envelope, for callers that edit the cached entry. */
export interface DocumentStoresResponse<S> {
  mountPoints?: S[]
}

const unwrapStores = <S,>(data: DocumentStoresResponse<S>) => data.mountPoints

export function useDocumentStoresQuery<S = EntityRow, R = S[]>(options?: EntityListOptions<S, R>) {
  return useEnvelopeListQuery<DocumentStoresResponse<S>, S, R>({
    queryKey: queryKeys.mountPoints.list(),
    url: '/api/v1/mount-points',
    unwrap: unwrapStores,
    options,
  })
}
