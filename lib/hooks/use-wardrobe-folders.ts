'use client'

/**
 * One wardrobe container's folders, read and changed through TanStack Query.
 *
 * Folders are the operator's filing under a tier's `Wardrobe/` — the real
 * folder tree in the store, so the Scriptorium shows the same thing. The read
 * is `GET …/wardrobe?action=folders` under `queryKeys.wardrobe.folders`; the
 * mutations (`create-folder`, `rename-folder`, `delete-folder`, `move-items`)
 * invalidate every folder tree and every wardrobe list, since moving an item
 * changes both.
 *
 * There is no realtime topic for wardrobe changes, so these refresh on
 * invalidation (after this client's own mutations) and on remount; they do
 * not poll. A folder made in the Scriptorium appears on the next open.
 *
 * @module lib/hooks/use-wardrobe-folders
 */

import { useCallback, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { apiFetch } from '@/lib/query/fetcher'
import { fetchJson } from '@/lib/fetch-helpers'
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types'
import type { WardrobeFolder } from '@/lib/wardrobe/folders'
import {
  wardrobeCollectionActionUrl,
  wardrobeTierKey,
  type WardrobeContainer,
} from '@/lib/wardrobe/wardrobe-container'

const EMPTY: WardrobeFolder[] = []

export interface UseWardrobeFoldersResult {
  /** Every folder in the container, sorted by path; empty until the read lands. */
  folders: WardrobeFolder[]
  loading: boolean
}

/** The folder tree of one container. Pass null to skip the read. */
export function useWardrobeFolders(container: WardrobeContainer | null): UseWardrobeFoldersResult {
  const tierKey = container ? wardrobeTierKey({ container }) : 'none'
  // The URL is a pure function of the container, which `tierKey` encodes.
  // eslint-disable-next-line @tanstack/query/exhaustive-deps
  const query = useQuery({
    queryKey: queryKeys.wardrobe.folders(tierKey),
    queryFn: async ({ signal }) => {
      const data = await apiFetch<{ folders?: WardrobeFolder[] }>(
        wardrobeCollectionActionUrl(container as WardrobeContainer, 'folders'),
        { signal },
      )
      return data?.folders ?? []
    },
    enabled: container !== null,
  })

  const error = query.error
  useEffect(() => {
    if (error) console.warn('[useWardrobeFolders] Failed to load wardrobe folders', { tierKey, error })
  }, [error, tierKey])

  return { folders: query.data ?? EMPTY, loading: query.isLoading }
}

interface FolderRequest {
  container: WardrobeContainer
  action: 'create-folder' | 'rename-folder' | 'delete-folder' | 'move-items'
  body: unknown
}

/**
 * The folder mutations, each against a container named per call (a row's
 * home may differ from the browsed container in a character's merged view).
 * Every call throws with the server's message on failure.
 */
export function useWardrobeFolderMutations() {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: async ({ container, action, body }: FolderRequest) => {
      const result = await fetchJson<Record<string, unknown>>(
        wardrobeCollectionActionUrl(container, action),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      )
      if (!result.ok) throw new Error(result.error || 'The wardrobe would not oblige')
      return result.data
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.wardrobe.folderLists }),
        queryClient.invalidateQueries({ queryKey: queryKeys.wardrobe.lists }),
      ]),
  })
  const { mutateAsync } = mutation

  const createFolder = useCallback(
    async (container: WardrobeContainer, path: string): Promise<WardrobeFolder> => {
      const data = await mutateAsync({ container, action: 'create-folder', body: { path } })
      return data?.folder as WardrobeFolder
    },
    [mutateAsync],
  )

  const renameFolder = useCallback(
    async (container: WardrobeContainer, path: string, name: string): Promise<WardrobeFolder> => {
      const data = await mutateAsync({ container, action: 'rename-folder', body: { path, name } })
      return data?.folder as WardrobeFolder
    },
    [mutateAsync],
  )

  const deleteFolder = useCallback(
    async (
      container: WardrobeContainer,
      path: string,
    ): Promise<{ movedItems: number; movedFolders: number }> => {
      const data = await mutateAsync({ container, action: 'delete-folder', body: { path } })
      return {
        movedItems: Number(data?.movedItems ?? 0),
        movedFolders: Number(data?.movedFolders ?? 0),
      }
    },
    [mutateAsync],
  )

  const moveItems = useCallback(
    async (container: WardrobeContainer, itemIds: string[], folder: string): Promise<WardrobeItem[]> => {
      const data = await mutateAsync({ container, action: 'move-items', body: { itemIds, folder } })
      return (data?.items as WardrobeItem[] | undefined) ?? []
    },
    [mutateAsync],
  )

  return { createFolder, renameFolder, deleteFolder, moveItems, pending: mutation.isPending }
}
