'use client'

/**
 * ReattributeMessageDialog Component
 *
 * Dialog for changing which participant (character/persona) is attributed
 * as the sender of a message. When re-attributed, associated memories
 * are deleted.
 */

import { useState, useRef, useEffect } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import Avatar from '@/components/ui/Avatar'
import { useClickOutside } from '@/hooks/useClickOutside'

interface ParticipantData {
  id: string
  type: 'CHARACTER' | 'PERSONA'
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
  persona?: {
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
  const modalRef = useRef<HTMLDivElement>(null)

  // Reset selection when dialog opens
  useEffect(() => {
    if (isOpen) {
      setSelectedParticipantId(null)
      clientLogger.debug('[ReattributeMessageDialog] Dialog opened', {
        messageId,
        currentParticipantId,
        participantCount: participants.length,
      })
    }
  }, [isOpen, messageId, currentParticipantId, participants.length])

  // Handle click outside to close
  useClickOutside(modalRef, () => { if (!isSubmitting) onClose() }, {
    enabled: isOpen,
    onEscape: () => { if (!isSubmitting) onClose() },
  })

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
    clientLogger.debug('[ReattributeMessageDialog] Submitting re-attribution', {
      messageId,
      newParticipantId: selectedParticipantId,
    })

    try {
      const response = await fetch(`/api/v1/messages/${messageId}?action=reattribute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          newParticipantId: selectedParticipantId,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to re-attribute message')
      }

      const result = await response.json()

      clientLogger.info('[ReattributeMessageDialog] Message re-attributed successfully', {
        messageId,
        newParticipantId: selectedParticipantId,
        memoriesDeleted: result.memoriesDeleted,
      })

      const selectedParticipant = participants.find(p => p.id === selectedParticipantId)
      const name = selectedParticipant?.character?.name || selectedParticipant?.persona?.name || 'participant'

      showSuccessToast(
        result.memoriesDeleted > 0
          ? `Message re-attributed to ${name}. ${result.memoriesDeleted} ${result.memoriesDeleted === 1 ? 'memory' : 'memories'} deleted.`
          : `Message re-attributed to ${name}.`
      )

      onReattributed()
      onClose()
    } catch (error) {
      clientLogger.error('[ReattributeMessageDialog] Error re-attributing message', {
        error: error instanceof Error ? error.message : String(error),
      })
      showErrorToast(error instanceof Error ? error.message : 'Failed to re-attribute message')
    } finally {
      setIsSubmitting(false)
    }
  }

  const getParticipantName = (participant: ParticipantData): string => {
    return participant.character?.name || participant.persona?.name || 'Unknown'
  }

  const getParticipantTitle = (participant: ParticipantData): string | null | undefined => {
    return participant.character?.title || participant.persona?.title
  }

  const getParticipantAvatarSrc = (participant: ParticipantData) => {
    return participant.character || participant.persona || null
  }

  if (!isOpen) return null

  return (
    <div className="qt-dialog-overlay p-4">
      <div
        ref={modalRef}
        className="qt-dialog max-w-md"
      >
        {/* Header */}
        <div className="qt-dialog-header flex items-center justify-between">
          <h2 className="qt-dialog-title">
            Re-attribute Message
          </h2>
          <button
            onClick={onClose}
            className="qt-button qt-button-ghost p-2"
            disabled={isSubmitting}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="qt-dialog-body">
          {availableParticipants.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
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
                          ? 'border-primary bg-primary/10 ring-2 ring-primary'
                          : 'border-border hover:border-primary/50 hover:bg-muted/50'
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
                            <span className="font-semibold text-foreground truncate">
                              {name}
                            </span>
                            <span className="qt-text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                              {participant.type === 'CHARACTER' ? 'Character' : 'Persona'}
                            </span>
                          </div>
                          {title && (
                            <div className="qt-text-xs italic truncate text-muted-foreground">
                              {title}
                            </div>
                          )}
                        </div>

                        {/* Selected indicator */}
                        {isSelected && (
                          <svg className="w-5 h-5 text-primary flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                          </svg>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="qt-dialog-footer flex justify-end gap-2">
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
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Re-attributing...
              </span>
            ) : (
              'Re-attribute'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
