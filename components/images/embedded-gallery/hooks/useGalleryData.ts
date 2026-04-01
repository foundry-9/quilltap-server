'use client'

import { useState, useEffect, useCallback } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import type { GalleryImage, EntityType } from '../types'

export function useGalleryData(entityId: string, entityType: EntityType) {
  const [allImages, setAllImages] = useState<GalleryImage[]>([])
  const [loading, setLoading] = useState(true)
  const [missingImages, setMissingImages] = useState<Set<string>>(new Set())

  const fetchImages = useCallback(async () => {
    setLoading(true)
    try {
      // Fetch ALL images for the user, not filtered by tag
      const res = await fetch('/api/images')
      if (!res.ok) throw new Error('Failed to fetch images')
      const json = await res.json()
      setAllImages(json.data || [])
      clientLogger.debug('Gallery images fetched successfully', { count: json.data?.length || 0 })
    } catch (error) {
      clientLogger.error('Error fetching images:', { error: error instanceof Error ? error.message : String(error) })
      setAllImages([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchImages()
  }, [fetchImages])

  const handleImageError = (imageId: string) => {
    setMissingImages(prev => new Set(prev).add(imageId))
    clientLogger.warn('Image failed to load', { imageId })
  }

  const isImageTagged = (image: GalleryImage) => {
    // Check for both CHARACTER and legacy PERSONA tags (for backwards compatibility after migration)
    // After migration, personas become characters with the same ID, so we check both tag types
    return image.tags?.some(tag =>
      tag.tagId === entityId && (tag.tagType === 'CHARACTER' || tag.tagType === 'PERSONA')
    ) ?? false
  }

  const handleToggleTag = async (image: GalleryImage, entityName: string) => {
    // Find existing tag for this entity (could be CHARACTER or legacy PERSONA)
    const existingTag = image.tags?.find(tag =>
      tag.tagId === entityId && (tag.tagType === 'CHARACTER' || tag.tagType === 'PERSONA')
    )
    const isTagged = !!existingTag

    try {
      clientLogger.debug('Toggle tag action started', { imageId: image.id, isTagged, entityType })

      if (isTagged && existingTag) {
        // Remove the existing tag (use its actual tagType for the API call)
        const res = await fetch(`/api/images/${image.id}/tags?tagType=${existingTag.tagType}&tagId=${entityId}`, {
          method: 'DELETE',
        })
        if (!res.ok) throw new Error('Failed to remove tag')
        showSuccessToast(`Removed from ${entityName}`)
        clientLogger.debug('Tag removed successfully', { imageId: image.id })
      } else {
        // Add new tag - always use CHARACTER for new tags
        const tagType = 'CHARACTER'
        const res = await fetch(`/api/images/${image.id}/tags`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tagType, tagId: entityId }),
        })
        if (!res.ok) throw new Error('Failed to add tag')
        showSuccessToast(`Tagged to ${entityName}`)
        clientLogger.debug('Tag added successfully', { imageId: image.id })
      }

      // Update local state
      setAllImages(prev => prev.map(img => {
        if (img.id !== image.id) return img
        const currentTags = img.tags || []
        const newTag = { tagId: entityId, tagType: 'CHARACTER' }
        return {
          ...img,
          tags: isTagged
            ? currentTags.filter(t => t.tagId !== entityId || (t.tagType !== 'CHARACTER' && t.tagType !== 'PERSONA'))
            : [...currentTags, newTag]
        }
      }))
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : 'Failed to update tag')
      clientLogger.error('Error toggling tag:', { error: error instanceof Error ? error.message : String(error) })
    }
  }

  const handleSetAvatar = async (image: GalleryImage, currentAvatarId: string | undefined, onAvatarChange?: (imageId: string | null) => void) => {
    if (!onAvatarChange) return
    try {
      clientLogger.debug('Setting avatar', { imageId: image.id, entityType })

      // All entities are now characters (personas migrated to characters with controlledBy: 'user')
      const endpoint = `/api/characters/${entityId}/avatar`

      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageId: image.id }),
      })

      if (!res.ok) throw new Error('Failed to set avatar')

      onAvatarChange(image.id)
      showSuccessToast('Avatar updated!')
      clientLogger.debug('Avatar set successfully', { imageId: image.id })
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : 'Failed to set avatar')
      clientLogger.error('Error setting avatar:', { error: error instanceof Error ? error.message : String(error) })
    }
  }

  const handleClearAvatar = async (currentAvatarId: string | undefined, onAvatarChange?: (imageId: string | null) => void) => {
    if (!currentAvatarId || !onAvatarChange) return

    try {
      clientLogger.debug('Clearing avatar', { entityType })

      // All entities are now characters (personas migrated to characters with controlledBy: 'user')
      const endpoint = `/api/characters/${entityId}/avatar`

      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageId: null }),
      })

      if (!res.ok) throw new Error('Failed to clear avatar')

      onAvatarChange(null)
      showSuccessToast('Avatar cleared!')
      clientLogger.debug('Avatar cleared successfully')
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : 'Failed to clear avatar')
      clientLogger.error('Error clearing avatar:', { error: error instanceof Error ? error.message : String(error) })
    }
  }

  const handleDeleteImage = async (image: GalleryImage, currentAvatarId: string | undefined, onAvatarChange?: (imageId: string | null) => void) => {
    try {
      clientLogger.debug('Deleting image', { imageId: image.id })

      // If this is the current avatar (especially for missing images), clear it first
      const isCurrentAvatar = currentAvatarId === image.id
      if (isCurrentAvatar && onAvatarChange) {
        // All entities are now characters (personas migrated to characters with controlledBy: 'user')
        const endpoint = `/api/characters/${entityId}/avatar`

        const clearRes = await fetch(endpoint, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageId: null }),
        })

        if (!clearRes.ok) {
          throw new Error('Failed to clear avatar before deletion')
        }
        onAvatarChange(null)
        clientLogger.debug('Avatar cleared before deletion')
      }

      const res = await fetch(`/api/images/${image.id}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to delete image')
      }

      // Remove from local state
      setAllImages(prev => prev.filter(img => img.id !== image.id))
      showSuccessToast('Image deleted')
      clientLogger.debug('Image deleted successfully', { imageId: image.id })
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : 'Failed to delete image')
      clientLogger.error('Error deleting image:', { error: error instanceof Error ? error.message : String(error) })
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
