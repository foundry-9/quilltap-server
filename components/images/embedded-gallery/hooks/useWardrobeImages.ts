'use client'

import { useCallback, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { showErrorToast } from '@/lib/toast'
import { triggerDownload } from '@/lib/download-utils'
import type { WardrobeGalleryImage } from '../types'

interface WardrobeGalleryImageEntry {
  fileId: string
  fileName: string
  url: string
  thumbnailUrl: string
  mimeType: string | null
  fileSizeBytes: number
  width: number | null
  height: number | null
  createdAt: string
  generationPrompt: string | null
  generationModel: string | null
  itemId: string
  itemTitle: string
  locationLabel: string
  itemArchived: boolean
  isCurrentItemImage: boolean
}

interface WardrobeImagesListResponse {
  entries: WardrobeGalleryImageEntry[]
  total: number
}

function toWardrobeGalleryImage(entry: WardrobeGalleryImageEntry): WardrobeGalleryImage {
  return {
    id: entry.fileId,
    filename: entry.fileName,
    filepath: entry.url,
    // The tile shows the thumbnail; the detail view and download use `fullUrl`.
    url: entry.thumbnailUrl,
    fullUrl: entry.url,
    mimeType: entry.mimeType,
    size: entry.fileSizeBytes,
    width: entry.width ?? undefined,
    height: entry.height ?? undefined,
    createdAt: entry.createdAt,
    caption: null,
    tags: [],
    itemId: entry.itemId,
    itemTitle: entry.itemTitle,
    locationLabel: entry.locationLabel,
    itemArchived: entry.itemArchived,
    isCurrentItemImage: entry.isCurrentItemImage,
    generationPrompt: entry.generationPrompt,
    generationModel: entry.generationModel,
  }
}

/**
 * Read the generated pictures of every wardrobe item a character can reach —
 * `/api/v1/characters/[id]/wardrobe-images`. Read-only: the only action is a
 * download, done bytes-then-blob like the album grid so Electron's native
 * save dialog gets a blob rather than a link.
 */
export function useWardrobeImages(characterId: string) {
  const [missingImages, setMissingImages] = useState<Set<string>>(new Set())

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.characters.wardrobeImages(characterId),
    queryFn: ({ signal }) =>
      apiFetch<WardrobeImagesListResponse>(
        `/api/v1/characters/${characterId}/wardrobe-images`,
        { signal }
      ),
  })

  const images: WardrobeGalleryImage[] = (data?.entries ?? []).map(toWardrobeGalleryImage)

  const handleImageError = useCallback((imageId: string) => {
    setMissingImages(prev => new Set(prev).add(imageId))
    console.warn('Wardrobe picture failed to load', { imageId })
  }, [])

  const downloadImage = useCallback(
    async (image: WardrobeGalleryImage) => {
      try {
        const res = await fetch(image.fullUrl)
        if (!res.ok) throw new Error(`Failed to fetch image (${res.status})`)
        const blob = await res.blob()
        await triggerDownload(blob, image.filename)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        showErrorToast('Failed to download image')
        console.error('Error downloading wardrobe picture', { characterId, imageId: image.id, error: message })
      }
    },
    [characterId]
  )

  return {
    images,
    total: data?.total ?? 0,
    loading: isLoading,
    missingImages,
    handleImageError,
    downloadImage,
  }
}
