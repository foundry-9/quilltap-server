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
import { showErrorToast } from '@/lib/toast'
import { BaseModal } from '@/components/ui/BaseModal'
import Avatar from '@/components/ui/Avatar'

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
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedProfileId, setSelectedProfileId] = useState<string>('')

  // Fetch connection profiles when modal opens
  useEffect(() => {
    if (!isOpen) return

    const fetchProfiles = async () => {
      try {
        setLoading(true)

        const res = await fetch('/api/settings/connection-profiles')
        if (!res.ok) {
          throw new Error('Failed to fetch connection profiles')
        }

        const data = await res.json()
        setProfiles(data.profiles || [])

        // Pre-select the character's default profile if available
        if (character?.defaultConnectionProfileId) {
          setSelectedProfileId(character.defaultConnectionProfileId)
        } else if (data.profiles?.length > 0) {
          setSelectedProfileId(data.profiles[0].id)
        }
      } catch (error) {
        console.error('[SelectLLMProfileDialog] Failed to fetch profiles', {
          error: error instanceof Error ? error.message : String(error),
        })
        showErrorToast('Failed to load connection profiles')
      } finally {
        setLoading(false)
      }
    }

    fetchProfiles()
  }, [isOpen, character?.defaultConnectionProfileId])

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
              <svg
                className="animate-spin h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
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
                      ? 'qt-card-selected'
                      : 'qt-card hover:bg-muted/50'
                    }
                  `}
                >
                  <input
                    type="radio"
                    name="connectionProfile"
                    value={profile.id}
                    checked={selectedProfileId === profile.id}
                    onChange={() => setSelectedProfileId(profile.id)}
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
                    <svg className="w-5 h-5 text-primary" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
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
