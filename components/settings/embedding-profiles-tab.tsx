'use client'

import { useEffect, useState } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { useFormState } from '@/hooks/useFormState'
import { useAsyncOperation } from '@/hooks/useAsyncOperation'
import { fetchJson } from '@/lib/fetch-helpers'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { LoadingState } from '@/components/ui/LoadingState'
import { ErrorAlert } from '@/components/ui/ErrorAlert'
import { EmptyState } from '@/components/ui/EmptyState'
import { DeleteConfirmPopover } from '@/components/ui/DeleteConfirmPopover'
import { FormActions } from '@/components/ui/FormActions'

interface ApiKey {
  id: string
  label: string
  provider: string
  isActive: boolean
}

interface EmbeddingModel {
  id: string
  name: string
  dimensions: number
  description: string
}

interface EmbeddingProfile {
  id: string
  name: string
  provider: 'OPENAI' | 'OLLAMA'
  apiKeyId?: string
  baseUrl?: string
  modelName: string
  dimensions?: number
  isDefault: boolean
  apiKey?: ApiKey | null
}

const PROVIDER_COLORS: Record<string, string> = {
  OPENAI: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
  OLLAMA: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
}

function ProviderBadge({ provider }: { provider: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${PROVIDER_COLORS[provider] || 'bg-muted text-foreground'}`}>
      {provider}
    </span>
  )
}

export default function EmbeddingProfilesTab() {
  // Data states
  const [profiles, setProfiles] = useState<EmbeddingProfile[]>([])
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [embeddingModels, setEmbeddingModels] = useState<Record<string, EmbeddingModel[]>>({})

  // UI states
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteConfirming, setDeleteConfirming] = useState<string | null>(null)

  // Async operations
  const {
    loading: initialLoading,
    error: loadError,
    execute: executeLoad,
  } = useAsyncOperation<void>()

  const {
    loading: formLoading,
    error: formError,
    execute: executeFormSubmit,
    clearError: clearFormError,
  } = useAsyncOperation<void>()

  const {
    loading: deleteLoading,
    error: deleteError,
    execute: executeDelete,
    clearError: clearDeleteError,
  } = useAsyncOperation<void>()

  // Form state
  const form = useFormState({
    name: '',
    provider: 'OPENAI' as 'OPENAI' | 'OLLAMA',
    apiKeyId: '',
    baseUrl: '',
    modelName: '',
    dimensions: '',
    isDefault: false,
  })

  // Load initial data
  useEffect(() => {
    const loadData = async () => {
      clientLogger.debug('Loading embedding profiles tab data')
      await executeLoad(async () => {
        const [profilesRes, keysRes, modelsRes] = await Promise.all([
          fetchJson<EmbeddingProfile[]>('/api/embedding-profiles'),
          fetchJson<ApiKey[]>('/api/keys'),
          fetchJson<Record<string, EmbeddingModel[]>>('/api/embedding-profiles/models'),
        ])

        if (!profilesRes.ok) {
          throw new Error(profilesRes.error || 'Failed to fetch profiles')
        }
        if (!keysRes.ok) {
          clientLogger.error('Failed to fetch API keys', { error: keysRes.error })
        } else if (keysRes.data) {
          setApiKeys(keysRes.data)
        }
        if (!modelsRes.ok) {
          clientLogger.error('Failed to fetch embedding models', { error: modelsRes.error })
        } else if (modelsRes.data) {
          setEmbeddingModels(modelsRes.data)
        }

        if (profilesRes.data) {
          setProfiles(profilesRes.data)
        }
      })
    }

    loadData()
  }, [executeLoad])

  const fetchProfiles = async () => {
    clientLogger.debug('Fetching embedding profiles')
    const result = await fetchJson<EmbeddingProfile[]>('/api/embedding-profiles')
    if (!result.ok) {
      throw new Error(result.error || 'Failed to fetch profiles')
    }
    if (result.data) {
      setProfiles(result.data)
    }
  }

  const handleDelete = async (id: string) => {
    clientLogger.debug('Deleting embedding profile', { profileId: id })
    await executeDelete(async () => {
      const result = await fetchJson('/api/embedding-profiles/' + id, { method: 'DELETE' })
      if (!result.ok) {
        throw new Error(result.error || 'Failed to delete profile')
      }
      await fetchProfiles()
      setDeleteConfirming(null)
    })
  }

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    clientLogger.debug('Submitting embedding profile form', { isEditing: !!editingId })

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

      const url = editingId ? `/api/embedding-profiles/${editingId}` : '/api/embedding-profiles'
      const method = editingId ? 'PUT' : 'POST'

      const result = await fetchJson(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!result.ok) {
        throw new Error(result.error || 'Failed to save profile')
      }

      await fetchProfiles()
      handleFormCancel()
    })
  }

  const handleFormCancel = () => {
    clientLogger.debug('Cancelling form')
    setShowForm(false)
    setEditingId(null)
    form.resetForm()
    clearFormError()
  }

  const handleEdit = (profile: EmbeddingProfile) => {
    clientLogger.debug('Editing profile', { profileId: profile.id })
    setEditingId(profile.id)
    form.setField('name', profile.name)
    form.setField('provider', profile.provider)
    form.setField('apiKeyId', profile.apiKeyId || '')
    form.setField('baseUrl', profile.baseUrl || '')
    form.setField('modelName', profile.modelName)
    form.setField('dimensions', profile.dimensions?.toString() || '')
    form.setField('isDefault', profile.isDefault)
  }

  const handleModelSelect = (modelId: string) => {
    form.setField('modelName', modelId)
    // Auto-fill dimensions if we know them
    const models = embeddingModels[form.formData.provider] || []
    const model = models.find(m => m.id === modelId)
    if (model) {
      form.setField('dimensions', model.dimensions.toString())
    }
  }

  // Filter API keys for selected provider
  const filteredApiKeys = apiKeys.filter(key => {
    if (form.formData.provider === 'OPENAI') return key.provider === 'OPENAI'
    if (form.formData.provider === 'OLLAMA') return key.provider === 'OLLAMA'
    return false
  })

  const currentModels = embeddingModels[form.formData.provider] || []

  // Show loading state during initial load
  if (initialLoading) {
    return <LoadingState message="Loading embedding profiles..." />
  }

  return (
    <div className="space-y-6">
      {/* Header with description and action */}
      <div>
        <SectionHeader
          title="Embedding Profiles"
          level="h2"
          action={
            !showForm && !editingId
              ? {
                  label: 'New Profile',
                  onClick: () => {
                    clientLogger.debug('Opening new profile form')
                    setShowForm(true)
                  },
                }
              : undefined
          }
        />
        <p className="qt-text-small text-muted-foreground">
          Manage text embedding connections for semantic search (OpenAI or Ollama)
        </p>
      </div>

      {/* Load error alert */}
      {loadError && (
        <ErrorAlert
          message={loadError}
          onRetry={() => {
            clientLogger.debug('Retrying load')
            window.location.reload()
          }}
        />
      )}

      {/* Form */}
      {(showForm || editingId) && (
        <div className="border border-border rounded-lg p-6 bg-muted/50">
          <h3 className="text-md font-semibold text-foreground mb-4">
            {editingId ? 'Edit Profile' : 'Create New Profile'}
          </h3>

          {formError && (
            <ErrorAlert message={formError} className="mb-4" />
          )}

          <form onSubmit={handleFormSubmit} className="space-y-4">
            {/* Name */}
            <div>
              <label className="qt-label mb-1">
                Profile Name
              </label>
              <input
                type="text"
                name="name"
                value={form.formData.name}
                onChange={form.handleChange}
                className="qt-input"
                placeholder="My OpenAI Embeddings"
                required
              />
            </div>

            {/* Provider */}
            <div>
              <label className="qt-label mb-1">
                Provider
              </label>
              <select
                name="provider"
                value={form.formData.provider}
                onChange={(e) => {
                  form.handleChange(e)
                  form.setField('apiKeyId', '')
                  form.setField('modelName', '')
                  form.setField('dimensions', '')
                }}
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
                Model
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
                  required
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
                min="1"
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

            {/* Form Actions */}
            <div className="pt-4">
              <FormActions
                onCancel={handleFormCancel}
                submitLabel={editingId ? 'Update Profile' : 'Create Profile'}
                isLoading={formLoading}
                type="submit"
              />
            </div>
          </form>
        </div>
      )}

      {/* Delete operation error */}
      {deleteError && (
        <ErrorAlert
          message={deleteError}
          onRetry={clearDeleteError}
        />
      )}

      {/* Profiles List */}
      {!showForm && !editingId && (
        <div className="space-y-3">
          {profiles.length === 0 ? (
            <EmptyState
              title="No embedding profiles yet"
              description="Embedding profiles are used for semantic search in memories"
              action={{
                label: 'Create First Profile',
                onClick: () => {
                  clientLogger.debug('Creating first profile')
                  setShowForm(true)
                },
              }}
            />
          ) : (
            profiles.toSorted((a, b) => a.name.localeCompare(b.name)).map(profile => (
              <div
                key={profile.id}
                className="border border-border rounded-lg p-4 hover:border-border/70 transition bg-card"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="qt-text-primary">{profile.name}</h3>
                      <ProviderBadge provider={profile.provider} />
                      {profile.isDefault && (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100/50 text-green-700">
                          Default
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-4 qt-text-small">
                      <div>
                        <p className="qt-text-xs uppercase">Model</p>
                        <p className="font-mono text-sm text-foreground">{profile.modelName}</p>
                      </div>
                      {profile.dimensions && (
                        <div>
                          <p className="qt-text-xs uppercase">Dimensions</p>
                          <p className="text-sm text-foreground">{profile.dimensions}</p>
                        </div>
                      )}
                      {profile.apiKey && (
                        <div>
                          <p className="qt-text-xs uppercase">API Key</p>
                          <p className="text-sm text-foreground">{profile.apiKey.label}</p>
                        </div>
                      )}
                      {profile.baseUrl && (
                        <div>
                          <p className="qt-text-xs uppercase">Base URL</p>
                          <p className="text-sm text-foreground">{profile.baseUrl}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 ml-4">
                    <button
                      onClick={() => handleEdit(profile)}
                      className="px-3 py-1 text-sm text-primary hover:bg-primary/10 rounded border border-primary/50 hover:border-primary focus:outline-none focus:ring-2 focus:ring-ring"
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
                        isDeleting={deleteLoading}
                      />
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
