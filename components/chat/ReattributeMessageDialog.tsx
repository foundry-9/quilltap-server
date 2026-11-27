'use client'

/**
 * ReattributeMessageDialog Component
 *
 * Dialog for changing which participant (character) is attributed
 * as the sender of a message. When re-attributed, associated memories
 * are deleted.
 */

import { useState, useEffect } from 'react'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { apiFetch, apiErrorMessage } from '@/lib/query/fetcher'
import Avatar from '@/components/ui/Avatar'
import { Icon } from '@/components/ui/icon'
import { BaseModal } from '@/components/ui/BaseModal'
import { Spinner } from '@/components/ui/Spinner'

interface ParticipantData {
  id: string
  type: 'CHARACTER'
  character?: {
    id: string
    name: string
    title?: string | null
    avatarUrl?: string
    defaultImage?: {
      id: string
      filepath: string
      url?: string
    } | null
  } | null
}

interface ReattributeMessageDialogProps {
  isOpen: boolean
  onClose: () => void
  messageId: string
  currentParticipantId: string | null
  participants: ParticipantData[]
  onReattributed: () => void
}

export default function ReattributeMessageDialog({
  isOpen,
  onClose,
  messageId,
  currentParticipantId,
  participants,
  onReattributed,
}: ReattributeMessageDialogProps) {
  const [selectedParticipantId, setSelectedParticipantId] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Reset selection when dialog opens
  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- modal reset on open; parent renders unconditionally
      setSelectedParticipantId(null)
    }
  }, [isOpen, messageId, currentParticipantId, participants.length])

  // Filter to only show other participants (exclude current)
  const availableParticipants = participants.filter(
    (p) => p.id !== currentParticipantId
  )

  const handleReattribute = async () => {
    if (!selectedParticipantId) {
      showErrorToast('Please select a participant')
      return
    }

    setIsSubmitting(true)

    try {
      const result = await apiFetch<{ memoriesDeleted?: number }>(
        `/api/v1/messages/${messageId}?action=reattribute`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            newParticipantId: selectedParticipantId,
          }),
        },
      )

      const selectedParticipant = participants.find(p => p.id === selectedParticipantId)
      const name = selectedParticipant?.character?.name || 'participant'

      const memoriesDeleted = result.memoriesDeleted ?? 0
      showSuccessToast(
        memoriesDeleted > 0
          ? `Message re-attributed to ${name}. ${memoriesDeleted} ${memoriesDeleted === 1 ? 'memory' : 'memories'} deleted.`
          : `Message re-attributed to ${name}.`
      )

      onReattributed()
      onClose()
    } catch (error) {
      const message = apiErrorMessage(error, '') || 'Failed to re-attribute message'
      console.error('[ReattributeMessageDialog] Error re-attributing message', { error: message })
      showErrorToast(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const getParticipantName = (participant: ParticipantData): string => {
    return participant.character?.name || 'Unknown'
  }

  const getParticipantTitle = (participant: ParticipantData): string | null | undefined => {
    return participant.character?.title
  }

  const getParticipantAvatarSrc = (participant: ParticipantData) => {
    return participant.character || null
  }

  if (!isOpen) return null

  const footer = (
    <>
      <button
        onClick={onClose}
        className="qt-button qt-button-secondary"
        disabled={isSubmitting}
      >
        Cancel
      </button>
      <button
        onClick={handleReattribute}
        className="qt-button qt-button-primary"
        disabled={isSubmitting || !selectedParticipantId || availableParticipants.length === 0}
      >
        {isSubmitting ? (
          <span className="flex items-center gap-2">
            <Spinner className="h-4 w-4" />
            Re-attributing...
          </span>
        ) : (
          'Re-attribute'
        )}
      </button>
    </>
  )

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="Re-attribute Message"
      maxWidth="md"
      busy={isSubmitting}
      footerClassName="qt-dialog-footer-default flex justify-end gap-2"
      headerActions={
        <button
          aria-label="Close"
          onClick={onClose}
          className="qt-button qt-button-ghost p-2"
          disabled={isSubmitting}
        >
          <Icon name="close" className="w-6 h-6" />
        </button>
      }
      footer={footer}
    >
      {availableParticipants.length === 0 ? (
        <div className="text-center py-8 qt-text-secondary">
          No other participants available in this chat.
        </div>
      ) : (
        <div className="space-y-4">
          <p className="qt-text-secondary text-sm">
            Select who should be attributed as the sender of this message.
            Any memories associated with this message will be deleted.
          </p>

          {/* Participant list */}
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {availableParticipants.map((participant) => {
              const isSelected = selectedParticipantId === participant.id
              const name = getParticipantName(participant)
              const title = getParticipantTitle(participant)
              const avatarSrc = getParticipantAvatarSrc(participant)

              return (
                <button
                  key={participant.id}
                  onClick={() => setSelectedParticipantId(participant.id)}
                  disabled={isSubmitting}
                  className={`
                    w-full p-3 rounded-lg border text-left transition-all
                    ${isSelected
                      ? 'qt-border-primary qt-bg-primary/10 ring-2 qt-ring-brand'
                      : 'qt-border-default hover:qt-border-primary/50 hover:qt-bg-muted/50'
                    }
                    disabled:opacity-50 disabled:cursor-not-allowed
                  `}
                >
                  <div className="flex items-center gap-3">
                    {/* Avatar */}
                    <Avatar
                      name={name}
                      src={avatarSrc}
                      size="md"
                      styleOverride="RECTANGULAR"
                    />

                    {/* Info */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold qt-text truncate">
                          {name}
                        </span>
                        <span className="qt-text-xs px-1.5 py-0.5 rounded qt-bg-muted qt-text-secondary">
                          {participant.type === 'CHARACTER' ? 'Character' : 'Persona'}
                        </span>
                      </div>
                      {title && (
                        <div className="qt-text-xs italic truncate qt-text-secondary">
                          {title}
                        </div>
                      )}
                    </div>

                    {/* Selected indicator */}
                    {isSelected && (
                      <Icon name="check-circle" className="w-5 h-5 qt-text-brand flex-shrink-0" />
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </BaseModal>
  )
}
