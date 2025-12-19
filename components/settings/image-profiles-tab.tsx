'use client'

import { useEffect, useState } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { useAsyncOperation } from '@/hooks/useAsyncOperation'
import { fetchJson } from '@/lib/fetch-helpers'
import { ProviderBadge } from '@/components/image-profiles/ProviderIcon'
import { ImageProfileModal } from '@/components/image-profiles/ImageProfileModal'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { LoadingState } from '@/components/ui/LoadingState'
import { ErrorAlert } from '@/components/ui/ErrorAlert'
import { EmptyState } from '@/components/ui/EmptyState'
import { DeleteConfirmPopover } from '@/components/ui/DeleteConfirmPopover'
import { MissingApiKeyBadge } from '@/components/ui/MissingApiKeyBadge'

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
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingProfile, setEditingProfile] = useState<ImageProfile | null>(null)
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
  } = useAsyncOperation<void>()

  // Fetch profiles on mount only
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // executeLoadProfiles is stable

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

  const handleOpenModal = (profile?: ImageProfile) => {
    clientLogger.debug('Opening image profile modal', { isEditing: !!profile })
    setEditingProfile(profile || null)
    setIsModalOpen(true)
  }

  const handleCloseModal = () => {
    clientLogger.debug('Closing image profile modal')
    setIsModalOpen(false)
    setEditingProfile(null)
  }

  const handleModalSuccess = () => {
    clientLogger.debug('Image profile saved via modal')
    refreshProfiles()
  }

  if (loadingProfiles) {
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
          action={{
            label: 'New Profile',
            onClick: () => handleOpenModal(),
          }}
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

      {/* Profiles List */}
      <div className="space-y-3">
        {profiles.length === 0 ? (
          <EmptyState
            title="No image profiles yet"
            description="Create a profile to start generating images with AI"
            action={{
              label: 'Create First Profile',
              onClick: () => handleOpenModal(),
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
                    {/* All image generation providers require API keys */}
                    {!profile.apiKey && <MissingApiKeyBadge />}
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
                    onClick={() => handleOpenModal(profile)}
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

      {/* Image Profile Modal - key ensures remount when switching profiles */}
      <ImageProfileModal
        key={editingProfile?.id || 'new'}
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        onSuccess={handleModalSuccess}
        profile={editingProfile || undefined}
        apiKeys={apiKeys}
      />
    </div>
  )
}
