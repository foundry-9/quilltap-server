'use client'

import { useState, useId } from 'react'
import { useFormState } from '@/hooks/useFormState'
import { useAsyncOperation } from '@/hooks/useAsyncOperation'
import { fetchJson } from '@/lib/fetch-helpers'
import { BaseModal } from '@/components/ui/BaseModal'
import { FormActions } from '@/components/ui/FormActions'
import { ErrorAlert } from '@/components/ui/ErrorAlert'
import { notifyQueueChange } from '@/components/layout/queue-status-badges'
import { showInfoToast } from '@/lib/toast'
import type { ApiKey, EmbeddingModel, EmbeddingProfile, EmbeddingProfileFormData } from './types'
import type { EmbeddingProviderInfo } from './hooks/useEmbeddingProfiles'

interface ProfileModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  profile?: EmbeddingProfile | null
  apiKeys: ApiKey[]
  embeddingModels: Record<string, EmbeddingModel[]>
  embeddingProviders: EmbeddingProviderInfo[]
  /**
   * Provider to preselect on a new profile (the per-provider card's Add menu);
   * honoured only when it is one of `embeddingProviders`. Ignored when editing.
   */
  initialProvider?: string
}

export function ProfileModal({
  isOpen,
  onClose,
  onSuccess,
  profile,
  apiKeys,
  embeddingModels,
  embeddingProviders,
  initialProvider,
}: ProfileModalProps) {
  const id = useId()
  const {
    loading: formLoading,
    error: formError,
    execute: executeFormSubmit,
    clearError: clearFormError,
  } = useAsyncOperation<void>()

  const [fetchedModels, setFetchedModels] = useState<EmbeddingModel[]>([])
  // The provider the fetched list belongs to, so it is never offered for another
  const [fetchedModelsProvider, setFetchedModelsProvider] = useState<string | null>(null)
  const [fetchingModels, setFetchingModels] = useState(false)
  const [fetchModelsError, setFetchModelsError] = useState<string | null>(null)

  // Default to first available provider or 'BUILTIN'
  const defaultProvider = embeddingProviders[0]?.name || 'BUILTIN'
  const presetProvider = embeddingProviders.find((p) => p.name === initialProvider)?.name
  const presetKeys = presetProvider ? apiKeys.filter((k) => k.provider === presetProvider) : []

  const form = useFormState<EmbeddingProfileFormData>({
    name: profile?.name || '',
    provider: profile?.provider || presetProvider || defaultProvider,
    apiKeyId: profile?.apiKeyId || (presetKeys.length === 1 ? presetKeys[0].id : ''),
    baseUrl: profile?.baseUrl || '',
    modelName: profile?.modelName || '',
    dimensions: profile?.dimensions?.toString() || '',
    isDefault: profile?.isDefault || false,
  })

  const handleModelSelect = (modelId: string) => {
    form.setField('modelName', modelId)
    // Auto-fill dimensions if we know them from static or fetched models
    const staticModel = (embeddingModels[form.formData.provider] || []).find(m => m.id === modelId)
    const fetchedModel = fetchedModels.find(m => m.id === modelId)
    const dims = staticModel?.dimensions || fetchedModel?.dimensions
    if (dims) {
      form.setField('dimensions', dims.toString())
    }
  }

  const handleSubmit = async () => {
    // Track whether this save is newly setting the profile as default
    const isNewlyDefault = !profile?.isDefault && form.formData.isDefault

    await executeFormSubmit(async () => {
      // For BUILTIN provider, set default model name
      const modelName = form.formData.provider === 'BUILTIN'
        ? 'tfidf-bm25-v1'
        : form.formData.modelName

      const payload = {
        name: form.formData.name,
        provider: form.formData.provider,
        // `null`, never `undefined`: JSON drops an undefined key, and an
        // absent key on an edit means "leave it" — so a cleared field must be
        // sent as null to be cleared.
        apiKeyId: form.formData.apiKeyId || null,
        baseUrl: form.formData.baseUrl || null,
        modelName,
        dimensions: form.formData.dimensions ? parseInt(form.formData.dimensions, 10) : null,
        isDefault: form.formData.isDefault,
      }

      const url = profile?.id ? `/api/v1/embedding-profiles/${profile.id}` : '/api/v1/embedding-profiles'
      const method = profile?.id ? 'PUT' : 'POST'

      const result = await fetchJson<{ id: string; reembeddingTriggered?: boolean }>(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!result.ok) {
        throw new Error(result.error || 'Failed to save profile')
      }

      onSuccess()

      // A save that makes this the default has already queued the re-embed on
      // the server (create and update alike). Say so and refresh the queue
      // badges; never queue a second one from here (#258).
      if (isNewlyDefault || result.data?.reembeddingTriggered) {
        notifyQueueChange()
        showInfoToast(
          'Re-embedding has begun with the new default profile. Help documentation goes first, then memories and conversations; the Emb badge in the header shows its progress.',
        )
      }
      handleClose()
    })
  }

  const handleClose = () => {
    clearFormError()
    form.resetForm()
    onClose()
  }

  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    form.handleChange(e)
    form.setField('apiKeyId', '')
    form.setField('modelName', '')
    form.setField('dimensions', '')
    setFetchedModels([])
    setFetchedModelsProvider(null)
    setFetchModelsError(null)
  }

  const handleFetchModels = async () => {
    setFetchingModels(true)
    setFetchModelsError(null)
    const provider = form.formData.provider
    try {
      const baseUrl = form.formData.baseUrl || undefined
      const params = new URLSearchParams({
        action: 'fetch-models',
        provider: form.formData.provider,
      })
      if (baseUrl) params.set('baseUrl', baseUrl)

      const result = await fetchJson<{ models: EmbeddingModel[] }>(
        `/api/v1/embedding-profiles?${params.toString()}`
      )
      if (result.ok && result.data?.models) {
        setFetchedModels(result.data.models)
        setFetchedModelsProvider(provider)
      } else if (!result.ok) {
        setFetchModelsError(result.error || 'Models could not be fetched')
      }
    } finally {
      setFetchingModels(false)
    }
  }

  // Get current provider info
  const currentProviderInfo = embeddingProviders.find(p => p.name === form.formData.provider)

  // Filter API keys for selected provider
  const filteredApiKeys = apiKeys.filter(key => key.provider === form.formData.provider)

  // Determine what the current provider needs
  const isBuiltin = form.formData.provider === 'BUILTIN'
  const needsApiKey = currentProviderInfo?.requiresApiKey ?? false
  const needsBaseUrl = currentProviderInfo?.requiresBaseUrl ?? false

  const staticModels = embeddingModels[form.formData.provider] || []
  // Merge fetched models with static models, preferring fetched (they're installed)
  const fetchedForProvider = fetchedModelsProvider === form.formData.provider ? fetchedModels : []
  const currentModels = fetchedForProvider.length > 0
    ? [
        ...fetchedForProvider,
        // Add static models not in the fetched list (as suggestions)
        ...staticModels.filter(s => !fetchedForProvider.some(f => f.id === s.id)),
      ]
    : staticModels
  const canFetchModels = needsBaseUrl // Ollama-style providers with a base URL
  // BUILTIN doesn't require a model name (it's auto-set)
  const isValid = form.formData.name.trim() && (isBuiltin || form.formData.modelName.trim())

  return (
    <>
    <BaseModal
      isOpen={isOpen}
      onClose={handleClose}
      title={profile?.id ? 'Edit Embedding Profile' : 'Create Embedding Profile'}
      footer={
        <FormActions
          onCancel={handleClose}
          onSubmit={handleSubmit}
          submitLabel={profile?.id ? 'Update Profile' : 'Create Profile'}
          isLoading={formLoading}
          isDisabled={!isValid}
        />
      }
    >
      {formError && (
        <ErrorAlert message={formError} className="mb-4" />
      )}

      <div className="space-y-4">
            {/* Name */}
            <div>
              <label className="qt-label mb-1" htmlFor={`${id}-name`}>
                Profile Name *
              </label>
              <input
                id={`${id}-name`}
                type="text"
                name="name"
                value={form.formData.name}
                onChange={form.handleChange}
                className="qt-input"
                placeholder="My OpenAI Embeddings"
                autoFocus
              />
            </div>

            {/* Provider */}
            <div>
              <label className="qt-label mb-1" htmlFor={`${id}-provider`}>
                Provider *
              </label>
              <select
                id={`${id}-provider`}
                name="provider"
                value={form.formData.provider}
                onChange={handleProviderChange}
                className="qt-select"
              >
                {embeddingProviders.map(provider => (
                  <option key={provider.name} value={provider.name}>
                    {provider.displayName}
                  </option>
                ))}
              </select>
              {currentProviderInfo?.description && (
                <p className="mt-1 qt-text-xs qt-text-warning">
                  {currentProviderInfo.description}
                </p>
              )}
            </div>

            {/* API Key (for providers that need it) */}
            {needsApiKey && (
              <div>
                <label className="qt-label mb-1" htmlFor={`${id}-api-key`}>
                  API Key
                </label>
                <select
                  id={`${id}-api-key`}
                  name="apiKeyId"
                  value={form.formData.apiKeyId}
                  onChange={form.handleChange}
                  className="qt-select"
                >
                  <option value="">Select API Key...</option>
                  {filteredApiKeys.map(key => (
                    <option key={key.id} value={key.id}>
                      {key.label}
                    </option>
                  ))}
                </select>
                {filteredApiKeys.length === 0 && (
                  <p className="mt-1 qt-text-xs qt-text-secondary">
                    No {form.formData.provider} API keys found. Add one in the API Keys tab first.
                  </p>
                )}
              </div>
            )}

            {/* Base URL (for providers that need it) */}
            {needsBaseUrl && (
              <div>
                <label className="qt-label mb-1" htmlFor={`${id}-base-url`}>
                  Base URL
                </label>
                <input
                  id={`${id}-base-url`}
                  type="text"
                  name="baseUrl"
                  value={form.formData.baseUrl}
                  onChange={form.handleChange}
                  className="qt-input"
                  placeholder="http://localhost:11434"
                />
                <p className="mt-1 qt-text-xs">
                  Leave empty for default URL
                </p>
              </div>
            )}

            {/* Model Selection - not needed for BUILTIN */}
            {!isBuiltin && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="qt-label" htmlFor={`${id}-model`}>
                    Model *
                  </label>
                  {canFetchModels && (
                    <button
                      type="button"
                      onClick={handleFetchModels}
                      disabled={fetchingModels}
                      className="qt-button-ghost qt-button-sm"
                    >
                      {fetchingModels ? (
                        <span className="flex items-center gap-1">
                          <span className="qt-spinner-sm" />
                          Fetching...
                        </span>
                      ) : (
                        'Fetch Installed Models'
                      )}
                    </button>
                  )}
                </div>
                {fetchModelsError && (
                  <div role="alert" className="qt-alert-error mb-2">
                    {fetchModelsError}
                  </div>
                )}
                {currentModels.length > 0 ? (
                  <div className="space-y-2">
                    <select
                      id={`${id}-model`}
                      value={form.formData.modelName}
                      onChange={e => handleModelSelect(e.target.value)}
                      className="qt-select"
                    >
                      <option value="">Select a model...</option>
                      {currentModels.map(model => (
                        <option key={model.id} value={model.id}>
                          {model.name}{model.dimensions ? ` (${model.dimensions} dims)` : ''}
                        </option>
                      ))}
                    </select>
                    {form.formData.modelName && (
                      <p className="qt-text-xs">
                        {currentModels.find(m => m.id === form.formData.modelName)?.description}
                      </p>
                    )}
                  </div>
                ) : (
                  <input
                    id={`${id}-model`}
                    type="text"
                    name="modelName"
                    value={form.formData.modelName}
                    onChange={form.handleChange}
                    className="qt-input"
                    placeholder={canFetchModels ? 'nomic-embed-text' : 'text-embedding-3-small'}
                  />
                )}
              </div>
            )}

            {/* Dimensions (optional override) - not needed for BUILTIN */}
            {!isBuiltin && (
              <div>
                <label className="qt-label mb-1" htmlFor={`${id}-dimensions`}>
                  Dimensions (optional)
                </label>
                <input
                  id={`${id}-dimensions`}
                  type="text"
                  name="dimensions"
                  value={form.formData.dimensions}
                  onChange={form.handleChange}
                  className="qt-input"
                  placeholder="1536"
                />
                <p className="mt-1 qt-text-xs">
                  Leave empty to use the model&apos;s default dimensions
                </p>
              </div>
            )}

        {/* Default */}
        <div className="flex items-center">
          <input
            type="checkbox"
            id="isDefault"
            name="isDefault"
            checked={form.formData.isDefault}
            onChange={form.handleChange}
            className="qt-checkbox"
          />
          <label htmlFor="isDefault" className="ml-2 block qt-text-label qt-text">
            Set as default embedding profile
          </label>
        </div>
      </div>
    </BaseModal>
    </>
  )
}

export default ProfileModal
