'use client'

import { useEffect, useState } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { LoadingState } from '@/components/ui/LoadingState'
import { ErrorAlert } from '@/components/ui/ErrorAlert'
import { useEmbeddingProfiles } from './hooks/useEmbeddingProfiles'
import { ProfileForm } from './ProfileForm'
import { ProfileList } from './ProfileList'
import type { EmbeddingProfile } from './types'

// Re-export types and utilities for consumers
export type {
  ApiKey,
  EmbeddingModel,
  EmbeddingProfile,
  EmbeddingProfileFormData,
} from './types'
export { PROVIDER_COLORS } from './types'
export { useEmbeddingProfiles } from './hooks/useEmbeddingProfiles'
export { ProfileForm } from './ProfileForm'
export { ProfileList } from './ProfileList'
export { ProviderBadge } from './ProviderBadge'

/**
 * Main embedding profiles settings tab component
 */
export default function EmbeddingProfilesTab() {
  // UI states
  const [showForm, setShowForm] = useState(false)
  const [editingProfile, setEditingProfile] = useState<EmbeddingProfile | null>(null)

  // Data hook
  const {
    profiles,
    apiKeys,
    embeddingModels,
    loading: initialLoading,
    error: loadError,
    loadData,
    fetchProfiles,
  } = useEmbeddingProfiles()

  // Load initial data on mount only
  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // loadData is stable

  const handleEdit = (profile: EmbeddingProfile) => {
    clientLogger.debug('Editing profile', { profileId: profile.id })
    setEditingProfile(profile)
    setShowForm(true)
  }

  const handleFormCancel = () => {
    clientLogger.debug('Cancelling form')
    setShowForm(false)
    setEditingProfile(null)
  }

  const handleNewProfile = () => {
    clientLogger.debug('Opening new profile form')
    setEditingProfile(null)
    setShowForm(true)
  }

  const handleFormSubmitSuccess = async () => {
    await fetchProfiles()
    handleFormCancel()
  }

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
            !showForm && !editingProfile
              ? {
                  label: 'New Profile',
                  onClick: handleNewProfile,
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
      {showForm && (
        <ProfileForm
          profile={editingProfile}
          apiKeys={apiKeys}
          embeddingModels={embeddingModels}
          onSubmitSuccess={handleFormSubmitSuccess}
          onCancel={handleFormCancel}
        />
      )}

      {/* Profiles List */}
      {!showForm && (
        <ProfileList
          profiles={profiles}
          onEdit={handleEdit}
          onProfilesChange={fetchProfiles}
        />
      )}
    </div>
  )
}
