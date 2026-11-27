'use client'

/**
 * useCharacterPhotosQuery — the one read of a character's photo album
 * (`GET /api/v1/characters/{id}/photos?limit=200`), cached under
 * `queryKeys.characters.photos(id)`.
 *
 * The Aurora embedded gallery and the album mode of `PhotoGalleryModal` both
 * read it, so a write through either (which invalidates or edits that key)
 * refreshes the other. `toGalleryImage` is the one mapping from the route's
 * entry shape to the gallery's.
 *
 * @module components/images/embedded-gallery/hooks/useCharacterPhotosQuery
 */

import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import type { GenerationModeration } from '@/lib/schemas/file.types'
import type { GalleryImage } from '../types'

/** One album entry as `GET /api/v1/characters/{id}/photos` returns it. */
export interface CharacterGalleryEntry {
  linkId: string
  mountPointId: string
  relativePath: string
  fileName: string
  blobUrl: string
  mimeType: string | null
  sha256: string
  fileSizeBytes: number
  keptAt: string
  caption: string | null
  tags: string[]
  generationModeration?: GenerationModeration | null
}

export interface CharacterGalleryListResponse {
  entries: CharacterGalleryEntry[]
  total: number
  hasMore: boolean
}

/** The album read's page size: the whole album, as both galleries show it. */
export const CHARACTER_PHOTOS_LIMIT = 200

/** Map an album entry onto the gallery's image shape (`id` is the link id). */
export function toGalleryImage(entry: CharacterGalleryEntry): GalleryImage {
  return {
    id: entry.linkId,
    filename: entry.fileName,
    filepath: entry.blobUrl,
    mimeType: entry.mimeType,
    size: entry.fileSizeBytes,
    createdAt: entry.keptAt,
    caption: entry.caption,
    tags: entry.tags,
    generationModeration: entry.generationModeration ?? null,
  }
}

export function useCharacterPhotosQuery(
  characterId: string,
  options?: {
    enabled?: boolean
    /**
     * Read again each time the consumer mounts or is enabled, cached or not. A
     * photo saved to the album from elsewhere (a chat image, the save-image
     * dialog) publishes no topic that reaches this key, so a dialog that must
     * show it asks.
     */
    fresh?: boolean
  },
) {
  return useQuery({
    queryKey: queryKeys.characters.photos(characterId),
    queryFn: ({ signal }) =>
      apiFetch<CharacterGalleryListResponse>(
        `/api/v1/characters/${characterId}/photos?limit=${CHARACTER_PHOTOS_LIMIT}`,
        { signal },
      ),
    enabled: (options?.enabled ?? true) && Boolean(characterId),
    ...(options?.fresh ? { staleTime: 0, refetchOnMount: 'always' as const } : {}),
  })
}
