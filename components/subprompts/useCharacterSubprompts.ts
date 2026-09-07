'use client'

/**
 * useCharacterSubprompts — the client's view of a character's `Subprompts/`
 * folder: one TanStack query for the list, and create/update/delete
 * mutations that invalidate it. Shared by the New Chat picker, the Salon
 * Participants drawer, and the Aurora System Prompts tab, so every dropdown
 * that lists subprompts reads the same cache.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, ApiFetchError } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { useRealtimeRefetchInterval } from '@/hooks/useRealtime'

/** Wire shape of one subprompt, as served by `/api/v1/characters/[id]/subprompts`. */
export interface SubpromptRecord {
  id: string
  path: string
  title: string
  content: string
  updatedAt: string
}

export interface SubpromptInput {
  title: string
  content: string
}

function listUrl(characterId: string): string {
  return `/api/v1/characters/${characterId}/subprompts`
}

function itemUrl(characterId: string, subpromptId: string): string {
  return `${listUrl(characterId)}/${encodeURIComponent(subpromptId)}`
}

/** A readable message from a failed subprompt request. */
export function subpromptErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiFetchError) {
    const info = err.info as { error?: unknown } | undefined
    if (info && typeof info.error === 'string') return info.error
  }
  return err instanceof Error && err.message ? err.message : fallback
}

/**
 * List + mutations for `characterId`'s subprompts. Pass `enabled: false` to
 * defer the read (e.g. a collapsed picker that has not been opened yet).
 */
export function useCharacterSubprompts(characterId: string | null | undefined, options: { enabled?: boolean } = {}) {
  const queryClient = useQueryClient()
  const enabled = !!characterId && (options.enabled ?? true)
  const key = queryKeys.characters.subprompts(characterId ?? '')
  const refetchInterval = useRealtimeRefetchInterval(60_000)

  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => apiFetch<{ subprompts: SubpromptRecord[] }>(listUrl(characterId!), { signal }),
    enabled,
    refetchInterval,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: key })

  const create = useMutation({
    mutationFn: (input: SubpromptInput) =>
      apiFetch<{ subprompt: SubpromptRecord }>(listUrl(characterId!), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: invalidate,
  })

  const update = useMutation({
    mutationFn: ({ id, ...patch }: Partial<SubpromptInput> & { id: string }) =>
      apiFetch<{ subprompt: SubpromptRecord }>(itemUrl(characterId!, id), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }),
    onSuccess: invalidate,
  })

  const remove = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ success: boolean }>(itemUrl(characterId!, id), { method: 'DELETE' }),
    onSuccess: invalidate,
  })

  return {
    subprompts: query.data?.subprompts ?? [],
    isLoading: enabled && query.isLoading,
    error: query.error,
    refetch: query.refetch,
    create,
    update,
    remove,
  }
}
