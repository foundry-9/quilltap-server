'use client'

/**
 * BulkCharacterReplaceModal Component
 *
 * Modal dialog for re-attributing multiple messages from one participant
 * to another in a single operation. Supports filtering by message role
 * (assistant/user/both). Associated memories are deleted.
 */

import { useState, useRef, useEffect, useMemo } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import Avatar from '@/components/ui/Avatar'
import { useClickOutside } from '@/hooks/useClickOutside'

interface ParticipantData {
  id: string
  type: 'CHARACTER' | 'PERSONA'
  controlledBy?: 'llm' | 'user'
  character?: {
    id: string
    name: string
    title?: string | null
    avatarUrl?: string
    defaultImage?: {
      id?: string
      filepath?: string
      url?: string
    } | null
  } | null
  persona?: {
    id: string
    name: string
    title?: string | null
    avatarUrl?: string
    defaultImage?: {
      id?: string
      filepath?: string
      url?: string
    } | null
  } | null
}

interface MessageData {
  id: string
  role: string
  participantId?: string | null
}

interface BulkCharacterReplaceModalProps {
  isOpen: boolean
  onClose: () => void
  chatId: string
  participants: ParticipantData[]
  messages: MessageData[]
  onSuccess: () => void
}

type RoleFilter = 'ASSISTANT' | 'USER' | 'both'

// Special value to represent messages with null participantId (the actual user)
const UNASSIGNED_USER = '__UNASSIGNED__'

export default function BulkCharacterReplaceModal({
  isOpen,
  onClose,
  chatId,
  participants,
  messages,
  onSuccess,
}: Readonly<BulkCharacterReplaceModalProps>) {
  // Use a special string value for "unassigned" selection, empty string for "not selected"
  const [sourceSelection, setSourceSelection] = useState<string>('')
  const [targetSelection, setTargetSelection] = useState<string>('')
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('both')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const modalRef = useRef<HTMLDivElement>(null)

  // Check if there are any messages with null participantId
  const hasUnassignedMessages = useMemo(() => {
    return messages.some((msg) => msg.participantId === null || msg.participantId === undefined)
  }, [messages])

  // Convert selection strings to actual participantId values (null for unassigned)
  const sourceParticipantId = sourceSelection === UNASSIGNED_USER ? null : (sourceSelection || null)
  const targetParticipantId = targetSelection === UNASSIGNED_USER ? null : (targetSelection || null)

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setSourceSelection('')
      setTargetSelection('')
      setRoleFilter('both')
      clientLogger.debug('[BulkCharacterReplaceModal] Modal opened', {
        chatId,
        participantCount: participants.length,
        messageCount: messages.length,
        hasUnassignedMessages,
      })
    }
  }, [isOpen, chatId, participants.length, messages.length, hasUnassignedMessages])

  // Handle click outside to close
  useClickOutside(
    modalRef,
    () => {
      if (!isSubmitting) onClose()
    },
    {
      enabled: isOpen,
      onEscape: () => {
        if (!isSubmitting) onClose()
      },
    }
  )

  // Compute affected message count
  const affectedCount = useMemo(() => {
    // Must have a source selection (empty string means not selected)
    if (!sourceSelection) return 0
    return messages.filter((msg) => {
      // Handle unassigned (null) participantId
      if (sourceSelection === UNASSIGNED_USER) {
        if (msg.participantId !== null && msg.participantId !== undefined) return false
      } else {
        if (msg.participantId !== sourceSelection) return false
      }
      if (roleFilter === 'both') return true
      // Compare with uppercase role (msg.role may be lowercase from frontend types)
      return msg.role.toUpperCase() === roleFilter
    }).length
  }, [messages, sourceSelection, roleFilter])

  // Filter target participants (exclude source if it's a participant)
  const availableTargets = useMemo(() => {
    if (sourceSelection === UNASSIGNED_USER) {
      // If source is unassigned, all participants are valid targets
      return participants
    }
    return participants.filter((p) => p.id !== sourceSelection)
  }, [participants, sourceSelection])

  // Clear target when source changes (if target equals source)
  useEffect(() => {
    if (targetSelection && targetSelection === sourceSelection) {
      setTargetSelection('')
    }
  }, [sourceSelection, targetSelection])

  const handleSubmit = async () => {
    // Check selections, not participantIds, since null is valid for unassigned
    if (!sourceSelection || !targetSelection) {
      showErrorToast('Please select both source and target participants')
      return
    }

    if (affectedCount === 0) {
      showErrorToast('No messages match the selected criteria')
      return
    }

    setIsSubmitting(true)
    clientLogger.debug('[BulkCharacterReplaceModal] Submitting bulk re-attribution', {
      chatId,
      sourceParticipantId,
      targetParticipantId,
      roleFilter,
      affectedCount,
    })

    try {
      const response = await fetch(`/api/chats/${chatId}/bulk-reattribute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceParticipantId,
          targetParticipantId,
          roleFilter,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to re-attribute messages')
      }

      const result = await response.json()

      clientLogger.info('[BulkCharacterReplaceModal] Bulk re-attribution successful', {
        chatId,
        messagesUpdated: result.messagesUpdated,
        memoriesDeleted: result.memoriesDeleted,
      })

      const targetParticipant = participants.find((p) => p.id === targetParticipantId)
      const targetName =
        targetParticipant?.character?.name || targetParticipant?.persona?.name || 'participant'

      let successMessage = `${result.messagesUpdated} ${result.messagesUpdated === 1 ? 'message' : 'messages'} re-attributed to ${targetName}.`
      if (result.memoriesDeleted > 0) {
        successMessage += ` ${result.memoriesDeleted} ${result.memoriesDeleted === 1 ? 'memory' : 'memories'} deleted.`
      }

      showSuccessToast(successMessage)
      onSuccess()
      onClose()
    } catch (error) {
      clientLogger.error('[BulkCharacterReplaceModal] Error during bulk re-attribution', {
        error: error instanceof Error ? error.message : String(error),
      })
      showErrorToast(error instanceof Error ? error.message : 'Failed to re-attribute messages')
    } finally {
      setIsSubmitting(false)
    }
  }

  const getParticipantName = (participant: ParticipantData): string => {
    return participant.character?.name || participant.persona?.name || 'Unknown'
  }

  const getParticipantAvatarSrc = (participant: ParticipantData) => {
    return participant.character || participant.persona || null
  }

  const getControlLabel = (participant: ParticipantData): string => {
    if (participant.controlledBy === 'user') {
      return 'User-controlled'
    }
    return participant.type === 'CHARACTER' ? 'Character' : 'Persona'
  }

  if (!isOpen) return null

  return (
    <div className="qt-dialog-overlay p-4">
      <div ref={modalRef} className="qt-dialog max-w-lg">
        {/* Header */}
        <div className="qt-dialog-header flex items-center justify-between">
          <h2 className="qt-dialog-title">Bulk Character Replace</h2>
          <button
            onClick={onClose}
            className="qt-button qt-button-ghost p-2"
            disabled={isSubmitting}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="qt-dialog-body space-y-5">
          {participants.length < 2 && !hasUnassignedMessages ? (
            <div className="text-center py-8 text-muted-foreground">
              This chat needs at least 2 participants to use bulk character replace.
            </div>
          ) : (
            <>
              {/* Source Participant */}
              <div className="space-y-2">
                <label className="block text-sm font-medium">Re-attribute from:</label>
                <select
                  value={sourceSelection}
                  onChange={(e) => setSourceSelection(e.target.value)}
                  disabled={isSubmitting}
                  className="qt-select w-full"
                >
                  <option value="">Select participant...</option>
                  {hasUnassignedMessages && (
                    <option value={UNASSIGNED_USER}>Unassigned (You)</option>
                  )}
                  {participants.map((p) => (
                    <option key={p.id} value={p.id}>
                      {getParticipantName(p)} ({getControlLabel(p)})
                    </option>
                  ))}
                </select>
              </div>

              {/* Target Participant */}
              <div className="space-y-2">
                <label className="block text-sm font-medium">Re-attribute to:</label>
                <select
                  value={targetSelection}
                  onChange={(e) => setTargetSelection(e.target.value)}
                  disabled={isSubmitting || !sourceSelection}
                  className="qt-select w-full"
                >
                  <option value="">Select participant...</option>
                  {availableTargets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {getParticipantName(p)} ({getControlLabel(p)})
                    </option>
                  ))}
                </select>
              </div>

              {/* Role Filter */}
              <div className="space-y-2">
                <label className="block text-sm font-medium">Which messages?</label>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="roleFilter"
                      value="ASSISTANT"
                      checked={roleFilter === 'ASSISTANT'}
                      onChange={() => setRoleFilter('ASSISTANT')}
                      disabled={isSubmitting}
                      className="qt-radio"
                    />
                    <span className="text-sm">AI responses only</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="roleFilter"
                      value="USER"
                      checked={roleFilter === 'USER'}
                      onChange={() => setRoleFilter('USER')}
                      disabled={isSubmitting}
                      className="qt-radio"
                    />
                    <span className="text-sm">User messages only</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="roleFilter"
                      value="both"
                      checked={roleFilter === 'both'}
                      onChange={() => setRoleFilter('both')}
                      disabled={isSubmitting}
                      className="qt-radio"
                    />
                    <span className="text-sm">All messages</span>
                  </label>
                </div>
              </div>

              {/* Affected Count & Warning */}
              {sourceSelection && targetSelection && (
                <div className="qt-alert qt-alert-warning">
                  <div className="flex items-start gap-3">
                    <svg
                      className="w-5 h-5 flex-shrink-0 mt-0.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                      />
                    </svg>
                    <div className="text-sm">
                      <p className="font-medium">
                        {affectedCount} {affectedCount === 1 ? 'message' : 'messages'} will be
                        re-attributed
                      </p>
                      <p className="mt-1 opacity-80">
                        Memories extracted from these messages will be permanently deleted.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="qt-dialog-footer flex justify-end gap-2">
          <button onClick={onClose} className="qt-button qt-button-secondary" disabled={isSubmitting}>
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="qt-button qt-button-primary"
            disabled={
              isSubmitting ||
              !sourceSelection ||
              !targetSelection ||
              affectedCount === 0 ||
              (participants.length < 2 && !hasUnassignedMessages)
            }
          >
            {isSubmitting ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
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
                Re-attributing...
              </span>
            ) : (
              'Re-attribute Messages'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
