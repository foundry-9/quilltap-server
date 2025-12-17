'use client'

import { useState, useCallback } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import type { ImageData, Character, Persona, EntityType } from '../types'

interface UseImageActionsReturn {
  taggedCharacterIds: Set<string>
  taggedPersonaIds: Set<string>
  taggingInProgress: Set<string>
  settingAvatar: Set<string>
  toggleCharacterTag: (characterId: string) => Promise<void>
  togglePersonaTag: (personaId: string) => Promise<void>
  setAsAvatar: (entityType: EntityType, entityId: string) => Promise<void>
  handleDownload: () => Promise<void>
  updateTaggedCharacters: (charIds: Set<string>) => void
  updateTaggedPersonas: (personaIds: Set<string>) => void
  setCharacters: (characters: Character[]) => void
  setPersonas: (personas: Persona[]) => void
}

export function useImageActions(
  image: ImageData,
  characters: Character[],
  personas: Persona[],
  onAvatarSet?: () => void
): Omit<UseImageActionsReturn, 'setCharacters' | 'setPersonas'> & {
  setCharacters: (fn: (prev: Character[]) => Character[]) => void
  setPersonas: (fn: (prev: Persona[]) => Persona[]) => void
} {
  const [taggedCharacterIds, setTaggedCharacterIds] = useState<Set<string>>(new Set())
  const [taggedPersonaIds, setTaggedPersonaIds] = useState<Set<string>>(new Set())
  const [taggingInProgress, setTaggingInProgress] = useState<Set<string>>(new Set())
  const [settingAvatar, setSettingAvatar] = useState<Set<string>>(new Set())
  const [internalCharacters, setInternalCharacters] = useState<Character[]>(characters)
  const [internalPersonas, setInternalPersonas] = useState<Persona[]>(personas)

  const updateTaggedCharacters = useCallback((charIds: Set<string>) => {
    setTaggedCharacterIds(charIds)
  }, [])

  const updateTaggedPersonas = useCallback((personaIds: Set<string>) => {
    setTaggedPersonaIds(personaIds)
  }, [])

  const toggleCharacterTag = useCallback(
    async (characterId: string) => {
      const isTagged = taggedCharacterIds.has(characterId)
      const key = `char-${characterId}`

      try {
        setTaggingInProgress((prev) => new Set(prev).add(key))
        clientLogger.debug('Toggling character tag', { characterId, isTagged, imageId: image.id })

        if (isTagged) {
          // Remove tag
          const params = new URLSearchParams({
            tagType: 'CHARACTER',
            tagId: characterId,
          })
          const response = await fetch(`/api/images/${image.id}/tags?${params.toString()}`, {
            method: 'DELETE',
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
          clientLogger.debug('Character tag removed successfully', { characterId })
        } else {
          // Add tag
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

  const togglePersonaTag = useCallback(
    async (personaId: string) => {
      const isTagged = taggedPersonaIds.has(personaId)
      const key = `persona-${personaId}`

      try {
        setTaggingInProgress((prev) => new Set(prev).add(key))
        clientLogger.debug('Toggling persona tag', { personaId, isTagged, imageId: image.id })

        if (isTagged) {
          // Remove tag
          const params = new URLSearchParams({
            tagType: 'PERSONA',
            tagId: personaId,
          })
          const response = await fetch(`/api/images/${image.id}/tags?${params.toString()}`, {
            method: 'DELETE',
          })

          if (!response.ok) {
            const data = await response.json()
            throw new Error(data.error || 'Failed to remove tag')
          }

          setTaggedPersonaIds((prev) => {
            const newSet = new Set(prev)
            newSet.delete(personaId)
            return newSet
          })
          showSuccessToast('Removed from persona gallery')
          clientLogger.debug('Persona tag removed successfully', { personaId })
        } else {
          // Add tag
          const response = await fetch(`/api/images/${image.id}/tags`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tagType: 'PERSONA',
              tagId: personaId,
            }),
          })

          if (!response.ok) {
            const data = await response.json()
            throw new Error(data.error || 'Failed to add tag')
          }

          setTaggedPersonaIds((prev) => new Set(prev).add(personaId))
          showSuccessToast('Added to persona gallery')
          clientLogger.debug('Persona tag added successfully', { personaId })
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to update tag'
        clientLogger.error('Persona tag toggle failed', { personaId, error: errorMessage })
        showErrorToast(errorMessage)
      } finally {
        setTaggingInProgress((prev) => {
          const newSet = new Set(prev)
          newSet.delete(key)
          return newSet
        })
      }
    },
    [image.id, taggedPersonaIds]
  )

  const setAsAvatar = useCallback(
    async (entityType: EntityType, entityId: string) => {
      const key = `${entityType}-${entityId}-avatar`

      try {
        setSettingAvatar((prev) => new Set(prev).add(key))
        clientLogger.debug('Setting avatar', { entityType, entityId, imageId: image.id })

        const endpoint =
          entityType === 'character'
            ? `/api/characters/${entityId}/avatar`
            : `/api/personas/${entityId}/avatar`

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
        if (entityType === 'character') {
          setInternalCharacters((prev) =>
            prev.map((char) =>
              char.id === entityId ? { ...char, defaultImageId: image.id } : char
            )
          )
        } else {
          setInternalPersonas((prev) =>
            prev.map((persona) =>
              persona.id === entityId ? { ...persona, defaultImageId: image.id } : persona
            )
          )
        }

        showSuccessToast(`Set as avatar for ${entityType}`)
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
    taggedPersonaIds,
    taggingInProgress,
    settingAvatar,
    toggleCharacterTag,
    togglePersonaTag,
    setAsAvatar,
    handleDownload,
    updateTaggedCharacters,
    updateTaggedPersonas,
    setCharacters: setInternalCharacters,
    setPersonas: setInternalPersonas,
  }
}
