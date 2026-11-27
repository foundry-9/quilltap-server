'use client'

/**
 * `useTagsQuery` — the one read of the tag list (`GET /api/v1/tags`).
 *
 * The tag badges' styles, the quick-hide menu, the tag editor's suggestions
 * and the Tags settings card all read this one cache entry, so a write that
 * patches or invalidates `queryKeys.tags.list()` reaches every one of them.
 * The cache holds the envelope (`{ tags }`) — the settings card patches it in
 * place — and callers narrow with `select`.
 *
 * @module lib/hooks/use-tags
 */

import { queryKeys } from '@/lib/query/keys'
import { useEnvelopeListQuery, type EntityListOptions, type EntityRow } from './use-profiles'

/** The list response's envelope, for callers that edit the cached entry. */
export interface TagsResponse<T> {
  tags?: T[]
}

const unwrapTags = <T,>(data: TagsResponse<T>) => data.tags

export function useTagsQuery<T = EntityRow, R = T[]>(options?: EntityListOptions<T, R>) {
  return useEnvelopeListQuery<TagsResponse<T>, T, R>({
    queryKey: queryKeys.tags.list(),
    url: '/api/v1/tags',
    unwrap: unwrapTags,
    options,
  })
}
