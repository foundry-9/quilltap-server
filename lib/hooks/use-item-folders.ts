'use client'

/**
 * One item container's folders — the Wardrobe's, the Inventory's or the
 * Atlas's — read and changed through TanStack Query, stated once for every kind.
 *
 * Folders are the operator's filing under a tier's `Wardrobe/`,
 * `Inventory/` or `Atlas/` — the real folder tree in the store, so the Scriptorium shows
 * the same thing. The read is `GET …?action=folders` under the kind's
 * `queryKeys.<kind>.folders`; the mutations are `create-folder`,
 * `rename-folder`, `delete-folder`, `move-items` and `copy-items`.
 *
 * No polling, and no refresh of its own while the realtime socket is up:
 * every one of these writes lands through a server location that publishes
 * the kind's topic (`wardrobe` / `inventory`, `lib/realtime/topic-map.ts`),
 * which refreshes the lists and folder trees for this tab and every other.
 * While the socket is down a write refreshes them itself
 * ({@link refreshUnlessRealtime}).
 *
 * The kinds differ in a few small ways, kept in {@link KIND_SPECS}: the URL
 * builder, the error a refusal throws (the Inventory's and the Atlas's carry
 * the server's `code`), the keys its topic refreshes, and the Atlas's
 * `entryIds` / `entries` where the others say `itemIds` / `items`. The Wardrobe's `move-items` /
 * `copy-items` also take a `components` mode for an outfit's components.
 *
 * @module lib/hooks/use-item-folders
 */

import { useCallback, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { apiFetch } from '@/lib/query/fetcher'
import { fetchJson } from '@/lib/fetch-helpers'
import { refreshUnlessRealtime } from '@/lib/query/refresh-unless-realtime'
import { inventoryRequest } from '@/lib/inventory/request'
import { inventoryActionUrl } from '@/lib/inventory/container'
import { atlasRequest } from '@/lib/atlas/request'
import { atlasActionUrl } from '@/lib/atlas/container'
import {
  encodeWardrobeContainer,
  wardrobeCollectionActionUrl,
  type WardrobeContainer,
} from '@/lib/wardrobe/wardrobe-container'
import type { ItemKind } from '@/lib/folder-browser/item-kind'
import type { ItemFolder } from '@/lib/mount-index/item-folders'
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types'
import type { ResolvedInventoryItem } from '@/lib/schemas/inventory.types'
import type { AtlasEntryWithOrigin } from '@/lib/schemas/atlas.types'

export type { ItemKind } from '@/lib/folder-browser/item-kind'

/** A tier of either kind (the Inventory's container is the Wardrobe's shape). */
export type ItemContainer = WardrobeContainer

/** What travels with a Wardrobe outfit filed into a folder (mirrors the server's `components`). */
export type WardrobeFolderComponentMode = 'move' | 'copy' | 'none'

/** The item each kind's `move-items` / `copy-items` answers with. */
export interface ItemKindItem {
  wardrobe: WardrobeItem
  inventory: ResolvedInventoryItem
  atlas: AtlasEntryWithOrigin
}

/** The kind-specific trailing arguments of `fileItems`: the Wardrobe's `components` mode. */
export type FileItemsExtra<K extends ItemKind> = K extends 'wardrobe'
  ? [components?: WardrobeFolderComponentMode]
  : []

type FolderAction = 'folders' | 'create-folder' | 'rename-folder' | 'delete-folder' | 'move-items' | 'copy-items'

interface KindSpec {
  actionUrl(container: ItemContainer, action: FolderAction): string
  /** POST a JSON body, throwing the kind's refusal on failure. */
  post(url: string, body: unknown): Promise<Record<string, unknown>>
  /** What the kind's realtime topic refreshes — refreshed by hand only while the socket is down. */
  refreshKeys: readonly QueryKey[]
  folderKey(tierKey: string): QueryKey
  label: string
  /** The body key `move-items` / `copy-items` names the ids under, and the answer's list key. */
  idsKey: 'itemIds' | 'entryIds'
  itemsKey: 'items' | 'entries'
}

const KIND_SPECS: Record<ItemKind, KindSpec> = {
  wardrobe: {
    actionUrl: wardrobeCollectionActionUrl,
    async post(url, body) {
      const result = await fetchJson<Record<string, unknown>>(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!result.ok) throw new Error(result.error || 'The wardrobe would not oblige')
      return result.data ?? {}
    },
    refreshKeys: [queryKeys.wardrobe.folderLists, queryKeys.wardrobe.lists],
    folderKey: queryKeys.wardrobe.folders,
    label: 'wardrobe',
    idsKey: 'itemIds',
    itemsKey: 'items',
  },
  inventory: {
    actionUrl: (container, action) => inventoryActionUrl(container, action),
    post: async (url, body) => (await inventoryRequest<Record<string, unknown>>(url, 'POST', body)) ?? {},
    refreshKeys: [
      queryKeys.inventory.lists,
      queryKeys.inventory.folderLists,
      queryKeys.inventory.archetypeLists,
      queryKeys.inventory.equippedLists,
    ],
    folderKey: queryKeys.inventory.folders,
    label: 'inventory',
    idsKey: 'itemIds',
    itemsKey: 'items',
  },
  atlas: {
    actionUrl: (container, action) => atlasActionUrl(container, action),
    post: async (url, body) => (await atlasRequest<Record<string, unknown>>(url, 'POST', body)) ?? {},
    refreshKeys: [queryKeys.atlas.lists, queryKeys.atlas.folderLists, queryKeys.atlas.overlapLists],
    folderKey: queryKeys.atlas.folders,
    label: 'atlas',
    idsKey: 'entryIds',
    itemsKey: 'entries',
  },
}

/** The keys a kind's folder write refreshes (while the socket is down). */
export function itemFolderRefreshKeys(kind: ItemKind): readonly QueryKey[] {
  return KIND_SPECS[kind].refreshKeys
}

/** The cache identity of a container's folder tree: its encoded `scope:id`. */
export function itemFolderTierKey(container: ItemContainer | null): string {
  return container ? encodeWardrobeContainer(container) : 'none'
}

const EMPTY: ItemFolder[] = []

export interface UseItemFoldersResult {
  /** Every folder in the container, sorted by path; empty until the read lands. */
  folders: ItemFolder[]
  loading: boolean
}

/** The folder tree of one container of `kind`. Pass null to skip the read. */
export function useItemFolders(kind: ItemKind, container: ItemContainer | null): UseItemFoldersResult {
  const spec = KIND_SPECS[kind]
  const tierKey = itemFolderTierKey(container)
  // The URL is a pure function of the kind and container, which the key encodes.
  // eslint-disable-next-line @tanstack/query/exhaustive-deps
  const query = useQuery({
    queryKey: spec.folderKey(tierKey),
    queryFn: async ({ signal }) => {
      const data = await apiFetch<{ folders?: ItemFolder[] }>(
        spec.actionUrl(container as ItemContainer, 'folders'),
        { signal },
      )
      return data?.folders ?? []
    },
    enabled: container !== null,
  })

  const error = query.error
  useEffect(() => {
    if (error) console.warn('[useItemFolders] Failed to load folders', { kind, tierKey, error })
  }, [error, kind, tierKey])

  return { folders: query.data ?? EMPTY, loading: query.isLoading }
}

interface FolderRequest {
  container: ItemContainer
  action: Exclude<FolderAction, 'folders'>
  body: unknown
}

export interface ItemFolderMutations<K extends ItemKind> {
  createFolder(container: ItemContainer, path: string): Promise<ItemFolder>
  renameFolder(container: ItemContainer, path: string, name: string): Promise<ItemFolder>
  deleteFolder(container: ItemContainer, path: string): Promise<{ movedItems: number; movedFolders: number }>
  /** Move or copy items into a folder of `container` (`''` is the root). */
  fileItems(
    mode: 'move' | 'copy',
    container: ItemContainer,
    itemIds: string[],
    folder: string,
    ...extra: FileItemsExtra<K>
  ): Promise<ItemKindItem[K][]>
  pending: boolean
}

/**
 * The folder mutations of `kind`, each against a container named per call (a
 * row's home may differ from the browsed container in a character's merged
 * view). Every call throws with the server's refusal on failure — for the
 * Inventory an `InventoryRequestError` carrying its `code`.
 */
export function useItemFolderMutations<K extends ItemKind>(kind: K): ItemFolderMutations<K> {
  const queryClient = useQueryClient()
  const spec = KIND_SPECS[kind]

  const mutation = useMutation({
    mutationFn: ({ container, action, body }: FolderRequest) => spec.post(spec.actionUrl(container, action), body),
    onSettled: () => refreshUnlessRealtime(queryClient, spec.refreshKeys),
  })
  const { mutateAsync } = mutation

  const createFolder = useCallback(
    async (container: ItemContainer, path: string): Promise<ItemFolder> =>
      (await mutateAsync({ container, action: 'create-folder', body: { path } })).folder as ItemFolder,
    [mutateAsync],
  )

  const renameFolder = useCallback(
    async (container: ItemContainer, path: string, name: string): Promise<ItemFolder> =>
      (await mutateAsync({ container, action: 'rename-folder', body: { path, name } })).folder as ItemFolder,
    [mutateAsync],
  )

  const deleteFolder = useCallback(
    async (container: ItemContainer, path: string): Promise<{ movedItems: number; movedFolders: number }> => {
      const data = await mutateAsync({ container, action: 'delete-folder', body: { path } })
      return { movedItems: Number(data.movedItems ?? 0), movedFolders: Number(data.movedFolders ?? 0) }
    },
    [mutateAsync],
  )

  const fileItems = useCallback(
    async (
      mode: 'move' | 'copy',
      container: ItemContainer,
      itemIds: string[],
      folder: string,
      ...extra: FileItemsExtra<K>
    ): Promise<ItemKindItem[K][]> => {
      const components = (extra as Array<WardrobeFolderComponentMode | undefined>)[0]
      const data = await mutateAsync({
        container,
        action: mode === 'move' ? 'move-items' : 'copy-items',
        body: { [spec.idsKey]: itemIds, folder, ...(components ? { components } : {}) },
      })
      return (data[spec.itemsKey] as ItemKindItem[K][] | undefined) ?? []
    },
    [mutateAsync, spec],
  )

  return { createFolder, renameFolder, deleteFolder, fileItems, pending: mutation.isPending }
}
