'use client'

import { useState, useCallback } from 'react'
import useSWR from 'swr'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import type { GalleryImage, EntityType } from '../types'

export function useGalleryData(entityId: string, entityType: EntityType) {
  const [missingImages, setMissingImages] = useState<Set<string>>(new Set())

  // Fetch ALL images for the user via SWR
  const { data: imagesData, isLoading: loading, mutate: mutateImages } = useSWR<{ data: GalleryImage[] }>(
    '/api/v1/images'
  )

  const allImages = imagesData?.data ?? []

  const fetchImages = useCallback(async () => {
    await mutateImages()
  }, [mutateImages])

  const setAllImages = useCallback((update: ((prev: GalleryImage[]) => GalleryImage[]) | GalleryImage[]) => {
    if (typeof update === 'function') {
      mutateImages(prev => prev ? { ...prev, data: update(prev.data) } : prev, false)
    } else {
      mutateImages({ data: update }, false)
    }
  }, [mutateImages])

  const handleImageError = (imageId: string) => {
    setMissingImages(prev => new Set(prev).add(imageId))
    console.warn('Image failed to load', { imageId })
  }

  const isImageTagged = (image: GalleryImage) => {
    return image.tags?.some(tag =>
      tag.tagId === entityId && tag.tagType === 'CHARACTER'
    ) ?? false
  }

  const handleToggleTag = async (image: GalleryImage, entityName: string) => {
    // Find existing tag for this entity
    const existingTag = image.tags?.find(tag =>
      tag.tagId === entityId && tag.tagType === 'CHARACTER'
    )
    const isTagged = !!existingTag

    try {
      if (isTagged && existingTag) {
        // Remove the existing tag using action dispatch
        const res = await fetch(`/api/v1/images/${image.id}?action=remove-tag`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tagId: entityId }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || 'Failed to remove tag')
        }
        showSuccessToast(`Removed from ${entityName}`)
      } else {
        // Add new tag - always use CHARACTER for new tags
        const tagType = 'CHARACTER'
        const res = await fetch(`/api/v1/images/${image.id}?action=add-tag`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tagType, tagId: entityId }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || 'Failed to add tag')
        }
        showSuccessToast(`Tagged to ${entityName}`)
      }

      // Update local state
      await mutateImages(
        prev => prev ? {
          ...prev,
          data: prev.data.map(img => {
            if (img.id !== image.id) return img
            const currentTags = img.tags || []
            const newTag = { tagId: entityId, tagType: 'CHARACTER' }
            return {
              ...img,
              tags: isTagged
                ? currentTags.filter(t => t.tagId !== entityId || t.tagType !== 'CHARACTER')
                : [...currentTags, newTag]
            }
          })
        } : prev,
        false
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      showErrorToast(message || 'Failed to update tag')
      console.error('Error toggling tag:', { error: message, entityId, imageId: image.id })
    }
  }

  const handleSetAvatar = async (image: GalleryImage, currentAvatarId: string | undefined, onAvatarChange?: (imageId: string | null) => void) => {
    if (!onAvatarChange) return
    try {
      // All entities are now characters (personas migrated to characters with controlledBy: 'user')
      const endpoint = `/api/v1/characters/${entityId}?action=avatar`

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageId: image.id }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Failed to set avatar (${res.status})`)
      }

      onAvatarChange(image.id)
      showSuccessToast('Avatar updated!')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      showErrorToast(message || 'Failed to set avatar')
      console.error('Error setting avatar:', { error: message, entityId, imageId: image.id })
    }
  }

  const handleClearAvatar = async (currentAvatarId: string | undefined, onAvatarChange?: (imageId: string | null) => void) => {
    if (!currentAvatarId || !onAvatarChange) return

    try {
      // All entities are now characters (personas migrated to characters with controlledBy: 'user')
      const endpoint = `/api/v1/characters/${entityId}?action=avatar`

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageId: null }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Failed to clear avatar (${res.status})`)
      }

      onAvatarChange(null)
      showSuccessToast('Avatar cleared!')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      showErrorToast(message || 'Failed to clear avatar')
      console.error('Error clearing avatar:', { error: message, entityId })
    }
  }

  const handleDeleteImage = async (image: GalleryImage, currentAvatarId: string | undefined, onAvatarChange?: (imageId: string | null) => void) => {
    try {
      // If this is the current avatar (especially for missing images), clear it first
      const isCurrentAvatar = currentAvatarId === image.id
      if (isCurrentAvatar && onAvatarChange) {
        // All entities are now characters (personas migrated to characters with controlledBy: 'user')
        const endpoint = `/api/v1/characters/${entityId}?action=avatar`

        const clearRes = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageId: null }),
        })

        if (!clearRes.ok) {
          throw new Error('Failed to clear avatar before deletion')
        }
        onAvatarChange(null)
      }

      const res = await fetch(`/api/v1/images/${image.id}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to delete image')
      }

      // Remove from local state
      await mutateImages(
        prev => prev ? { ...prev, data: prev.data.filter(img => img.id !== image.id) } : prev,
        false
      )
      showSuccessToast('Image deleted')
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : 'Failed to delete image')
      console.error('Error deleting image:', { error: error instanceof Error ? error.message : String(error) })
    }
  }

  return {
    allImages,
    setAllImages,
    loading,
    missingImages,
    setMissingImages,
    fetchImages,
    handleImageError,
    isImageTagged,
    handleToggleTag,
    handleSetAvatar,
    handleClearAvatar,
    handleDeleteImage
  }
}
