'use client'

import { useState, useEffect } from 'react'
import { clientLogger } from '@/lib/client-logger'

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
  const [profiles, setProfiles] = useState<EmbeddingProfile[]>([])
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [embeddingModels, setEmbeddingModels] = useState<Record<string, EmbeddingModel[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteConfirming, setDeleteConfirming] = useState<string | null>(null)

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    provider: 'OPENAI' as 'OPENAI' | 'OLLAMA',
    apiKeyId: '',
    baseUrl: '',
    modelName: '',
    dimensions: '',
    isDefault: false,
  })
  const [formLoading, setFormLoading] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    fetchProfiles()
    fetchApiKeys()
    fetchModels()
  }, [])

  const fetchProfiles = async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch('/api/embedding-profiles')
      if (!res.ok) throw new Error('Failed to fetch profiles')
      const data = await res.json()
      setProfiles(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const fetchApiKeys = async () => {
    try {
      const res = await fetch('/api/keys')
      if (!res.ok) throw new Error('Failed to fetch API keys')
      const data = await res.json()
      setApiKeys(data)
    } catch (err) {
      clientLogger.error('Failed to fetch API keys', { error: err instanceof Error ? err.message : String(err) })
    }
  }

  const fetchModels = async () => {
    try {
      const res = await fetch('/api/embedding-profiles/models')
      if (!res.ok) throw new Error('Failed to fetch models')
      const data = await res.json()
      setEmbeddingModels(data)
    } catch (err) {
      clientLogger.error('Failed to fetch embedding models', { error: err instanceof Error ? err.message : String(err) })
    }
  }

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/embedding-profiles/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete profile')
      await fetchProfiles()
      setDeleteConfirming(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    }
  }

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormLoading(true)
    setFormError(null)

    try {
      const payload = {
        name: formData.name,
        provider: formData.provider,
        apiKeyId: formData.apiKeyId || undefined,
        baseUrl: formData.baseUrl || undefined,
        modelName: formData.modelName,
        dimensions: formData.dimensions ? parseInt(formData.dimensions) : undefined,
        isDefault: formData.isDefault,
      }

      const url = editingId ? `/api/embedding-profiles/${editingId}` : '/api/embedding-profiles'
      const method = editingId ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to save profile')
      }

      await fetchProfiles()
      handleFormCancel()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setFormLoading(false)
    }
  }

  const handleFormCancel = () => {
    setShowForm(false)
    setEditingId(null)
    setFormData({
      name: '',
      provider: 'OPENAI',
      apiKeyId: '',
      baseUrl: '',
      modelName: '',
      dimensions: '',
      isDefault: false,
    })
    setFormError(null)
  }

  const handleEdit = (profile: EmbeddingProfile) => {
    setEditingId(profile.id)
    setFormData({
      name: profile.name,
      provider: profile.provider,
      apiKeyId: profile.apiKeyId || '',
      baseUrl: profile.baseUrl || '',
      modelName: profile.modelName,
      dimensions: profile.dimensions?.toString() || '',
      isDefault: profile.isDefault,
    })
  }

  const handleModelSelect = (modelId: string) => {
    setFormData(prev => ({ ...prev, modelName: modelId }))
    // Auto-fill dimensions if we know them
    const models = embeddingModels[formData.provider] || []
    const model = models.find(m => m.id === modelId)
    if (model) {
      setFormData(prev => ({ ...prev, dimensions: model.dimensions.toString() }))
    }
  }

  // Filter API keys for selected provider
  const filteredApiKeys = apiKeys.filter(key => {
    if (formData.provider === 'OPENAI') return key.provider === 'OPENAI'
    if (formData.provider === 'OLLAMA') return key.provider === 'OLLAMA'
    return false
  })

  const currentModels = embeddingModels[formData.provider] || []

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <div className="text-muted-foreground">Loading embedding profiles...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Embedding Profiles</h2>
          <p className="qt-text-small mt-1">
            Manage text embedding connections for semantic search (OpenAI or Ollama)
          </p>
        </div>
        {!showForm && !editingId && (
          <button
            onClick={() => setShowForm(true)}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring"
          >
            New Profile
          </button>
        )}
      </div>

      {/* Error Alert */}
      {error && (
        <div className="qt-alert-error">
          {error}
        </div>
      )}

      {/* Form */}
      {(showForm || editingId) && (
        <div className="border border-border rounded-lg p-6 bg-muted/50">
          <h3 className="text-md font-semibold text-foreground mb-4">
            {editingId ? 'Edit Profile' : 'Create New Profile'}
          </h3>

          {formError && (
            <div className="mb-4 qt-alert-error">
              {formError}
            </div>
          )}

          <form onSubmit={handleFormSubmit} className="space-y-4">
            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Profile Name
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
                className="qt-input"
                placeholder="My OpenAI Embeddings"
                required
              />
            </div>

            {/* Provider */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Provider
              </label>
              <select
                value={formData.provider}
                onChange={e => setFormData(prev => ({ ...prev, provider: e.target.value as 'OPENAI' | 'OLLAMA', apiKeyId: '', modelName: '', dimensions: '' }))}
                className="qt-select"
              >
                <option value="OPENAI">OpenAI</option>
                <option value="OLLAMA">Ollama (Local)</option>
              </select>
            </div>

            {/* API Key (for OpenAI) */}
            {formData.provider === 'OPENAI' && (
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  API Key
                </label>
                <select
                  value={formData.apiKeyId}
                  onChange={e => setFormData(prev => ({ ...prev, apiKeyId: e.target.value }))}
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
            {formData.provider === 'OLLAMA' && (
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  Base URL
                </label>
                <input
                  type="text"
                  value={formData.baseUrl}
                  onChange={e => setFormData(prev => ({ ...prev, baseUrl: e.target.value }))}
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
              <label className="block text-sm font-medium text-foreground mb-1">
                Model
              </label>
              {currentModels.length > 0 ? (
                <div className="space-y-2">
                  <select
                    value={formData.modelName}
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
                  {formData.modelName && (
                    <p className="qt-text-xs">
                      {currentModels.find(m => m.id === formData.modelName)?.description}
                    </p>
                  )}
                </div>
              ) : (
                <input
                  type="text"
                  value={formData.modelName}
                  onChange={e => setFormData(prev => ({ ...prev, modelName: e.target.value }))}
                  className="qt-input"
                  placeholder="text-embedding-3-small"
                  required
                />
              )}
            </div>

            {/* Dimensions (optional override) */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Dimensions (optional)
              </label>
              <input
                type="number"
                value={formData.dimensions}
                onChange={e => setFormData(prev => ({ ...prev, dimensions: e.target.value }))}
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
                checked={formData.isDefault}
                onChange={e => setFormData(prev => ({ ...prev, isDefault: e.target.checked }))}
                className="h-4 w-4 text-primary focus:ring-ring border-input rounded"
              />
              <label htmlFor="isDefault" className="ml-2 block text-sm text-foreground">
                Set as default embedding profile
              </label>
            </div>

            {/* Buttons */}
            <div className="flex gap-3 pt-4">
              <button
                type="submit"
                disabled={formLoading}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              >
                {formLoading ? 'Saving...' : editingId ? 'Update Profile' : 'Create Profile'}
              </button>
              <button
                type="button"
                onClick={handleFormCancel}
                className="px-4 py-2 bg-muted text-foreground rounded-md hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Profiles List */}
      {!showForm && !editingId && (
        <div className="space-y-3">
          {profiles.length === 0 ? (
            <div className="text-center py-8 bg-muted rounded-lg border border-border">
              <p className="text-muted-foreground mb-2">No embedding profiles yet</p>
              <p className="qt-text-small mb-4">
                Embedding profiles are used for semantic search in memories
              </p>
              <button
                onClick={() => setShowForm(true)}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring"
              >
                Create First Profile
              </button>
            </div>
          ) : (
            profiles.toSorted((a, b) => a.name.localeCompare(b.name)).map(profile => (
              <div
                key={profile.id}
                className="border border-border rounded-lg p-4 hover:border-border/70 transition bg-card"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="font-medium text-foreground">{profile.name}</h3>
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
                      {deleteConfirming === profile.id && (
                        <div className="absolute right-0 top-full mt-1 bg-card border border-border rounded-lg shadow-lg p-3 whitespace-nowrap z-10">
                          <p className="text-sm text-foreground mb-2">Delete this profile?</p>
                          <div className="flex gap-2">
                            <button
                              onClick={() => setDeleteConfirming(null)}
                              className="px-2 py-1 text-xs bg-muted text-foreground hover:bg-accent rounded focus:outline-none focus:ring-2 focus:ring-ring"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => handleDelete(profile.id)}
                              className="px-2 py-1 text-xs bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded focus:outline-none focus:ring-2 focus:ring-destructive"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      )}
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
