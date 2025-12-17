'use client'

import { useState, useEffect, useCallback } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { fetchJson } from '@/lib/fetch-helpers'
import { getErrorMessage } from '@/lib/error-utils'
import { LoadingState } from '@/components/ui/LoadingState'
import { ErrorAlert } from '@/components/ui/ErrorAlert'
import { ProfileList } from './ProfileList'
import { ProfileForm } from './ProfileForm'
import { useConnectionProfiles } from './hooks/useConnectionProfiles'
import { useProfileForm } from './hooks/useProfileForm'
import type { ConnectionProfile } from './types'
import type { ModelInfo } from '../model-selector'

// Re-export for barrel exports
export { ProfileForm } from './ProfileForm'
export { ProfileList } from './ProfileList'
export { ProfileCard } from './ProfileCard'
export { useConnectionProfiles, useProfileForm } from './hooks'
export type {
  ApiKey,
  Tag,
  ProviderConfig,
  ConnectionProfile,
  ProfileFormData,
} from './types'
export { initialFormState } from './types'

/**
 * Main connection profiles component
 * Orchestrates profile list, form, and all operations
 */
export default function ConnectionProfilesTab() {
  // Profile and UI state management
  const {
    profiles,
    apiKeys,
    providers,
    cheapDefaultProfileId,
    fetchOp,
    deleteOp,
    fetchProfiles,
    fetchApiKeys,
    fetchProviders,
    fetchChatSettings,
    handleDelete,
  } = useConnectionProfiles()

  // Form state and operations
  const {
    form,
    saveOp,
    connectOp,
    fetchModelsOp,
    testMessageOp,
    getProviderRequirements,
    resetForm,
    loadProfileIntoForm,
    handleConnect,
    handleFetchModels,
    handleTestMessage,
    handleSubmit,
  } = useProfileForm(providers)

  // Additional UI state
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteConfirming, setDeleteConfirming] = useState<string | null>(null)

  // Connection testing states
  const [isConnected, setIsConnected] = useState(false)
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null)

  // Fetch models states
  const [fetchedModels, setFetchedModels] = useState<string[]>([])
  const [fetchedModelsWithInfo, setFetchedModelsWithInfo] = useState<ModelInfo[]>([])
  const [modelsMessage, setModelsMessage] = useState<string | null>(null)

  // Test message states
  const [testMessageResult, setTestMessageResult] = useState<string | null>(null)

  // Initialize data on mount - only run once
  useEffect(() => {
    fetchProfiles()
    fetchApiKeys()
    fetchProviders()
    fetchChatSettings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleResetForm = useCallback(() => {
    resetForm()
    setEditingId(null)
    // Reset connection states
    setIsConnected(false)
    setConnectionMessage(null)
    setFetchedModels([])
    setModelsMessage(null)
    setTestMessageResult(null)
  }, [resetForm])

  const handleEdit = useCallback(
    async (profile: ConnectionProfile) => {
      loadProfileIntoForm(profile)
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
    },
    [loadProfileIntoForm]
  )

  const handleAddClick = useCallback(() => {
    handleResetForm()
    setShowForm(true)
    setTimeout(() => {
      const formElement = document.getElementById('profile-form')
      if (formElement) {
        formElement.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }, 0)
  }, [handleResetForm])

  const handleFormSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      const result = await handleSubmit(editingId, () => {
        handleResetForm()
        setShowForm(false)
        fetchProfiles()
        fetchApiKeys()
      })

      if (result) {
        return result
      }
    },
    [editingId, handleSubmit, handleResetForm, fetchProfiles, fetchApiKeys]
  )

  const handleConnectClick = useCallback(async () => {
    const result = await handleConnect((data) => {
      setIsConnected(true)
      setConnectionMessage(data.message || 'Connection successful!')
    })

    if (!result) {
      setIsConnected(false)
      setConnectionMessage(null)
    }
  }, [handleConnect])

  const handleFetchModelsClick = useCallback(async () => {
    const result = await handleFetchModels((data) => {
      setFetchedModels(data.models || [])
      setFetchedModelsWithInfo(data.modelsWithInfo || [])
      setModelsMessage(`Found ${data.models?.length || 0} models`)
    })

    if (!result) {
      setFetchedModels([])
      setModelsMessage(null)
    }
  }, [handleFetchModels])

  const handleTestMessageClick = useCallback(async () => {
    const result = await handleTestMessage((data) => {
      setTestMessageResult(data.message || 'Test message sent successfully!')
    })

    if (!result) {
      setTestMessageResult(null)
    }
  }, [handleTestMessage])

  const handleDeleteClick = useCallback(
    async (profileId: string) => {
      await handleDelete(profileId)
      setDeleteConfirming(null)
    },
    [handleDelete]
  )

  // Helper to get the selected model's info (including maxOutputTokens)
  const getSelectedModelInfo = useCallback(() => {
    if (!form.formData.modelName || fetchedModelsWithInfo.length === 0) return null
    return fetchedModelsWithInfo.find((m) => m.id === form.formData.modelName) || null
  }, [form.formData.modelName, fetchedModelsWithInfo])

  // Get max tokens limit for the selected model (default to 128000 if not known)
  const getMaxTokensLimit = useCallback(() => {
    const modelInfo = getSelectedModelInfo()
    // Use model's maxOutputTokens if known, otherwise default to 128000
    return modelInfo?.maxOutputTokens || 128000
  }, [getSelectedModelInfo])

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
          <p className="qt-text-small">
            Add an API key in the &quot;API Keys&quot; tab before creating a connection profile.
          </p>
        </div>
      )}

      {/* Profiles List */}
      <ProfileList
        profiles={profiles}
        cheapDefaultProfileId={cheapDefaultProfileId}
        showForm={showForm}
        deleteConfirming={deleteConfirming}
        isDeleting={deleteOp.loading}
        onEdit={handleEdit}
        onDelete={handleDeleteClick}
        onDeleteConfirmChange={setDeleteConfirming}
        onAddClick={handleAddClick}
      />

      {/* Add/Edit Profile Form */}
      {showForm && (
        <ProfileForm
          editingId={editingId}
          formData={form.formData}
          onFormChange={(name, value) => {
            form.setField(name as keyof typeof form.formData, value)
          }}
          onFormSetField={(name, value) => {
            form.setField(name as keyof typeof form.formData, value)
          }}
          apiKeys={apiKeys}
          providers={providers}
          fetchedModels={fetchedModels}
          fetchedModelsWithInfo={fetchedModelsWithInfo}
          connectionMessage={connectionMessage}
          modelsMessage={modelsMessage}
          testMessageResult={testMessageResult}
          isConnected={isConnected}
          isConnecting={connectOp.loading}
          isFetchingModels={fetchModelsOp.loading}
          isTestingMessage={testMessageOp.loading}
          isSaving={saveOp.loading}
          onConnect={handleConnectClick}
          onFetchModels={handleFetchModelsClick}
          onTestMessage={handleTestMessageClick}
          onSubmit={handleFormSubmit}
          onCancel={() => {
            setShowForm(false)
            handleResetForm()
          }}
          getProviderRequirements={getProviderRequirements}
          getSelectedModelInfo={getSelectedModelInfo}
          getMaxTokensLimit={getMaxTokensLimit}
          getModelSuggestions={getModelSuggestions}
        />
      )}
    </div>
  )
}
