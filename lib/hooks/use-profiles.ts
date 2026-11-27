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
import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query'
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

/**
 * The query's `select`: unwrap the envelope, then the caller's narrowing.
 * Stable while the caller's `select` is, so TanStack memoises the result —
 * pass a module-level or memoised `select` when its output's identity matters.
 */
function useEnvelopeSelect<E, P, R>(unwrap: (data: E) => P[] | undefined, select?: (rows: P[]) => R) {
  return useCallback(
    (data: E): R => {
      const rows = unwrap(data) ?? []
      return select ? select(rows) : (rows as unknown as R)
    },
    [unwrap, select],
  )
}

/**
 * The one shape of an entity list read: `GET url`, cached under `queryKey`,
 * the envelope unwrapped by `unwrap` (a module-level function, so the select
 * stays stable), then the caller's `select`. Every list hook in `lib/hooks/`
 * is a binding of this — a new list endpoint is another binding, not another
 * `useQuery` body. `enabled` is the caller's gate (`options.enabled`) already
 * combined with any the binding adds (a missing id).
 */
export function useEnvelopeListQuery<E, P, R>(spec: {
  queryKey: QueryKey
  url: string
  unwrap: (data: E) => P[] | undefined
  options?: EntityListOptions<P, R>
  enabled?: boolean
}) {
  const { queryKey, url, unwrap, options } = spec
  const select = useEnvelopeSelect<E, P, R>(unwrap, options?.select)
  // eslint-disable-next-line @tanstack/query/exhaustive-deps -- each binding derives `url` from the same inputs as `queryKey`
  return useQuery({
    queryKey,
    queryFn: ({ signal }) => apiFetch<E>(url, { signal }),
    select,
    enabled: spec.enabled ?? options?.enabled,
    staleTime: options?.staleTime,
    refetchOnMount: options?.refetchOnMount,
  })
}

const unwrapProfiles = <P,>(data: { profiles?: P[] }) => data.profiles
const unwrapApiKeys = <K,>(data: { apiKeys?: K[] }) => data.apiKeys
const unwrapArray = <T,>(data: T[]) => data
const unwrapTemplates = <T,>(data: { templates?: T[] }) => data.templates

/** `GET /api/v1/connection-profiles` → `profiles`. */
export function useConnectionProfilesQuery<P = EntityRow, R = P[]>(options?: EntityListOptions<P, R>) {
  return useEnvelopeListQuery<{ profiles?: P[] }, P, R>({
    queryKey: queryKeys.connectionProfiles.all,
    url: '/api/v1/connection-profiles',
    unwrap: unwrapProfiles,
    options,
  })
}

/** `GET /api/v1/image-profiles` → `profiles`. */
export function useImageProfilesQuery<P = EntityRow, R = P[]>(options?: EntityListOptions<P, R>) {
  return useEnvelopeListQuery<{ profiles?: P[] }, P, R>({
    queryKey: queryKeys.imageProfiles.all,
    url: '/api/v1/image-profiles',
    unwrap: unwrapProfiles,
    options,
  })
}

/** `GET /api/v1/embedding-profiles` → `profiles`. */
export function useEmbeddingProfilesQuery<P = EntityRow, R = P[]>(options?: EntityListOptions<P, R>) {
  return useEnvelopeListQuery<{ profiles?: P[] }, P, R>({
    queryKey: queryKeys.embeddingProfiles.all,
    url: '/api/v1/embedding-profiles',
    unwrap: unwrapProfiles,
    options,
  })
}

/** `GET /api/v1/api-keys` → `apiKeys`. Rows carry a label and provider, never the secret. */
export function useApiKeysQuery<K = { id: string; label: string; provider: string }, R = K[]>(
  options?: EntityListOptions<K, R>,
) {
  return useEnvelopeListQuery<{ apiKeys?: K[] }, K, R>({
    queryKey: queryKeys.apiKeys.all,
    url: '/api/v1/api-keys',
    unwrap: unwrapApiKeys,
    options,
  })
}

/** `GET /api/v1/roleplay-templates` → the array itself (built-ins and the user's own). */
export function useRoleplayTemplatesQuery<T = EntityRow, R = T[]>(options?: EntityListOptions<T, R>) {
  return useEnvelopeListQuery<T[], T, R>({
    queryKey: queryKeys.roleplayTemplates.all,
    url: '/api/v1/roleplay-templates',
    unwrap: unwrapArray,
    options,
  })
}

/** `GET /api/v1/prompt-templates` → `templates` (system-prompt templates, built-ins and the user's own). */
export function usePromptTemplatesQuery<T = EntityRow, R = T[]>(options?: EntityListOptions<T, R>) {
  return useEnvelopeListQuery<{ templates?: T[] }, T, R>({
    queryKey: queryKeys.promptTemplates.list(),
    url: '/api/v1/prompt-templates',
    unwrap: unwrapTemplates,
    options,
  })
}

const unwrapProviders = <P,>(data: { providers?: P[] }) => data.providers

/**
 * `GET /api/v1/providers` → `providers` (LLM, image, embedding and search
 * plugins alike). Callers type the fields they read and narrow with `select`.
 */
export function useProvidersQuery<P = { name: string }, R = P[]>(options?: EntityListOptions<P, R>) {
  return useEnvelopeListQuery<{ providers?: P[] }, P, R>({
    queryKey: queryKeys.providers.all,
    url: '/api/v1/providers',
    unwrap: unwrapProviders,
    options,
  })
}

/** `GET /api/v1/embedding-profiles?action=list-providers` → `providers`: the embedding provider names. */
export function useEmbeddingProviderNamesQuery<R = string[]>(options?: EntityListOptions<string, R>) {
  return useEnvelopeListQuery<{ providers?: string[] }, string, R>({
    queryKey: queryKeys.embeddingProfiles.providerNames,
    url: '/api/v1/embedding-profiles?action=list-providers',
    unwrap: unwrapProviders,
    options,
  })
}

/** An API key as `GET /api/v1/api-keys` lists it (never the secret). */
export interface ApiKeyRow {
  id: string
  label: string
  provider: string
  isActive: boolean
}

/** An image profile as `GET /api/v1/image-profiles` lists it. */
export interface ImageProfileRow {
  id: string
  name: string
  provider: string
  modelName: string
  isDefault: boolean
  apiKeyId?: string
  baseUrl?: string
  parameters: Record<string, unknown>
  isDangerousCompatible?: boolean
  apiKey?: ApiKeyRow | null
  tags?: unknown[]
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
