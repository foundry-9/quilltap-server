'use client'

import { useState, useEffect, useCallback } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { useFormState } from '@/hooks/useFormState'
import { useAsyncOperation } from '@/hooks/useAsyncOperation'
import { fetchJson } from '@/lib/fetch-helpers'
import { getErrorMessage } from '@/lib/error-utils'
import { TagEditor } from '@/components/tags/tag-editor'
import { TagBadge } from '@/components/tags/tag-badge'
import { ModelSelector, type ModelInfo } from './model-selector'
import { getAttachmentSupportDescription } from '@/lib/llm/attachment-support'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { LoadingState } from '@/components/ui/LoadingState'
import { ErrorAlert } from '@/components/ui/ErrorAlert'
import { EmptyState } from '@/components/ui/EmptyState'
import { DeleteConfirmPopover } from '@/components/ui/DeleteConfirmPopover'

interface ApiKey {
  id: string
  label: string
  provider: string
  isActive: boolean
}

interface Tag {
  id: string
  name: string
  createdAt?: string
}

interface ProviderConfig {
  name: string
  displayName: string
  configRequirements: {
    requiresApiKey: boolean
    requiresBaseUrl: boolean
  }
  capabilities: {
    chat: boolean
    imageGeneration: boolean
    embeddings: boolean
    webSearch: boolean
  }
}

interface ConnectionProfile {
  id: string
  name: string
  provider: string
  apiKeyId?: string
  baseUrl?: string
  modelName: string
  parameters: Record<string, any>
  isDefault: boolean
  isCheap?: boolean
  allowWebSearch?: boolean
  apiKey?: ApiKey | null
  tags?: Tag[]
  messageCount?: number
}

const initialFormState = {
  name: '',
  provider: 'OPENAI',
  apiKeyId: '',
  baseUrl: '',
  modelName: 'gpt-3.5-turbo',
  temperature: 1,
  maxTokens: 4096,
  topP: 1,
  isDefault: false,
  isCheap: false,
  allowWebSearch: false,
  // OpenRouter-specific fields
  fallbackModels: [] as string[],
  enableZDR: false,
  providerOrder: [] as string[],
  useCustomModel: false,
  // Anthropic-specific fields
  enableCacheBreakpoints: false,
  cacheStrategy: 'system_and_long_context' as 'system_only' | 'system_and_long_context',
  cacheTTL: '5m' as '5m' | '1h',
}

export default function ConnectionProfilesTab() {
  // Form state management using new hook
  const form = useFormState(initialFormState)

  // Async operation hooks
  const fetchOp = useAsyncOperation<any>()
  const saveOp = useAsyncOperation<any>()
  const deleteOp = useAsyncOperation<any>()
  const connectOp = useAsyncOperation<any>()
  const fetchModelsOp = useAsyncOperation<any>()
  const testMessageOp = useAsyncOperation<any>()

  // Remaining UI state
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([])
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [providers, setProviders] = useState<ProviderConfig[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteConfirming, setDeleteConfirming] = useState<string | null>(null)
  const [cheapDefaultProfileId, setCheapDefaultProfileId] = useState<string | null>(null)

  // Connection testing states
  const [isConnected, setIsConnected] = useState(false)
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null)

  // Fetch models states
  const [fetchedModels, setFetchedModels] = useState<string[]>([])
  const [fetchedModelsWithInfo, setFetchedModelsWithInfo] = useState<ModelInfo[]>([])
  const [modelsMessage, setModelsMessage] = useState<string | null>(null)

  // Test message states
  const [testMessageResult, setTestMessageResult] = useState<string | null>(null)

  const countMessagesPerProfile = useCallback(async (profilesList: ConnectionProfile[]) => {
    try {
      // Initialize message counts for all profiles
      const messageCounts: Record<string, number> = {}
      profilesList.forEach(p => {
        messageCounts[p.id] = 0
      })

      // Fetch all chats to analyze message usage
      const chatsRes = await fetch('/api/chats')
      if (!chatsRes.ok) return messageCounts

      const chats = await chatsRes.json()
      if (!Array.isArray(chats)) return messageCounts

      // For each chat, count messages by profile
      await Promise.all(
        chats.map(async (chat: any) => {
          try {
            // Get messages for this chat
            const messagesRes = await fetch(`/api/chats/${chat.id}/messages`)
            if (!messagesRes.ok) return

            const messages = await messagesRes.json()
            if (!Array.isArray(messages.messages)) return

            // Get CHARACTER participants with their connection profiles
            const characterParticipants = (chat.participants || []).filter(
              (p: any) => p.type === 'CHARACTER'
            )

            if (characterParticipants.length === 0) return

            // Count ASSISTANT messages
            // Distribute messages among character participants based on conversation flow
            const assistantMessages = messages.messages.filter(
              (m: any) => m.role === 'ASSISTANT'
            )

            if (assistantMessages.length === 0) return

            // Simple strategy: if only one character, assign all assistant messages to them
            // If multiple characters, assign based on alternating pattern or message order
            if (characterParticipants.length === 1) {
              const profileId = characterParticipants[0].connectionProfileId
              if (profileId && profileId in messageCounts) {
                messageCounts[profileId] += assistantMessages.length
              }
            } else {
              // For multiple participants, use a round-robin approach based on message index
              assistantMessages.forEach((msg: any, index: number) => {
                const participantIndex = index % characterParticipants.length
                const profileId =
                  characterParticipants[participantIndex].connectionProfileId
                if (profileId && profileId in messageCounts) {
                  messageCounts[profileId]++
                }
              })
            }
          } catch (err) {
            clientLogger.error(`Error processing chat ${chat.id}`, { error: getErrorMessage(err) })
          }
        })
      )

      return messageCounts
    } catch (err) {
      clientLogger.error('Error counting messages per profile', { error: getErrorMessage(err) })
      return {}
    }
  }, [])

  const fetchProfiles = useCallback(async () => {
    return await fetchOp.execute(async () => {
      clientLogger.debug('Fetching connection profiles')
      // Add cache busting timestamp to force fresh data
      const result = await fetchJson<ConnectionProfile[]>(`/api/profiles?t=${Date.now()}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache'
        }
      })

      if (!result.ok) {
        throw new Error(result.error || 'Failed to fetch profiles')
      }

      const data = result.data || []

      // Fetch tags for each profile
      const profilesWithTags = await Promise.all(
        data.map(async (profile: ConnectionProfile) => {
          try {
            const tagsResult = await fetchJson<{ tags: Tag[] }>(`/api/profiles/${profile.id}/tags`)
            if (tagsResult.ok) {
              return { ...profile, tags: tagsResult.data?.tags || [] }
            }
          } catch (err) {
            clientLogger.error(`Error fetching tags for profile ${profile.id}`, { error: getErrorMessage(err) })
          }
          return profile
        })
      )

      // Count messages per profile
      const messageCounts = await countMessagesPerProfile(profilesWithTags)

      // Attach message counts to profiles
      const profilesWithCounts = profilesWithTags.map(profile => ({
        ...profile,
        messageCount: messageCounts[profile.id] || 0,
      }))

      setProfiles(profilesWithCounts)
      clientLogger.debug('Profiles loaded successfully', { count: profilesWithCounts.length })
      return profilesWithCounts
    })
  }, [fetchOp, countMessagesPerProfile])

  const fetchApiKeys = useCallback(async () => {
    try {
      clientLogger.debug('Fetching API keys')
      const result = await fetchJson<ApiKey[]>('/api/keys')
      if (result.ok) {
        setApiKeys(result.data || [])
        clientLogger.debug('API keys loaded', { count: result.data?.length })
      } else {
        throw new Error(result.error)
      }
    } catch (err) {
      clientLogger.error('Failed to fetch API keys', { error: getErrorMessage(err) })
    }
  }, [])

  const fetchProviders = useCallback(async () => {
    try {
      clientLogger.debug('Fetching providers configuration')
      const result = await fetchJson<{ providers: ProviderConfig[] }>('/api/providers')
      if (result.ok) {
        const providerList = result.data?.providers || []
        setProviders(providerList)
        clientLogger.debug('Providers loaded', {
          count: providerList.length,
          providers: providerList.map((p: ProviderConfig) => p.name)
        })
      } else {
        throw new Error(result.error)
      }
    } catch (err) {
      clientLogger.error('Failed to fetch providers', { error: getErrorMessage(err) })
    }
  }, [])

  // Get provider config requirements - returns defaults if provider not found
  const getProviderRequirements = (providerName: string) => {
    const provider = providers.find(p => p.name === providerName)
    return {
      requiresApiKey: provider?.configRequirements?.requiresApiKey ?? true,
      requiresBaseUrl: provider?.configRequirements?.requiresBaseUrl ?? false,
      supportsWebSearch: provider?.capabilities?.webSearch ?? false,
    }
  }

  useEffect(() => {
    fetchProfiles()
    fetchApiKeys()
    fetchProviders()
    // Fetch chat settings to get the cheap default profile
    const fetchChatSettings = async () => {
      try {
        const result = await fetchJson<any>('/api/chat-settings')
        if (result.ok) {
          setCheapDefaultProfileId(result.data?.cheapLLMSettings?.defaultCheapProfileId || null)
        }
      } catch (err) {
        clientLogger.error('Error fetching chat settings', { error: getErrorMessage(err) })
      }
    }
    fetchChatSettings()
  }, [fetchProfiles, fetchApiKeys, fetchProviders])

  const resetForm = () => {
    form.resetForm()
    setEditingId(null)
    // Reset connection states
    setIsConnected(false)
    setConnectionMessage(null)
    setFetchedModels([])
    setModelsMessage(null)
    setTestMessageResult(null)
  }

  const handleEdit = async (profile: ConnectionProfile) => {
    form.setFormData({
      name: profile.name,
      provider: profile.provider,
      apiKeyId: profile.apiKeyId || '',
      baseUrl: profile.baseUrl || '',
      modelName: profile.modelName,
      temperature: profile.parameters?.temperature ?? 1,
      maxTokens: profile.parameters?.max_tokens ?? 1000,
      topP: profile.parameters?.top_p ?? 1,
      isDefault: profile.isDefault,
      isCheap: profile.isCheap ?? false,
      allowWebSearch: profile.allowWebSearch ?? false,
      // OpenRouter-specific fields
      fallbackModels: profile.parameters?.fallbackModels ?? [],
      enableZDR: profile.parameters?.providerPreferences?.dataCollection === 'deny',
      providerOrder: profile.parameters?.providerPreferences?.order ?? [],
      useCustomModel: profile.parameters?.useCustomModel ?? false,
      // Anthropic-specific fields
      enableCacheBreakpoints: profile.parameters?.enableCacheBreakpoints ?? false,
      cacheStrategy: profile.parameters?.cacheStrategy ?? 'system_and_long_context',
      cacheTTL: profile.parameters?.cacheTTL ?? '5m',
    })
    setEditingId(profile.id)
    setShowForm(true)

    // Auto-fetch models to show model warnings and enable ModelSelector
    try {
      const result = await fetchJson<any>('/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: profile.provider,
          apiKeyId: profile.apiKeyId || undefined,
          baseUrl: profile.baseUrl || undefined,
        }),
      })
      if (result.ok) {
        setFetchedModels(result.data?.models || [])
        setFetchedModelsWithInfo(result.data?.modelsWithInfo || [])
        setModelsMessage(`Found ${result.data?.models?.length || 0} models`)
        clientLogger.debug('Models auto-fetched during edit', { count: result.data?.models?.length })
      }
    } catch {
      // Silently ignore fetch errors - user can manually fetch if needed
    }

    // Scroll to form after state update
    setTimeout(() => {
      const formElement = document.getElementById('profile-form')
      if (formElement) {
        formElement.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }, 0)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const result = await saveOp.execute(async () => {
      clientLogger.debug('Saving connection profile', { editingId, profileName: form.formData.name })
      const method = editingId ? 'PUT' : 'POST'
      const url = editingId ? `/api/profiles/${editingId}` : '/api/profiles'

      // Build request body
      // Start with base parameters
      const parameters: Record<string, any> = {
        temperature: parseFloat(String(form.formData.temperature)),
        max_tokens: parseInt(String(form.formData.maxTokens)),
        top_p: parseFloat(String(form.formData.topP)),
      }

      // Add OpenRouter-specific parameters
      if (form.formData.provider === 'OPENROUTER') {
        if (form.formData.fallbackModels.length > 0) {
          parameters.fallbackModels = form.formData.fallbackModels
        }
        // Build providerPreferences if any options are set
        const providerPreferences: Record<string, any> = {}
        if (form.formData.enableZDR) {
          providerPreferences.dataCollection = 'deny'
        }
        if (form.formData.providerOrder.length > 0) {
          providerPreferences.order = form.formData.providerOrder
        }
        if (Object.keys(providerPreferences).length > 0) {
          parameters.providerPreferences = providerPreferences
        }
        // Save custom model preference
        if (form.formData.useCustomModel) {
          parameters.useCustomModel = true
        }
      }

      // Add Anthropic-specific parameters
      if (form.formData.provider === 'ANTHROPIC' && form.formData.enableCacheBreakpoints) {
        parameters.enableCacheBreakpoints = true
        parameters.cacheStrategy = form.formData.cacheStrategy
        parameters.cacheTTL = form.formData.cacheTTL
      }

      const requestBody: any = {
        name: form.formData.name,
        provider: form.formData.provider,
        modelName: form.formData.modelName,
        isDefault: form.formData.isDefault,
        isCheap: form.formData.isCheap,
        allowWebSearch: form.formData.allowWebSearch,
        parameters,
      }

      // Always include apiKeyId when editing (to support changes)
      // Only include when truthy for new profiles
      if (editingId) {
        requestBody.apiKeyId = form.formData.apiKeyId || null
      } else if (form.formData.apiKeyId) {
        requestBody.apiKeyId = form.formData.apiKeyId
      }

      // Only include baseUrl if set
      if (form.formData.baseUrl) {
        requestBody.baseUrl = form.formData.baseUrl
      }

      const fetchResult = await fetchJson<any>(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      })

      if (!fetchResult.ok) {
        throw new Error(fetchResult.error || 'Failed to save profile')
      }

      clientLogger.debug('Profile saved successfully', { editingId, isNew: !editingId })
      return fetchResult.data
    })

    if (result) {
      resetForm()
      setShowForm(false)
      await fetchProfiles()
      await fetchApiKeys()
    }
  }

  const handleDelete = async (id: string) => {
    const result = await deleteOp.execute(async () => {
      clientLogger.debug('Deleting connection profile', { profileId: id })
      const fetchResult = await fetchJson(`/api/profiles/${id}`, { method: 'DELETE' })
      if (!fetchResult.ok) throw new Error(fetchResult.error || 'Failed to delete profile')
      clientLogger.debug('Profile deleted successfully', { profileId: id })
      return fetchResult.data
    })

    if (result) {
      setDeleteConfirming(null)
      await fetchProfiles()
    }
  }

  // Helper to get the selected model's info (including maxOutputTokens)
  const getSelectedModelInfo = useCallback(() => {
    if (!form.formData.modelName || fetchedModelsWithInfo.length === 0) return null
    return fetchedModelsWithInfo.find(m => m.id === form.formData.modelName) || null
  }, [form.formData.modelName, fetchedModelsWithInfo])

  // Get max tokens limit for the selected model (default to 128000 if not known)
  const getMaxTokensLimit = useCallback(() => {
    const modelInfo = getSelectedModelInfo()
    // Use model's maxOutputTokens if known, otherwise default to 128000
    return modelInfo?.maxOutputTokens || 128000
  }, [getSelectedModelInfo])

  const handleConnect = async () => {
    const result = await connectOp.execute(async () => {
      clientLogger.debug('Testing connection', { provider: form.formData.provider })
      // Validate required fields
      if (!form.formData.provider) {
        throw new Error('Provider is required')
      }

      const requirements = getProviderRequirements(form.formData.provider)

      if (requirements.requiresBaseUrl && !form.formData.baseUrl) {
        throw new Error('Base URL is required for this provider')
      }

      if (requirements.requiresApiKey && !form.formData.apiKeyId) {
        throw new Error('API Key is required for this provider')
      }

      // Test the connection
      const fetchResult = await fetchJson<any>('/api/profiles/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: form.formData.provider,
          apiKeyId: form.formData.apiKeyId || undefined,
          baseUrl: form.formData.baseUrl || undefined,
        }),
      })

      if (!fetchResult.ok) {
        throw new Error(fetchResult.error || 'Connection test failed')
      }

      clientLogger.debug('Connection test successful', { provider: form.formData.provider })
      return fetchResult.data
    })

    if (result) {
      setIsConnected(true)
      setConnectionMessage(result.message || 'Connection successful!')
    } else {
      setIsConnected(false)
      setConnectionMessage(null)
    }
  }

  const handleFetchModels = async () => {
    const result = await fetchModelsOp.execute(async () => {
      clientLogger.debug('Fetching models', { provider: form.formData.provider })
      // Validate required fields based on provider
      const requirements = getProviderRequirements(form.formData.provider)
      if (requirements.requiresBaseUrl && !form.formData.baseUrl) {
        throw new Error('Base URL is required for this provider')
      }

      const fetchResult = await fetchJson<any>('/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: form.formData.provider,
          apiKeyId: form.formData.apiKeyId || undefined,
          baseUrl: form.formData.baseUrl || undefined,
        }),
      })

      if (!fetchResult.ok) {
        throw new Error(fetchResult.error || 'Failed to fetch models')
      }

      clientLogger.debug('Models fetched successfully', { count: fetchResult.data?.models?.length })
      return fetchResult.data
    })

    if (result) {
      setFetchedModels(result.models || [])
      setFetchedModelsWithInfo(result.modelsWithInfo || [])
      setModelsMessage(`Found ${result.models?.length || 0} models`)
    } else {
      setFetchedModels([])
      setModelsMessage(null)
    }
  }

  const handleTestMessage = async () => {
    const result = await testMessageOp.execute(async () => {
      clientLogger.debug('Testing message', { provider: form.formData.provider, model: form.formData.modelName })
      // Validate model name
      if (!form.formData.modelName) {
        throw new Error('Model name is required')
      }

      const fetchResult = await fetchJson<any>('/api/profiles/test-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: form.formData.provider,
          apiKeyId: form.formData.apiKeyId || undefined,
          baseUrl: form.formData.baseUrl || undefined,
          modelName: form.formData.modelName,
          parameters: {
            temperature: parseFloat(String(form.formData.temperature)),
            max_tokens: parseInt(String(form.formData.maxTokens)),
            top_p: parseFloat(String(form.formData.topP)),
          },
        }),
      })

      if (!fetchResult.ok) {
        throw new Error(fetchResult.error || 'Test message failed')
      }

      clientLogger.debug('Test message sent successfully')
      return fetchResult.data
    })

    if (result) {
      setTestMessageResult(result.message || 'Test message sent successfully!')
    } else {
      setTestMessageResult(null)
    }
  }

  const getModelSuggestions = (provider: string): string[] => {
    const models: Record<string, string[]> = {
      OPENAI: ['gpt-4', 'gpt-3.5-turbo', 'gpt-4-turbo'],
      ANTHROPIC: ['claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001', 'claude-opus-4-1-20250805'],
      GOOGLE: ['gemini-1.5-flash-latest', 'gemini-1.5-pro-latest', 'gemini-1.0-pro', 'gemini-pro-vision'],
      GROK: ['grok-beta', 'grok-2', 'grok-vision-beta'],
      GAB_AI: ['arya', 'gpt-4o'],
      OLLAMA: ['llama2', 'neural-chat', 'mistral'],
      OPENROUTER: ['openai/gpt-4', 'anthropic/claude-2', 'meta-llama/llama-2-70b'],
      OPENAI_COMPATIBLE: ['gpt-3.5-turbo'],
    }
    const modelList = models[provider] || ['gpt-3.5-turbo']
    return modelList.sort()
  }

  if (fetchOp.loading) {
    return <LoadingState message="Loading connection profiles..." />
  }

  return (
    <div>
      {fetchOp.error && (
        <ErrorAlert
          message={fetchOp.error}
          onRetry={() => fetchProfiles()}
          className="mb-4"
        />
      )}

      {apiKeys.length === 0 && (
        <div className="qt-alert-warning mb-6">
          <p className="font-medium">No API keys found</p>
          <p className="qt-text-small">Add an API key in the &quot;API Keys&quot; tab before creating a connection profile.</p>
        </div>
      )}

      {/* Profiles List */}
      <div className="mb-8">
        <SectionHeader
          title="Connection Profiles"
          count={profiles.length}
          level="h2"
          action={{
            label: '+ Add Profile',
            onClick: () => {
              resetForm()
              setShowForm(true)
              setTimeout(() => {
                const formElement = document.getElementById('profile-form')
                if (formElement) {
                  formElement.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }
              }, 0)
            },
            show: !showForm,
          }}
        />

        {profiles.length === 0 ? (
          <EmptyState
            title="No connection profiles yet"
            description="Create one to start chatting."
            action={{
              label: 'Create Profile',
              onClick: () => {
                resetForm()
                setShowForm(true)
              },
            }}
          />
        ) : (
          <div className="space-y-3">
            {profiles
              .toSorted((a, b) => a.name.localeCompare(b.name))
              .map(profile => (
              <div
                key={profile.id}
                className="border border-border rounded-lg p-4 bg-card hover:bg-accent/50"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="qt-text-primary">{profile.name}</p>
                      {profile.isDefault && (
                        <span className="px-2 py-1 bg-green-100/50 text-green-700 text-xs rounded-full">
                          Default
                        </span>
                      )}
                      {profile.id === cheapDefaultProfileId && (
                        <span className="px-2 py-1 bg-indigo-100/50 text-indigo-700 text-xs rounded-full">
                          Default Cheap
                        </span>
                      )}
                      {profile.isCheap && profile.id !== cheapDefaultProfileId && (
                        <span className="px-2 py-1 bg-amber-100/50 text-amber-700 text-xs rounded-full">
                          Cheap
                        </span>
                      )}
                    </div>
                    <p className="qt-text-small mt-1">
                      {profile.provider} • {profile.modelName}
                    </p>
                    <p className="qt-text-xs mt-1">
                      {getAttachmentSupportDescription(profile.provider as any, profile.baseUrl ?? undefined)}
                    </p>
                    {profile.messageCount !== undefined && (
                      <p className="text-sm text-primary mt-1 font-medium">
                        {profile.messageCount} message{profile.messageCount === 1 ? '' : 's'} used
                      </p>
                    )}
                    {profile.apiKey && (
                      <p className="qt-text-small">
                        API Key: {profile.apiKey.label}
                      </p>
                    )}
                    {profile.baseUrl && (
                      <p className="qt-text-small">
                        Base URL: {profile.baseUrl}
                      </p>
                    )}
                    <div className="qt-text-xs mt-2">
                      Temperature: {profile.parameters?.temperature ?? 0.7} •
                      Max Tokens: {profile.parameters?.max_tokens ?? 1000} •
                      Top P: {profile.parameters?.top_p ?? 1}
                    </div>
                    {profile.tags && profile.tags.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {profile.tags.map(tag => (
                          <TagBadge key={tag.id} tag={tag} size="sm" />
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEdit(profile)}
                      className="px-3 py-1 text-sm bg-primary/10 text-primary rounded hover:bg-primary/20"
                    >
                      Edit
                    </button>
                    <div className="relative">
                      <button
                        onClick={() => setDeleteConfirming(deleteConfirming === profile.id ? null : profile.id)}
                        className="px-3 py-1 text-sm text-destructive hover:bg-destructive/10 rounded border border-destructive/50 hover:border-destructive focus:outline-none focus:ring-2 focus:ring-destructive"
                      >
                        Delete
                      </button>

                      {/* Delete Confirmation Popover */}
                      <DeleteConfirmPopover
                        isOpen={deleteConfirming === profile.id}
                        onCancel={() => setDeleteConfirming(null)}
                        onConfirm={() => handleDelete(profile.id)}
                        message="Delete this profile?"
                        isDeleting={deleteOp.loading}
                      />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add/Edit Profile Form */}
      {showForm && (
        <div id="profile-form" className="bg-muted border border-border rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-4">
            {editingId ? 'Edit Connection Profile' : 'Add New Connection Profile'}
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="name" className="block qt-text-label mb-2">
                  Name *
                </label>
                <input
                  type="text"
                  id="name"
                  name="name"
                  value={form.formData.name}
                  onChange={form.handleChange}
                  placeholder="e.g., My GPT-4 Profile"
                  required
                  className="qt-input"
                />
              </div>

              <div>
                <label htmlFor="provider" className="block qt-text-label mb-2">
                  Provider *
                </label>
                <select
                  id="provider"
                  name="provider"
                  value={form.formData.provider}
                  onChange={form.handleChange}
                  className="qt-select"
                >
                  {providers.length > 0 ? (
                    providers
                      .filter(p => p.capabilities.chat)
                      .map(p => (
                        <option key={p.name} value={p.name}>
                          {p.displayName}
                        </option>
                      ))
                  ) : (
                    <>
                      <option value="OPENAI">OpenAI</option>
                      <option value="ANTHROPIC">Anthropic</option>
                      <option value="GOOGLE">Google</option>
                      <option value="GROK">Grok</option>
                      <option value="GAB_AI">Gab AI</option>
                      <option value="OLLAMA">Ollama</option>
                      <option value="OPENROUTER">OpenRouter</option>
                      <option value="OPENAI_COMPATIBLE">OpenAI Compatible</option>
                    </>
                  )}
                </select>
                <p className="qt-text-xs mt-1">
                  File attachments: {getAttachmentSupportDescription(form.formData.provider as any, form.formData.baseUrl || undefined)}
                </p>
              </div>
            </div>

            {(() => {
              const reqs = getProviderRequirements(form.formData.provider)
              const showApiKey = reqs.requiresApiKey
              const showBaseUrl = reqs.requiresBaseUrl
              const showBoth = showApiKey && showBaseUrl

              return (
                <div className={showBoth ? "grid grid-cols-2 gap-4" : ""}>
                  {showApiKey && (
                    <div>
                      <label htmlFor="apiKeyId" className="block qt-text-label mb-2">
                        API Key *
                      </label>
                      <select
                        id="apiKeyId"
                        name="apiKeyId"
                        value={form.formData.apiKeyId}
                        onChange={form.handleChange}
                        className="qt-select"
                      >
                        <option value="">Select an API Key</option>
                        {apiKeys
                          .filter(key => key.provider === form.formData.provider)
                          .map(key => (
                            <option key={key.id} value={key.id}>
                              {key.label}
                            </option>
                          ))}
                      </select>
                      <p className="qt-text-xs mt-1">Required for this provider</p>
                    </div>
                  )}

                  {showBaseUrl && (
                    <div>
                      <label htmlFor="baseUrl" className="block qt-text-label mb-2">
                        Base URL *
                      </label>
                      <input
                        type="url"
                        id="baseUrl"
                        name="baseUrl"
                        value={form.formData.baseUrl}
                        onChange={form.handleChange}
                        placeholder="http://localhost:11434"
                        className="qt-input"
                      />
                      <p className="qt-text-xs mt-1">Required for this provider</p>
                    </div>
                  )}
                </div>
              )
            })()}

            {/* Connection Testing Section */}
            <div className="border border-border rounded-lg p-4 bg-muted/50">
              <h4 className="font-medium text-sm mb-3">Connection Testing</h4>

              <div className="flex flex-wrap gap-3 mb-3">
                <button
                  type="button"
                  onClick={handleConnect}
                  disabled={connectOp.loading}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed"
                >
                  {connectOp.loading ? 'Connecting...' : 'Connect'}
                </button>

                <button
                  type="button"
                  onClick={handleFetchModels}
                  disabled={(() => {
                    const reqs = getProviderRequirements(form.formData.provider)
                    if (fetchModelsOp.loading) return true
                    // For providers that need baseUrl, require it
                    if (reqs.requiresBaseUrl && !form.formData.baseUrl) return true
                    // For providers that need API key and aren't connected yet, require connection
                    if (reqs.requiresApiKey && !isConnected) return true
                    return false
                  })()}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed"
                >
                  {fetchModelsOp.loading ? 'Fetching...' : 'Fetch Models'}
                </button>

                <button
                  type="button"
                  onClick={handleTestMessage}
                  disabled={!isConnected || testMessageOp.loading || !form.formData.modelName}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed"
                >
                  {testMessageOp.loading ? 'Testing...' : 'Test Message'}
                </button>
              </div>

              {/* Status messages */}
              {connectionMessage && (
                <div className="text-sm text-green-700 bg-green-50/50 border border-green-200/70 rounded px-3 py-2 mb-2">
                  ✓ {connectionMessage}
                </div>
              )}

              {modelsMessage && (
                <div className="text-sm text-blue-700 bg-blue-50/50 border border-blue-200/70 rounded px-3 py-2 mb-2">
                  ✓ {modelsMessage}
                </div>
              )}

              {testMessageResult && (
                <div className="text-sm text-purple-700 bg-purple-50/50 border border-purple-200/70 rounded px-3 py-2 mb-2">
                  ✓ {testMessageResult}
                </div>
              )}

              <p className="qt-text-xs mt-2">
                1. Click Connect to test the connection • 2. Fetch Models (enabled after connection) • 3. Test Message to verify API functionality
              </p>
            </div>

            <div>
              <label htmlFor="modelName" className="block qt-text-label mb-2">
                Model *
              </label>
              {/* Show text input for custom model (OpenRouter only) or when models haven't been fetched */}
              {(form.formData.provider === 'OPENROUTER' && form.formData.useCustomModel) ? (
                <>
                  <input
                    type="text"
                    id="modelName"
                    name="modelName"
                    value={form.formData.modelName}
                    onChange={form.handleChange}
                    placeholder="e.g., openai/gpt-4-turbo or anthropic/claude-3-opus"
                    list="modelSuggestions"
                    required
                    className="qt-input"
                  />
                  <datalist id="modelSuggestions">
                    {fetchedModels.length > 0 ? (
                      fetchedModels.map(model => (
                        <option key={model} value={model} />
                      ))
                    ) : (
                      getModelSuggestions(form.formData.provider).map(model => (
                        <option key={model} value={model} />
                      ))
                    )}
                  </datalist>
                  <p className="qt-text-xs mt-1">
                    Enter any OpenRouter model ID. Use &quot;Test Message&quot; to verify.
                  </p>
                </>
              ) : fetchedModels.length > 0 ? (
                <ModelSelector
                  models={fetchedModels}
                  modelsWithInfo={fetchedModelsWithInfo}
                  value={form.formData.modelName}
                  onChange={(value) => form.setField('modelName', value)}
                  placeholder="Select or search a model"
                  required
                  showFetchedCount
                />
              ) : (
                <>
                  <input
                    type="text"
                    id="modelName"
                    name="modelName"
                    value={form.formData.modelName}
                    onChange={form.handleChange}
                    placeholder="e.g., gpt-4"
                    list="modelSuggestions"
                    required
                    className="qt-input"
                  />
                  <datalist id="modelSuggestions">
                    {getModelSuggestions(form.formData.provider).map(model => (
                      <option key={model} value={model} />
                    ))}
                  </datalist>
                </>
              )}
            </div>

            <div className="border-t border-border pt-4">
              <h4 className="font-medium text-sm mb-3">Model Parameters (Optional)</h4>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label htmlFor="temperature" className="block qt-text-label mb-2">
                    Temperature ({form.formData.temperature})
                  </label>
                  <input
                    type="range"
                    id="temperature"
                    name="temperature"
                    min="0"
                    max="2"
                    step="0.1"
                    value={form.formData.temperature}
                    onChange={form.handleChange}
                    className="w-full"
                  />
                  <p className="qt-text-xs mt-1">0 = deterministic, 2 = creative</p>
                </div>

                <div>
                  <label htmlFor="maxTokens" className="block qt-text-label mb-2">
                    Max Tokens
                  </label>
                  <input
                    type="number"
                    id="maxTokens"
                    name="maxTokens"
                    value={form.formData.maxTokens}
                    onChange={form.handleChange}
                    min="1"
                    max={getMaxTokensLimit()}
                    className="qt-input"
                  />
                  <p className="qt-text-xs mt-1">
                    {getSelectedModelInfo()?.maxOutputTokens
                      ? `Model limit: ${getSelectedModelInfo()?.maxOutputTokens?.toLocaleString()} tokens`
                      : 'Max output tokens for responses'}
                  </p>
                </div>

                <div>
                  <label htmlFor="topP" className="block qt-text-label mb-2">
                    Top P ({form.formData.topP})
                  </label>
                  <input
                    type="range"
                    id="topP"
                    name="topP"
                    min="0"
                    max="1"
                    step="0.05"
                    value={form.formData.topP}
                    onChange={form.handleChange}
                    className="w-full"
                  />
                  <p className="qt-text-xs mt-1">Nucleus sampling (0-1)</p>
                </div>
              </div>
            </div>

            <div className="space-y-2 pt-2">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isDefault"
                  name="isDefault"
                  checked={form.formData.isDefault}
                  onChange={form.handleChange}
                  className="w-4 h-4 rounded dark:bg-slate-800 dark:border-slate-600"
                />
                <label htmlFor="isDefault" className="text-sm">
                  Set as default profile
                </label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isCheap"
                  name="isCheap"
                  checked={form.formData.isCheap}
                  onChange={form.handleChange}
                  className="w-4 h-4 rounded dark:bg-slate-800 dark:border-slate-600"
                />
                <label htmlFor="isCheap" className="text-sm">
                  Mark as cheap LLM (suitable for cost-effective tasks like memory extraction)
                </label>
              </div>
              {(() => {
                const supportsWebSearch = getProviderRequirements(form.formData.provider).supportsWebSearch
                return (
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="allowWebSearch"
                      name="allowWebSearch"
                      checked={form.formData.allowWebSearch}
                      onChange={form.handleChange}
                      disabled={!supportsWebSearch}
                      className="w-4 h-4 rounded dark:bg-slate-800 dark:border-slate-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                    <div className="flex flex-col gap-1">
                      <label htmlFor="allowWebSearch" className={`text-sm ${supportsWebSearch ? '' : 'text-muted-foreground'}`}>
                        Allow Web Search
                      </label>
                      {supportsWebSearch ? (
                        <p className="qt-text-xs">
                          Enable the LLM to search the web for real-time information when responding to queries
                        </p>
                      ) : (
                        <p className="qt-text-xs">
                          This provider does not support web search
                        </p>
                      )}
                    </div>
                  </div>
                )
              })()}
            </div>

            {/* OpenRouter-specific options */}
            {form.formData.provider === 'OPENROUTER' && (
              <div className="border border-border rounded-lg p-4 bg-muted/50">
                <h4 className="font-medium text-sm mb-3">OpenRouter Options</h4>

                {/* ZDR Toggle */}
                <div className="flex items-center gap-2 mb-4">
                  <input
                    type="checkbox"
                    id="enableZDR"
                    checked={form.formData.enableZDR}
                    onChange={(e) => form.setField('enableZDR', e.target.checked)}
                    className="w-4 h-4 rounded dark:bg-slate-800 dark:border-slate-600"
                  />
                  <div className="flex flex-col gap-1">
                    <label htmlFor="enableZDR" className="text-sm">
                      Enable Zero Data Retention (ZDR)
                    </label>
                    <p className="qt-text-xs">
                      When enabled, providers will not store or log your prompts and responses. May limit available providers.
                    </p>
                  </div>
                </div>

                {/* Custom Model Toggle */}
                <div className="flex items-center gap-2 mb-4">
                  <input
                    type="checkbox"
                    id="useCustomModel"
                    checked={form.formData.useCustomModel}
                    onChange={(e) => form.setField('useCustomModel', e.target.checked)}
                    className="w-4 h-4 rounded dark:bg-slate-800 dark:border-slate-600"
                  />
                  <div className="flex flex-col gap-1">
                    <label htmlFor="useCustomModel" className="text-sm">
                      Use Custom Model ID
                    </label>
                    <p className="qt-text-xs">
                      Enable this to enter an arbitrary model ID not in the fetched list. Use the &quot;Test Message&quot; button to verify the model works.
                    </p>
                  </div>
                </div>

                {/* Fallback Models */}
                {fetchedModels.length > 0 && (
                  <div className="mb-4">
                    <label className="block qt-text-label mb-2">Fallback Models (Optional, max 2)</label>
                    <p className="qt-text-xs mb-2">
                      If the primary model fails or is unavailable, OpenRouter will try these models in order.
                      OpenRouter supports up to 3 total models (1 primary + 2 fallbacks).
                    </p>
                    {form.formData.fallbackModels.length >= 2 && (
                      <p className="qt-text-xs text-amber-600 dark:text-amber-400 mb-2">
                        Maximum fallback models reached. Remove one to add a different model.
                      </p>
                    )}
                    <div className="space-y-1 max-h-32 overflow-y-auto border border-border rounded p-2 bg-background">
                      {fetchedModels
                        .filter(model => model !== form.formData.modelName)
                        .slice(0, 50)
                        .map(model => {
                          const isSelected = form.formData.fallbackModels.includes(model)
                          const isDisabled = !isSelected && form.formData.fallbackModels.length >= 2
                          return (
                            <label
                              key={model}
                              className={`flex items-center gap-2 p-1 rounded ${
                                isDisabled
                                  ? 'cursor-not-allowed opacity-50'
                                  : 'cursor-pointer hover:bg-muted'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                disabled={isDisabled}
                                onChange={(e) => {
                                  if (e.target.checked && form.formData.fallbackModels.length < 2) {
                                    form.setField('fallbackModels', [...form.formData.fallbackModels, model])
                                  } else if (!e.target.checked) {
                                    form.setField('fallbackModels', form.formData.fallbackModels.filter(m => m !== model))
                                  }
                                }}
                                className="w-3 h-3 rounded"
                              />
                              <span className="qt-text-xs text-foreground truncate">{model}</span>
                            </label>
                          )
                        })}
                    </div>
                    {form.formData.fallbackModels.length > 0 && (
                      <div className="mt-2">
                        <p className="qt-text-xs mb-1">
                          Selected fallbacks ({form.formData.fallbackModels.length}/2):
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {form.formData.fallbackModels.map((model, idx) => (
                            <span
                              key={model}
                              className="px-2 py-0.5 bg-primary/10 text-primary text-xs rounded flex items-center gap-1"
                            >
                              {idx + 1}. {model.split('/').pop()}
                              <button
                                type="button"
                                onClick={() => form.setField('fallbackModels', form.formData.fallbackModels.filter(m => m !== model))}
                                className="hover:text-destructive ml-1"
                              >
                                ×
                              </button>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Provider Order */}
                <div>
                  <label className="block qt-text-label mb-2">Provider Order (Optional)</label>
                  <p className="qt-text-xs mb-2">
                    Specify which infrastructure providers to prefer when routing requests.
                  </p>
                  <div className="grid grid-cols-3 gap-1 mb-2">
                    {['OpenAI', 'Anthropic', 'Google', 'Azure', 'AWS Bedrock', 'Together', 'Fireworks', 'DeepInfra', 'Cloudflare', 'Lepton']
                      .filter(p => !form.formData.providerOrder.includes(p))
                      .map(provider => (
                        <button
                          key={provider}
                          type="button"
                          onClick={() => form.setField('providerOrder', [...form.formData.providerOrder, provider])}
                          className="px-2 py-1 text-xs bg-muted text-foreground rounded hover:bg-accent text-left truncate"
                        >
                          + {provider}
                        </button>
                      ))}
                  </div>
                  {form.formData.providerOrder.length > 0 && (
                    <div className="space-y-1 border border-border rounded p-2 bg-background">
                      <p className="qt-text-label-xs mb-1">Priority order:</p>
                      {form.formData.providerOrder.map((provider, idx) => (
                        <div key={provider} className="flex items-center gap-2 bg-primary/5 rounded px-2 py-1">
                          <span className="qt-text-label-xs w-4">{idx + 1}.</span>
                          <span className="qt-text-xs flex-1">{provider}</span>
                          <button
                            type="button"
                            onClick={() => {
                              if (idx > 0) {
                                const newOrder = [...form.formData.providerOrder]
                                ;[newOrder[idx], newOrder[idx - 1]] = [newOrder[idx - 1], newOrder[idx]]
                                form.setField('providerOrder', newOrder)
                              }
                            }}
                            disabled={idx === 0}
                            className="px-1 text-xs disabled:opacity-30 hover:bg-muted rounded"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (idx < form.formData.providerOrder.length - 1) {
                                const newOrder = [...form.formData.providerOrder]
                                ;[newOrder[idx], newOrder[idx + 1]] = [newOrder[idx + 1], newOrder[idx]]
                                form.setField('providerOrder', newOrder)
                              }
                            }}
                            disabled={idx === form.formData.providerOrder.length - 1}
                            className="px-1 qt-text-xs disabled:opacity-30 hover:bg-muted rounded"
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            onClick={() => form.setField('providerOrder', form.formData.providerOrder.filter(p => p !== provider))}
                            className="px-1 qt-text-xs text-destructive hover:bg-destructive/10 rounded"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Anthropic-specific options */}
            {form.formData.provider === 'ANTHROPIC' && (
              <div className="border border-border rounded-lg p-4 bg-muted/50">
                <h4 className="font-medium text-sm mb-3">Anthropic Options</h4>

                {/* Cache Control */}
                <div className="flex items-center gap-2 mb-3">
                  <input
                    type="checkbox"
                    id="enableCacheBreakpoints"
                    checked={form.formData.enableCacheBreakpoints}
                    onChange={(e) => form.setField('enableCacheBreakpoints', e.target.checked)}
                    className="w-4 h-4 rounded dark:bg-slate-800 dark:border-slate-600"
                  />
                  <label htmlFor="enableCacheBreakpoints" className="text-sm">
                    Enable Prompt Caching
                  </label>
                </div>
                {form.formData.enableCacheBreakpoints && (
                  <div className="space-y-3 pl-6 mb-3">
                    {/* Cache Strategy */}
                    <div className="space-y-2">
                      <p className="qt-text-label-xs">Cache Strategy</p>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="cacheStrategy"
                          value="system_only"
                          checked={form.formData.cacheStrategy === 'system_only'}
                          onChange={(e) => form.setField('cacheStrategy', e.target.value as any)}
                          className="w-3 h-3"
                        />
                        <span className="text-sm">System message only</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="cacheStrategy"
                          value="system_and_long_context"
                          checked={form.formData.cacheStrategy === 'system_and_long_context'}
                          onChange={(e) => form.setField('cacheStrategy', e.target.value as any)}
                          className="w-3 h-3"
                        />
                        <span className="text-sm">System + tools + conversation (recommended)</span>
                      </label>
                    </div>

                    {/* Cache TTL */}
                    <div className="space-y-2">
                      <label htmlFor="cacheTTL" className="qt-text-label-xs">Cache Duration</label>
                      <select
                        id="cacheTTL"
                        value={form.formData.cacheTTL}
                        onChange={(e) => form.setField('cacheTTL', e.target.value as '5m' | '1h')}
                        className="qt-select text-sm"
                      >
                        <option value="5m">5 minutes (1.25x write cost)</option>
                        <option value="1h">1 hour (2x write cost)</option>
                      </select>
                      <p className="qt-text-xs">
                        Cache reads are 10% of base input cost. 5m is auto-refreshed on use.
                      </p>
                    </div>
                  </div>
                )}
                <p className="qt-text-xs">
                  Prompt caching can reduce costs by up to 90% for repeated context. Caches tools, system prompts, and conversation history.
                </p>
              </div>
            )}

            {/* Tag Editor (only show when editing existing profile) */}
            {editingId && (
              <div className="pt-4">
                <TagEditor entityType="profile" entityId={editingId} />
              </div>
            )}

            <div className="flex gap-3 pt-4 border-t border-border">
              <button
                type="submit"
                disabled={saveOp.loading}
                className="px-6 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground"
              >
                {saveOp.loading
                  ? 'Saving...'
                  : editingId
                    ? 'Update Profile'
                    : 'Create Profile'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowForm(false)
                  resetForm()
                }}
                className="px-6 py-2 bg-muted text-foreground rounded-lg hover:bg-accent"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
