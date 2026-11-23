'use client'

/**
 * Calliope's Atelier — server state for theme drafts.
 *
 * The draft list and one draft's detail, and the writes on them (create,
 * save, delete, install, export), over `/api/v1/theme-drafts` and the
 * `queryKeys.themeDrafts` namespace. The realtime `themes` topic invalidates
 * the namespace, so a draft written elsewhere refreshes here.
 *
 * @module components/theme-editor/use-theme-drafts
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiFetchError, apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import type { DraftDetail, DraftExportForm, DraftImportResult, DraftInstallResult, DraftSummary } from '@/lib/themes/drafts/service'
import type { ThemeTokensDocument } from '@/lib/themes/engine/client'

export type { DraftDetail, DraftExportForm, DraftSummary, DraftInstallResult, DraftImportResult }

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

/**
 * Open a `.qtap-theme` file as a new draft (`?action=import`). Throws
 * `ApiFetchError`: 422 with `details.errors` when the archive would not
 * install (a version 1 bundle among them), 413 when it is too large.
 */
export function useImportThemeDraft() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return apiFetch<DraftImportResult>(`${BASE}?action=import`, { method: 'POST', body: form })
    },
    onSuccess: (result) => {
      queryClient.setQueryData(queryKeys.themeDrafts.detail(result.draft.id), result.draft)
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

/**
 * The body of a draft save: the revisions it was read at, and what changed.
 * Tokens go to `PUT` (guarded by `revision`); the custom CSS goes to `PUT`
 * too, as its own body (guarded by `stylesRevision`, Spec G); name and
 * description are manifest fields and go to `?action=set-manifest` (guarded
 * by `manifestRevision`, Spec F decision 6).
 */
export interface ThemeDraftSave {
  revision: string
  manifestRevision: string
  /** The stylesheet's revision; needed with `css`. */
  stylesRevision?: string
  tokens?: ThemeTokensDocument
  css?: string
  name?: string
  description?: string
}

/** One JSON action on a draft (`?action=…`). Throws `ApiFetchError`. */
export function themeDraftAction<T extends { draft: DraftDetail }>(
  id: string,
  action: string,
  body: Record<string, unknown>,
  init?: { keepalive?: boolean },
): Promise<T> {
  return apiFetch<T>(`${itemUrl(id)}?action=${encodeURIComponent(action)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    keepalive: init?.keepalive,
  })
}

/** One upload action on a draft (multipart, the file in `file`). Throws `ApiFetchError`. */
export function themeDraftUpload<T>(id: string, action: string, file: File, fields: Record<string, string | undefined>): Promise<T> {
  const form = new FormData()
  form.append('file', file)
  for (const [key, value] of Object.entries(fields)) if (value !== undefined) form.append(key, value)
  return apiFetch<T>(`${itemUrl(id)}?action=${encodeURIComponent(action)}`, { method: 'POST', body: form })
}

/** One save. Throws `ApiFetchError` (409 on a stale revision or manifest revision). */
export async function saveThemeDraft(id: string, body: ThemeDraftSave, init?: { keepalive?: boolean }): Promise<DraftDetail> {
  let fresh: DraftDetail | null = null
  if (body.name !== undefined || body.description !== undefined) {
    const fields = { name: body.name, description: body.description }
    fresh = (await themeDraftAction(id, 'set-manifest', { manifestRevision: body.manifestRevision, fields }, init)).draft
  }
  if (body.tokens) {
    fresh = await apiFetch<{ draft: DraftDetail }>(itemUrl(id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: body.revision, tokens: body.tokens }),
      keepalive: init?.keepalive,
    }).then((r) => r.draft)
  }
  if (body.css !== undefined && body.stylesRevision !== undefined) {
    fresh = await apiFetch<{ draft: DraftDetail }>(itemUrl(id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stylesRevision: body.stylesRevision, css: body.css }),
      keepalive: init?.keepalive,
    }).then((r) => r.draft)
  }
  return fresh ?? fetchThemeDraft(id)
}

/** Install a draft. Throws `ApiFetchError` (422 with `info.errors` when it has errors). */
export function installThemeDraft(id: string): Promise<DraftInstallResult> {
  return apiFetch<{ result: DraftInstallResult }>(`${itemUrl(id)}?action=install`, { method: 'POST' }).then((r) => r.result)
}

/**
 * Export a draft as a `.qtap-theme` archive: `theme` is the installable build
 * (WebP, WOFF2, nothing unused), `draft` every file as stored. Answers the
 * bytes and the file name the server chose; throws `ApiFetchError` (422 with
 * `info.details.errors` when the draft has errors).
 */
export async function exportThemeDraft(id: string, form: DraftExportForm): Promise<{ blob: Blob; fileName: string }> {
  const url = `${itemUrl(id)}?action=export&form=${form}`
  const res = await fetch(url)
  if (!res.ok) {
    let info: unknown = undefined
    try {
      info = await res.json()
    } catch {
      // response body wasn't JSON
    }
    throw new ApiFetchError(`Request to ${url} failed: ${res.status} ${res.statusText}`, res.status, info)
  }
  const named = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')
  return { blob: await res.blob(), fileName: named?.[1] ?? (form === 'theme' ? `${id}.qtap-theme` : `${id}-draft.qtap-theme`) }
}
