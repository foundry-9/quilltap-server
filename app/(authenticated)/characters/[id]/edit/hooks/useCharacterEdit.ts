'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { clientLogger } from '@/lib/client-logger'
import { showAlert } from '@/lib/alert'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import {
  Character,
  CharacterFormData,
  CharacterEditState,
} from '../types'

const INITIAL_FORM_DATA: CharacterFormData = {
  name: '',
  title: '',
  description: '',
  personality: '',
  scenario: '',
  firstMessage: '',
  exampleDialogues: '',
  systemPrompt: '',
  avatarUrl: '',
  defaultConnectionProfileId: '',
}

/**
 * Hook for managing character edit state and operations
 * Handles fetching, form management, and API interactions
 */
export function useCharacterEdit(id: string) {
  const router = useRouter()

  // State management
  const [state, setState] = useState<CharacterEditState>({
    loading: true,
    saving: false,
    error: null,
    showUploadDialog: false,
    showAvatarSelector: false,
    character: null,
    formData: INITIAL_FORM_DATA,
    originalFormData: INITIAL_FORM_DATA,
    avatarRefreshKey: 0,
  })

  /**
   * Fetch character data from API
   */
  const fetchCharacter = useCallback(async () => {
    try {
      clientLogger.debug('Fetching character', { characterId: id })
      const res = await fetch(`/api/characters/${id}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache',
        },
      })
      if (!res.ok) throw new Error('Failed to fetch character')
      const data = await res.json()
      const char = data.character

      setState((prev) => {
        const hasImageChanged = prev.character?.defaultImageId !== char.defaultImageId
        const initialFormData: CharacterFormData = {
          name: char.name,
          title: char.title || '',
          description: char.description || '',
          personality: char.personality || '',
          scenario: char.scenario || '',
          firstMessage: char.firstMessage || '',
          exampleDialogues: char.exampleDialogues || '',
          systemPrompt: char.systemPrompt || '',
          avatarUrl: char.avatarUrl || '',
          defaultConnectionProfileId: char.defaultConnectionProfileId || '',
        }

        return {
          ...prev,
          character: char,
          avatarRefreshKey: hasImageChanged ? prev.avatarRefreshKey + 1 : prev.avatarRefreshKey,
          formData: initialFormData,
          originalFormData: initialFormData,
          loading: false,
        }
      })

      clientLogger.debug('Character fetched successfully', { characterId: id })
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'An error occurred'
      clientLogger.error('Failed to fetch character', { error: errorMsg })
      setState((prev) => ({
        ...prev,
        error: errorMsg,
        loading: false,
      }))
    }
  }, [id])

  /**
   * Initial data loading effect
   */
  useEffect(() => {
    clientLogger.debug('Initializing character edit page', { characterId: id })
    fetchCharacter()
  }, [id, fetchCharacter])

  /**
   * Check if form has unsaved changes
   */
  const hasChanges = JSON.stringify(state.formData) !== JSON.stringify(state.originalFormData)

  /**
   * Handle form field changes
   */
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setState((prev) => ({
      ...prev,
      formData: { ...prev.formData, [e.target.name]: e.target.value },
    }))
  }

  /**
   * Submit form and save character data
   */
  const handleSubmit = async (e: React.FormEvent): Promise<boolean> => {
    e.preventDefault()
    setState((prev) => ({ ...prev, saving: true, error: null }))

    try {
      clientLogger.debug('Saving character', { characterId: id })

      // Update character fields
      const res = await fetch(`/api/characters/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state.formData),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to update character')
      }

      clientLogger.info('Character fields updated', { characterId: id })

      await fetchCharacter()
      setState((prev) => ({ ...prev, saving: false }))
      showSuccessToast('Character saved successfully!')
      clientLogger.info('Character saved successfully', { characterId: id })
      router.push(`/characters/${id}/view`)
      return true
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'An error occurred'
      clientLogger.error('Failed to save character', { error: errorMsg })
      setState((prev) => ({
        ...prev,
        saving: false,
        error: errorMsg,
      }))
      showErrorToast(errorMsg)
      return false
    }
  }

  /**
   * Handle cancel/back navigation
   * Navigates to NPCs settings if character is an NPC, otherwise to character view
   */
  const handleCancel = async () => {
    if (hasChanges) {
      const result = await showAlert('You have unsaved changes. What would you like to do?', [
        'Save',
        'Discard',
        'Cancel',
      ])

      if (result === 'Save') {
        // Submit the form
        clientLogger.debug('User chose to save changes', { characterId: id })
        const submitEvent = new Event('submit', { bubbles: true, cancelable: true })
        document.querySelector('form')?.dispatchEvent(submitEvent)
        return
      } else if (result === 'Cancel' || result === undefined) {
        clientLogger.debug('User chose to cancel', { characterId: id })
        return
      }
      // If 'Discard', continue to navigation
      clientLogger.debug('User chose to discard changes', { characterId: id })
    }
    // Navigate to appropriate location based on character type
    if (state.character?.npc) {
      router.push('/settings?tab=npcs')
    } else {
      router.push(`/characters/${id}/view`)
    }
  }

  /**
   * Check if character is an NPC
   */
  const isNpc = state.character?.npc ?? false

  /**
   * Set character avatar
   */
  const setCharacterAvatar = async (imageId: string) => {
    try {
      if (!id) {
        throw new Error('Character ID is missing')
      }

      clientLogger.debug('Setting character avatar', { characterId: id, imageId })

      const res = await fetch(`/api/characters/${id}/avatar`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageId: imageId || null }),
      })

      const responseData = await res.json()

      if (!res.ok) {
        throw new Error(responseData.error || 'Failed to set avatar')
      }

      await fetchCharacter()
      setState((prev) => ({ ...prev, showAvatarSelector: false }))
      showSuccessToast('Avatar updated!')
      clientLogger.info('Avatar updated successfully', { characterId: id })
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to set avatar'
      clientLogger.error('Failed to set avatar', { error: errorMsg })
      showErrorToast(errorMsg)
    }
  }

  /**
   * Get avatar source URL with cache busting
   */
  const getAvatarSrc = (): string | null => {
    let src = null
    if (state.character?.defaultImage) {
      const filepath = state.character.defaultImage.filepath
      src = state.character.defaultImage.url || (filepath.startsWith('/') ? filepath : `/${filepath}`)
    } else {
      src = state.character?.avatarUrl || null
    }
    // Add cache-busting parameter based on defaultImageId to force reload when avatar changes
    if (src && state.character?.defaultImageId) {
      const separator = src.includes('?') ? '&' : '?'
      src = `${src}${separator}v=${state.character.defaultImageId}`
    }
    return src
  }

  /**
   * Update state for showing/hiding modals
   */
  const toggleUploadDialog = (show: boolean) => {
    setState((prev) => ({ ...prev, showUploadDialog: show }))
  }

  const toggleAvatarSelector = (show: boolean) => {
    setState((prev) => ({ ...prev, showAvatarSelector: show }))
  }

  /**
   * Clear avatar (set to null)
   */
  const clearAvatar = async () => {
    try {
      clientLogger.debug('Clearing character avatar', { characterId: id })
      const res = await fetch(`/api/characters/${id}/avatar`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageId: null }),
      })

      if (!res.ok) {
        throw new Error('Failed to clear avatar')
      }

      await fetchCharacter()
      showSuccessToast('Avatar cleared!')
      clientLogger.info('Avatar cleared successfully', { characterId: id })
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to clear avatar'
      clientLogger.error('Failed to clear avatar', { error: errorMsg })
      showErrorToast(errorMsg)
    }
  }

  return {
    // State
    ...state,

    // Computed
    isNpc,

    // Methods
    handleChange,
    handleSubmit,
    handleCancel,
    setCharacterAvatar,
    getAvatarSrc,
    toggleUploadDialog,
    toggleAvatarSelector,
    clearAvatar,
    fetchCharacter,
    hasChanges,
  }
}
