'use client'

import { useEffect } from 'react'
import { useFormState } from '@/hooks/useFormState'
import { useAsyncOperation } from '@/hooks/useAsyncOperation'
import { fetchJson } from '@/lib/fetch-helpers'
import { useProvidersQuery } from '@/lib/hooks/use-profiles'
import { BaseModal } from '@/components/ui/BaseModal'
import { FormActions } from '@/components/ui/FormActions'
import ErrorAlert from '@/components/ui/ErrorAlert'
import { useAnnounceAssociations } from '@/hooks/useAutoAssociate'
import type { ProfileAssociation } from './types'
import { providerAcceptsApiKey, type ApiKeyConfigRequirements } from '@/lib/llm/api-key-support'

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
  /**
   * Provider to preselect when the modal opens (the per-provider card's Add
   * menu). Absent, the picker starts empty as it always has.
   */
  initialProvider?: string
}

interface ProviderOption {
  value: string
  label: string
}

interface KeyProviderRow {
  name: string
  displayName: string
  configRequirements?: ApiKeyConfigRequirements
}

const EMPTY_OPTIONS: ProviderOption[] = []

/**
 * Offered on "may this provider hold a key?", not "must it?" — the two
 * answers differ for OpenAI-Compatible, whose hosted endpoints need a bearer
 * token its local ones have no use for, and asking the stricter question left
 * no way to create such a key at all (Bug 81).
 */
function toKeyProviderOptions(rows: KeyProviderRow[]): ProviderOption[] {
  return rows
    .filter((p) => providerAcceptsApiKey(p.configRequirements))
    .map((p) => ({ value: p.name, label: p.displayName }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

export function ApiKeyModal({ isOpen, onClose, onSuccess, initialProvider }: ApiKeyModalProps) {
  // Providers that can hold an API key, from the shared providers list.
  const { data: providers = EMPTY_OPTIONS, isPending: providersLoading } = useProvidersQuery<
    KeyProviderRow,
    ProviderOption[]
  >({ select: toKeyProviderOptions })

  const form = useFormState<ApiKeyFormData>({
    label: '',
    provider: '',
    apiKey: '',
  })

  // Preselect the provider each time the modal opens with one. The form
  // persists across openings (it is reset on close), so this runs on the
  // open transition rather than at mount.
  const { setField } = form
  useEffect(() => {
    if (isOpen && initialProvider) {
      setField('provider', initialProvider)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- preselect only on the open transition; setField from useFormState is a fresh function every render
  }, [isOpen, initialProvider])

  const createKey = useAsyncOperation<ApiKeyResponse>()
  const announceAssociations = useAnnounceAssociations()

  const handleSubmit = async () => {
    const result = await createKey.execute(async () => {
      const response = await fetchJson<{ apiKey: ApiKeyResponse }>('/api/v1/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form.formData),
      })

      if (!response.ok) {
        throw new Error(response.error || 'Failed to create API key')
      }

      return response.data!.apiKey
    })

    if (result) {
      announceAssociations(result.associations)

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

  const isValid =
    !providersLoading &&
    form.formData.label.trim() &&
    form.formData.provider &&
    form.formData.apiKey.trim()

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
            disabled={providersLoading}
          >
            {providersLoading ? (
              <option value="">Loading providers...</option>
            ) : (
              <>
                <option value="">Select a provider</option>
                {providers.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </>
            )}
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
