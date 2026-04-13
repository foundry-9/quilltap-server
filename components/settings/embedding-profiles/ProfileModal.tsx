'use client'

import { useState } from 'react'
import { useFormState } from '@/hooks/useFormState'
import { useAsyncOperation } from '@/hooks/useAsyncOperation'
import { fetchJson } from '@/lib/fetch-helpers'
import { BaseModal } from '@/components/ui/BaseModal'
import { FormActions } from '@/components/ui/FormActions'
import { ErrorAlert } from '@/components/ui/ErrorAlert'
import { notifyQueueChange } from '@/components/layout/queue-status-badges'
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
}

export function ProfileModal({
  isOpen,
  onClose,
  onSuccess,
  profile,
  apiKeys,
  embeddingModels,
  embeddingProviders,
}: ProfileModalProps) {
  const {
    loading: formLoading,
    error: formError,
    execute: executeFormSubmit,
    clearError: clearFormError,
  } = useAsyncOperation<void>()

  const [showReembedDialog, setShowReembedDialog] = useState(false)
  const [reembedProfileId, setReembedProfileId] = useState<string | null>(null)
  const [reembedLoading, setReembedLoading] = useState(false)
  const [fetchedModels, setFetchedModels] = useState<EmbeddingModel[]>([])
  const [fetchingModels, setFetchingModels] = useState(false)

  // Default to first available provider or 'BUILTIN'
  const defaultProvider = embeddingProviders[0]?.name || 'BUILTIN'

  const form = useFormState<EmbeddingProfileFormData>({
    name: profile?.name || '',
    provider: profile?.provider || defaultProvider,
    apiKeyId: profile?.apiKeyId || '',
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
        apiKeyId: form.formData.apiKeyId || undefined,
        baseUrl: form.formData.baseUrl || undefined,
        modelName,
        dimensions: form.formData.dimensions ? parseInt(form.formData.dimensions) : undefined,
        isDefault: form.formData.isDefault,
      }

      const url = profile?.id ? `/api/v1/embedding-profiles/${profile.id}` : '/api/v1/embedding-profiles'
      const method = profile?.id ? 'PUT' : 'POST'

      const result = await fetchJson<{ id: string }>(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!result.ok) {
        throw new Error(result.error || 'Failed to save profile')
      }

      onSuccess()

      // If newly set as default, prompt to re-embed before closing
      if (isNewlyDefault && result.data?.id) {
        setReembedProfileId(result.data.id)
        setShowReembedDialog(true)
      } else {
        handleClose()
      }
    })
  }

  const handleReembedConfirm = async () => {
    if (!reembedProfileId) return
    setReembedLoading(true)
    try {
      await fetchJson(`/api/v1/embedding-profiles/${reembedProfileId}?action=reindex`, {
        method: 'POST',
      })
      notifyQueueChange()
    } finally {
      setReembedLoading(false)
      setShowReembedDialog(false)
      setReembedProfileId(null)
      handleClose()
    }
  }

  const handleReembedDecline = () => {
    setShowReembedDialog(false)
    setReembedProfileId(null)
    handleClose()
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
  }

  const handleFetchModels = async () => {
    setFetchingModels(true)
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
  const currentModels = fetchedModels.length > 0
    ? [
        ...fetchedModels,
        // Add static models not in the fetched list (as suggestions)
        ...staticModels.filter(s => !fetchedModels.some(f => f.id === s.id)),
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
              <label className="qt-label mb-1">
                Profile Name *
              </label>
              <input
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
              <label className="qt-label mb-1">
                Provider *
              </label>
              <select
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
                <label className="qt-label mb-1">
                  API Key
                </label>
                <select
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
                <label className="qt-label mb-1">
                  Base URL
                </label>
                <input
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
                  <label className="qt-label">
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
                {currentModels.length > 0 ? (
                  <div className="space-y-2">
                    <select
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
                <label className="qt-label mb-1">
                  Dimensions (optional)
                </label>
                <input
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
            className="h-4 w-4 text-primary focus:ring-ring border-input rounded"
          />
          <label htmlFor="isDefault" className="ml-2 block qt-text-label text-foreground">
            Set as default embedding profile
          </label>
        </div>
      </div>
    </BaseModal>

    <BaseModal
      isOpen={showReembedDialog}
      onClose={handleReembedDecline}
      title="Re-embed Everything?"
      maxWidth="md"
      footer={
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={handleReembedDecline}
            disabled={reembedLoading}
            className="qt-button-secondary"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={handleReembedConfirm}
            disabled={reembedLoading}
            className="qt-button-primary"
          >
            {reembedLoading ? (
              <span className="flex items-center gap-2">
                <span className="qt-spinner-sm" />
                Queuing...
              </span>
            ) : (
              'Re-embed Everything'
            )}
          </button>
        </div>
      }
    >
      <p className="text-foreground">
        You&apos;ve switched the default embedding profile. All existing
        embeddings were created with a different model and need to be
        regenerated — this includes help documentation, character memories,
        and conversation history.
      </p>
      <p className="mt-3 qt-text-secondary qt-text-small">
        Help documentation will be embedded first, followed by character
        memories and conversation history. You can track progress via the
        Emb badge in the header.
      </p>
    </BaseModal>
    </>
  )
}

export default ProfileModal
