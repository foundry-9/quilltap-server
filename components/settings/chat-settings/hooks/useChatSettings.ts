'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAvatarDisplay } from '@/hooks/useAvatarDisplay'
import {
  ChatSettings,
  ConnectionProfile,
  EmbeddingProfile,
  ImageProfile,
  AvatarDisplayMode,
  AvatarDisplayStyle,
  CheapLLMSettings,
  MemoryCascadePreferences,
  TokenDisplaySettings,
  ContextCompressionSettings,
  LLMLoggingSettings,
  StoryBackgroundsSettings,
  DEFAULT_MEMORY_CASCADE_PREFERENCES,
  DEFAULT_TOKEN_DISPLAY_SETTINGS,
  DEFAULT_CONTEXT_COMPRESSION_SETTINGS,
  DEFAULT_LLM_LOGGING_SETTINGS,
  DEFAULT_AUTO_DETECT_RNG,
  AgentModeSettings,
  DEFAULT_AGENT_MODE_SETTINGS,
  DEFAULT_STORY_BACKGROUNDS_SETTINGS,
  DangerousContentSettings,
  DEFAULT_DANGEROUS_CONTENT_SETTINGS,
} from '../types'

interface UseChatSettingsReturn {
  settings: ChatSettings | null
  loading: boolean
  error: string | null
  saving: boolean
  success: boolean
  connectionProfiles: ConnectionProfile[]
  embeddingProfiles: EmbeddingProfile[]
  imageProfiles: ImageProfile[]
  loadingProfiles: boolean
  fetchSettings: () => Promise<void>
  handleAvatarModeChange: (mode: AvatarDisplayMode) => Promise<void>
  handleAvatarStyleChange: (style: AvatarDisplayStyle) => Promise<void>
  handleCheapLLMUpdate: (updates: Partial<CheapLLMSettings>) => Promise<void>
  handleImageDescriptionProfileChange: (profileId: string | null) => Promise<void>
  handleMemoryCascadeUpdate: (updates: Partial<MemoryCascadePreferences>) => Promise<void>
  handleTokenDisplayChange: (key: keyof TokenDisplaySettings, value: boolean) => Promise<void>
  handleContextCompressionUpdate: (updates: Partial<ContextCompressionSettings>) => Promise<void>
  handleLLMLoggingChange: (key: keyof LLMLoggingSettings, value: boolean | number) => Promise<void>
  handleAutoDetectRngChange: (value: boolean) => Promise<void>
  handleAgentModeDefaultEnabledChange: (value: boolean) => Promise<void>
  handleAgentModeMaxTurnsChange: (value: number) => Promise<void>
  handleStoryBackgroundsEnabledChange: (value: boolean) => Promise<void>
  handleStoryBackgroundsProfileChange: (profileId: string | null) => Promise<void>
  handleDangerousContentUpdate: (updates: Partial<DangerousContentSettings>) => Promise<void>
}

export function useChatSettings(): UseChatSettingsReturn {
  const [settings, setSettings] = useState<ChatSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [connectionProfiles, setConnectionProfiles] = useState<ConnectionProfile[]>([])
  const [embeddingProfiles, setEmbeddingProfiles] = useState<EmbeddingProfile[]>([])
  const [imageProfiles, setImageProfiles] = useState<ImageProfile[]>([])
  const [loadingProfiles, setLoadingProfiles] = useState(false)

  // Ref to track the latest settings for use in concurrent updates
  // This prevents race conditions when multiple updates happen quickly
  const settingsRef = useRef<ChatSettings | null>(null)

  // Keep the ref in sync with state
  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  // Get the avatar display context updater to sync style changes globally
  const { syncAvatarDisplayStyle } = useAvatarDisplay()

  /**
   * Fetch chat settings from the API
   */
  const fetchSettings = useCallback(async () => {
    setLoading(true)
    setError(null)

    const maxAttempts = 3
    let lastError: string | null = null

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const res = await fetch('/api/v1/settings/chat')
        if (!res.ok) throw new Error('Failed to fetch chat settings')
        const data = await res.json()
        setSettings(data)
        lastError = null
        break
      } catch (err) {
        lastError = err instanceof Error ? err.message : 'An error occurred'
        if (attempt < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 500 * attempt))
          continue
        }
      }
    }

    if (lastError) {
      console.error('Error fetching chat settings', { error: lastError })
      setError(lastError)
    }

    setLoading(false)
  }, [])

  /**
   * Fetch connection profiles from the API
   */
  const fetchConnectionProfiles = useCallback(async () => {
    try {
      setLoadingProfiles(true)
      const res = await fetch('/api/v1/connection-profiles')
      if (!res.ok) throw new Error('Failed to fetch profiles')
      const data = await res.json()
      const profiles = data.profiles || []
      setConnectionProfiles(profiles)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      console.error('Error loading connection profiles', { error: errorMsg })
      // Set empty array on error to prevent map errors
      setConnectionProfiles([])
    } finally {
      setLoadingProfiles(false)
    }
  }, [])

  /**
   * Fetch embedding profiles from the API
   */
  const fetchEmbeddingProfiles = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/embedding-profiles')
      if (!res.ok) throw new Error('Failed to fetch embedding profiles')
      const data = await res.json()
      const profiles = data.profiles || []
      setEmbeddingProfiles(profiles)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      console.error('Error loading embedding profiles', { error: errorMsg })
      // Set empty array on error to prevent map errors
      setEmbeddingProfiles([])
    }
  }, [])

  /**
   * Fetch image profiles from the API
   */
  const fetchImageProfiles = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/image-profiles')
      if (!res.ok) throw new Error('Failed to fetch image profiles')
      const data = await res.json()
      const profiles = data.profiles || []
      setImageProfiles(profiles)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      console.error('Error loading image profiles', { error: errorMsg })
      // Set empty array on error to prevent map errors
      setImageProfiles([])
    }
  }, [])

  /**
   * Initial load of all settings and profiles
   */
  useEffect(() => {
    fetchSettings()
    fetchConnectionProfiles()
    fetchEmbeddingProfiles()
    fetchImageProfiles()
  }, [fetchSettings, fetchConnectionProfiles, fetchEmbeddingProfiles, fetchImageProfiles])

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
        setSaving(true)
        setError(null)
        setSuccess(false)

        const res = await fetch('/api/v1/settings/chat', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ avatarDisplayMode: mode }),
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Failed to update chat settings')
        }

        const updatedSettings = await res.json()
        setSettings(updatedSettings)
        showSuccess()
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'An error occurred'
        console.error('Failed to update avatar display mode', { error: errorMsg })
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
        setSaving(true)
        setError(null)
        setSuccess(false)

        const res = await fetch('/api/v1/settings/chat', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ avatarDisplayStyle: style }),
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Failed to update chat settings')
        }

        const updatedSettings = await res.json()
        setSettings(updatedSettings)

        // Sync the style to the global AvatarDisplayProvider context
        // This ensures all Avatar components re-render with the new style
        syncAvatarDisplayStyle(style)

        showSuccess()
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'An error occurred'
        console.error('Failed to update avatar display style', { error: errorMsg })
        setError(errorMsg)
      } finally {
        setSaving(false)
      }
    },
    [settings, showSuccess, syncAvatarDisplayStyle]
  )

  /**
   * Update cheap LLM settings
   */
  const handleCheapLLMUpdate = useCallback(
    async (updates: Partial<CheapLLMSettings>) => {
      if (!settings) return

      try {
        setSaving(true)
        setError(null)
        setSuccess(false)

        const res = await fetch('/api/v1/settings/chat', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cheapLLMSettings: { ...settings.cheapLLMSettings, ...updates } }),
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Failed to update cheap LLM settings')
        }

        const updatedSettings = await res.json()
        setSettings(updatedSettings)
        showSuccess()
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'An error occurred'
        console.error('Failed to update cheap LLM settings', { error: errorMsg })
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
        setSaving(true)
        setError(null)

        const res = await fetch('/api/v1/settings/chat', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageDescriptionProfileId: profileId }),
        })

        if (!res.ok) throw new Error('Failed to update settings')

        await fetchSettings()
        showSuccess()
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Failed to save'
        console.error('Failed to update image description profile', { error: errorMsg })
        setError(errorMsg)
      } finally {
        setSaving(false)
      }
    },
    [fetchSettings, showSuccess]
  )

  /**
   * Update memory cascade preferences
   */
  const handleMemoryCascadeUpdate = useCallback(
    async (updates: Partial<MemoryCascadePreferences>) => {
      if (!settings) return

      try {
        setSaving(true)
        setError(null)
        setSuccess(false)

        const currentPrefs = settings.memoryCascadePreferences || DEFAULT_MEMORY_CASCADE_PREFERENCES
        const res = await fetch('/api/v1/settings/chat', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            memoryCascadePreferences: { ...currentPrefs, ...updates },
          }),
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Failed to update memory cascade preferences')
        }

        const updatedSettings = await res.json()
        setSettings(updatedSettings)
        showSuccess()
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'An error occurred'
        console.error('Failed to update memory cascade preferences', { error: errorMsg })
        setError(errorMsg)
      } finally {
        setSaving(false)
      }
    },
    [settings, showSuccess]
  )

  /**
   * Update token display settings
   */
  const handleTokenDisplayChange = useCallback(
    async (key: keyof TokenDisplaySettings, value: boolean) => {
      if (!settings) return

      try {
        setSaving(true)
        setError(null)
        setSuccess(false)

        const currentSettings = settings.tokenDisplaySettings || DEFAULT_TOKEN_DISPLAY_SETTINGS
        const res = await fetch('/api/v1/settings/chat', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tokenDisplaySettings: { ...currentSettings, [key]: value },
          }),
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Failed to update token display settings')
        }

        const updatedSettings = await res.json()
        setSettings(updatedSettings)
        showSuccess()
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'An error occurred'
        console.error('Failed to update token display settings', { error: errorMsg })
        setError(errorMsg)
      } finally {
        setSaving(false)
      }
    },
    [settings, showSuccess]
  )

  /**
   * Update context compression settings
   */
  const handleContextCompressionUpdate = useCallback(
    async (updates: Partial<ContextCompressionSettings>) => {
      if (!settings) return

      try {
        setSaving(true)
        setError(null)
        setSuccess(false)

        const currentSettings = settings.contextCompressionSettings || DEFAULT_CONTEXT_COMPRESSION_SETTINGS
        const res = await fetch('/api/v1/settings/chat', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contextCompressionSettings: { ...currentSettings, ...updates },
          }),
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Failed to update context compression settings')
        }

        const updatedSettings = await res.json()
        setSettings(updatedSettings)
        showSuccess()
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'An error occurred'
        console.error('Failed to update context compression settings', { error: errorMsg })
        setError(errorMsg)
      } finally {
        setSaving(false)
      }
    },
    [settings, showSuccess]
  )

  /**
   * Update LLM logging settings
   */
  const handleLLMLoggingChange = useCallback(
    async (key: keyof LLMLoggingSettings, value: boolean | number) => {
      if (!settings) return

      try {
        setSaving(true)
        setError(null)
        setSuccess(false)

        const currentSettings = settings.llmLoggingSettings || DEFAULT_LLM_LOGGING_SETTINGS
        const res = await fetch('/api/v1/settings/chat', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            llmLoggingSettings: { ...currentSettings, [key]: value },
          }),
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Failed to update LLM logging settings')
        }

        const updatedSettings = await res.json()
        setSettings(updatedSettings)
        showSuccess()
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'An error occurred'
        console.error('Failed to update LLM logging settings', { error: errorMsg })
        setError(errorMsg)
      } finally {
        setSaving(false)
      }
    },
    [settings, showSuccess]
  )

  /**
   * Update auto-detect RNG setting
   */
  const handleAutoDetectRngChange = useCallback(
    async (value: boolean) => {
      if (!settings) return

      try {
        setSaving(true)
        setError(null)
        setSuccess(false)

        const res = await fetch('/api/v1/settings/chat', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ autoDetectRng: value }),
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Failed to update auto-detect RNG setting')
        }

        const updatedSettings = await res.json()
        setSettings(updatedSettings)
        showSuccess()
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'An error occurred'
        console.error('Failed to update auto-detect RNG setting', { error: errorMsg })
        setError(errorMsg)
      } finally {
        setSaving(false)
      }
    },
    [settings, showSuccess]
  )

  /**
   * Update agent mode default enabled setting
   */
  const handleAgentModeDefaultEnabledChange = useCallback(
    async (value: boolean) => {
      if (!settings) return

      try {
        setSaving(true)
        setError(null)
        setSuccess(false)

        const currentSettings = settings.agentModeSettings || DEFAULT_AGENT_MODE_SETTINGS
        const res = await fetch('/api/v1/settings/chat', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentModeSettings: { ...currentSettings, defaultEnabled: value },
          }),
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Failed to update agent mode settings')
        }

        const updatedSettings = await res.json()
        setSettings(updatedSettings)
        showSuccess()
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'An error occurred'
        console.error('Failed to update agent mode default enabled', { error: errorMsg })
        setError(errorMsg)
      } finally {
        setSaving(false)
      }
    },
    [settings, showSuccess]
  )

  /**
   * Update agent mode max turns setting
   */
  const handleAgentModeMaxTurnsChange = useCallback(
    async (value: number) => {
      if (!settings) return

      try {
        setSaving(true)
        setError(null)
        setSuccess(false)

        const currentSettings = settings.agentModeSettings || DEFAULT_AGENT_MODE_SETTINGS
        const res = await fetch('/api/v1/settings/chat', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentModeSettings: { ...currentSettings, maxTurns: value },
          }),
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Failed to update agent mode settings')
        }

        const updatedSettings = await res.json()
        setSettings(updatedSettings)
        showSuccess()
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'An error occurred'
        console.error('Failed to update agent mode max turns', { error: errorMsg })
        setError(errorMsg)
      } finally {
        setSaving(false)
      }
    },
    [settings, showSuccess]
  )

  /**
   * Update story backgrounds enabled setting
   * Uses settingsRef to prevent race conditions with concurrent updates
   */
  const handleStoryBackgroundsEnabledChange = useCallback(
    async (value: boolean) => {
      // Use ref for latest state to prevent race conditions
      const latestSettings = settingsRef.current
      if (!latestSettings) return

      try {
        setSaving(true)
        setError(null)
        setSuccess(false)

        const currentSettings = latestSettings.storyBackgroundsSettings || DEFAULT_STORY_BACKGROUNDS_SETTINGS
        const res = await fetch('/api/v1/settings/chat', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            storyBackgroundsSettings: { ...currentSettings, enabled: value },
          }),
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Failed to update story backgrounds settings')
        }

        const updatedSettings = await res.json()
        setSettings(updatedSettings)
        showSuccess()
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'An error occurred'
        console.error('Failed to update story backgrounds enabled', { error: errorMsg })
        setError(errorMsg)
      } finally {
        setSaving(false)
      }
    },
    [showSuccess]
  )

  /**
   * Update story backgrounds image profile
   * Uses settingsRef to prevent race conditions with concurrent updates
   */
  const handleStoryBackgroundsProfileChange = useCallback(
    async (profileId: string | null) => {
      // Use ref for latest state to prevent race conditions
      const latestSettings = settingsRef.current
      if (!latestSettings) return

      try {
        setSaving(true)
        setError(null)
        setSuccess(false)

        const currentSettings = latestSettings.storyBackgroundsSettings || DEFAULT_STORY_BACKGROUNDS_SETTINGS
        const res = await fetch('/api/v1/settings/chat', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            storyBackgroundsSettings: { ...currentSettings, defaultImageProfileId: profileId },
          }),
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Failed to update story backgrounds settings')
        }

        const updatedSettings = await res.json()
        setSettings(updatedSettings)
        showSuccess()
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'An error occurred'
        console.error('Failed to update story backgrounds profile', { error: errorMsg })
        setError(errorMsg)
      } finally {
        setSaving(false)
      }
    },
    [showSuccess]
  )

  /**
   * Update dangerous content settings
   * Uses settingsRef to prevent race conditions with concurrent updates
   */
  const handleDangerousContentUpdate = useCallback(
    async (updates: Partial<DangerousContentSettings>) => {
      // Use ref for latest state to prevent race conditions
      const latestSettings = settingsRef.current
      if (!latestSettings) return

      try {
        setSaving(true)
        setError(null)
        setSuccess(false)

        const currentSettings = latestSettings.dangerousContentSettings || DEFAULT_DANGEROUS_CONTENT_SETTINGS
        const res = await fetch('/api/v1/settings/chat', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dangerousContentSettings: { ...currentSettings, ...updates },
          }),
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Failed to update dangerous content settings')
        }

        const updatedSettings = await res.json()
        setSettings(updatedSettings)
        showSuccess()
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'An error occurred'
        console.error('Failed to update dangerous content settings', { error: errorMsg })
        setError(errorMsg)
      } finally {
        setSaving(false)
      }
    },
    [showSuccess]
  )

  return {
    settings,
    loading,
    error,
    saving,
    success,
    connectionProfiles,
    embeddingProfiles,
    imageProfiles,
    loadingProfiles,
    fetchSettings,
    handleAvatarModeChange,
    handleAvatarStyleChange,
    handleCheapLLMUpdate,
    handleImageDescriptionProfileChange,
    handleMemoryCascadeUpdate,
    handleTokenDisplayChange,
    handleContextCompressionUpdate,
    handleLLMLoggingChange,
    handleAutoDetectRngChange,
    handleAgentModeDefaultEnabledChange,
    handleAgentModeMaxTurnsChange,
    handleStoryBackgroundsEnabledChange,
    handleStoryBackgroundsProfileChange,
    handleDangerousContentUpdate,
  }
}
