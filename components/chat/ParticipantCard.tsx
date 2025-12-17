'use client'

/**
 * ParticipantCard Component
 * Multi-Character Chat System - Phase 4
 *
 * Displays a single participant in the chat sidebar with:
 * - Avatar and name
 * - Turn indicator (glowing border when it's their turn)
 * - Talkativeness slider (for characters)
 * - LLM backend indicator (for characters)
 * - Queue position badge (when queued)
 * - Nudge/Queue button
 */

import { useState } from 'react'
import { clientLogger } from '@/lib/client-logger'
import Avatar from '@/components/ui/Avatar'

export interface ParticipantData {
  id: string
  type: 'CHARACTER' | 'PERSONA'
  displayOrder: number
  isActive: boolean
  character?: {
    id: string
    name: string
    title?: string | null
    avatarUrl?: string | null
    talkativeness: number
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
    avatarUrl?: string | null
    defaultImage?: {
      id: string
      filepath: string
      url?: string
    } | null
  } | null
  connectionProfile?: {
    id: string
    name: string
    provider?: string
    modelName?: string
  } | null
}

interface ParticipantCardProps {
  participant: ParticipantData
  isCurrentTurn: boolean
  queuePosition: number // 0 = not in queue, 1+ = position in queue
  isGenerating: boolean
  onNudge: (participantId: string) => void
  onQueue: (participantId: string) => void
  onDequeue: (participantId: string) => void
  onSkip?: () => void // Skip turn (for user participants in multi-char chat)
  onTalkativenessChange?: (participantId: string, value: number) => void
  onRemove?: (participantId: string) => void // Phase 6: Remove character from chat
  isUserParticipant?: boolean // True if this is the user's persona
  canRemove?: boolean // True if this character can be removed (not the only character)
  canSkip?: boolean // True if user can skip their turn (next speaker is null = user's turn)
}

export function ParticipantCard({
  participant,
  isCurrentTurn,
  queuePosition,
  isGenerating,
  onNudge,
  onQueue,
  onDequeue,
  onSkip,
  onTalkativenessChange,
  onRemove,
  isUserParticipant = false,
  canRemove = true,
  canSkip = false,
}: ParticipantCardProps) {
  const [localTalkativeness, setLocalTalkativeness] = useState(
    participant.character?.talkativeness ?? 0.5
  )

  const isCharacter = participant.type === 'CHARACTER'
  const entity = isCharacter ? participant.character : participant.persona

  if (!entity) {
    clientLogger.warn('[ParticipantCard] No entity data for participant', { participantId: participant.id })
    return null
  }

  const name = entity.name
  const title = entity.title
  const talkativeness = participant.character?.talkativeness ?? 0.5


  // Handle nudge/queue button click
  const handleActionClick = () => {
    clientLogger.debug('[ParticipantCard] Action clicked', {
      participantId: participant.id,
      queuePosition,
      isGenerating,
      isCurrentTurn,
      isCharacter,
    })

    if (queuePosition > 0) {
      // Already in queue - dequeue
      onDequeue(participant.id)
    } else if (isGenerating) {
      // Someone is actively generating - add to queue for later
      onQueue(participant.id)
    } else if (isCharacter) {
      // Not generating and this is a character - nudge for immediate response
      // Characters can always be nudged when no one is generating
      onNudge(participant.id)
    } else {
      // User persona - queue them
      onQueue(participant.id)
    }
  }

  // Handle talkativeness slider change
  const handleTalkativenessChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value)
    setLocalTalkativeness(value)

    clientLogger.debug('[ParticipantCard] Talkativeness changed', {
      participantId: participant.id,
      value,
    })

    if (onTalkativenessChange) {
      onTalkativenessChange(participant.id, value)
    }
  }

  // Determine button label
  const getActionButtonLabel = () => {
    if (queuePosition > 0) return 'Dequeue'
    if (isGenerating && isCurrentTurn) return 'Speaking...'
    if (isGenerating) return 'Queue'
    if (isCurrentTurn) return 'Nudge' // Their turn but not yet generating - can nudge to start
    return isCharacter ? 'Nudge' : 'Queue'
  }

  // Determine if button should be disabled - only disabled while actively generating
  const isActionDisabled = isGenerating && isCurrentTurn

  return (
    <div
      className={`
        ${isCurrentTurn ? 'qt-participant-card-active' : 'qt-participant-card'}
        participant-card
      `}
    >
      {/* Queue position badge */}
      {queuePosition > 0 && (
        <div className="qt-participant-queue-badge absolute -top-2 -right-2 w-6 h-6 shadow-md">
          {queuePosition}
        </div>
      )}

      {/* Turn indicator dot */}
      {isCurrentTurn && (
        <div className="qt-participant-turn-dot" />
      )}

      <div className="qt-participant-card-header">
        {/* Avatar */}
        <div className="flex-shrink-0">
          <Avatar
            name={name}
            src={entity}
            size="md"
            isActive={isCurrentTurn}
            styleOverride="RECTANGULAR"
          />
        </div>

        {/* Info */}
        <div className="qt-participant-card-info">
          <div className="flex items-center gap-2">
            <span className="qt-participant-card-name">
              {name}
            </span>
            {isUserParticipant && (
              <span className="qt-badge-secondary text-xs">
                You
              </span>
            )}
          </div>

          {title && (
            <div className="qt-participant-card-status italic truncate">
              {title}
            </div>
          )}

          {/* LLM indicator for characters */}
          {isCharacter && participant.connectionProfile && (
            <div className="qt-participant-card-status mt-1 truncate" title={`${participant.connectionProfile.provider}: ${participant.connectionProfile.modelName}`}>
              {participant.connectionProfile.modelName || participant.connectionProfile.name}
            </div>
          )}

          {/* Talkativeness slider for characters */}
          {isCharacter && !isUserParticipant && (
            <div className="mt-2">
              <div className="flex items-center justify-between qt-text-xs mb-1">
                <span>Talkativeness</span>
                <span>{(localTalkativeness * 100).toFixed(0)}%</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="1"
                step="0.1"
                value={localTalkativeness}
                onChange={handleTalkativenessChange}
                className="qt-input w-full h-1 rounded-lg appearance-none cursor-pointer accent-primary"
              />
            </div>
          )}

          {/* Talkativeness indicator for personas (greyed out) */}
          {isUserParticipant && (
            <div className="mt-2 opacity-50">
              <div className="flex items-center justify-between qt-text-xs mb-1">
                <span>Talkativeness</span>
                <span>N/A</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="1"
                step="0.1"
                value={0.5}
                disabled
                className="qt-input w-full h-1 rounded-lg appearance-none cursor-not-allowed"
              />
            </div>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="qt-participant-card-actions">
        {/* User participant: show Queue and Skip buttons side by side */}
        {isUserParticipant && onSkip ? (
          <>
            <button
              onClick={handleActionClick}
              disabled={isActionDisabled}
              className={`
                flex-1
                ${queuePosition > 0
                  ? 'qt-badge-info hover:bg-info/20'
                  : 'qt-button qt-button-secondary qt-button-sm'
                }
                disabled:opacity-50 disabled:cursor-not-allowed
              `}
            >
              {queuePosition > 0 ? 'Dequeue' : 'Queue'}
            </button>
            <button
              onClick={() => {
                clientLogger.debug('[ParticipantCard] Skip clicked')
                onSkip()
              }}
              disabled={isGenerating || !canSkip}
              className="flex-1 qt-button qt-button-sm qt-chat-continue-button disabled:opacity-50 disabled:cursor-not-allowed"
              title={canSkip ? 'Skip your turn and let a character respond' : "It's not your turn to skip"}
            >
              Skip
            </button>
          </>
        ) : (
          /* Character participants: normal single button */
          <button
            onClick={handleActionClick}
            disabled={isActionDisabled}
            className={`
              flex-1
              ${queuePosition > 0
                ? 'qt-badge-info hover:bg-info/20'
                : isCurrentTurn
                  ? 'qt-participant-turn-indicator cursor-default'
                  : 'qt-button qt-button-secondary qt-button-sm'
              }
              disabled:opacity-50 disabled:cursor-not-allowed
            `}
          >
            {getActionButtonLabel()}
          </button>
        )}

        {/* Remove button - only for characters, not user personas */}
        {isCharacter && !isUserParticipant && onRemove && canRemove && (
          <button
            onClick={() => {
              clientLogger.debug('[ParticipantCard] Remove clicked', {
                participantId: participant.id,
                characterName: name,
              })
              onRemove(participant.id)
            }}
            disabled={isGenerating}
            className="qt-button qt-button-destructive qt-button-sm py-1.5 px-2 disabled:opacity-50 disabled:cursor-not-allowed"
            title={`Remove ${name} from chat`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}

export default ParticipantCard
