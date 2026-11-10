'use client'

/**
 * The Atlas's client data: one tier's entries and folders, the overlap
 * notices the editor shows, and an entry's pictures — each a TanStack Query
 * read under `queryKeys.atlas`, with the writes as mutations. No polling: the
 * lists, folders and overlaps refetch on the `atlas` realtime topic, which
 * every entry or folder write publishes (`lib/realtime/topic-map.ts`). A write
 * refreshes what it changed itself only while the socket is down
 * (`lib/query/refresh-unless-realtime.ts`).
 *
 * The folder reads and writes are the shared folder hooks'
 * (`lib/hooks/use-item-folders.ts`), bound to the Atlas here.
 *
 * Every write throws an {@link AtlasRequestError} carrying the server's
 * refusal `code` (`NAME_TAKEN`, …) so a surface can say something readable.
 *
 * @module lib/hooks/use-atlas
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { apiFetch } from '@/lib/query/fetcher'
import { refreshUnlessRealtime } from '@/lib/query/refresh-unless-realtime'
import { atlasRequest } from '@/lib/atlas/request'
import { itemFolderRefreshKeys, useItemFolderMutations, useItemFolders } from '@/lib/hooks/use-item-folders'
import type { AtlasFolder } from '@/lib/atlas/folders'
import type { WardrobeItemImageSummary } from '@/lib/wardrobe/item-images-client'
import type { AtlasEntryWithOrigin, AtlasOverlap } from '@/lib/schemas/atlas.types'
import {
  atlasActionUrl,
  atlasCollectionUrl,
  atlasEntryUrl,
  atlasImagesUrl,
  encodeAtlasContainer,
  type AtlasContainer,
} from '@/lib/atlas/container'

export { AtlasRequestError, atlasRequest } from '@/lib/atlas/request'

/** One picture of an entry, as the images route lists it. */
export type AtlasImageSummary = WardrobeItemImageSummary

/** The tier key a container's reads are cached under. */
export function atlasTierKey(container: AtlasContainer): string {
  return encodeAtlasContainer(container)
}

const EMPTY_ENTRIES: AtlasEntryWithOrigin[] = []
const EMPTY_OVERLAPS: AtlasOverlap[] = []

/** One tier's entries. Pass null to skip. */
export function useAtlasList(container: AtlasContainer | null, opts: { includeArchived: boolean }) {
  const tierKey = container ? atlasTierKey(container) : 'none'
  // The URL is a pure function of the container, which the key encodes.
  // eslint-disable-next-line @tanstack/query/exhaustive-deps
  const query = useQuery({
    queryKey: queryKeys.atlas.list(tierKey, { includeArchived: opts.includeArchived }),
    queryFn: async ({ signal }) => {
      const url = `${atlasCollectionUrl(container as AtlasContainer)}${opts.includeArchived ? '?includeArchived=true' : ''}`
      const data = await apiFetch<{ entries?: AtlasEntryWithOrigin[] }>(url, { signal })
      return data?.entries ?? []
    },
    enabled: container !== null,
  })
  return { entries: query.data ?? EMPTY_ENTRIES, loading: query.isLoading, error: query.error }
}

/** One tier's folder tree (the shared folder hook, Atlas-bound). */
export function useAtlasFolders(container: AtlasContainer | null): { folders: AtlasFolder[]; loading: boolean } {
  return useItemFolders('atlas', container)
}

/**
 * The terms a tier's entries share with other reachable entries or with a
 * character's name or alias — the editor's non-blocking notices.
 */
export function useAtlasOverlaps(container: AtlasContainer | null) {
  const tierKey = container ? atlasTierKey(container) : 'none'
  // The URL is a pure function of the container, which the key encodes.
  // eslint-disable-next-line @tanstack/query/exhaustive-deps
  const query = useQuery({
    queryKey: queryKeys.atlas.overlaps(tierKey),
    queryFn: async ({ signal }) => {
      const data = await apiFetch<{ overlaps?: AtlasOverlap[] }>(atlasActionUrl(container as AtlasContainer, 'overlaps'), { signal })
      return data?.overlaps ?? []
    },
    enabled: container !== null,
  })
  return { overlaps: query.data ?? EMPTY_OVERLAPS, loading: query.isLoading }
}

/** One entry's pictures. */
export function useAtlasImages(container: AtlasContainer | null, entryId: string | null) {
  // The URL is a pure function of the container and entry, which the key encodes.
  // eslint-disable-next-line @tanstack/query/exhaustive-deps
  const query = useQuery({
    queryKey: queryKeys.atlas.images(entryId ?? 'none'),
    queryFn: ({ signal }) =>
      apiFetch<{ current: string | null; images: AtlasImageSummary[] }>(
        atlasImagesUrl(container as AtlasContainer, entryId as string),
        { signal },
      ),
    enabled: container !== null && entryId !== null,
  })
  return { current: query.data?.current ?? null, images: query.data?.images ?? [], loading: query.isLoading }
}

/** The body the editor sends for a create or an edit. */
export type AtlasEntryBody = Partial<
  Pick<AtlasEntryWithOrigin, 'name' | 'aliases' | 'graphicPrompt' | 'knowledge' | 'metadata' | 'folder' | 'imageFileId'>
> & { archived?: boolean }

/**
 * Every entry and folder write, each against a container named per call.
 */
export function useAtlasMutations() {
  const queryClient = useQueryClient()
  // Every entry or folder write publishes `atlas`, which refreshes the lists,
  // folders and overlap notices (`topic-map.ts`); the folder writes are the
  // shared folder hook's, with the same strategy.
  const folders = useItemFolderMutations('atlas')
  const mutation = useMutation({
    mutationFn: ({ url, method, body }: { url: string; method: string; body?: unknown }) =>
      atlasRequest<Record<string, unknown>>(url, method, body),
    onSettled: () => refreshUnlessRealtime(queryClient, itemFolderRefreshKeys('atlas')),
  })
  const run = mutation.mutateAsync

  return {
    pending: mutation.isPending || folders.pending,
    create: async (container: AtlasContainer, body: AtlasEntryBody) =>
      (await run({ url: atlasCollectionUrl(container), method: 'POST', body })).entry as AtlasEntryWithOrigin,
    update: async (container: AtlasContainer, entryId: string, body: AtlasEntryBody) =>
      (await run({ url: atlasEntryUrl(container, entryId), method: 'PUT', body })).entry as AtlasEntryWithOrigin,
    remove: async (container: AtlasContainer, entryId: string) =>
      run({ url: atlasEntryUrl(container, entryId), method: 'DELETE' }),
    duplicate: async (container: AtlasContainer, entryId: string) =>
      (await run({ url: atlasActionUrl(container, 'duplicate'), method: 'POST', body: { entryId } })).entry as AtlasEntryWithOrigin,
    createFolder: folders.createFolder,
    renameFolder: folders.renameFolder,
    deleteFolder: folders.deleteFolder,
    fileItems: folders.fileItems,
    transfer: async (body: { action: 'move' | 'copy'; entryId: string; from: AtlasContainer; to: AtlasContainer }) =>
      (await run({ url: '/api/v1/atlas/transfers', method: 'POST', body })).entry as AtlasEntryWithOrigin,
  }
}
