'use client'

/**
 * One document store, as a folder browser sees it: its record (with its
 * capabilities), its listing (files and folders), and every write the
 * browser makes, each a thin call to an existing `/api/v1/mount-points` verb.
 *
 * Reads are TanStack queries under `queryKeys.mountPoints.store(id)`, which
 * the `mountPoints` realtime topic invalidates — so a change made anywhere
 * (another tab, a character's `doc_*` tool, the CLI) reaches the browser
 * without a poll. A write also invalidates the stores it touched at once,
 * so the browser does not wait on the socket for its own change.
 *
 * @module components/document-browser/useDocumentStoreSource
 */

import { useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { apiFetch } from '@/lib/query/fetcher'
import { buildMountFileItemUrl } from '@/components/files/mountBlobUrl'
import { folderName, joinFolder, parentFolder } from '@/lib/mount-index/item-folders'
import type { BrowserStore, StoreCapabilities } from '@/lib/folder-browser/document-actions'
import type { DocMountBrowserEntry, DocMountLinkLocation } from '@/lib/schemas/mount-index.types'

/** A store's record as `GET /api/v1/mount-points/[id]` answers it. */
export interface DocumentStoreRecord extends BrowserStore {
  name: string
  basePath: string
  storeType: 'documents' | 'character'
  enabled: boolean
  capabilities: StoreCapabilities & { canConvert: boolean }
  includePatterns: string[]
  excludePatterns: string[]
  lastScannedAt: string | null
  scanStatus: 'idle' | 'scanning' | 'error'
  lastScanError: string | null
  conversionStatus: 'idle' | 'converting' | 'deconverting' | 'error'
  conversionError: string | null
  fileCount: number
  chunkCount: number
  totalSizeBytes: number
  embeddedChunkCount: number
  createdAt: string
  updatedAt: string
}

/** A listed file, with the folder the browser files it under. */
export type DocumentEntry = DocMountBrowserEntry & {
  /** The folder holding it (`''` at the top). */
  folder: string
}

interface ListingResponse {
  files: DocMountBrowserEntry[]
  folders: string[]
}

/** Fetch one store's record (shared by the browser, the detail page and the picker). */
export function fetchDocumentStore(id: string, signal?: AbortSignal): Promise<DocumentStoreRecord> {
  return apiFetch<{ mountPoint: DocumentStoreRecord }>(`/api/v1/mount-points/${encodeURIComponent(id)}`, {
    signal,
  }).then((r) => r.mountPoint)
}

/** Fetch one store's listing. */
export function fetchDocumentListing(id: string, signal?: AbortSignal): Promise<ListingResponse> {
  return apiFetch<ListingResponse>(`/api/v1/mount-points/${encodeURIComponent(id)}/files`, { signal })
}

/** The store's folders with their direct file counts, for the view math. */
export function folderTreeOf(
  folders: readonly string[],
  entries: readonly DocumentEntry[],
): Array<{ path: string; itemCount: number }> {
  const counts = new Map<string, number>()
  for (const e of entries) counts.set(e.folder.toLowerCase(), (counts.get(e.folder.toLowerCase()) ?? 0) + 1)
  return folders.map((path) => ({ path, itemCount: counts.get(path.toLowerCase()) ?? 0 }))
}

function postAction<T>(storeId: string, action: string, body: unknown): Promise<T> {
  return apiFetch<T>(`/api/v1/mount-points/${encodeURIComponent(storeId)}?action=${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Where a file op sends something: a store and a full path in it. */
export interface FileDestination {
  mountPointId: string
  path: string
}

export function useDocumentStoreSource(storeId: string | null) {
  const queryClient = useQueryClient()
  const id = storeId ?? ''

  const storeQuery = useQuery({
    queryKey: queryKeys.mountPoints.detail(id),
    queryFn: ({ signal }) => fetchDocumentStore(id, signal),
    enabled: Boolean(storeId),
  })

  const listingQuery = useQuery({
    queryKey: queryKeys.mountPoints.files(id),
    queryFn: ({ signal }) => fetchDocumentListing(id, signal),
    enabled: Boolean(storeId),
  })

  const entries = useMemo<DocumentEntry[]>(
    () => (listingQuery.data?.files ?? []).map((f) => ({ ...f, folder: parentFolder(f.relativePath) })),
    [listingQuery.data],
  )
  const folders = useMemo(() => listingQuery.data?.folders ?? [], [listingQuery.data])
  const tree = useMemo(() => folderTreeOf(folders, entries), [folders, entries])

  /** After a write: this store, any other store it touched, and the store list's counts. */
  const settle = useCallback(
    async (...others: Array<string | undefined>) => {
      const ids = new Set([id, ...others.filter((o): o is string => Boolean(o))])
      await Promise.all([
        ...Array.from(ids).map((s) => queryClient.invalidateQueries({ queryKey: queryKeys.mountPoints.store(s) })),
        queryClient.invalidateQueries({ queryKey: queryKeys.mountPoints.lists }),
      ])
    },
    [id, queryClient],
  )

  const ops = useMemo(() => {
    const withSettle =
      <A extends unknown[], R>(fn: (...args: A) => Promise<R>, touched?: (...args: A) => string | undefined) =>
      async (...args: A): Promise<R> => {
        try {
          return await fn(...args)
        } finally {
          await settle(touched?.(...args))
        }
      }

    return {
      createFolder: withSettle(async (path: string) => {
        await apiFetch(`/api/v1/mount-points/${encodeURIComponent(id)}/folders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path }),
        })
        return { name: folderName(path), path }
      }),
      renameFolder: withSettle(async (path: string, name: string) => {
        const toPath = joinFolder(parentFolder(path), name)
        await postAction(id, 'move-folder', { fromPath: path, toPath })
        return { name: folderName(toPath), path: toPath }
      }),
      deleteFolder: withSettle((path: string) =>
        postAction<{ deletedFiles?: number }>(id, 'delete-folder', { path, recursive: true }),
      ),
      moveFolder: withSettle(
        (fromPath: string, dest: FileDestination) =>
          postAction(id, 'move-folder', { fromPath, toPath: dest.path, destMountPointId: dest.mountPointId }),
        (_from, dest) => dest.mountPointId,
      ),
      copyFolder: withSettle(
        (fromPath: string, dest: FileDestination) =>
          postAction(id, 'copy-folder', { fromPath, toPath: dest.path, destMountPointId: dest.mountPointId }),
        (_from, dest) => dest.mountPointId,
      ),
      moveFile: withSettle(
        (sourcePath: string, dest: FileDestination) =>
          postAction(id, 'move-file', { sourcePath, destMountPointId: dest.mountPointId, destPath: dest.path }),
        (_from, dest) => dest.mountPointId,
      ),
      copyFile: withSettle(
        (sourcePath: string, dest: FileDestination) =>
          postAction(id, 'copy-file', { sourcePath, destMountPointId: dest.mountPointId, destPath: dest.path }),
        (_from, dest) => dest.mountPointId,
      ),
      linkFile: withSettle(
        (sourcePath: string, dest: FileDestination) =>
          postAction(id, 'link-file', { sourcePath, destMountPointId: dest.mountPointId, destPath: dest.path }),
        (_from, dest) => dest.mountPointId,
      ),
      unlinkFile: withSettle((path: string) => postAction(id, 'unlink-file', { path })),
      renameFile: withSettle((path: string, newPath: string) =>
        apiFetch(buildMountFileItemUrl(id, path), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rename: newPath }),
        }),
      ),
      describeFile: withSettle((path: string, description: string) =>
        apiFetch(buildMountFileItemUrl(id, path), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description }),
        }),
      ),
      deleteFile: withSettle((path: string) => apiFetch(buildMountFileItemUrl(id, path), { method: 'DELETE' })),
      uploadFile: withSettle((path: string, file: File) => {
        const form = new FormData()
        form.set('file', file)
        return apiFetch(buildMountFileItemUrl(id, path), { method: 'PUT', body: form })
      }),
    }
  }, [id, settle])

  return {
    store: storeQuery.data ?? null,
    storeLoading: storeQuery.isLoading,
    storeError: storeQuery.error,
    entries,
    folders,
    tree,
    listingLoading: listingQuery.isLoading,
    refetch: () => Promise.all([storeQuery.refetch(), listingQuery.refetch()]),
    ops,
  }
}

/** Where one file appears (`?action=links`), fetched only while asked for. */
export function useDocumentFileLinks(storeId: string, path: string | null) {
  return useQuery({
    queryKey: queryKeys.mountPoints.links(storeId, path ?? ''),
    queryFn: ({ signal }) =>
      apiFetch<{ linkGroupId: string | null; locations: DocMountLinkLocation[] }>(
        `${buildMountFileItemUrl(storeId, path ?? '')}?action=links`,
        { signal },
      ),
    enabled: Boolean(path),
  })
}
