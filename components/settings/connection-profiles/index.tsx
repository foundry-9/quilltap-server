'use client'

import { useState, useEffect, useCallback } from 'react'
import { LoadingState } from '@/components/ui/LoadingState'
import { ErrorAlert } from '@/components/ui/ErrorAlert'
import { ProfileList } from './ProfileList'
import { useConnectionProfiles } from './hooks/useConnectionProfiles'
import { useConnectionProfileModal } from './useConnectionProfileModal'
import { fetchJson } from '@/lib/fetch-helpers'
import { showSuccessToast, showErrorToast } from '@/lib/toast'

/**
 * Main connection profiles component
 * Orchestrates profile list, modal, and all operations
 */
export default function ConnectionProfilesTab() {
  // Profile and UI state management
  const {
    profiles,
    apiKeys,
    providers,
    cheapDefaultProfileId,
    loading,
    error,
    deleting,
    refreshProfiles,
    refreshAfterSave,
    handleDelete,
    triggerAutoAssociate,
    reorderProfiles,
    resetSort,
  } = useConnectionProfiles()

  const [deleteConfirming, setDeleteConfirming] = useState<string | null>(null)
  const [autoConfiguringId, setAutoConfiguringId] = useState<string | null>(null)

  // Trigger auto-association on mount (fire and forget)
  useEffect(() => {
    triggerAutoAssociate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleModalSuccess = useCallback(() => {
    void refreshAfterSave()
  }, [refreshAfterSave])

  // The modal, its form and its editing target (shared with the provider view)
  const { openNew, openEdit, modal } = useConnectionProfileModal({
    profiles,
    apiKeys,
    providers,
    onSuccess: handleModalSuccess,
  })
  const handleOpenModal = useCallback(() => openNew(), [openNew])

  const handleDeleteClick = useCallback(
    async (profileId: string) => {
      await handleDelete(profileId)
      setDeleteConfirming(null)
    },
    [handleDelete]
  )

  const handleAutoConfigureCard = useCallback(async (profileId: string) => {
    setAutoConfiguringId(profileId)
    try {
      const result = await fetchJson<any>(
        `/api/v1/connection-profiles/${profileId}?action=auto-configure`,
        { method: 'POST' }
      )
      if (!result.ok) {
        showErrorToast(result.error || 'Auto-configure failed')
      } else {
        showSuccessToast('Profile auto-configured successfully')
        void refreshProfiles()
      }
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : 'Auto-configure failed')
    } finally {
      setAutoConfiguringId(null)
    }
  }, [refreshProfiles])

  if (loading) {
    return <LoadingState message="Loading connection profiles..." />
  }

  return (
    <div>
      {error && (
        <ErrorAlert
          message={error}
          onRetry={() => void refreshProfiles()}
          className="mb-4"
        />
      )}

      {apiKeys.length === 0 && (
        <div className="qt-alert-warning mb-6">
          <p className="font-medium">No API keys found</p>
          <p className="qt-text-small">
            Add an API key in the &quot;API Keys&quot; tab before creating a connection profile.
          </p>
        </div>
      )}

      {/* Profiles List - always visible */}
      <ProfileList
        profiles={profiles}
        cheapDefaultProfileId={cheapDefaultProfileId}
        providers={providers}
        showForm={false}
        deleteConfirming={deleteConfirming}
        isDeleting={deleting}
        onEdit={openEdit}
        onDelete={handleDeleteClick}
        onDeleteConfirmChange={setDeleteConfirming}
        onAddClick={handleOpenModal}
        onReorder={reorderProfiles}
        onResetSort={resetSort}
        onAutoConfigure={handleAutoConfigureCard}
        autoConfiguringId={autoConfiguringId}
      />

      {/* Profile Modal */}
      {modal}
    </div>
  )
}
