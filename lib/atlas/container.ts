/**
 * The Atlas's client-side addressing: which tier a browser is looking at, and
 * the URLs its reads and writes go to. A container is the wardrobe's
 * `{ scope, id }` shape (one encoder, `encodeWardrobeContainer`, names a tier
 * for every item kind), so the dialogs' container selects read the same.
 *
 * Client-safe: pure.
 *
 * @module lib/atlas/container
 */

import {
  GENERAL_CONTAINER,
  decodeWardrobeContainer,
  encodeWardrobeContainer,
  type WardrobeContainer,
} from '@/lib/wardrobe/wardrobe-container'
import type { AtlasOrigin } from '@/lib/schemas/atlas.types'

export type AtlasContainer = WardrobeContainer

export const GENERAL_ATLAS_CONTAINER: AtlasContainer = GENERAL_CONTAINER
export const GENERAL_ATLAS_NAME = 'Quilltap General'

export const encodeAtlasContainer = encodeWardrobeContainer
export const decodeAtlasContainer = decodeWardrobeContainer

/** The collection URL of a tier. */
export function atlasCollectionUrl(container: AtlasContainer): string {
  switch (container.scope) {
    case 'general':
      return '/api/v1/atlas'
    case 'character':
      return `/api/v1/characters/${container.id}/atlas`
    case 'project':
      return `/api/v1/projects/${container.id}/atlas`
    case 'group':
      return `/api/v1/groups/${container.id}/atlas`
  }
}

/** A collection action URL, with optional extra query parameters. */
export function atlasActionUrl(
  container: AtlasContainer,
  action: string,
  params: Record<string, string | null | undefined> = {},
): string {
  const query = new URLSearchParams({ action })
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value)
  return `${atlasCollectionUrl(container)}?${query.toString()}`
}

/** The item URL of one entry in a tier. */
export function atlasEntryUrl(container: AtlasContainer, entryId: string): string {
  return `${atlasCollectionUrl(container)}/${entryId}`
}

/** The images URL of one entry, with its container in the query. */
export function atlasImagesUrl(container: AtlasContainer, entryId: string, action?: string): string {
  const query = new URLSearchParams({ scope: container.scope })
  if (container.id) query.set('id', container.id)
  if (action) query.set('action', action)
  return `/api/v1/atlas/${entryId}/images?${query.toString()}`
}

/** The tier an entry lives in, from the origin a read tagged it with. */
export function containerOfAtlasOrigin(origin: AtlasOrigin | null | undefined, fallback: AtlasContainer): AtlasContainer {
  if (!origin) return fallback
  if (origin.scope === 'general') return GENERAL_ATLAS_CONTAINER
  return origin.id ? { scope: origin.scope, id: origin.id } : fallback
}

/** A short label for the tier an entry (or another reachable entry) lives in. */
export function atlasOriginLabel(origin: AtlasOrigin | null | undefined): string | null {
  if (!origin) return null
  if (origin.scope === 'general') return 'General'
  if (origin.scope === 'project') return `Project: ${origin.name}`
  if (origin.scope === 'group') return `Group: ${origin.name}`
  return origin.name
}
