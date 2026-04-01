'use client'

import { useState, useEffect, useCallback } from 'react'
import { LoadingState } from '@/components/ui/LoadingState'
import { ErrorAlert } from '@/components/ui/ErrorAlert'
import { ProfileList } from './ProfileList'
import { ProfileModal } from './ProfileModal'
import { useConnectionProfiles } from './hooks/useConnectionProfiles'
import { useProfileForm } from './hooks/useProfileForm'
import type { ConnectionProfile } from './types'

// Re-export for barrel exports
export { ProfileForm } from './ProfileForm'
export { ProfileList } from './ProfileList'
export { ProfileCard } from './ProfileCard'
export { useConnectionProfiles, useProfileForm } from './hooks'
export type {
  ApiKey,
  Tag,
  ProviderConfig,
  ConnectionProfile,
  ProfileFormData,
} from './types'
export { initialFormState } from './types'

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
    fetchOp,
    deleteOp,
    fetchProfiles,
    fetchApiKeys,
    fetchProviders,
    fetchChatSettings,
    handleDelete,
    triggerAutoAssociate,
  } = useConnectionProfiles()

  // Form state and operations
  const {
    form,
    saveOp,
    connectOp,
    fetchModelsOp,
    testMessageOp,
    getProviderRequirements,
    resetForm,
    loadProfileIntoForm,
    handleConnect,
    handleFetchModels,
    handleTestMessage,
    handleSubmit,
  } = useProfileForm(providers)

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingProfile, setEditingProfile] = useState<ConnectionProfile | null>(null)
  const [deleteConfirming, setDeleteConfirming] = useState<string | null>(null)

  // Trigger auto-association on mount (fire and forget)
  useEffect(() => {
    triggerAutoAssociate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Initialize data on mount - only run once
  useEffect(() => {
    fetchProfiles()
    fetchApiKeys()
    fetchProviders()
    fetchChatSettings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleEdit = useCallback(
    (profile: ConnectionProfile) => {
      loadProfileIntoForm(profile)
      setEditingProfile(profile)
      setIsModalOpen(true)
    },
    [loadProfileIntoForm]
  )

  const handleOpenModal = useCallback(() => {
    resetForm()
    setEditingProfile(null)
    setIsModalOpen(true)
  }, [resetForm])

  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false)
    setEditingProfile(null)
    resetForm()
  }, [resetForm])

  const handleModalSuccess = useCallback(() => {
    fetchProfiles()
    fetchApiKeys()
  }, [fetchProfiles, fetchApiKeys])

  const handleDeleteClick = useCallback(
    async (profileId: string) => {
      await handleDelete(profileId)
      setDeleteConfirming(null)
    },
    [handleDelete]
  )

  if (fetchOp.loading) {
    return <LoadingState message="Loading connection profiles..." />
  }

  return (
    <div>
      {fetchOp.error && (
        <ErrorAlert
          message={fetchOp.error}
          onRetry={() => fetchProfiles()}
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
        isDeleting={deleteOp.loading}
        onEdit={handleEdit}
        onDelete={handleDeleteClick}
        onDeleteConfirmChange={setDeleteConfirming}
        onAddClick={handleOpenModal}
      />

      {/* Profile Modal - key ensures remount when switching profiles */}
      <ProfileModal
        key={editingProfile?.id || 'new'}
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        onSuccess={handleModalSuccess}
        profile={editingProfile}
        apiKeys={apiKeys}
        providers={providers}
        form={{
          formData: form.formData,
          setField: form.setField,
          handleChange: form.handleChange,
          resetForm: resetForm,
        }}
        operations={{
          saveLoading: saveOp.loading,
          connectLoading: connectOp.loading,
          connectError: connectOp.error,
          fetchModelsLoading: fetchModelsOp.loading,
          testMessageLoading: testMessageOp.loading,
          handleConnect,
          handleFetchModels,
          handleTestMessage,
          handleSubmit,
          getProviderRequirements,
        }}
      />
    </div>
  )
}
