'use client'

import { useEffect, useState } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { useAsyncOperation } from '@/hooks/useAsyncOperation'
import { fetchJson } from '@/lib/fetch-helpers'
import { getErrorMessage } from '@/lib/error-utils'
import { ImageProfileForm } from '@/components/image-profiles/ImageProfileForm'
import { ProviderBadge } from '@/components/image-profiles/ProviderIcon'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { LoadingState } from '@/components/ui/LoadingState'
import { ErrorAlert } from '@/components/ui/ErrorAlert'
import { EmptyState } from '@/components/ui/EmptyState'
import { DeleteConfirmPopover } from '@/components/ui/DeleteConfirmPopover'

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
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteConfirming, setDeleteConfirming] = useState<string | null>(null)

  const {
    loading: loadingProfiles,
    error: profilesError,
    execute: executeLoadProfiles,
    clearError: clearProfilesError,
  } = useAsyncOperation<ImageProfile[]>()

  const {
    loading: deletingProfile,
    error: deleteError,
    execute: executeDelete,
    setError: setDeleteError,
  } = useAsyncOperation<void>()

  const {
    loading: loadingApiKeys,
    error: apiKeysError,
  } = useAsyncOperation<ApiKey[]>()

  // Fetch profiles on mount
  useEffect(() => {
    const loadProfiles = async () => {
      clientLogger.debug('Loading image profiles')
      const result = await executeLoadProfiles(async () => {
        const response = await fetchJson<ImageProfile[]>('/api/image-profiles')
        if (!response.ok) {
          throw new Error(response.error || 'Failed to load profiles')
        }
        return response.data || []
      })
      if (result) {
        clientLogger.debug('Image profiles loaded successfully', { count: result.length })
        setProfiles(result)
      }
    }

    loadProfiles()
  }, [executeLoadProfiles])

  // Fetch API keys on mount
  useEffect(() => {
    const loadApiKeys = async () => {
      clientLogger.debug('Loading API keys for image profiles')
      const response = await fetchJson<ApiKey[]>('/api/keys')
      if (response.ok && response.data) {
        clientLogger.debug('API keys loaded successfully', { count: response.data.length })
        setApiKeys(response.data)
      } else {
        clientLogger.error('Failed to load API keys', { error: response.error })
      }
    }

    loadApiKeys()
  }, [])

  const refreshProfiles = async () => {
    clientLogger.debug('Refreshing image profiles')
    const response = await fetchJson<ImageProfile[]>('/api/image-profiles')
    if (response.ok && response.data) {
      setProfiles(response.data)
      clientLogger.debug('Profiles refreshed', { count: response.data.length })
    } else {
      clientLogger.error('Failed to refresh profiles', { error: response.error })
    }
  }

  const handleDelete = async (id: string) => {
    clientLogger.debug('Deleting image profile', { profileId: id })
    const result = await executeDelete(async () => {
      const response = await fetchJson(`/api/image-profiles/${id}`, { method: 'DELETE' })
      if (!response.ok) {
        throw new Error(response.error || 'Failed to delete profile')
      }
    })

    if (result !== null) {
      clientLogger.debug('Profile deleted successfully', { profileId: id })
      setDeleteConfirming(null)
      await refreshProfiles()
    }
  }

  const handleFormSuccess = async () => {
    clientLogger.debug('Image profile form submitted successfully')
    setShowForm(false)
    setEditingId(null)
    await refreshProfiles()
  }

  const handleFormCancel = () => {
    clientLogger.debug('Image profile form cancelled')
    setShowForm(false)
    setEditingId(null)
  }

  const editingProfile = editingId ? profiles.find(p => p.id === editingId) : undefined

  const isLoading = loadingProfiles

  if (isLoading) {
    return <LoadingState message="Loading image profiles..." />
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <SectionHeader
          title="Image Generation Profiles"
          count={profiles.length}
          level="h2"
          action={
            !showForm && !editingId
              ? {
                  label: 'New Profile',
                  onClick: () => {
                    clientLogger.debug('Opening new image profile form')
                    setShowForm(true)
                  },
                }
              : undefined
          }
        />
        <p className="qt-text-small">
          Manage profiles for different image generation providers
        </p>
      </div>

      {/* Error Alert */}
      {(profilesError || deleteError) && (
        <ErrorAlert
          message={profilesError || deleteError || 'An error occurred'}
          onRetry={() => {
            if (profilesError) clearProfilesError()
            refreshProfiles()
          }}
        />
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
            <EmptyState
              title="No image profiles yet"
              description="Create a profile to start generating images with AI"
              action={{
                label: 'Create First Profile',
                onClick: () => {
                  clientLogger.debug('Opening new image profile form from empty state')
                  setShowForm(true)
                },
              }}
            />
          ) : (
            profiles.toSorted((a, b) => a.name.localeCompare(b.name)).map(profile => (
              <div
                key={profile.id}
                className="border border-border rounded-lg p-4 hover:border-border/80 transition bg-card"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="qt-text-primary">{profile.name}</h3>
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
                      onClick={() => {
                        clientLogger.debug('Editing image profile', { profileId: profile.id })
                        setEditingId(profile.id)
                      }}
                      className="px-3 py-1 text-sm text-primary hover:bg-accent rounded border border-border/50 hover:border-border focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      Edit
                    </button>
                    <div className="relative">
                      <button
                        onClick={() => {
                          clientLogger.debug('Toggling delete confirmation', { profileId: profile.id })
                          setDeleteConfirming(deleteConfirming === profile.id ? null : profile.id)
                        }}
                        className="px-3 py-1 text-sm text-destructive hover:bg-destructive/10 rounded border border-border/50 hover:border-destructive/30 focus:outline-none focus:ring-2 focus:ring-ring"
                      >
                        Delete
                      </button>

                      {/* Delete Confirmation Popover */}
                      <DeleteConfirmPopover
                        isOpen={deleteConfirming === profile.id}
                        isDeleting={deletingProfile}
                        message="Delete this profile?"
                        onCancel={() => {
                          clientLogger.debug('Cancelling profile deletion')
                          setDeleteConfirming(null)
                        }}
                        onConfirm={() => handleDelete(profile.id)}
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
