'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { showAlert } from '@/lib/alert'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import {
  Character,
  CharacterFormData,
  CharacterEditState,
  CharacterScenario,
} from '../types'

const INITIAL_FORM_DATA: CharacterFormData = {
  name: '',
  aliases: [],
  pronouns: null,
  title: '',
  description: '',
  personality: '',
  scenarios: [],
  firstMessage: '',
  exampleDialogues: '',
  systemPrompt: '',
  avatarUrl: '',
  defaultConnectionProfileId: '',
  readPropertiesFromDocumentStore: false,
}

/**
 * Fields that, when the Scriptorium overlay switch is on, are read from the
 * character's vault properties.json instead of the DB. The edit form must
 * strip these from PUT payloads so a save doesn't silently persist overlaid
 * (vault-derived) values back into the DB.
 */
const OVERLAY_MANAGED_FIELDS = ['aliases', 'pronouns', 'title', 'firstMessage'] as const satisfies readonly (keyof CharacterFormData)[]

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
      const res = await fetch(`/api/v1/characters/${id}`, {
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
          aliases: char.aliases || [],
          pronouns: char.pronouns || null,
          title: char.title || '',
          description: char.description || '',
          personality: char.personality || '',
          scenarios: char.scenarios || [],
          firstMessage: char.firstMessage || '',
          exampleDialogues: char.exampleDialogues || '',
          systemPrompt: char.systemPrompt || '',
          avatarUrl: char.avatarUrl || '',
          defaultConnectionProfileId: char.defaultConnectionProfileId || '',
          readPropertiesFromDocumentStore: char.readPropertiesFromDocumentStore === true,
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
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'An error occurred'
      console.error('Failed to fetch character', errorMsg)
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount + form initialization with loaded data
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
   * Handle aliases array changes
   */
  const handleAliasesChange = (aliases: string[]) => {
    setState((prev) => ({
      ...prev,
      formData: { ...prev.formData, aliases },
    }))
  }

  /**
   * Handle pronouns changes
   */
  const handlePronounsChange = (pronouns: { subject: string; object: string; possessive: string } | null) => {
    setState((prev) => ({
      ...prev,
      formData: { ...prev.formData, pronouns },
    }))
  }

  /**
   * Handle scenarios array changes
   */
  const handleScenariosChange = (scenarios: CharacterScenario[]) => {
    setState((prev) => ({
      ...prev,
      formData: { ...prev.formData, scenarios },
    }))
  }

  /**
   * Toggle the Scriptorium-overlay switch. Persists immediately so subsequent
   * reads reflect the choice even if the user navigates away without saving
   * other form edits.
   */
  const handleReadFromDocStoreToggle = async (enabled: boolean) => {
    setState((prev) => ({
      ...prev,
      formData: { ...prev.formData, readPropertiesFromDocumentStore: enabled },
    }))
    try {
      const res = await fetch(`/api/v1/characters/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ readPropertiesFromDocumentStore: enabled }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to update switch')
      }
      showSuccessToast(enabled
        ? 'Reading character properties from Scriptorium vault.'
        : 'Reading character properties from the database.')
      await fetchCharacter()
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to update switch'
      showErrorToast(errorMsg)
      // Revert local state on failure
      setState((prev) => ({
        ...prev,
        formData: { ...prev.formData, readPropertiesFromDocumentStore: !enabled },
      }))
    }
  }

  /**
   * Copy the character's vault properties.json values into the DB row.
   * Only meaningful when the overlay switch is on and a vault is linked.
   */
  const handleSyncPropertiesFromVault = async () => {
    try {
      const res = await fetch(`/api/v1/characters/${id}?action=sync-properties-from-vault`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || 'Failed to sync properties from vault')
      }
      showSuccessToast('Synced properties from the vault into the character record.')
      await fetchCharacter()
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to sync properties from vault'
      showErrorToast(errorMsg)
    }
  }

  /**
   * Submit form and save character data
   */
  const handleSubmit = async (e: React.FormEvent): Promise<boolean> => {
    e.preventDefault()
    setState((prev) => ({ ...prev, saving: true, error: null }))

    try {
      // When the Scriptorium overlay is on, strip the overlay-managed fields
      // from the PUT payload so the save doesn't silently persist overlaid
      // (vault-derived) values back into the DB.
      let payload: Partial<CharacterFormData> = { ...state.formData }
      if (state.formData.readPropertiesFromDocumentStore) {
        for (const field of OVERLAY_MANAGED_FIELDS) {
          delete payload[field]
        }
      }

      // Update character fields
      const res = await fetch(`/api/v1/characters/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to update character')
      }

      await fetchCharacter()
      setState((prev) => ({ ...prev, saving: false }))
      showSuccessToast('Character saved successfully!')

      router.push(`/aurora/${id}/view`)
      return true
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'An error occurred'
      console.error('Failed to save character', errorMsg)
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
        const submitEvent = new Event('submit', { bubbles: true, cancelable: true })
        document.querySelector('form')?.dispatchEvent(submitEvent)
        return
      } else if (result === 'Cancel' || result === undefined) {
        return
      }
      // If 'Discard', continue to navigation
    }
    // Navigate to appropriate location based on character type
    if (state.character?.npc) {
      router.push('/settings')
    } else {
      router.push(`/aurora/${id}/view`)
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

      const res = await fetch(`/api/v1/characters/${id}?action=avatar`, {
        method: 'POST',
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
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to set avatar'
      console.error('Failed to set avatar', errorMsg)
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
      const res = await fetch(`/api/v1/characters/${id}?action=avatar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageId: null }),
      })

      if (!res.ok) {
        throw new Error('Failed to clear avatar')
      }

      await fetchCharacter()
      showSuccessToast('Avatar cleared!')
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to clear avatar'
      console.error('Failed to clear avatar', errorMsg)
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
    handleAliasesChange,
    handlePronounsChange,
    handleScenariosChange,
    handleSubmit,
    handleCancel,
    handleReadFromDocStoreToggle,
    handleSyncPropertiesFromVault,
    setCharacterAvatar,
    getAvatarSrc,
    toggleUploadDialog,
    toggleAvatarSelector,
    clearAvatar,
    fetchCharacter,
    hasChanges,
  }
}
