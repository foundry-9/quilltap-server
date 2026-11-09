'use client'

/**
 * The connection-profile modal and everything that drives it — form state,
 * the probe operations, the editing target, the taken-name guard — packaged so
 * any list can host it. The Connection Profiles card (*By kind*) and the
 * per-provider cards (*By provider*) both render `modal` and call `openNew` /
 * `openEdit`; the modal itself is `ProfileModal`, unchanged.
 *
 * @module components/settings/connection-profiles/useConnectionProfileModal
 */

import { useCallback, useMemo, useState, type ReactElement } from 'react'
import { normalizeProfileName } from '@/lib/llm/connection-profile-names'
import { ProfileModal } from './ProfileModal'
import { useProfileForm } from './hooks/useProfileForm'
import type { ApiKey, ConnectionProfile, ProviderConfig } from './types'

export interface UseConnectionProfileModalOptions {
  profiles: ConnectionProfile[]
  apiKeys: ApiKey[]
  providers: ProviderConfig[]
  /** Called after a save, to refresh whichever list shows the profiles. */
  onSuccess: () => void
}

export interface ConnectionProfileModalHandle {
  /** Open a blank profile, optionally with its provider preselected. */
  openNew: (initialProvider?: string) => void
  /** Open an existing profile for editing. */
  openEdit: (profile: ConnectionProfile) => void
  /** The modal element; render it once wherever the list lives. */
  modal: ReactElement
}

export function useConnectionProfileModal({
  profiles,
  apiKeys,
  providers,
  onSuccess,
}: UseConnectionProfileModalOptions): ConnectionProfileModalHandle {
  const {
    form,
    saveOp,
    connectOp,
    fetchModelsOp,
    testMessageOp,
    autoConfigureOp,
    getProviderRequirements,
    resetForm,
    loadProfileIntoForm,
    handleConnect,
    handleFetchModels,
    handleTestMessage,
    handleAutoConfigure,
    handleSubmit,
  } = useProfileForm(providers, apiKeys)

  const [isOpen, setIsOpen] = useState(false)
  const [editingProfile, setEditingProfile] = useState<ConnectionProfile | null>(null)
  const [initialProvider, setInitialProvider] = useState<string | undefined>(undefined)

  const openEdit = useCallback(
    (profile: ConnectionProfile) => {
      loadProfileIntoForm(profile)
      setEditingProfile(profile)
      setInitialProvider(undefined)
      setIsOpen(true)
    },
    [loadProfileIntoForm]
  )

  const openNew = useCallback(
    (provider?: string) => {
      resetForm()
      setEditingProfile(null)
      setInitialProvider(provider)
      setIsOpen(true)
    },
    [resetForm]
  )

  const close = useCallback(() => {
    setIsOpen(false)
    setEditingProfile(null)
    setInitialProvider(undefined)
    resetForm()
  }, [resetForm])

  // Normalized names already in use, excluding the profile being edited — feeds
  // the modal's inline duplicate-name validation and unique auto-name suggestion.
  const takenNames = useMemo(
    () =>
      new Set(
        profiles
          .filter((p) => p.id !== editingProfile?.id)
          .map((p) => normalizeProfileName(p.name))
      ),
    [profiles, editingProfile]
  )

  const modal = (
    // Keyed so the modal remounts when switching profiles
    <ProfileModal
      key={editingProfile?.id || 'new'}
      isOpen={isOpen}
      onClose={close}
      onSuccess={onSuccess}
      profile={editingProfile}
      apiKeys={apiKeys}
      providers={providers}
      takenNames={takenNames}
      allProfiles={profiles}
      initialProvider={initialProvider}
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
        autoConfigureLoading: autoConfigureOp.loading,
        handleConnect,
        handleFetchModels,
        handleTestMessage,
        handleAutoConfigure,
        handleSubmit,
        getProviderRequirements,
      }}
    />
  )

  return { openNew, openEdit, modal }
}
