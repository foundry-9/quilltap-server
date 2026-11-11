'use client'

/**
 * The document stores linked to a project or a group, and the writes that
 * link and unlink them.
 *
 * Both owners answer from one server route factory
 * (`lib/mount-index/owner-mount-links-routes.ts`), so the client has one hook:
 * `useOwnerStoresQuery` is the one read of `/api/v1/{projects|groups}/{id}/mount-points`
 * (keyed `projects.stores(id)` / `groups.stores(id)`, so the project page's
 * card and the project store browser share one entry), and
 * `useOwnerStoreLinks` adds the store list for the picker and the two writes.
 * A link or unlink refreshes the owner's list and the store's own reads (the
 * Scriptorium shows where a store is linked).
 *
 * @module lib/hooks/use-owner-store-links
 */

import { useCallback, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { useDocumentStoresQuery } from './use-document-stores'

export type StoreOwnerKind = 'project' | 'group'

export interface StoreOwner {
  kind: StoreOwnerKind
  id: string
}

/** `GET /api/v1/{projects|groups}/{id}/mount-points`. */
export interface OwnerStoresResponse<S> {
  mountPoints: S[]
  officialMountPointId: string | null
}

export function ownerStoresKey(owner: StoreOwner) {
  return owner.kind === 'project' ? queryKeys.projects.stores(owner.id) : queryKeys.groups.stores(owner.id)
}

function ownerStoresUrl(owner: StoreOwner): string {
  const base = owner.kind === 'project' ? '/api/v1/projects' : '/api/v1/groups'
  return `${base}/${owner.id}/mount-points`
}

/** The owner's linked stores, envelope and all. Gated off while `owner.id` is empty. */
export function useOwnerStoresQuery<S = { id: string; name: string }>(owner: StoreOwner) {
  return useQuery({
    queryKey: ownerStoresKey(owner),
    queryFn: ({ signal }) => apiFetch<OwnerStoresResponse<S>>(ownerStoresUrl(owner), { signal }),
    enabled: !!owner.id,
  })
}

export interface OwnerStoreLinks<S> {
  /** Stores linked to the owner. */
  linkedStores: S[]
  /** Every store, for the picker. */
  allStores: S[]
  loading: boolean
  /** Link a store; resolves false (and logs) on failure. */
  linkStore: (mountPointId: string) => Promise<boolean>
  /** Unlink a store; resolves false (and logs) on failure. */
  unlinkStore: (mountPointId: string) => Promise<boolean>
}

const NO_STORES: never[] = []

export function useOwnerStoreLinks<S = { id: string; name: string }>(
  kind: StoreOwnerKind,
  id: string,
): OwnerStoreLinks<S> {
  const owner = useMemo<StoreOwner>(() => ({ kind, id }), [kind, id])
  const queryClient = useQueryClient()
  const linked = useOwnerStoresQuery<S>(owner)
  const all = useDocumentStoresQuery<S>()

  const settle = useCallback(
    (mountPointId: string) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ownerStoresKey(owner) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.mountPoints.store(mountPointId) }),
      ]),
    [queryClient, owner],
  )

  const { mutateAsync: link } = useMutation({
    mutationFn: (mountPointId: string) =>
      apiFetch(ownerStoresUrl(owner), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mountPointId }),
      }),
    onSuccess: (_data, mountPointId) => settle(mountPointId),
  })

  const { mutateAsync: unlink } = useMutation({
    mutationFn: (mountPointId: string) =>
      apiFetch(`${ownerStoresUrl(owner)}?mountPointId=${encodeURIComponent(mountPointId)}`, { method: 'DELETE' }),
    onSuccess: (_data, mountPointId) => settle(mountPointId),
  })

  const run = useCallback(
    async (write: (id: string) => Promise<unknown>, verb: string, mountPointId: string): Promise<boolean> => {
      try {
        await write(mountPointId)
        return true
      } catch (err) {
        console.error(`useOwnerStoreLinks: ${verb} error`, {
          owner: owner.kind,
          ownerId: owner.id,
          mountPointId,
          error: err instanceof Error ? err.message : String(err),
        })
        return false
      }
    },
    [owner],
  )

  const linkStore = useCallback((id: string) => run(link, 'link', id), [run, link])
  const unlinkStore = useCallback((id: string) => run(unlink, 'unlink', id), [run, unlink])

  return {
    linkedStores: linked.data?.mountPoints ?? NO_STORES,
    allStores: all.data ?? NO_STORES,
    loading: linked.isLoading || all.isLoading,
    linkStore,
    unlinkStore,
  }
}
