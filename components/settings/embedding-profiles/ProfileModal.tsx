'use client'

import { useFormState } from '@/hooks/useFormState'
import { useAsyncOperation } from '@/hooks/useAsyncOperation'
import { fetchJson } from '@/lib/fetch-helpers'
import { BaseModal } from '@/components/ui/BaseModal'
import { FormActions } from '@/components/ui/FormActions'
import { ErrorAlert } from '@/components/ui/ErrorAlert'
import type { ApiKey, EmbeddingModel, EmbeddingProfile, EmbeddingProfileFormData } from './types'

interface ProfileModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  profile?: EmbeddingProfile | null
  apiKeys: ApiKey[]
  embeddingModels: Record<string, EmbeddingModel[]>
}

export function ProfileModal({
  isOpen,
  onClose,
  onSuccess,
  profile,
  apiKeys,
  embeddingModels,
}: ProfileModalProps) {
  const {
    loading: formLoading,
    error: formError,
    execute: executeFormSubmit,
    clearError: clearFormError,
  } = useAsyncOperation<void>()

  const form = useFormState<EmbeddingProfileFormData>({
    name: profile?.name || '',
    provider: profile?.provider || ('OPENAI' as const),
    apiKeyId: profile?.apiKeyId || '',
    baseUrl: profile?.baseUrl || '',
    modelName: profile?.modelName || '',
    dimensions: profile?.dimensions?.toString() || '',
    isDefault: profile?.isDefault || false,
  })

  const handleModelSelect = (modelId: string) => {
    form.setField('modelName', modelId)
    // Auto-fill dimensions if we know them
    const models = embeddingModels[form.formData.provider] || []
    const model = models.find(m => m.id === modelId)
    if (model) {
      form.setField('dimensions', model.dimensions.toString())
    }
  }

  const handleSubmit = async () => {

    await executeFormSubmit(async () => {
      const payload = {
        name: form.formData.name,
        provider: form.formData.provider,
        apiKeyId: form.formData.apiKeyId || undefined,
        baseUrl: form.formData.baseUrl || undefined,
        modelName: form.formData.modelName,
        dimensions: form.formData.dimensions ? parseInt(form.formData.dimensions) : undefined,
        isDefault: form.formData.isDefault,
      }

      const url = profile?.id ? `/api/v1/embedding-profiles/${profile.id}` : '/api/v1/embedding-profiles'
      const method = profile?.id ? 'PUT' : 'POST'

      const result = await fetchJson(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!result.ok) {
        throw new Error(result.error || 'Failed to save profile')
      }

      onSuccess()
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
  }

  // Filter API keys for selected provider
  const filteredApiKeys = apiKeys.filter(key => {
    if (form.formData.provider === 'OPENAI') return key.provider === 'OPENAI'
    if (form.formData.provider === 'OLLAMA') return key.provider === 'OLLAMA'
    return false
  })

  const currentModels = embeddingModels[form.formData.provider] || []
  const isValid = form.formData.name.trim() && form.formData.modelName.trim()

  return (
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
                <option value="OPENAI">OpenAI</option>
                <option value="OLLAMA">Ollama (Local)</option>
              </select>
            </div>

            {/* API Key (for OpenAI) */}
            {form.formData.provider === 'OPENAI' && (
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
                  <p className="mt-1 qt-text-xs text-amber-600">
                    No OpenAI API keys found. Add one in the API Keys tab first.
                  </p>
                )}
              </div>
            )}

            {/* Base URL (for Ollama) */}
            {form.formData.provider === 'OLLAMA' && (
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
                  Leave empty for default Ollama URL (http://localhost:11434)
                </p>
              </div>
            )}

            {/* Model Selection */}
            <div>
              <label className="qt-label mb-1">
                Model *
              </label>
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
                        {model.name} ({model.dimensions} dims)
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
                  placeholder="text-embedding-3-small"
                />
              )}
            </div>

            {/* Dimensions (optional override) */}
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
  )
}

export default ProfileModal
