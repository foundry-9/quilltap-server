'use client'

import { useState, useCallback } from 'react'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { triggerDownload } from '@/lib/download-utils'
import { copyImageToClipboard } from '@/lib/clipboard-utils'
import type { ImageData, Character, EntityType } from '../types'

interface UseImageActionsReturn {
  taggedCharacterIds: Set<string>
  taggingInProgress: Set<string>
  settingAvatar: Set<string>
  toggleCharacterTag: (characterId: string) => Promise<void>
  setAsAvatar: (entityType: EntityType, entityId: string) => Promise<void>
  handleDownload: () => Promise<void>
  handleCopyToClipboard: () => Promise<void>
  handleSaveToGallery: () => Promise<void>
  savingToGallery: boolean
  updateTaggedCharacters: (charIds: Set<string>) => void
  setCharacters: (characters: Character[]) => void
}

export function useImageActions(
  image: ImageData,
  characters: Character[],
  onAvatarSet?: () => void
): Omit<UseImageActionsReturn, 'setCharacters'> & {
  setCharacters: (fn: (prev: Character[]) => Character[]) => void
} {
  const [taggedCharacterIds, setTaggedCharacterIds] = useState<Set<string>>(new Set())
  const [taggingInProgress, setTaggingInProgress] = useState<Set<string>>(new Set())
  const [settingAvatar, setSettingAvatar] = useState<Set<string>>(new Set())
  const [internalCharacters, setInternalCharacters] = useState<Character[]>(characters)
  const [savingToGallery, setSavingToGallery] = useState(false)

  const updateTaggedCharacters = useCallback((charIds: Set<string>) => {
    setTaggedCharacterIds(charIds)
  }, [])

  const toggleCharacterTag = useCallback(
    async (characterId: string) => {
      const isTagged = taggedCharacterIds.has(characterId)
      const key = `char-${characterId}`

      try {
        setTaggingInProgress((prev) => new Set(prev).add(key))

        if (isTagged) {
          // Remove tag using v1 action dispatch API
          const response = await fetch(`/api/v1/images/${image.id}?action=remove-tag`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tagId: characterId }),
          })

          if (!response.ok) {
            const data = await response.json()
            throw new Error(data.error || 'Failed to remove tag')
          }

          setTaggedCharacterIds((prev) => {
            const newSet = new Set(prev)
            newSet.delete(characterId)
            return newSet
          })
          showSuccessToast('Removed from character gallery')
        } else {
          // Add tag using v1 action dispatch API
          const response = await fetch(`/api/v1/images/${image.id}?action=add-tag`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tagType: 'CHARACTER',
              tagId: characterId,
            }),
          })

          if (!response.ok) {
            const data = await response.json()
            throw new Error(data.error || 'Failed to add tag')
          }

          setTaggedCharacterIds((prev) => new Set(prev).add(characterId))
          showSuccessToast('Added to character gallery')
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to update tag'
        console.error('Character tag toggle failed', { characterId, error: errorMessage })
        showErrorToast(errorMessage)
      } finally {
        setTaggingInProgress((prev) => {
          const newSet = new Set(prev)
          newSet.delete(key)
          return newSet
        })
      }
    },
    [image.id, taggedCharacterIds]
  )

  const setAsAvatar = useCallback(
    async (entityType: EntityType, entityId: string) => {
      const key = `${entityType}-${entityId}-avatar`

      try {
        setSettingAvatar((prev) => new Set(prev).add(key))

        // All entities are now characters (personas migrated to characters with controlledBy: 'user')
        const endpoint = `/api/v1/characters/${entityId}?action=avatar`

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageId: image.id }),
        })

        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || 'Failed to set avatar')
        }

        // Update local state
        setInternalCharacters((prev) =>
          prev.map((char) =>
            char.id === entityId ? { ...char, defaultImageId: image.id } : char
          )
        )

        showSuccessToast('Set as avatar for character')
        onAvatarSet?.()
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to set avatar'
        console.error('Set avatar failed', { entityType, entityId, error: errorMessage })
        showErrorToast(errorMessage)
      } finally {
        setSettingAvatar((prev) => {
          const newSet = new Set(prev)
          newSet.delete(key)
          return newSet
        })
      }
    },
    [image.id, onAvatarSet]
  )

  const handleDownload = useCallback(async () => {
    try {
      const filepath = image.url || image.filepath
      const src = filepath.startsWith('/') ? filepath : `/${filepath}`
      const response = await fetch(src)
      const blob = await response.blob()
      await triggerDownload(blob, image.filename)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error('Failed to download image', { imageId: image.id, error: errorMessage })
    }
  }, [image.id, image.filename, image.url, image.filepath])

  const handleSaveToGallery = useCallback(async () => {
    setSavingToGallery(true)
    try {
      const response = await fetch('/api/v1/photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId: image.id }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to save to gallery')
      }
      showSuccessToast('Saved to your gallery')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save to gallery'
      console.error('Save to gallery failed', { imageId: image.id, error: message })
      showErrorToast(message)
    } finally {
      setSavingToGallery(false)
    }
  }, [image.id])

  const handleCopyToClipboard = useCallback(async () => {
    try {
      const filepath = image.url || image.filepath
      const src = filepath.startsWith('/') ? filepath : `/${filepath}`
      await copyImageToClipboard(src)
      showSuccessToast('Image copied to clipboard')
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error('Failed to copy image to clipboard', { imageId: image.id, error: errorMessage })
      showErrorToast('Failed to copy image to clipboard')
    }
  }, [image.id, image.url, image.filepath])

  return {
    taggedCharacterIds,
    taggingInProgress,
    settingAvatar,
    toggleCharacterTag,
    setAsAvatar,
    handleDownload,
    handleCopyToClipboard,
    handleSaveToGallery,
    savingToGallery,
    updateTaggedCharacters,
    setCharacters: setInternalCharacters,
  }
}
