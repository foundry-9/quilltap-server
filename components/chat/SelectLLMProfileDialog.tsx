'use client'

/**
 * SelectLLMProfileDialog Component
 * Characters Not Personas - Phase 5
 *
 * Dialog that appears when user stops impersonating a character.
 * Allows selecting a connection profile to assign to the character
 * so the LLM can take over.
 */

import { useState, useEffect } from 'react'
import { useConnectionProfilesQuery } from '@/lib/hooks/use-profiles'
import { orderProfilesByChatUse } from '@/lib/llm/profile-usage'
import { showErrorToast } from '@/lib/toast'
import { BaseModal } from '@/components/ui/BaseModal'
import { Icon } from '@/components/ui/icon'
import Avatar from '@/components/ui/Avatar'
import { Spinner } from '@/components/ui/Spinner'

export interface ConnectionProfile {
  id: string
  name: string
  provider?: string
  modelName?: string
}

export interface CharacterInfo {
  id: string
  name: string
  defaultImage?: {
    id: string
    filepath: string
    url?: string
  } | null
  avatarUrl?: string | null
  defaultConnectionProfileId?: string | null
}

interface SelectLLMProfileDialogProps {
  isOpen: boolean
  onClose: () => void
  character: CharacterInfo | null
  participantId: string
  onConfirm: (participantId: string, connectionProfileId: string) => void
  onCancel: () => void
}

export function SelectLLMProfileDialog({
  isOpen,
  onClose,
  character,
  participantId,
  onConfirm,
  onCancel,
}: Readonly<SelectLLMProfileDialogProps>) {
  // Shared connection-profile list, fetched only while the dialog is open.
  const {
    data: profiles = [],
    isLoading: loading,
    error: profilesError,
  } = useConnectionProfilesQuery<ConnectionProfile>({ enabled: isOpen, select: orderProfilesByChatUse })
  const [pickedProfileId, setPickedProfileId] = useState<string>('')

  // Until the operator picks one: the character's default profile if it has
  // one, otherwise the first profile in the list.
  const selectedProfileId = pickedProfileId || character?.defaultConnectionProfileId || profiles[0]?.id || ''

  useEffect(() => {
    if (!profilesError) return
    console.error('[SelectLLMProfileDialog] Failed to fetch profiles', {
      error: profilesError.message,
    })
    showErrorToast('Failed to load connection profiles')
  }, [profilesError])

  const handleConfirm = () => {
    if (!selectedProfileId) {
      showErrorToast('Please select a connection profile')
      return
    }

    onConfirm(participantId, selectedProfileId)
    onClose()
  }

  const handleCancel = () => {
    onCancel()
    onClose()
  }

  const footer = (
    <div className="flex justify-end gap-2">
      <button
        onClick={handleCancel}
        className="qt-button qt-button-secondary"
      >
        Cancel
      </button>
      <button
        onClick={handleConfirm}
        disabled={loading || !selectedProfileId}
        className="qt-button qt-button-primary"
      >
        Assign & Hand Off
      </button>
    </div>
  )

  if (!character) return null

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={handleCancel}
      title="Hand Off Character to AI"
      maxWidth="md"
      footer={footer}
    >
      <div className="space-y-4">
        {/* Character info */}
        <div className="flex items-center gap-3 p-3 qt-card">
          <Avatar
            name={character.name}
            src={character}
            size="md"
            styleOverride="RECTANGULAR"
          />
          <div>
            <div className="font-semibold">{character.name}</div>
            <div className="qt-text-xs">Will be controlled by AI</div>
          </div>
        </div>

        {/* Profile selection */}
        <div>
          <label className="qt-label mb-2 block">
            Select an LLM Connection Profile
          </label>

          {loading ? (
            <div className="flex items-center gap-2 qt-text-small py-4">
              <Spinner className="h-4 w-4" />
              Loading profiles...
            </div>
          ) : profiles.length === 0 ? (
            <div className="qt-text-small py-4 text-center">
              No connection profiles available.
              <br />
              <span className="qt-text-xs">
                Please create one in Settings &rarr; Connection Profiles.
              </span>
            </div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {profiles.map(profile => (
                <label
                  key={profile.id}
                  className={`
                    flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors
                    ${selectedProfileId === profile.id
                      ? 'qt-option-selected'
                      : 'qt-card hover:qt-bg-muted/50'
                    }
                  `}
                >
                  <input
                    type="radio"
                    name="connectionProfile"
                    value={profile.id}
                    checked={selectedProfileId === profile.id}
                    onChange={() => setPickedProfileId(profile.id)}
                    className="sr-only"
                  />
                  <div className="flex-1">
                    <div className="font-medium">{profile.name}</div>
                    {profile.modelName && (
                      <div className="qt-text-xs">
                        {profile.provider && `${profile.provider}: `}{profile.modelName}
                      </div>
                    )}
                  </div>
                  {selectedProfileId === profile.id && (
                    <Icon name="check" className="w-5 h-5 qt-text-brand" />
                  )}
                </label>
              ))}
            </div>
          )}
        </div>

        <p className="qt-text-xs">
          The selected profile will be used when this character speaks. You can change this later in the chat settings.
        </p>
      </div>
    </BaseModal>
  )
}

export default SelectLLMProfileDialog
