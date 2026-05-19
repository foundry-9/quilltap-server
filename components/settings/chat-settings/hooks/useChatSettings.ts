'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import useSWR from 'swr'
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
  handleUncensoredImageDescriptionProfileChange: (profileId: string | null) => Promise<void>
  handleMemoryCascadeUpdate: (updates: Partial<MemoryCascadePreferences>) => Promise<void>
  handleTokenDisplayChange: (key: keyof TokenDisplaySettings, value: boolean) => Promise<void>
  handleContextCompressionUpdate: (updates: Partial<ContextCompressionSettings>) => Promise<void>
  handleLLMLoggingChange: (key: keyof LLMLoggingSettings, value: boolean | number) => Promise<void>
  handleAutoDetectRngChange: (value: boolean) => Promise<void>
  handleCompositionModeDefaultChange: (value: boolean) => Promise<void>
  handleAgentModeDefaultEnabledChange: (value: boolean) => Promise<void>
  handleAgentModeMaxTurnsChange: (value: number) => Promise<void>
  handleStoryBackgroundsEnabledChange: (value: boolean) => Promise<void>
  handleStoryBackgroundsProfileChange: (profileId: string | null) => Promise<void>
  handleDangerousContentUpdate: (updates: Partial<DangerousContentSettings>) => Promise<void>
  handleTimezoneChange: (timezone: string | null) => Promise<void>
}

export function useChatSettings(): UseChatSettingsReturn {
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)

  // Ref to track the latest settings for use in concurrent updates
  // This prevents race conditions when multiple updates happen quickly
  const settingsRef = useRef<ChatSettings | null>(null)

  // Get the avatar display context updater to sync style changes globally
  const { syncAvatarDisplayStyle } = useAvatarDisplay()

  // Fetch all data via SWR
  const { data: settingsData, isLoading, error: loadError, mutate: mutateSettings } = useSWR<ChatSettings>(
    '/api/v1/settings/chat'
  )
  const { data: connProfileData } = useSWR<{ profiles: ConnectionProfile[] }>(
    '/api/v1/connection-profiles'
  )
  const { data: embeddingProfileData } = useSWR<{ profiles: EmbeddingProfile[] }>(
    '/api/v1/embedding-profiles'
  )
  const { data: imageProfileData } = useSWR<{ profiles: ImageProfile[] }>(
    '/api/v1/image-profiles'
  )

  const settings = settingsData ?? null
  const connectionProfiles = connProfileData?.profiles ?? []
  const embeddingProfiles = embeddingProfileData?.profiles ?? []
  const imageProfiles = imageProfileData?.profiles ?? []
  const loadingProfiles = !connProfileData || !embeddingProfileData || !imageProfileData
  const loading = isLoading
  const error = loadError ? (loadError instanceof Error ? loadError.message : 'An error occurred') : null

  // Keep the ref in sync with state
  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  /**
   * Fetch helper (kept for backward compatibility with return interface)
   */
  const fetchSettings = useCallback(async () => {
    await mutateSettings()
  }, [mutateSettings])

  /**
   * Helper function to show success message
   */
  const showSuccess = useCallback(async () => {
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
        await mutateSettings(updatedSettings, false)
        await showSuccess()
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'An error occurred'
        console.error('Failed to update avatar display mode', { error: errorMsg })
      } finally {
        setSaving(false)
      }
    },
    [settings, mutateSettings, showSuccess]
  )

  /**
   * Update avatar display style
   */
  const handleAvatarStyleChange = useCallback(
    async (style: AvatarDisplayStyle) => {
      if (!settings) return

      try {
        setSaving(true)

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
        await mutateSettings(updatedSettings, false)

        // Sync the style to the global AvatarDisplayProvider context
        // This ensures all Avatar components re-render with the new style
        syncAvatarDisplayStyle(style)

        await showSuccess()
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'An error occurred'
        console.error('Failed to update avatar display style', { error: errorMsg })
      } finally {
        setSaving(false)
      }
    },
    [settings, mutateSettings, showSuccess, syncAvatarDisplayStyle]
  )

  /**
   * Update cheap LLM settings
   */
  const handleCheapLLMUpdate = useCallback(
    async (updates: Partial<CheapLLMSettings>) => {
      if (!settings) return

      try {
        setSaving(true)

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
        await mutateSettings(updatedSettings, false)
        await showSuccess()
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'An error occurred'
        console.error('Failed to update cheap LLM settings', { error: errorMsg })
      } finally {
        setSaving(false)
      }
    },
    [settings, mutateSettings, showSuccess]
  )

  /**
   * Update image description profile
   */
  const handleImageDescriptionProfileChange = useCallback(
    async (profileId: string | null) => {
      try {
        setSaving(true)

        const res = await fetch('/api/v1/settings/chat', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageDescriptionProfileId: profileId }),
        })

        if (!res.ok) throw new Error('Failed to update settings')

        await mutateSettings()
        await showSuccess()
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Failed to save'
        console.error('Failed to update image description profile', { error: errorMsg })
      } finally {
        setSaving(false)
      }
    },
    [mutateSettings, showSuccess]
  )

  /**
   * Update uncensored image description fallback profile
   */
  const handleUncensoredImageDescriptionProfileChange = useCallback(
    async (profileId: string | null) => {
      try {
        setSaving(true)

        const res = await fetch('/api/v1/settings/chat', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uncensoredImageDescriptionProfileId: profileId }),
        })

        if (!res.ok) throw new Error('Failed to update settings')

        await mutateSettings()
        await showSuccess()
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Failed to save'
        console.error('Failed to update uncensored image description profile', { error: errorMsg })
      } finally {
        setSaving(false)
      }
    },
    [mutateSettings, showSuccess]
  )

  /**
   * Update memory cascade preferences
   */
  const handleMemoryCascadeUpdate = useCallback(
    async (updates: Partial<MemoryCascadePreferences>) => {
      if (!settings) return

      try {
        setSaving(true)

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
        await mutateSettings(updatedSettings, false)
        await showSuccess()
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'An error occurred'
        console.error('Failed to update memory cascade preferences', { error: errorMsg })
      } finally {
        setSaving(false)
      }
    },
    [settings, mutateSettings, showSuccess]
  )

  /**
   * Update token display settings
   */
  const handleTokenDisplayChange = useCallback(
    async (key: keyof TokenDisplaySettings, value: boolean) => {
      if (!settings) return

      try {
        setSaving(true)

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
        await mutateSettings(updatedSettings, false)
        await showSuccess()
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'An error occurred'
        console.error('Failed to update token display settings', { error: errorMsg })
      } finally {
        setSaving(false)
      }
    },
    [settings, mutateSettings, showSuccess]
  )

  /**
   * Update context compression settings
   */
  const handleContextCompressionUpdate = useCallback(
    async (updates: Partial<ContextCompressionSettings>) => {
      if (!settings) return

      try {
        setSaving(true)

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
        await mutateSettings(updatedSettings, false)
        await showSuccess()
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'An error occurred'
        console.error('Failed to update context compression settings', { error: errorMsg })
      } finally {
        setSaving(false)
      }
    },
    [settings, mutateSettings, showSuccess]
  )

  /**
   * Update LLM logging settings
   */
  const handleLLMLoggingChange = useCallback(
    async (key: keyof LLMLoggingSettings, value: boolean | number) => {
      if (!settings) return

      try {
        setSaving(true)

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
        await mutateSettings(updatedSettings, false)
        await showSuccess()
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'An error occurred'
        console.error('Failed to update LLM logging settings', { error: errorMsg })
      } finally {
        setSaving(false)
      }
    },
    [settings, mutateSettings, showSuccess]
  )

  /**
   * Update auto-detect RNG setting
   */
  const handleAutoDetectRngChange = useCallback(
    async (value: boolean) => {
      if (!settings) return

      try {
        setSaving(true)

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
        await mutateSettings(updatedSettings, false)
        await showSuccess()
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'An error occurred'
        console.error('Failed to update auto-detect RNG setting', { error: errorMsg })
      } finally {
        setSaving(false)
      }
    },
    [settings, mutateSettings, showSuccess]
  )

  /**
   * Update default-composition-mode setting
   */
  const handleCompositionModeDefaultChange = useCallback(
    async (value: boolean) => {
      if (!settings) return

      try {
        setSaving(true)

        const res = await fetch('/api/v1/settings/chat', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ compositionModeDefault: value }),
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Failed to update composition mode default')
        }

        const updatedSettings = await res.json()
        await mutateSettings(updatedSettings, false)
        await showSuccess()
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'An error occurred'
        console.error('Failed to update composition mode default', { error: errorMsg })
      } finally {
        setSaving(false)
      }
    },
    [settings, mutateSettings, showSuccess]
  )

  /**
   * Update agent mode default enabled setting
   */
  const handleAgentModeDefaultEnabledChange = useCallback(
    async (value: boolean) => {
      if (!settings) return

      try {
        setSaving(true)

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
        await mutateSettings(updatedSettings, false)
        await showSuccess()
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'An error occurred'
        console.error('Failed to update agent mode default enabled', { error: errorMsg })
      } finally {
        setSaving(false)
      }
    },
    [settings, mutateSettings, showSuccess]
  )

  /**
   * Update agent mode max turns setting
   */
  const handleAgentModeMaxTurnsChange = useCallback(
    async (value: number) => {
      if (!settings) return

      try {
        setSaving(true)

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
        await mutateSettings(updatedSettings, false)
        await showSuccess()
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'An error occurred'
        console.error('Failed to update agent mode max turns', { error: errorMsg })
      } finally {
        setSaving(false)
      }
    },
    [settings, mutateSettings, showSuccess]
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
        await mutateSettings(updatedSettings, false)
        await showSuccess()
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'An error occurred'
        console.error('Failed to update story backgrounds enabled', { error: errorMsg })
      } finally {
        setSaving(false)
      }
    },
    [mutateSettings, showSuccess]
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
        await mutateSettings(updatedSettings, false)
        await showSuccess()
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'An error occurred'
        console.error('Failed to update story backgrounds profile', { error: errorMsg })
      } finally {
        setSaving(false)
      }
    },
    [mutateSettings, showSuccess]
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
        await mutateSettings(updatedSettings, false)
        await showSuccess()
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'An error occurred'
        console.error('Failed to update dangerous content settings', { error: errorMsg })
      } finally {
        setSaving(false)
      }
    },
    [mutateSettings, showSuccess]
  )

  /**
   * Update default timezone setting
   */
  const handleTimezoneChange = useCallback(
    async (timezone: string | null) => {
      if (!settings) return

      try {
        setSaving(true)

        const res = await fetch('/api/v1/settings/chat', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ timezone }),
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Failed to update timezone')
        }

        const updatedSettings = await res.json()
        await mutateSettings(updatedSettings, false)
        await showSuccess()
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'An error occurred'
        console.error('Failed to update timezone', { error: errorMsg })
      } finally {
        setSaving(false)
      }
    },
    [settings, mutateSettings, showSuccess]
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
    handleUncensoredImageDescriptionProfileChange,
    handleMemoryCascadeUpdate,
    handleTokenDisplayChange,
    handleContextCompressionUpdate,
    handleLLMLoggingChange,
    handleAutoDetectRngChange,
    handleCompositionModeDefaultChange,
    handleAgentModeDefaultEnabledChange,
    handleAgentModeMaxTurnsChange,
    handleStoryBackgroundsEnabledChange,
    handleStoryBackgroundsProfileChange,
    handleDangerousContentUpdate,
    handleTimezoneChange,
  }
}
