'use client'

/**
 * Calliope's Atelier — server state for theme drafts.
 *
 * The draft list and one draft's detail, and the writes on them (create,
 * save, delete, install), over `/api/v1/theme-drafts` and the
 * `queryKeys.themeDrafts` namespace. The realtime `themes` topic invalidates
 * the namespace, so a draft written elsewhere refreshes here.
 *
 * @module components/theme-editor/use-theme-drafts
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import type { DraftDetail, DraftInstallResult, DraftSummary } from '@/lib/themes/drafts/service'
import type { ThemeTokensDocument } from '@/lib/themes/engine/client'

export type { DraftDetail, DraftSummary, DraftInstallResult }

const BASE = '/api/v1/theme-drafts'
const itemUrl = (id: string) => `${BASE}/${encodeURIComponent(id)}`

export function useThemeDraftList() {
  return useQuery({
    queryKey: queryKeys.themeDrafts.list,
    queryFn: ({ signal }) => apiFetch<{ drafts: DraftSummary[] }>(BASE, { signal }),
    select: (data) => data.drafts,
  })
}

export function useThemeDraft(id: string | null) {
  return useQuery({
    queryKey: queryKeys.themeDrafts.detail(id ?? ''),
    queryFn: ({ signal }) => fetchThemeDraft(id!, signal),
    enabled: !!id,
  })
}

export async function fetchThemeDraft(id: string, signal?: AbortSignal): Promise<DraftDetail> {
  const { draft } = await apiFetch<{ draft: DraftDetail }>(itemUrl(id), { signal })
  return draft
}

export function useCreateThemeDraft() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { name: string; from?: string }) =>
      apiFetch<{ draft: DraftDetail }>(BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then((r) => r.draft),
    onSuccess: (draft) => {
      queryClient.setQueryData(queryKeys.themeDrafts.detail(draft.id), draft)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.themeDrafts.list }),
  })
}

export function useDeleteThemeDraft() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiFetch<unknown>(itemUrl(id), { method: 'DELETE' }),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: queryKeys.themeDrafts.detail(id) })
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.themeDrafts.list }),
  })
}

/** The body of a draft save: the revision it was read at, and what changed. */
export interface ThemeDraftSave {
  revision: string
  tokens?: ThemeTokensDocument
  name?: string
  description?: string
}

/** One save. Throws `ApiFetchError` (409 on a stale revision). */
export function saveThemeDraft(id: string, body: ThemeDraftSave, init?: { keepalive?: boolean }): Promise<DraftDetail> {
  return apiFetch<{ draft: DraftDetail }>(itemUrl(id), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    keepalive: init?.keepalive,
  }).then((r) => r.draft)
}

/** Install a draft. Throws `ApiFetchError` (422 with `info.errors` when it has errors). */
export function installThemeDraft(id: string): Promise<DraftInstallResult> {
  return apiFetch<{ result: DraftInstallResult }>(`${itemUrl(id)}?action=install`, { method: 'POST' }).then((r) => r.result)
}
