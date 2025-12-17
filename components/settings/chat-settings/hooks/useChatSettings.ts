'use client'

import { useState, useEffect, useCallback } from 'react'
import { clientLogger } from '@/lib/client-logger'
import {
  ChatSettings,
  ConnectionProfile,
  EmbeddingProfile,
  AvatarDisplayMode,
  AvatarDisplayStyle,
  CheapLLMSettings,
} from '../types'

interface UseChatSettingsReturn {
  settings: ChatSettings | null
  loading: boolean
  error: string | null
  saving: boolean
  success: boolean
  connectionProfiles: ConnectionProfile[]
  embeddingProfiles: EmbeddingProfile[]
  loadingProfiles: boolean
  fetchSettings: () => Promise<void>
  handleAvatarModeChange: (mode: AvatarDisplayMode) => Promise<void>
  handleAvatarStyleChange: (style: AvatarDisplayStyle) => Promise<void>
  handleCheapLLMUpdate: (updates: Partial<CheapLLMSettings>) => Promise<void>
  handleImageDescriptionProfileChange: (profileId: string | null) => Promise<void>
}

export function useChatSettings(): UseChatSettingsReturn {
  const [settings, setSettings] = useState<ChatSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [connectionProfiles, setConnectionProfiles] = useState<ConnectionProfile[]>([])
  const [embeddingProfiles, setEmbeddingProfiles] = useState<EmbeddingProfile[]>([])
  const [loadingProfiles, setLoadingProfiles] = useState(false)

  /**
   * Fetch chat settings from the API
   */
  const fetchSettings = useCallback(async () => {
    try {
      clientLogger.debug('Fetching chat settings')
      setLoading(true)
      setError(null)
      const res = await fetch('/api/chat-settings')
      if (!res.ok) throw new Error('Failed to fetch chat settings')
      const data = await res.json()
      clientLogger.debug('Chat settings loaded', { settingsId: data.id })
      setSettings(data)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'An error occurred'
      clientLogger.error('Error fetching chat settings', { error: errorMsg })
      setError(errorMsg)
    } finally {
      setLoading(false)
    }
  }, [])

  /**
   * Fetch connection profiles from the API
   */
  const fetchConnectionProfiles = useCallback(async () => {
    try {
      clientLogger.debug('Fetching connection profiles')
      setLoadingProfiles(true)
      const res = await fetch('/api/profiles')
      if (!res.ok) throw new Error('Failed to fetch profiles')
      const data = await res.json()
      clientLogger.debug('Connection profiles loaded', { count: data.length })
      setConnectionProfiles(data)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      clientLogger.error('Error loading connection profiles', { error: errorMsg })
    } finally {
      setLoadingProfiles(false)
    }
  }, [])

  /**
   * Fetch embedding profiles from the API
   */
  const fetchEmbeddingProfiles = useCallback(async () => {
    try {
      clientLogger.debug('Fetching embedding profiles')
      const res = await fetch('/api/embedding-profiles')
      if (!res.ok) throw new Error('Failed to fetch embedding profiles')
      const data = await res.json()
      clientLogger.debug('Embedding profiles loaded', { count: data.length })
      setEmbeddingProfiles(data)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      clientLogger.error('Error loading embedding profiles', { error: errorMsg })
    }
  }, [])

  /**
   * Initial load of all settings and profiles
   */
  useEffect(() => {
    fetchSettings()
    fetchConnectionProfiles()
    fetchEmbeddingProfiles()
  }, [fetchSettings, fetchConnectionProfiles, fetchEmbeddingProfiles])

  /**
   * Helper function to show success message
   */
  const showSuccess = useCallback(() => {
    setSuccess(true)
    const timer = setTimeout(() => setSuccess(false), 2000)
    return () => clearTimeout(timer)
  }, [])

  /**
   * Update avatar display mode
   */
  const handleAvatarModeChange = useCallback(
    async (mode: AvatarDisplayMode) => {
      if (!settings) return

      try {
        clientLogger.debug('Updating avatar display mode', { mode })
        setSaving(true)
        setError(null)
        setSuccess(false)

        const res = await fetch('/api/chat-settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ avatarDisplayMode: mode }),
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Failed to update chat settings')
        }

        const updatedSettings = await res.json()
        clientLogger.info('Avatar display mode updated successfully', { mode })
        setSettings(updatedSettings)
        showSuccess()
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'An error occurred'
        clientLogger.error('Failed to update avatar display mode', { error: errorMsg })
        setError(errorMsg)
      } finally {
        setSaving(false)
      }
    },
    [settings, showSuccess]
  )

  /**
   * Update avatar display style
   */
  const handleAvatarStyleChange = useCallback(
    async (style: AvatarDisplayStyle) => {
      if (!settings) return

      try {
        clientLogger.debug('Updating avatar display style', { style })
        setSaving(true)
        setError(null)
        setSuccess(false)

        const res = await fetch('/api/chat-settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ avatarDisplayStyle: style }),
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Failed to update chat settings')
        }

        const updatedSettings = await res.json()
        clientLogger.info('Avatar display style updated successfully', { style })
        setSettings(updatedSettings)
        showSuccess()
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'An error occurred'
        clientLogger.error('Failed to update avatar display style', { error: errorMsg })
        setError(errorMsg)
      } finally {
        setSaving(false)
      }
    },
    [settings, showSuccess]
  )

  /**
   * Update cheap LLM settings
   */
  const handleCheapLLMUpdate = useCallback(
    async (updates: Partial<CheapLLMSettings>) => {
      if (!settings) return

      try {
        clientLogger.debug('Updating cheap LLM settings', { updates })
        setSaving(true)
        setError(null)
        setSuccess(false)

        const res = await fetch('/api/chat-settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cheapLLMSettings: { ...settings.cheapLLMSettings, ...updates } }),
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Failed to update cheap LLM settings')
        }

        const updatedSettings = await res.json()
        clientLogger.info('Cheap LLM settings updated successfully', { updates })
        setSettings(updatedSettings)
        showSuccess()
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'An error occurred'
        clientLogger.error('Failed to update cheap LLM settings', { error: errorMsg })
        setError(errorMsg)
      } finally {
        setSaving(false)
      }
    },
    [settings, showSuccess]
  )

  /**
   * Update image description profile
   */
  const handleImageDescriptionProfileChange = useCallback(
    async (profileId: string | null) => {
      try {
        clientLogger.debug('Updating image description profile', { profileId })
        setSaving(true)
        setError(null)

        const res = await fetch('/api/chat-settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageDescriptionProfileId: profileId }),
        })

        if (!res.ok) throw new Error('Failed to update settings')

        clientLogger.info('Image description profile updated successfully', { profileId })
        await fetchSettings()
        showSuccess()
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Failed to save'
        clientLogger.error('Failed to update image description profile', { error: errorMsg })
        setError(errorMsg)
      } finally {
        setSaving(false)
      }
    },
    [fetchSettings, showSuccess]
  )

  return {
    settings,
    loading,
    error,
    saving,
    success,
    connectionProfiles,
    embeddingProfiles,
    loadingProfiles,
    fetchSettings,
    handleAvatarModeChange,
    handleAvatarStyleChange,
    handleCheapLLMUpdate,
    handleImageDescriptionProfileChange,
  }
}
