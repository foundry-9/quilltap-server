'use client'

import { useFormState } from '@/hooks/useFormState'
import { useAsyncOperation } from '@/hooks/useAsyncOperation'
import { fetchJson } from '@/lib/fetch-helpers'
import { clientLogger } from '@/lib/client-logger'
import { BaseModal } from '@/components/ui/BaseModal'
import { FormActions } from '@/components/ui/FormActions'
import ErrorAlert from '@/components/ui/ErrorAlert'
import { showSuccessToast } from '@/lib/toast'
import type { ProfileAssociation } from './types'

interface ApiKeyResponse {
  id: string
  provider: string
  label: string
  isActive: boolean
  lastUsed: string | null
  createdAt: string
  updatedAt: string
  keyPreview?: string
  associations?: ProfileAssociation[]
}

interface ApiKeyFormData {
  label: string
  provider: string
  apiKey: string
}

interface ApiKeyModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

const PROVIDERS = [
  { value: 'OPENAI', label: 'OpenAI' },
  { value: 'ANTHROPIC', label: 'Anthropic' },
  { value: 'GROK', label: 'Grok' },
  { value: 'GOOGLE', label: 'Google' },
  { value: 'OLLAMA', label: 'Ollama' },
  { value: 'OPENROUTER', label: 'OpenRouter' },
  { value: 'OPENAI_COMPATIBLE', label: 'OpenAI Compatible' },
]

export function ApiKeyModal({ isOpen, onClose, onSuccess }: ApiKeyModalProps) {
  const form = useFormState<ApiKeyFormData>({
    label: '',
    provider: 'OPENAI',
    apiKey: '',
  })

  const createKey = useAsyncOperation<ApiKeyResponse>()

  const handleSubmit = async () => {
    clientLogger.debug('Creating API key', {
      provider: form.formData.provider,
    })

    const result = await createKey.execute(async () => {
      const response = await fetchJson<ApiKeyResponse>('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form.formData),
      })

      if (!response.ok) {
        throw new Error(response.error || 'Failed to create API key')
      }

      clientLogger.debug('API key created successfully', {
        id: response.data?.id,
        associations: response.data?.associations?.length || 0,
      })
      return response.data!
    })

    if (result) {
      // Show toasts for any auto-associations
      if (result.associations && result.associations.length > 0) {
        result.associations.forEach((assoc) => {
          showSuccessToast(
            `${assoc.profileName} linked to API key "${result.label}"`,
            4000
          )
        })
      }

      form.resetForm()
      onSuccess()
      onClose()
    }
  }

  const handleClose = () => {
    form.resetForm()
    createKey.clearError()
    onClose()
  }

  const isValid = form.formData.label.trim() && form.formData.apiKey.trim()

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={handleClose}
      title="Add New API Key"
      footer={
        <FormActions
          onCancel={handleClose}
          onSubmit={handleSubmit}
          submitLabel={createKey.loading ? 'Creating...' : 'Create API Key'}
          isLoading={createKey.loading}
          isDisabled={!isValid}
        />
      }
    >
      {createKey.error && (
        <ErrorAlert message={createKey.error} className="mb-4" />
      )}

      <div className="space-y-4">
        <div>
          <label htmlFor="label" className="block qt-text-label mb-2">
            Label *
          </label>
          <input
            type="text"
            id="label"
            name="label"
            value={form.formData.label}
            onChange={form.handleChange}
            placeholder="e.g., My OpenAI Key"
            className="qt-input"
            autoFocus
          />
          <p className="qt-text-xs mt-1">A friendly name to identify this key</p>
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
            {PROVIDERS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="apiKey" className="block qt-text-label mb-2">
            API Key *
          </label>
          <input
            type="password"
            id="apiKey"
            name="apiKey"
            value={form.formData.apiKey}
            onChange={form.handleChange}
            placeholder="Your API key (will be encrypted)"
            className="qt-input"
          />
          <p className="qt-text-xs mt-1">Your key is encrypted and never exposed</p>
        </div>
      </div>
    </BaseModal>
  )
}

export default ApiKeyModal
