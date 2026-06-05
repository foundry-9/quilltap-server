'use client'

import { useState, useCallback } from 'react'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { triggerDownload } from '@/lib/download-utils'
import { copyImageToClipboard } from '@/lib/clipboard-utils'
import type { ImageData, Character, EntityType, CharacterGalleryLink } from '../types'

interface UseImageActionsReturn {
  characterGalleryLinks: CharacterGalleryLink[]
  savingToGalleryFor: Set<string>
  settingAvatar: Set<string>
  addToCharacterGallery: (characterId: string) => Promise<void>
  removeFromCharacterGallery: (characterId: string) => Promise<void>
  setAsAvatar: (entityType: EntityType, entityId: string) => Promise<void>
  handleDownload: () => Promise<void>
  handleCopyToClipboard: () => Promise<void>
  handleSaveToGallery: () => Promise<void>
  savingToGallery: boolean
  updateCharacterGalleryLinks: (links: CharacterGalleryLink[]) => void
  setCharacters: (characters: Character[]) => void
}

export function useImageActions(
  image: ImageData,
  characters: Character[],
  onAvatarSet?: () => void
): Omit<UseImageActionsReturn, 'setCharacters'> & {
  setCharacters: (fn: (prev: Character[]) => Character[]) => void
} {
  const [characterGalleryLinks, setCharacterGalleryLinks] = useState<CharacterGalleryLink[]>([])
  const [savingToGalleryFor, setSavingToGalleryFor] = useState<Set<string>>(new Set())
  const [settingAvatar, setSettingAvatar] = useState<Set<string>>(new Set())
  const [internalCharacters, setInternalCharacters] = useState<Character[]>(characters)
  const [savingToGallery, setSavingToGallery] = useState(false)

  const updateCharacterGalleryLinks = useCallback((links: CharacterGalleryLink[]) => {
    setCharacterGalleryLinks(links)
  }, [])

  const addToCharacterGallery = useCallback(
    async (characterId: string) => {
      try {
        setSavingToGalleryFor((prev) => new Set(prev).add(characterId))

        const payload = image.linkId
          ? { linkId: image.linkId }
          : { fileId: image.id }
        const response = await fetch(`/api/v1/characters/${characterId}/photos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })

        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          throw new Error(data.error || 'Failed to save to photo album')
        }

        const data = await response.json()
        const character = internalCharacters.find((c) => c.id === characterId)

        setCharacterGalleryLinks((prev) => [
          ...prev,
          {
            characterId,
            characterName: character?.name ?? 'Character',
            linkId: data.linkId,
          },
        ])
        showSuccessToast(`Saved to ${character?.name ?? 'character'}'s photo album`)
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to save to photo album'
        console.error('Save to character gallery failed', { characterId, error: errorMessage })
        showErrorToast(errorMessage)
      } finally {
        setSavingToGalleryFor((prev) => {
          const newSet = new Set(prev)
          newSet.delete(characterId)
          return newSet
        })
      }
    },
    [image.id, image.linkId, internalCharacters]
  )

  const removeFromCharacterGallery = useCallback(
    async (characterId: string) => {
      const link = characterGalleryLinks.find((l) => l.characterId === characterId)
      if (!link) return

      try {
        setSavingToGalleryFor((prev) => new Set(prev).add(characterId))

        const response = await fetch(
          `/api/v1/characters/${characterId}/photos/${link.linkId}`,
          { method: 'DELETE' }
        )

        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          throw new Error(data.error || 'Failed to remove from photo album')
        }

        setCharacterGalleryLinks((prev) => prev.filter((l) => l.characterId !== characterId))
        showSuccessToast(`Removed from ${link.characterName}'s photo album`)
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to remove from photo album'
        console.error('Remove from character gallery failed', { characterId, error: errorMessage })
        showErrorToast(errorMessage)
      } finally {
        setSavingToGalleryFor((prev) => {
          const newSet = new Set(prev)
          newSet.delete(characterId)
          return newSet
        })
      }
    },
    [characterGalleryLinks]
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
    characterGalleryLinks,
    savingToGalleryFor,
    settingAvatar,
    addToCharacterGallery,
    removeFromCharacterGallery,
    setAsAvatar,
    handleDownload,
    handleCopyToClipboard,
    handleSaveToGallery,
    savingToGallery,
    updateCharacterGalleryLinks,
    setCharacters: setInternalCharacters,
  }
}
