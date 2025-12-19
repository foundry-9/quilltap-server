'use client'

import { useRef, useState } from 'react'
import { useFormState } from '@/hooks/useFormState'
import { useAsyncOperation } from '@/hooks/useAsyncOperation'
import { useClickOutside } from '@/hooks/useClickOutside'
import { fetchJson } from '@/lib/fetch-helpers'
import { clientLogger } from '@/lib/client-logger'
import { FormActions } from '@/components/ui/FormActions'
import ErrorAlert from '@/components/ui/ErrorAlert'

interface ApiKey {
  id: string
  provider: string
  label: string
  isActive: boolean
  lastUsed: string | null
  createdAt: string
  updatedAt: string
  keyPreview: string
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
  { value: 'GAB_AI', label: 'Gab AI' },
  { value: 'OLLAMA', label: 'Ollama' },
  { value: 'OPENROUTER', label: 'OpenRouter' },
  { value: 'OPENAI_COMPATIBLE', label: 'OpenAI Compatible' },
]

export function ApiKeyModal({ isOpen, onClose, onSuccess }: ApiKeyModalProps) {
  const modalRef = useRef<HTMLDivElement>(null)

  const form = useFormState<ApiKeyFormData>({
    label: '',
    provider: 'OPENAI',
    apiKey: '',
  })

  const createKey = useAsyncOperation<ApiKey>()

  useClickOutside(modalRef, onClose, {
    enabled: isOpen,
    onEscape: onClose,
  })

  const handleSubmit = async () => {
    clientLogger.debug('Creating API key', {
      provider: form.formData.provider,
    })

    const result = await createKey.execute(async () => {
      const response = await fetchJson<ApiKey>('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form.formData),
      })

      if (!response.ok) {
        throw new Error(response.error || 'Failed to create API key')
      }

      clientLogger.debug('API key created successfully', {
        id: response.data?.id,
      })
      return response.data!
    })

    if (result) {
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

  if (!isOpen) return null

  const isValid = form.formData.label.trim() && form.formData.apiKey.trim()

  return (
    <div className="qt-dialog-overlay">
      <div ref={modalRef} className="qt-dialog max-w-lg max-h-[80vh] flex flex-col">
        <div className="qt-dialog-header">
          <h2 className="qt-dialog-title">Add New API Key</h2>
        </div>

        <div className="qt-dialog-body flex-1 overflow-y-auto">
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
        </div>

        <div className="qt-dialog-footer">
          <FormActions
            onCancel={handleClose}
            onSubmit={handleSubmit}
            submitLabel={createKey.loading ? 'Creating...' : 'Create API Key'}
            isLoading={createKey.loading}
            isDisabled={!isValid}
          />
        </div>
      </div>
    </div>
  )
}

export default ApiKeyModal
