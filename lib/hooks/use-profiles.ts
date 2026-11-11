'use client'

/**
 * One read hook per settings entity list: connection, image and embedding
 * profiles, API keys and roleplay templates.
 *
 * Each is the one `useQuery` for its endpoint, keyed by `lib/query/keys.ts`,
 * so every view on the page — a settings tab, the by-provider card, a picker
 * in a dialog — shares one cache entry: a write through any of them that
 * invalidates the key refreshes all of them (the "by kind" tabs used to hold
 * private copies, so a created profile was missing from every other
 * dropdown). Callers narrow with their own `select` and type the row they
 * read with the first type parameter; the hooks unwrap the envelope.
 *
 * Writes invalidate the entity's `all` key — `invalidateProfileLists` names
 * the keys for callers that change more than one.
 *
 * @module lib/hooks/use-profiles
 */

import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'

/** The fields every list row carries; callers name the rest. */
export interface EntityRow {
  id: string
  name: string
}

export interface EntityListOptions<P, R> {
  /** Gate the fetch (a dialog that reads the list only while open). */
  enabled?: boolean
  /** Narrow the rows. Runs on the cached list, so it costs no fetch. */
  select?: (rows: P[]) => R
  /** Override the client default (reference lists that rarely change). */
  staleTime?: number
  /** `'always'` for a view that must not show a list another tab may have changed. */
  refetchOnMount?: boolean | 'always'
}

function narrow<P, R>(rows: P[], select?: (rows: P[]) => R): R {
  return select ? select(rows) : (rows as unknown as R)
}

/** `GET /api/v1/connection-profiles` → `profiles`. */
export function useConnectionProfilesQuery<P = EntityRow, R = P[]>(options?: EntityListOptions<P, R>) {
  const select = options?.select
  return useQuery({
    queryKey: queryKeys.connectionProfiles.all,
    queryFn: ({ signal }) => apiFetch<{ profiles?: P[] }>('/api/v1/connection-profiles', { signal }),
    select: (data) => narrow(data.profiles ?? [], select),
    enabled: options?.enabled,
    staleTime: options?.staleTime,
    refetchOnMount: options?.refetchOnMount,
  })
}

/** `GET /api/v1/image-profiles` → `profiles`. */
export function useImageProfilesQuery<P = EntityRow, R = P[]>(options?: EntityListOptions<P, R>) {
  const select = options?.select
  return useQuery({
    queryKey: queryKeys.imageProfiles.all,
    queryFn: ({ signal }) => apiFetch<{ profiles?: P[] }>('/api/v1/image-profiles', { signal }),
    select: (data) => narrow(data.profiles ?? [], select),
    enabled: options?.enabled,
    staleTime: options?.staleTime,
    refetchOnMount: options?.refetchOnMount,
  })
}

/** `GET /api/v1/embedding-profiles` → `profiles`. */
export function useEmbeddingProfilesQuery<P = EntityRow, R = P[]>(options?: EntityListOptions<P, R>) {
  const select = options?.select
  return useQuery({
    queryKey: queryKeys.embeddingProfiles.all,
    queryFn: ({ signal }) => apiFetch<{ profiles?: P[] }>('/api/v1/embedding-profiles', { signal }),
    select: (data) => narrow(data.profiles ?? [], select),
    enabled: options?.enabled,
    staleTime: options?.staleTime,
    refetchOnMount: options?.refetchOnMount,
  })
}

/** `GET /api/v1/api-keys` → `apiKeys`. Rows carry a label and provider, never the secret. */
export function useApiKeysQuery<K = { id: string; label: string; provider: string }, R = K[]>(
  options?: EntityListOptions<K, R>,
) {
  const select = options?.select
  return useQuery({
    queryKey: queryKeys.apiKeys.all,
    queryFn: ({ signal }) => apiFetch<{ apiKeys?: K[] }>('/api/v1/api-keys', { signal }),
    select: (data) => narrow(data.apiKeys ?? [], select),
    enabled: options?.enabled,
    staleTime: options?.staleTime,
    refetchOnMount: options?.refetchOnMount,
  })
}

/** `GET /api/v1/roleplay-templates` → the array itself (built-ins and the user's own). */
export function useRoleplayTemplatesQuery<T = EntityRow, R = T[]>(options?: EntityListOptions<T, R>) {
  const select = options?.select
  return useQuery({
    queryKey: queryKeys.roleplayTemplates.all,
    queryFn: ({ signal }) => apiFetch<T[]>('/api/v1/roleplay-templates', { signal }),
    select: (data) => narrow(data ?? [], select),
    enabled: options?.enabled,
    staleTime: options?.staleTime,
    refetchOnMount: options?.refetchOnMount,
  })
}

export type ProfileListKind = 'connectionProfiles' | 'imageProfiles' | 'embeddingProfiles' | 'apiKeys' | 'roleplayTemplates'

/**
 * Refresh the named lists everywhere they are shown. A write through any
 * view calls this (or invalidates the one key itself) — never a private
 * re-fetch into component state.
 */
export function useInvalidateProfileLists() {
  const queryClient = useQueryClient()
  return useCallback(
    (...kinds: ProfileListKind[]) =>
      Promise.all(kinds.map((kind) => queryClient.invalidateQueries({ queryKey: queryKeys[kind].all }))),
    [queryClient],
  )
}
