'use client'

import { useEffect, useState } from 'react'
import { useAsyncOperation } from '@/hooks/useAsyncOperation'
import { useAutoAssociate } from '@/hooks/useAutoAssociate'
import { useModalState } from '@/hooks/useModalState'
import { fetchJson } from '@/lib/fetch-helpers'
import { ProviderBadge } from '@/components/image-profiles/ProviderIcon'
import { ImageProfileModal } from '@/components/image-profiles/ImageProfileModal'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { LoadingState } from '@/components/ui/LoadingState'
import { ErrorAlert } from '@/components/ui/ErrorAlert'
import { EmptyState } from '@/components/ui/EmptyState'
import { MissingApiKeyBadge } from '@/components/ui/MissingApiKeyBadge'
import { SettingsCard, SettingsCardBadge, SettingsCardMetadata } from '@/components/ui/SettingsCard'

interface ApiKey {
  id: string
  label: string
  provider: string
  isActive: boolean
}

interface ImageProfile {
  id: string
  name: string
  provider: string
  apiKeyId?: string
  baseUrl?: string
  modelName: string
  parameters: Record<string, any>
  isDefault: boolean
  isDangerousCompatible?: boolean
  apiKey?: ApiKey | null
}

export default function ImageProfilesTab() {
  const [profiles, setProfiles] = useState<ImageProfile[]>([])
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
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

  const triggerAutoAssociate = useAutoAssociate()

  // Trigger auto-association on mount (fire and forget)
  useEffect(() => {
    triggerAutoAssociate()
  }, [triggerAutoAssociate])

  // Fetch profiles on mount only
  useEffect(() => {
    const loadProfiles = async () => {
      const result = await executeLoadProfiles(async () => {
        const response = await fetchJson<{ profiles: ImageProfile[], count: number }>('/api/v1/image-profiles')
        if (!response.ok) {
          throw new Error(response.error || 'Failed to load profiles')
        }
        return response.data?.profiles || []
      })
      if (result) {
        setProfiles(result)
      }
    }

    loadProfiles()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // executeLoadProfiles is stable

  // Fetch API keys on mount
  useEffect(() => {
    const loadApiKeys = async () => {
      const response = await fetchJson<{ apiKeys: ApiKey[]; count: number }>('/api/v1/api-keys')
      if (response.ok && response.data?.apiKeys) {
        setApiKeys(response.data.apiKeys)
      } else {
        console.error('Failed to load API keys', { error: response.error })
      }
    }

    loadApiKeys()
  }, [])

  const refreshProfiles = async () => {
    const response = await fetchJson<{ profiles: ImageProfile[], count: number }>('/api/v1/image-profiles')
    if (response.ok && response.data?.profiles) {
      setProfiles(response.data.profiles)
    } else {
      console.error('Failed to refresh profiles', { error: response.error })
    }
  }

  const {
    isOpen: isModalOpen,
    payload: editingProfile,
    openModal: handleOpenModal,
    closeModal: handleCloseModal,
    handleSuccess: handleModalSuccess,
  } = useModalState<ImageProfile>(() => refreshProfiles())

  const handleDelete = async (id: string) => {
    const result = await executeDelete(async () => {
      const response = await fetchJson(`/api/v1/image-profiles/${id}`, { method: 'DELETE' })
      if (!response.ok) {
        throw new Error(response.error || 'Failed to delete profile')
      }
    })

    if (result !== null) {
      setDeleteConfirming(null)
      await refreshProfiles()
    }
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
      <div className="qt-card-grid-auto">
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
          profiles.slice().sort((a, b) => a.name.localeCompare(b.name)).map(profile => {
            // Build badges array
            const badges: SettingsCardBadge[] = []
            if (profile.isDefault) {
              badges.push({ text: 'Default', variant: 'success' })
            }
            if (profile.isDangerousCompatible) {
              badges.push({ text: 'Uncensored', variant: 'destructive' })
            }

            // Build metadata array
            const metadata: SettingsCardMetadata[] = [
              { label: 'Model', value: <span className="font-mono text-sm text-foreground">{profile.modelName}</span> },
            ]
            if (profile.apiKey) {
              metadata.push({ label: 'API Key', value: profile.apiKey.label })
            }

            return (
              <SettingsCard
                key={profile.id}
                title={profile.name}
                badges={badges}
                metadata={metadata}
                actions={[
                  { label: 'Edit', onClick: () => handleOpenModal(profile), variant: 'secondary' },
                ]}
                deleteConfig={{
                  isConfirming: deleteConfirming === profile.id,
                  onConfirmChange: (confirming) => setDeleteConfirming(confirming ? profile.id : null),
                  onConfirm: () => handleDelete(profile.id),
                  message: 'Delete this profile?',
                  isDeleting: deletingProfile,
                }}
              >
                {/* Provider badge and missing API key warning */}
                <div className="flex items-center gap-2 mt-1 mb-2">
                  <ProviderBadge provider={profile.provider} />
                  {!profile.apiKey && <MissingApiKeyBadge />}
                </div>

                {/* Parameters Display */}
                {Object.keys(profile.parameters).length > 0 && (
                  <div className="mt-3 pt-3 border-t qt-border-default">
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
              </SettingsCard>
            )
          })
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
