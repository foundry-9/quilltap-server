'use client'

/**
 * The Inventory's client data: one tier's objects and folders, the
 * archetypes a tier can reach, an object's pictures, and what a chat's cast
 * carries — each a TanStack Query read under `queryKeys.inventory`, with the
 * writes as mutations. No polling: the chat read refetches on the `chats`
 * realtime topic and the lists, folders, archetype pickers and carried sets on
 * the `inventory` topic, which every object write publishes
 * (`lib/realtime/topic-map.ts`). A write refreshes what it changed itself only
 * while the socket is down ({@link refreshUnlessRealtime}).
 *
 * Every write throws an {@link InventoryRequestError} carrying the server's
 * refusal `code` (`ARCHETYPE_IN_USE`, `CAP_EXCEEDED`, …) so a surface can
 * open the right warning instead of a bare toast.
 *
 * @module lib/hooks/use-inventory
 */

import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query'
import { getRealtimeStatus } from '@/lib/realtime/client'
import { queryKeys } from '@/lib/query/keys'
import { apiFetch, apiErrorMessage, ApiFetchError } from '@/lib/query/fetcher'
import type { InventoryFolder } from '@/lib/inventory/folders'
import type { InventoryImageSummary } from '@/lib/inventory/item-images'
import type {
  InventoryInheritableField,
  KitState,
  ResolvedInventoryItem,
} from '@/lib/schemas/inventory.types'
import {
  encodeInventoryContainer,
  inventoryActionUrl,
  inventoryCollectionUrl,
  inventoryImagesUrl,
  inventoryItemUrl,
  type InventoryContainer,
} from '@/lib/inventory/container'

/** A refused write, with the server's code and details. */
export class InventoryRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
    readonly details: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'InventoryRequestError'
  }
}

/** POST / PUT / DELETE JSON, turning a refusal into an {@link InventoryRequestError}. */
export async function inventoryRequest<T>(url: string, method: string, body?: unknown): Promise<T> {
  try {
    return await apiFetch<T>(url, {
      method,
      ...(body !== undefined && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    })
  } catch (error) {
    if (error instanceof ApiFetchError) {
      const info = (error.info ?? {}) as { details?: Record<string, unknown> }
      const details = info.details ?? {}
      throw new InventoryRequestError(
        apiErrorMessage(error, 'The Inventory would not oblige'),
        error.status,
        typeof details.code === 'string' ? details.code : null,
        details,
      )
    }
    throw error
  }
}

/** The tier key a container's reads are cached under. */
export function inventoryTierKey(container: InventoryContainer, shared = false): string {
  return `${encodeInventoryContainer(container)}${shared ? '|shared' : ''}`
}

const EMPTY_ITEMS: ResolvedInventoryItem[] = []
const EMPTY_FOLDERS: InventoryFolder[] = []

export interface InventoryListOptions {
  includeArchived: boolean
  /** A character's whole reachable pool, each object tagged with its tier. */
  shared?: boolean
  /** The project tier for a character's pool. */
  projectId?: string | null
}

/** One tier's objects (resolved). Pass null to skip. */
export function useInventoryList(container: InventoryContainer | null, opts: InventoryListOptions) {
  const shared = !!opts.shared && container?.scope === 'character'
  const tierKey = container ? inventoryTierKey(container, shared) : 'none'
  // The URL is a pure function of the container (and object), which the key encodes.
  // eslint-disable-next-line @tanstack/query/exhaustive-deps
  const query = useQuery({
    queryKey: queryKeys.inventory.list(tierKey, { includeArchived: opts.includeArchived, projectId: opts.projectId ?? null }),
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams()
      if (opts.includeArchived) params.set('includeArchived', 'true')
      if (shared) params.set('shared', 'true')
      if (opts.projectId) params.set('projectId', opts.projectId)
      const qs = params.toString()
      const url = `${inventoryCollectionUrl(container as InventoryContainer)}${qs ? `?${qs}` : ''}`
      const data = await apiFetch<{ items?: ResolvedInventoryItem[] }>(url, { signal })
      return data?.items ?? []
    },
    enabled: container !== null,
  })
  return { items: query.data ?? EMPTY_ITEMS, loading: query.isLoading, error: query.error }
}

/** One tier's folder tree. */
export function useInventoryFolders(container: InventoryContainer | null) {
  const tierKey = container ? inventoryTierKey(container) : 'none'
  // The URL is a pure function of the container (and object), which the key encodes.
  // eslint-disable-next-line @tanstack/query/exhaustive-deps
  const query = useQuery({
    queryKey: queryKeys.inventory.folders(tierKey),
    queryFn: async ({ signal }) => {
      const data = await apiFetch<{ folders?: InventoryFolder[] }>(
        inventoryActionUrl(container as InventoryContainer, 'folders'),
        { signal },
      )
      return data?.folders ?? []
    },
    enabled: container !== null,
  })
  return { folders: query.data ?? EMPTY_FOLDERS, loading: query.isLoading }
}

/** The archetypes a tier can reach (the instantiate picker). */
export function useInventoryArchetypes(container: InventoryContainer | null, projectId?: string | null) {
  const tierKey = container ? inventoryTierKey(container) : 'none'
  // The URL is a pure function of the container (and object), which the key encodes.
  // eslint-disable-next-line @tanstack/query/exhaustive-deps
  const query = useQuery({
    queryKey: queryKeys.inventory.archetypes(tierKey, projectId),
    queryFn: async ({ signal }) => {
      const data = await apiFetch<{ items?: ResolvedInventoryItem[] }>(
        inventoryActionUrl(container as InventoryContainer, 'archetypes', { projectId }),
        { signal },
      )
      return data?.items ?? []
    },
    enabled: container !== null,
  })
  return { archetypes: query.data ?? EMPTY_ITEMS, loading: query.isLoading }
}

/** One object's pictures (an instance with none shows its archetype's). */
export function useInventoryImages(container: InventoryContainer | null, itemId: string | null) {
  // The URL is a pure function of the container (and object), which the key encodes.
  // eslint-disable-next-line @tanstack/query/exhaustive-deps
  const query = useQuery({
    queryKey: queryKeys.inventory.images(itemId ?? 'none'),
    queryFn: ({ signal }) =>
      apiFetch<{ current: string | null; images: InventoryImageSummary[] }>(
        inventoryImagesUrl(container as InventoryContainer, itemId as string),
        { signal },
      ),
    enabled: container !== null && itemId !== null,
  })
  return { current: query.data?.current ?? null, images: query.data?.images ?? [], loading: query.isLoading }
}

/** The body the editor sends for a create or an edit. */
export type InventoryItemBody = Partial<
  Pick<
    ResolvedInventoryItem,
    | 'kind'
    | 'name'
    | 'title'
    | 'description'
    | 'imageDescription'
    | 'equippedByDefault'
    | 'maxEquipped'
    | 'canCopy'
    | 'isArchetype'
    | 'itemIds'
    | 'emoji'
    | 'svg'
    | 'metadata'
    | 'folder'
    | 'imageFileId'
  >
> & { archived?: boolean }

/**
 * After this tab's own write: refresh `keys` only while the realtime socket
 * is down. While it is up, the server's publish for that write refreshes the
 * same keys (`lib/realtime/topic-map.ts`), and refreshing here as well would
 * fetch everything twice. A socket that drops before the hint arrives
 * re-reads every realtime key when it reconnects (`RealtimeProvider`).
 */
function refreshUnlessRealtime(queryClient: QueryClient, keys: readonly QueryKey[]): Promise<unknown> {
  if (getRealtimeStatus() === 'connected') return Promise.resolve()
  return Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })))
}

/** A collection or item URL with the project context a kit's pool reads. */
function withProjectContext(url: string, projectId?: string | null): string {
  return projectId ? `${url}?projectId=${encodeURIComponent(projectId)}` : url
}

/**
 * Every object and folder write, each against a container named per call
 * (an object seen in a character's merged view lives in its own tier).
 */
export function useInventoryMutations() {
  const queryClient = useQueryClient()
  // Every object or folder write publishes `inventory`, which refreshes the
  // lists, folders, archetype pickers and carried sets (`topic-map.ts`).
  const invalidate = useCallback(
    () =>
      refreshUnlessRealtime(queryClient, [
        queryKeys.inventory.lists,
        queryKeys.inventory.folderLists,
        queryKeys.inventory.archetypeLists,
        queryKeys.inventory.equippedLists,
      ]),
    [queryClient],
  )
  const mutation = useMutation({
    mutationFn: ({ url, method, body }: { url: string; method: string; body?: unknown }) =>
      inventoryRequest<Record<string, unknown>>(url, method, body),
    onSettled: invalidate,
  })
  const run = mutation.mutateAsync

  return {
    pending: mutation.isPending,
    // `projectId` names the project a character's kit may borrow members from.
    create: async (container: InventoryContainer, body: InventoryItemBody, projectId?: string | null) =>
      (await run({ url: withProjectContext(inventoryCollectionUrl(container), projectId), method: 'POST', body }))
        .item as ResolvedInventoryItem,
    update: async (container: InventoryContainer, itemId: string, body: InventoryItemBody, projectId?: string | null) =>
      (await run({ url: withProjectContext(inventoryItemUrl(container, itemId), projectId), method: 'PUT', body }))
        .item as ResolvedInventoryItem,
    clearOverrides: async (container: InventoryContainer, itemId: string, fields: InventoryInheritableField[]) =>
      (await run({ url: `${inventoryItemUrl(container, itemId)}?action=clear-override`, method: 'PUT', body: { fields } }))
        .item as ResolvedInventoryItem,
    detach: async (container: InventoryContainer, itemId: string) =>
      (await run({ url: `${inventoryItemUrl(container, itemId)}?action=detach`, method: 'PUT', body: {} }))
        .item as ResolvedInventoryItem,
    remove: async (container: InventoryContainer, itemId: string, force = false) =>
      run({ url: `${inventoryItemUrl(container, itemId)}${force ? '?force=true' : ''}`, method: 'DELETE' }),
    instantiate: async (
      container: InventoryContainer,
      body: { archetypeId: string; folder?: string; projectId?: string | null; chatId?: string | null },
    ) => (await run({ url: inventoryActionUrl(container, 'instantiate'), method: 'POST', body })).item as ResolvedInventoryItem,
    duplicate: async (container: InventoryContainer, itemId: string) =>
      (await run({ url: inventoryActionUrl(container, 'duplicate'), method: 'POST', body: { itemId } })).item as ResolvedInventoryItem,
    createFolder: async (container: InventoryContainer, path: string) =>
      (await run({ url: inventoryActionUrl(container, 'create-folder'), method: 'POST', body: { path } })).folder as InventoryFolder,
    renameFolder: async (container: InventoryContainer, path: string, name: string) =>
      (await run({ url: inventoryActionUrl(container, 'rename-folder'), method: 'POST', body: { path, name } })).folder as InventoryFolder,
    deleteFolder: async (container: InventoryContainer, path: string) => {
      const data = await run({ url: inventoryActionUrl(container, 'delete-folder'), method: 'POST', body: { path } })
      return { movedItems: Number(data.movedItems ?? 0), movedFolders: Number(data.movedFolders ?? 0) }
    },
    fileItems: async (mode: 'move' | 'copy', container: InventoryContainer, itemIds: string[], folder: string) =>
      ((await run({ url: inventoryActionUrl(container, mode === 'move' ? 'move-items' : 'copy-items'), method: 'POST', body: { itemIds, folder } }))
        .items ?? []) as ResolvedInventoryItem[],
    transfer: async (body: {
      action: 'move' | 'copy'
      itemId: string
      from: InventoryContainer
      to: InventoryContainer
    }) => (await run({ url: '/api/v1/inventory/transfers', method: 'POST', body })).item as ResolvedInventoryItem,
  }
}

/** One cast member's carried objects and kit states in a chat. */
export interface CarriedEntry {
  equipped: ResolvedInventoryItem[]
  kits: Record<string, KitState>
}

/** What a chat's cast carries, and the gestures that change it. */
export function useChatInventory(chatId: string | null) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: queryKeys.inventory.equipped(chatId ?? 'none'),
    queryFn: async ({ signal }) => {
      const data = await apiFetch<{ inventory?: Record<string, CarriedEntry>; projectId?: string | null }>(
        `/api/v1/chats/${chatId}?action=inventory`,
        { signal },
      )
      return { inventory: data?.inventory ?? {}, projectId: data?.projectId ?? null }
    },
    enabled: chatId !== null,
  })
  const mutation = useMutation({
    mutationFn: ({ action, body }: { action: string; body: unknown }) =>
      inventoryRequest<Record<string, unknown>>(`/api/v1/chats/${chatId}?action=${action}`, 'POST', body),
    // A carried-set write publishes `chats` (this chat's carried set); a kit's
    // archetype members instantiated into the vault publish `inventory`.
    onSettled: () =>
      refreshUnlessRealtime(queryClient, [queryKeys.inventory.equipped(chatId ?? 'none'), queryKeys.inventory.lists]),
  })
  const run = mutation.mutateAsync
  const inventory = query.data?.inventory ?? {}
  return {
    inventory,
    /** The chat's project, for the project tier of a character's pool. */
    projectId: query.data?.projectId ?? null,
    loading: query.isLoading,
    pending: mutation.isPending,
    carriedBy: (characterId: string | null): CarriedEntry =>
      (characterId && inventory[characterId]) || { equipped: [], kits: {} },
    equip: (characterId: string, ids: string[]) => run({ action: 'inventory-equip', body: { characterId, ids } }),
    unequip: (characterId: string, ids: string[]) => run({ action: 'inventory-unequip', body: { characterId, ids } }),
    resetToDefaults: (characterId: string) => run({ action: 'inventory-reset-defaults', body: { characterId } }),
  }
}
