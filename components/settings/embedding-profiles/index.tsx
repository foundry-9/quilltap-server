'use client'

import { useEffect, useState } from 'react'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { LoadingState } from '@/components/ui/LoadingState'
import { ErrorAlert } from '@/components/ui/ErrorAlert'
import { useEmbeddingProfiles } from './hooks/useEmbeddingProfiles'
import { ProfileModal } from './ProfileModal'
import { ProfileList } from './ProfileList'
import type { EmbeddingProfile } from './types'

// Re-export types and utilities for consumers
export type {
  ApiKey,
  EmbeddingModel,
  EmbeddingProfile,
  EmbeddingProfileFormData,
  EmbeddingProvider,
  VocabularyStats,
  EmbeddingStatusStats,
} from './types'
export { PROVIDER_BADGE_CLASSES, PROVIDER_COLORS } from './types'
export { useEmbeddingProfiles } from './hooks/useEmbeddingProfiles'
export { ProfileForm } from './ProfileForm'
export { ProfileList } from './ProfileList'
export { ProviderBadge } from './ProviderBadge'

/**
 * Main embedding profiles settings tab component
 */
export default function EmbeddingProfilesTab() {
  // UI states
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingProfile, setEditingProfile] = useState<EmbeddingProfile | null>(null)

  // Data hook
  const {
    profiles,
    apiKeys,
    embeddingModels,
    embeddingProviders,
    loading: initialLoading,
    error: loadError,
    loadData,
    fetchProfiles,
    triggerAutoAssociate,
  } = useEmbeddingProfiles()

  // Trigger auto-association on mount (fire and forget)
  useEffect(() => {
    triggerAutoAssociate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load initial data on mount only
  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // loadData is stable

  const handleEdit = (profile: EmbeddingProfile) => {
    setEditingProfile(profile)
    setIsModalOpen(true)
  }

  const handleOpenModal = () => {
    setEditingProfile(null)
    setIsModalOpen(true)
  }

  const handleCloseModal = () => {
    setIsModalOpen(false)
    setEditingProfile(null)
  }

  const handleModalSuccess = async () => {
    await fetchProfiles()
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
          action={{
            label: 'New Profile',
            onClick: handleOpenModal,
          }}
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
            window.location.reload()
          }}
        />
      )}

      {/* Profiles List - always visible */}
      <ProfileList
        profiles={profiles}
        onEdit={handleEdit}
        onProfilesChange={fetchProfiles}
      />

      {/* Profile Modal - key ensures remount when switching profiles */}
      <ProfileModal
        key={editingProfile?.id || 'new'}
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        onSuccess={handleModalSuccess}
        profile={editingProfile}
        apiKeys={apiKeys}
        embeddingModels={embeddingModels}
        embeddingProviders={embeddingProviders}
      />
    </div>
  )
}
