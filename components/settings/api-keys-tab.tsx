'use client'

import { useEffect, useState } from 'react'
import { useFormState } from '@/hooks/useFormState'
import { useAsyncOperation } from '@/hooks/useAsyncOperation'
import { fetchJson } from '@/lib/fetch-helpers'
import { getErrorMessage } from '@/lib/error-utils'
import { clientLogger } from '@/lib/client-logger'
import SectionHeader from '@/components/ui/SectionHeader'
import LoadingState from '@/components/ui/LoadingState'
import ErrorAlert from '@/components/ui/ErrorAlert'
import EmptyState from '@/components/ui/EmptyState'
import DeleteConfirmPopover from '@/components/ui/DeleteConfirmPopover'
import FormActions from '@/components/ui/FormActions'

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

export default function ApiKeysTab() {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [showForm, setShowForm] = useState(false)
  const [testingKeyId, setTestingKeyId] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<{ [key: string]: string }>({})
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  // Form state management
  const form = useFormState<ApiKeyFormData>({
    label: '',
    provider: 'OPENAI',
    apiKey: '',
  })

  // Load initial state
  const loadKeys = useAsyncOperation<ApiKey[]>()
  const createKey = useAsyncOperation<ApiKey>()
  const deleteKey = useAsyncOperation<void>()
  const testKey = useAsyncOperation<{ valid: boolean; error?: string }>()

  const fetchApiKeysData = async () => {
    clientLogger.debug('Fetching API keys')
    const result = await loadKeys.execute(async () => {
      const response = await fetchJson<ApiKey[]>('/api/keys', {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' },
      })

      if (!response.ok) {
        throw new Error(response.error || 'Failed to fetch API keys')
      }

      clientLogger.debug('API keys fetched successfully', {
        count: response.data?.length || 0,
      })
      return response.data || []
    })

    if (result) {
      setApiKeys(result)
    }
  }

  // Load API keys on mount
  useEffect(() => {
    clientLogger.debug('ApiKeysTab mounted, fetching API keys')
    fetchApiKeysData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
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
      setShowForm(false)
      await fetchApiKeysData()
    }
  }

  const handleDeleteClick = (id: string) => {
    clientLogger.debug('Delete confirmation requested for API key', { id })
    setDeleteConfirmId(id)
  }

  const handleDeleteCancel = () => {
    clientLogger.debug('Delete confirmation cancelled')
    setDeleteConfirmId(null)
  }

  const handleDeleteConfirm = async () => {
    if (!deleteConfirmId) return

    clientLogger.debug('Deleting API key', { id: deleteConfirmId })
    const result = await deleteKey.execute(async () => {
      const response = await fetchJson<void>(`/api/keys/${deleteConfirmId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error(response.error || 'Failed to delete API key')
      }

      clientLogger.debug('API key deleted successfully', { id: deleteConfirmId })
    })

    if (result !== null) {
      setDeleteConfirmId(null)
      await fetchApiKeysData()
    }
  }

  const handleTest = async (id: string) => {
    clientLogger.debug('Testing API key', { id })
    setTestingKeyId(id)
    setTestResults({})

    const result = await testKey.execute(async () => {
      const response = await fetchJson<{ valid: boolean; error?: string }>(
        `/api/keys/${id}/test`,
        { method: 'POST' }
      )

      if (!response.ok) {
        throw new Error(response.error || 'Failed to test API key')
      }

      return response.data || { valid: false }
    })

    if (result) {
      if (result.valid) {
        setTestResults({ [id]: '✓ Key is valid' })
        clientLogger.debug('API key test passed', { id })
      } else {
        setTestResults({ [id]: `✗ ${result.error || 'Key is invalid'}` })
        clientLogger.debug('API key test failed', { id, error: result.error })
      }
    } else {
      setTestResults({ [id]: 'Connection failed' })
      clientLogger.error('API key test connection failed', { id })
    }

    setTestingKeyId(null)
  }

  const handleCancel = () => {
    clientLogger.debug('Form cancelled')
    form.resetForm()
    setShowForm(false)
  }

  // Show loading state while fetching initial data
  if (loadKeys.loading && apiKeys.length === 0) {
    return <LoadingState message="Loading API keys..." />
  }

  const sortedKeys = apiKeys.toSorted((a, b) => a.label.localeCompare(b.label))

  return (
    <div>
      {/* Main error state */}
      {loadKeys.error && (
        <ErrorAlert
          message={loadKeys.error}
          onRetry={fetchApiKeysData}
          className="mb-4"
        />
      )}

      {/* Create key error state */}
      {createKey.error && (
        <ErrorAlert
          message={createKey.error}
          className="mb-4"
        />
      )}

      {/* Delete key error state */}
      {deleteKey.error && (
        <ErrorAlert
          message={deleteKey.error}
          className="mb-4"
        />
      )}

      {/* API Keys List */}
      <div className="mb-8">
        <SectionHeader
          title="Your API Keys"
          count={sortedKeys.length}
          action={{
            label: '+ Add API Key',
            onClick: () => {
              clientLogger.debug('Add API key form opened')
              setShowForm(true)
            },
            show: !showForm,
          }}
          level="h2"
        />

        {sortedKeys.length === 0 ? (
          <EmptyState
            title="No API keys yet"
            description="Add one to get started."
            action={{
              label: 'Add API Key',
              onClick: () => {
                clientLogger.debug('Add API key from empty state')
                setShowForm(true)
              },
            }}
          />
        ) : (
          <div className="space-y-3">
            {sortedKeys.map((key) => (
              <div
                key={key.id}
                className="relative border border-border rounded-lg p-4 flex items-center justify-between bg-card hover:bg-accent/50"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <div>
                      <p className="qt-text-primary">{key.label}</p>
                      <p className="qt-text-small">
                        {key.provider} • {key.keyPreview}
                      </p>
                      {key.lastUsed && (
                        <p className="qt-text-xs">
                          Last used:{' '}
                          {new Date(key.lastUsed).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                  </div>
                  {testResults[key.id] && (
                    <p
                      className={`text-sm mt-2 ${
                        testResults[key.id].startsWith('✓')
                          ? 'text-green-600'
                          : 'text-destructive/80'
                      }`}
                    >
                      {testResults[key.id]}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleTest(key.id)}
                    disabled={testingKeyId === key.id}
                    className="px-3 py-1 text-sm bg-muted text-foreground rounded hover:bg-accent disabled:bg-muted"
                  >
                    {testingKeyId === key.id ? 'Testing...' : 'Test'}
                  </button>
                  <button
                    onClick={() => handleDeleteClick(key.id)}
                    className="px-3 py-1 text-sm bg-destructive/10 text-destructive rounded hover:bg-destructive/20"
                  >
                    Delete
                  </button>

                  {/* Delete confirmation popover */}
                  <DeleteConfirmPopover
                    isOpen={deleteConfirmId === key.id}
                    onCancel={handleDeleteCancel}
                    onConfirm={handleDeleteConfirm}
                    message="Delete this API key?"
                    isDeleting={deleteKey.loading}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add API Key Form */}
      {showForm && (
        <div className="bg-muted border border-border rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-4">Add New API Key</h3>
          <form onSubmit={handleSubmit} className="space-y-4">
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
                required
                className="qt-input"
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
                <option value="OPENAI">OpenAI</option>
                <option value="ANTHROPIC">Anthropic</option>
                <option value="GROK">Grok</option>
                <option value="GOOGLE">Google</option>
                <option value="GAB_AI">Gab AI</option>
                <option value="OLLAMA">Ollama</option>
                <option value="OPENROUTER">OpenRouter</option>
                <option value="OPENAI_COMPATIBLE">OpenAI Compatible</option>
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
                required
                className="qt-input"
              />
              <p className="qt-text-xs mt-1">Your key is encrypted and never exposed</p>
            </div>

            <FormActions
              onCancel={handleCancel}
              submitLabel={createKey.loading ? 'Creating...' : 'Create API Key'}
              isLoading={createKey.loading}
              type="submit"
            />
          </form>
        </div>
      )}
    </div>
  )
}
