'use client'

import { useState, useEffect, useCallback } from 'react'
import { clientLogger } from '@/lib/client-logger'

type AvatarDisplayMode = 'ALWAYS' | 'GROUP_ONLY' | 'NEVER'
type AvatarDisplayStyle = 'CIRCULAR' | 'RECTANGULAR'
type CheapLLMStrategy = 'USER_DEFINED' | 'PROVIDER_CHEAPEST' | 'LOCAL_FIRST'
type EmbeddingProvider = 'SAME_PROVIDER' | 'OPENAI' | 'LOCAL'

interface CheapLLMSettings {
  strategy: CheapLLMStrategy
  userDefinedProfileId?: string | null
  defaultCheapProfileId?: string | null
  fallbackToLocal: boolean
  embeddingProvider: EmbeddingProvider
  embeddingProfileId?: string | null
}

interface ChatSettings {
  id: string
  userId: string
  avatarDisplayMode: AvatarDisplayMode
  avatarDisplayStyle: AvatarDisplayStyle
  cheapLLMSettings: CheapLLMSettings
  imageDescriptionProfileId?: string | null
  createdAt: string
  updatedAt: string
}

interface ConnectionProfile {
  id: string
  name: string
  provider: string
  modelName: string
  isDefault: boolean
  isCheap?: boolean
}

interface EmbeddingProfile {
  id: string
  name: string
  provider: string
  modelName: string
  isDefault: boolean
}

const AVATAR_MODES: { value: AvatarDisplayMode; label: string; description: string }[] = [
  {
    value: 'ALWAYS',
    label: 'Always Show Avatars',
    description: 'Display avatar for every message (character on left, user on right)',
  },
  {
    value: 'GROUP_ONLY',
    label: 'Group Chats Only',
    description: 'Only show avatars in group chats (will be implemented in the future)',
  },
  {
    value: 'NEVER',
    label: 'Never Show Avatars',
    description: 'Hide avatars in all chats',
  },
]

const AVATAR_STYLES: { value: AvatarDisplayStyle; label: string; description: string; preview: string }[] = [
  {
    value: 'CIRCULAR',
    label: 'Circular',
    description: 'Display avatars as circles',
    preview: '⭕',
  },
  {
    value: 'RECTANGULAR',
    label: 'Rectangular (5:4)',
    description: 'Display avatars as rectangles with 5:4 aspect ratio',
    preview: '▭',
  },
]

export default function ChatSettingsTab() {
  const [settings, setSettings] = useState<ChatSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [connectionProfiles, setConnectionProfiles] = useState<ConnectionProfile[]>([])
  const [embeddingProfiles, setEmbeddingProfiles] = useState<EmbeddingProfile[]>([])
  const [loadingProfiles, setLoadingProfiles] = useState(false)

  const fetchSettings = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch('/api/chat-settings')
      if (!res.ok) throw new Error('Failed to fetch chat settings')
      const data = await res.json()
      setSettings(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchConnectionProfiles = useCallback(async () => {
    try {
      setLoadingProfiles(true)
      const res = await fetch('/api/profiles')
      if (!res.ok) throw new Error('Failed to fetch profiles')
      const data = await res.json()
      setConnectionProfiles(data)
    } catch (err) {
      clientLogger.error('Error loading connection profiles', { error: err instanceof Error ? err.message : String(err) })
    } finally {
      setLoadingProfiles(false)
    }
  }, [])

  const fetchEmbeddingProfiles = useCallback(async () => {
    try {
      const res = await fetch('/api/embedding-profiles')
      if (!res.ok) throw new Error('Failed to fetch embedding profiles')
      const data = await res.json()
      setEmbeddingProfiles(data)
    } catch (err) {
      clientLogger.error('Error loading embedding profiles', { error: err instanceof Error ? err.message : String(err) })
    }
  }, [])

  useEffect(() => {
    fetchSettings()
    fetchConnectionProfiles()
    fetchEmbeddingProfiles()
  }, [fetchSettings, fetchConnectionProfiles, fetchEmbeddingProfiles])

  const handleAvatarModeChange = async (mode: AvatarDisplayMode) => {
    if (!settings) return

    try {
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
      setSettings(updatedSettings)
      setSuccess(true)
      setTimeout(() => setSuccess(false), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setSaving(false)
    }
  }

  const handleAvatarStyleChange = async (style: AvatarDisplayStyle) => {
    if (!settings) return

    try {
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
      setSettings(updatedSettings)
      setSuccess(true)
      setTimeout(() => setSuccess(false), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setSaving(false)
    }
  }

  const handleCheapLLMUpdate = async (updates: Partial<CheapLLMSettings>) => {
    if (!settings) return

    try {
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
      setSettings(updatedSettings)
      setSuccess(true)
      setTimeout(() => setSuccess(false), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-muted-foreground">Loading settings...</div>
      </div>
    )
  }

  if (!settings) {
    return (
      <div className="text-red-600 dark:text-red-400 py-8">
        Failed to load chat settings
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="qt-alert-error">
          {error}
        </div>
      )}

      {success && (
        <div className="qt-alert-success">
          Settings saved successfully
        </div>
      )}

      <div>
        <h2 className="text-xl font-semibold mb-4">Message Avatar Display</h2>
        <p className="text-muted-foreground mb-4">
          Control how avatars are displayed in chat messages
        </p>

        <div className="space-y-3">
          {AVATAR_MODES.map((mode) => (
            <label
              key={mode.value}
              className="flex items-start gap-3 p-4 border border-border rounded hover:bg-accent cursor-pointer transition-colors"
            >
              <input
                type="radio"
                name="avatarDisplayMode"
                value={mode.value}
                checked={settings.avatarDisplayMode === mode.value}
                onChange={() => handleAvatarModeChange(mode.value)}
                disabled={saving}
                className="mt-1"
              />
              <div className="flex-1">
                <div className="font-medium">{mode.label}</div>
                <div className="qt-text-small">
                  {mode.description}
                </div>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div className="border-t border-border pt-6">
        <h2 className="text-xl font-semibold mb-4">Avatar Display Style</h2>
        <p className="text-muted-foreground mb-4">
          Choose how avatars are shaped and displayed throughout the application
        </p>

        <div className="space-y-3">
          {AVATAR_STYLES.map((style) => (
            <label
              key={style.value}
              className="flex items-start gap-3 p-4 border border-border rounded hover:bg-accent cursor-pointer transition-colors"
            >
              <input
                type="radio"
                name="avatarDisplayStyle"
                value={style.value}
                checked={settings.avatarDisplayStyle === style.value}
                onChange={() => handleAvatarStyleChange(style.value)}
                disabled={saving}
                className="mt-1"
              />
              <div className="flex-1">
                <div className="font-medium">{style.label}</div>
                <div className="qt-text-small">
                  {style.description}
                </div>
              </div>
              <div className="text-3xl">{style.preview}</div>
            </label>
          ))}
        </div>
      </div>

      <div className="border-t border-border pt-6">
        <h2 className="text-xl font-semibold mb-4">Cheap LLM Settings</h2>
        <p className="text-muted-foreground mb-4">
          Configure which LLM to use for background tasks like memory extraction and summarization
        </p>

        <div className="space-y-4">
          {/* Strategy Selection */}
          <div>
            <label className="block text-sm font-medium mb-2">
              Strategy
            </label>
            <div className="space-y-2">
              {[
                { value: 'USER_DEFINED' as CheapLLMStrategy, label: 'User Defined', description: 'Use the profile you select below' },
                { value: 'PROVIDER_CHEAPEST' as CheapLLMStrategy, label: 'Provider Cheapest', description: 'Automatically use the cheapest model from current provider' },
                { value: 'LOCAL_FIRST' as CheapLLMStrategy, label: 'Local First', description: 'Prefer local/Ollama models if available' },
              ].map((strategy) => (
                <label
                  key={strategy.value}
                  className="flex items-start gap-3 p-3 border border-border rounded hover:bg-accent cursor-pointer transition-colors"
                >
                  <input
                    type="radio"
                    name="cheapLLMStrategy"
                    value={strategy.value}
                    checked={settings?.cheapLLMSettings.strategy === strategy.value}
                    onChange={() => handleCheapLLMUpdate({ strategy: strategy.value })}
                    disabled={saving}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <div className="font-medium text-sm">{strategy.label}</div>
                    <div className="qt-text-xs">
                      {strategy.description}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* User Defined Profile Selection */}
          {settings?.cheapLLMSettings.strategy === 'USER_DEFINED' && (
            <div>
              <label className="block text-sm font-medium mb-2">
                Select Cheap LLM Profile
              </label>
              <select
                value={settings?.cheapLLMSettings.userDefinedProfileId || ''}
                onChange={(e) => handleCheapLLMUpdate({ userDefinedProfileId: e.target.value || null })}
                disabled={saving || loadingProfiles}
                className="qt-select"
              >
                <option value="">Select a profile...</option>
                {connectionProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name} ({profile.provider} • {profile.modelName})
                  </option>
                ))}
              </select>
              {connectionProfiles.length === 0 && !loadingProfiles && (
                <p className="mt-1 qt-text-xs text-amber-600 dark:text-amber-400">
                  No connection profiles found. Create one in the Connection Profiles tab first.
                </p>
              )}
            </div>
          )}

          {/* Default Cheap Profile (Global Override) */}
          <div>
            <label className="block text-sm font-medium mb-2">
              Global Default Cheap LLM (Optional Override)
            </label>
            <p className="qt-text-xs mb-2">
              If set, this profile will always be used regardless of strategy
            </p>
            <select
              value={settings?.cheapLLMSettings.defaultCheapProfileId || ''}
              onChange={(e) => handleCheapLLMUpdate({ defaultCheapProfileId: e.target.value || null })}
              disabled={saving || loadingProfiles}
              className="qt-select"
            >
              <option value="">Not set</option>
              {connectionProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name} ({profile.provider} • {profile.modelName})
                </option>
              ))}
            </select>
          </div>

          {/* Fallback to Local */}
          <label className="flex items-center gap-3 p-3 border border-border rounded hover:bg-accent cursor-pointer transition-colors">
            <input
              type="checkbox"
              checked={settings?.cheapLLMSettings.fallbackToLocal ?? true}
              onChange={(e) => handleCheapLLMUpdate({ fallbackToLocal: e.target.checked })}
              disabled={saving}
              className="rounded"
            />
            <div className="flex-1">
              <div className="font-medium text-sm">Fallback to Local</div>
              <div className="qt-text-xs">
                Use local Ollama models as fallback if configured strategy is unavailable
              </div>
            </div>
          </label>

          {/* Embedding Provider */}
          <div>
            <label className="block text-sm font-medium mb-2">
              Embedding Provider
            </label>
            <div className="space-y-2">
              {[
                { value: 'SAME_PROVIDER' as EmbeddingProvider, label: 'Same Provider', description: 'Use embeddings from the same provider as the cheap LLM' },
                { value: 'OPENAI' as EmbeddingProvider, label: 'OpenAI', description: 'Use OpenAI for embeddings' },
                { value: 'LOCAL' as EmbeddingProvider, label: 'Local', description: 'Use local Ollama embeddings' },
              ].map((provider) => (
                <label
                  key={provider.value}
                  className="flex items-start gap-3 p-3 border border-border rounded hover:bg-accent cursor-pointer transition-colors"
                >
                  <input
                    type="radio"
                    name="embeddingProvider"
                    value={provider.value}
                    checked={settings?.cheapLLMSettings.embeddingProvider === provider.value}
                    onChange={() => handleCheapLLMUpdate({ embeddingProvider: provider.value })}
                    disabled={saving}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <div className="font-medium text-sm">{provider.label}</div>
                    <div className="qt-text-xs">
                      {provider.description}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Embedding Profile Selection */}
          <div>
            <label className="block text-sm font-medium mb-2">
              Embedding Profile (Optional)
            </label>
            <p className="qt-text-xs mb-2">
              Specific embedding profile to use. Leave blank to use the default for the selected embedding provider.
            </p>
            <select
              value={settings?.cheapLLMSettings.embeddingProfileId || ''}
              onChange={(e) => handleCheapLLMUpdate({ embeddingProfileId: e.target.value || null })}
              disabled={saving}
              className="qt-select"
            >
              <option value="">Use default for provider</option>
              {embeddingProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name} ({profile.provider} • {profile.modelName})
                </option>
              ))}
            </select>
            {embeddingProfiles.length === 0 && (
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                No embedding profiles found. Create one in the Embedding Profiles tab.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Image Description Profile */}
      <div className="border-t border-border pt-6">
        <h2 className="text-xl font-semibold mb-4">Image Description Profile</h2>
        <p className="text-muted-foreground mb-4">
          When you attach an image to a chat with a provider that doesn&apos;t support images (like Ollama, OpenRouter, etc.),
          this profile will be used to generate a text description of the image.
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">
              Image Description Profile
            </label>
            <p className="qt-text-xs mb-2">
              Select a vision-capable profile (like gpt-4o-mini, claude-haiku-4-5, or gemini-2.0-flash) to describe images.
              If not set, the system will automatically use any available vision-capable profile.
            </p>
            <select
              value={settings?.imageDescriptionProfileId || ''}
              onChange={async (e) => {
                const newValue = e.target.value || null
                try {
                  setSaving(true)
                  const res = await fetch('/api/chat-settings', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ imageDescriptionProfileId: newValue }),
                  })
                  if (!res.ok) throw new Error('Failed to update settings')
                  await fetchSettings()
                  setSuccess(true)
                  setTimeout(() => setSuccess(false), 3000)
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Failed to save')
                } finally {
                  setSaving(false)
                }
              }}
              disabled={saving || loadingProfiles}
              className="qt-select"
            >
              <option value="">Auto-select vision-capable profile</option>
              {connectionProfiles
                .filter(profile => {
                  // Only show vision-capable providers
                  const visionProviders = ['OPENAI', 'ANTHROPIC', 'GOOGLE', 'GROK']
                  return visionProviders.includes(profile.provider)
                })
                .map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name} ({profile.provider} • {profile.modelName})
                  </option>
                ))}
            </select>
            {connectionProfiles.filter(p => ['OPENAI', 'ANTHROPIC', 'GOOGLE', 'GROK'].includes(p.provider)).length === 0 && (
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                No vision-capable profiles found. Create an OpenAI, Anthropic, Google, or Grok profile in the Connection Profiles tab.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
