'use client'

/**
 * The Inventory's client data: one tier's objects and folders, the
 * archetypes a tier can reach, an object's pictures, and what a chat's cast
 * carries — each a TanStack Query read under `queryKeys.inventory`, with the
 * writes as mutations. No polling: the chat read refetches on the `chats`
 * realtime topic and the lists, folders, archetype pickers and carried sets on
 * the `inventory` topic, which every object write publishes
 * (`lib/realtime/topic-map.ts`). A write refreshes what it changed itself only
 * while the socket is down (`lib/query/refresh-unless-realtime.ts`).
 *
 * The folder reads and writes are the shared folder hooks'
 * (`lib/hooks/use-item-folders.ts`), bound to the Inventory here.
 *
 * Every write throws an {@link InventoryRequestError} carrying the server's
 * refusal `code` (`ARCHETYPE_IN_USE`, `CAP_EXCEEDED`, …) so a surface can
 * open the right warning instead of a bare toast.
 *
 * @module lib/hooks/use-inventory
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { apiFetch } from '@/lib/query/fetcher'
import { refreshUnlessRealtime } from '@/lib/query/refresh-unless-realtime'
import { inventoryRequest } from '@/lib/inventory/request'
import { itemFolderRefreshKeys, useItemFolderMutations, useItemFolders } from '@/lib/hooks/use-item-folders'
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

export { InventoryRequestError, inventoryRequest } from '@/lib/inventory/request'

/** The tier key a container's reads are cached under. */
export function inventoryTierKey(container: InventoryContainer, shared = false): string {
  return `${encodeInventoryContainer(container)}${shared ? '|shared' : ''}`
}

const EMPTY_ITEMS: ResolvedInventoryItem[] = []

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
  // eslint-disable-next-line @tanstack/query/exhaustive-deps -- container and shared are left out: tierKey encodes both, and the URL is a pure function of them
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

/** One tier's folder tree (the shared folder hook, Inventory-bound). */
export function useInventoryFolders(container: InventoryContainer | null): { folders: InventoryFolder[]; loading: boolean } {
  return useItemFolders('inventory', container)
}

/** The archetypes a tier can reach (the instantiate picker). */
export function useInventoryArchetypes(container: InventoryContainer | null, projectId?: string | null) {
  const tierKey = container ? inventoryTierKey(container) : 'none'
  // The URL is a pure function of the container (and object), which the key encodes.
  // eslint-disable-next-line @tanstack/query/exhaustive-deps -- container is left out: tierKey encodes it, and the URL is a pure function of it
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
  // eslint-disable-next-line @tanstack/query/exhaustive-deps -- container is left out: an item id names one object in one tier, so itemId alone keys its pictures
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
  // lists, folders, archetype pickers and carried sets (`topic-map.ts`); the
  // folder writes are the shared folder hook's, with the same strategy.
  const folders = useItemFolderMutations('inventory')
  const mutation = useMutation({
    mutationFn: ({ url, method, body }: { url: string; method: string; body?: unknown }) =>
      inventoryRequest<Record<string, unknown>>(url, method, body),
    onSettled: () => refreshUnlessRealtime(queryClient, itemFolderRefreshKeys('inventory')),
  })
  const run = mutation.mutateAsync

  return {
    pending: mutation.isPending || folders.pending,
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
    createFolder: folders.createFolder,
    renameFolder: folders.renameFolder,
    deleteFolder: folders.deleteFolder,
    fileItems: folders.fileItems,
    transfer: async ({ action, ...body }: {
      action: 'move' | 'copy'
      itemId: string
      from: InventoryContainer
      to: InventoryContainer
    }) => (await run({ url: `/api/v1/inventory?action=${action}-to-tier`, method: 'POST', body })).item as ResolvedInventoryItem,
  }
}

/** One cast member's carried objects and kit states in a chat. */
export interface CarriedEntry {
  equipped: ResolvedInventoryItem[]
  kits: Record<string, KitState>
}

/** The one read of a chat's carried sets, shared by every reader of it. */
function chatInventoryQuery(chatId: string | null) {
  return {
    queryKey: queryKeys.inventory.equipped(chatId ?? 'none'),
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const data = await apiFetch<{ inventory?: Record<string, CarriedEntry>; projectId?: string | null }>(
        `/api/v1/chats/${chatId}?action=inventory`,
        { signal },
      )
      return { inventory: data?.inventory ?? {}, projectId: data?.projectId ?? null }
    },
    enabled: chatId !== null,
  }
}

const NOTHING_CARRIED: ResolvedInventoryItem[] = []

/**
 * What one character carries in a chat, read-only — the Salon's avatar column
 * shows it. Shares the cache entry (and the `chats` realtime refetch) with
 * `useChatInventory`, so every avatar in the transcript costs one request.
 */
export function useChatCarriedItems(chatId: string | null | undefined, characterId: string | null | undefined): ResolvedInventoryItem[] {
  const query = useQuery({
    ...chatInventoryQuery(chatId && characterId ? chatId : null),
    select: (data) => (characterId && data.inventory[characterId]?.equipped) || NOTHING_CARRIED,
  })
  return query.data ?? NOTHING_CARRIED
}

/** What a chat's cast carries, and the gestures that change it. */
export function useChatInventory(chatId: string | null) {
  const queryClient = useQueryClient()
  const query = useQuery(chatInventoryQuery(chatId))
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
