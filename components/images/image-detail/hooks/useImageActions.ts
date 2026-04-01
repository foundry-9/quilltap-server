'use client'

import { useState, useCallback } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import type { ImageData, Character, EntityType } from '../types'

interface UseImageActionsReturn {
  taggedCharacterIds: Set<string>
  taggingInProgress: Set<string>
  settingAvatar: Set<string>
  toggleCharacterTag: (characterId: string) => Promise<void>
  setAsAvatar: (entityType: EntityType, entityId: string) => Promise<void>
  handleDownload: () => Promise<void>
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

  const updateTaggedCharacters = useCallback((charIds: Set<string>) => {
    setTaggedCharacterIds(charIds)
  }, [])

  const toggleCharacterTag = useCallback(
    async (characterId: string) => {
      const isTagged = taggedCharacterIds.has(characterId)
      const key = `char-${characterId}`

      try {
        setTaggingInProgress((prev) => new Set(prev).add(key))
        clientLogger.debug('Toggling character tag', { characterId, isTagged, imageId: image.id })

        if (isTagged) {
          // Remove tag - try both CHARACTER and PERSONA for backwards compatibility
          // First try CHARACTER (the new type)
          let response = await fetch(`/api/images/${image.id}/tags?tagType=CHARACTER&tagId=${characterId}`, {
            method: 'DELETE',
          })

          // If CHARACTER tag doesn't exist, try PERSONA (legacy)
          if (!response.ok) {
            response = await fetch(`/api/images/${image.id}/tags?tagType=PERSONA&tagId=${characterId}`, {
              method: 'DELETE',
            })
          }

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
          clientLogger.debug('Character tag removed successfully', { characterId })
        } else {
          // Add tag - always use CHARACTER for new tags
          const response = await fetch(`/api/images/${image.id}/tags`, {
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
          clientLogger.debug('Character tag added successfully', { characterId })
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to update tag'
        clientLogger.error('Character tag toggle failed', { characterId, error: errorMessage })
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
        clientLogger.debug('Setting avatar', { entityType, entityId, imageId: image.id })

        // All entities are now characters (personas migrated to characters with controlledBy: 'user')
        const endpoint = `/api/characters/${entityId}/avatar`

        const response = await fetch(endpoint, {
          method: 'PATCH',
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
        clientLogger.debug('Avatar set successfully', { entityType, entityId })
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to set avatar'
        clientLogger.error('Set avatar failed', { entityType, entityId, error: errorMessage })
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
      clientLogger.debug('Downloading image', { imageId: image.id, filename: image.filename })
      const filepath = image.url || image.filepath
      const src = filepath.startsWith('/') ? filepath : `/${filepath}`
      const response = await fetch(src)
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = image.filename
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
      clientLogger.debug('Image downloaded successfully', { imageId: image.id })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      clientLogger.error('Failed to download image', { imageId: image.id, error: errorMessage })
    }
  }, [image.id, image.filename, image.url, image.filepath])

  return {
    taggedCharacterIds,
    taggingInProgress,
    settingAvatar,
    toggleCharacterTag,
    setAsAvatar,
    handleDownload,
    updateTaggedCharacters,
    setCharacters: setInternalCharacters,
  }
}
