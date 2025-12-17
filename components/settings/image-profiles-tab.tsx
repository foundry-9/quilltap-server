'use client'

import { useState, useEffect } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { ImageProfileForm } from '@/components/image-profiles/ImageProfileForm'
import { ProviderBadge } from '@/components/image-profiles/ProviderIcon'

interface ApiKey {
  id: string
  label: string
  provider: string
  isActive: boolean
}

interface ImageProfile {
  id: string
  name: string
  provider: 'OPENAI' | 'GROK' | 'GOOGLE_IMAGEN'
  apiKeyId?: string
  baseUrl?: string
  modelName: string
  parameters: Record<string, any>
  isDefault: boolean
  apiKey?: ApiKey | null
}

export default function ImageProfilesTab() {
  const [profiles, setProfiles] = useState<ImageProfile[]>([])
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteConfirming, setDeleteConfirming] = useState<string | null>(null)

  useEffect(() => {
    fetchProfiles()
    fetchApiKeys()
  }, [])

  const fetchProfiles = async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch('/api/image-profiles')
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

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/image-profiles/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete profile')
      await fetchProfiles()
      setDeleteConfirming(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    }
  }

  const handleFormSuccess = async () => {
    setShowForm(false)
    setEditingId(null)
    await fetchProfiles()
  }

  const handleFormCancel = () => {
    setShowForm(false)
    setEditingId(null)
  }

  const editingProfile = editingId ? profiles.find(p => p.id === editingId) : undefined

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <div className="text-muted-foreground">Loading image profiles...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Image Generation Profiles</h2>
          <p className="qt-text-small mt-1">
            Manage profiles for different image generation providers
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
        <div className="bg-destructive/10 border border-destructive/30 text-destructive px-4 py-3 rounded">
          {error}
        </div>
      )}

      {/* Form */}
      {(showForm || editingId) && (
        <div className="border border-border rounded-lg p-6 bg-muted">
          <h3 className="text-md font-semibold text-foreground mb-4">
            {editingProfile ? 'Edit Profile' : 'Create New Profile'}
          </h3>
          <ImageProfileForm
            profile={editingProfile}
            apiKeys={apiKeys}
            onSuccess={handleFormSuccess}
            onCancel={handleFormCancel}
          />
        </div>
      )}

      {/* Profiles List */}
      {!showForm && !editingId && (
        <div className="space-y-3">
          {profiles.length === 0 ? (
            <div className="text-center py-8 bg-muted rounded-lg border border-border">
              <p className="text-muted-foreground mb-4">No image profiles yet</p>
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
                className="border border-border rounded-lg p-4 hover:border-border/80 transition bg-card"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="font-medium text-foreground">{profile.name}</h3>
                      <ProviderBadge provider={profile.provider} />
                      {profile.isDefault && (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                          Default
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-4 qt-text-small">
                      <div>
                        <p className="qt-text-xs uppercase">Model</p>
                        <p className="font-mono text-sm text-foreground">{profile.modelName}</p>
                      </div>
                      {profile.apiKey && (
                        <div>
                          <p className="qt-text-xs uppercase">API Key</p>
                          <p className="text-sm text-foreground">{profile.apiKey.label}</p>
                        </div>
                      )}
                    </div>

                    {/* Parameters Display */}
                    {Object.keys(profile.parameters).length > 0 && (
                      <div className="mt-3 pt-3 border-t border-border">
                        <p className="qt-text-xs uppercase mb-2">Parameters</p>
                        <div className="space-y-1">
                          {Object.entries(profile.parameters).map(([key, value]) => (
                            <div key={key} className="qt-text-xs">
                              <span className="font-mono">{key}:</span>{' '}
                              <span className="text-foreground">
                                {typeof value === 'string' ? value : JSON.stringify(value)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 ml-4">
                    <button
                      onClick={() => setEditingId(profile.id)}
                      className="px-3 py-1 text-sm text-primary hover:bg-accent rounded border border-border/50 hover:border-border focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      Edit
                    </button>
                    <div className="relative">
                      <button
                        onClick={() => setDeleteConfirming(deleteConfirming === profile.id ? null : profile.id)}
                        className="px-3 py-1 text-sm text-destructive hover:bg-destructive/10 rounded border border-border/50 hover:border-destructive/30 focus:outline-none focus:ring-2 focus:ring-ring"
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
                              className="px-2 py-1 text-xs bg-destructive text-primary-foreground hover:bg-destructive/90 rounded focus:outline-none focus:ring-2 focus:ring-ring"
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
