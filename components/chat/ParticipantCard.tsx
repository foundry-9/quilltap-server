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
  onTalkativenessChange?: (participantId: string, value: number) => void
  isUserParticipant?: boolean // True if this is the user's persona
}

export function ParticipantCard({
  participant,
  isCurrentTurn,
  queuePosition,
  isGenerating,
  onNudge,
  onQueue,
  onDequeue,
  onTalkativenessChange,
  isUserParticipant = false,
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

  // Get avatar source
  const getAvatarSrc = () => {
    if (entity.defaultImage) {
      const filepath = entity.defaultImage.url || entity.defaultImage.filepath
      return filepath.startsWith('/') ? filepath : `/${filepath}`
    }
    return entity.avatarUrl || null
  }

  const avatarSrc = getAvatarSrc()

  // Handle nudge/queue button click
  const handleActionClick = () => {
    clientLogger.debug('[ParticipantCard] Action clicked', {
      participantId: participant.id,
      queuePosition,
      isGenerating,
      isCurrentTurn,
    })

    if (queuePosition > 0) {
      // Already in queue - dequeue
      onDequeue(participant.id)
    } else if (isGenerating || (!isCurrentTurn && !isUserParticipant)) {
      // Someone is generating or it's not their turn - add to queue
      onQueue(participant.id)
    } else {
      // Not generating and eligible - nudge for immediate response
      onNudge(participant.id)
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
    if (isGenerating) return 'Queue'
    if (isCurrentTurn) return 'Speaking...'
    return isCharacter ? 'Nudge' : 'Queue'
  }

  // Determine if button should be disabled
  const isActionDisabled = isCurrentTurn && !queuePosition

  return (
    <div
      className={`
        relative p-3 rounded-lg border transition-all duration-200
        ${isCurrentTurn
          ? 'border-primary bg-primary/5 shadow-[0_0_10px_rgba(var(--primary),0.3)]'
          : 'border-border bg-card hover:bg-muted/50'
        }
      `}
    >
      {/* Queue position badge */}
      {queuePosition > 0 && (
        <div className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-info text-info-foreground text-xs font-bold flex items-center justify-center shadow-md">
          {queuePosition}
        </div>
      )}

      {/* Turn indicator dot */}
      {isCurrentTurn && (
        <div className="absolute top-2 left-2 w-2 h-2 rounded-full bg-success animate-pulse" />
      )}

      <div className="flex gap-3">
        {/* Avatar */}
        <div className="flex-shrink-0">
          <div
            className={`
              w-12 h-15 rounded overflow-hidden bg-muted flex items-center justify-center
              ${isCurrentTurn ? 'ring-2 ring-primary ring-offset-1 ring-offset-card' : ''}
            `}
            style={{ width: '48px', height: '60px' }}
          >
            {avatarSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarSrc}
                alt={name}
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-lg font-bold text-muted-foreground">
                {name.charAt(0).toUpperCase()}
              </span>
            )}
          </div>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm text-foreground truncate">
              {name}
            </span>
            {isUserParticipant && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                You
              </span>
            )}
          </div>

          {title && (
            <div className="text-xs text-muted-foreground italic truncate">
              {title}
            </div>
          )}

          {/* LLM indicator for characters */}
          {isCharacter && participant.connectionProfile && (
            <div className="text-xs text-muted-foreground mt-1 truncate" title={`${participant.connectionProfile.provider}: ${participant.connectionProfile.modelName}`}>
              {participant.connectionProfile.modelName || participant.connectionProfile.name}
            </div>
          )}

          {/* Talkativeness slider for characters */}
          {isCharacter && !isUserParticipant && (
            <div className="mt-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
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
                className="w-full h-1 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
              />
            </div>
          )}

          {/* Talkativeness indicator for personas (greyed out) */}
          {isUserParticipant && (
            <div className="mt-2 opacity-50">
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
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
                className="w-full h-1 bg-muted rounded-lg appearance-none cursor-not-allowed"
              />
            </div>
          )}
        </div>
      </div>

      {/* Action button */}
      <div className="mt-3">
        <button
          onClick={handleActionClick}
          disabled={isActionDisabled}
          className={`
            w-full py-1.5 px-3 text-xs font-medium rounded transition-colors
            ${queuePosition > 0
              ? 'bg-info/10 text-info hover:bg-info/20 border border-info/30'
              : isCurrentTurn
                ? 'bg-success/10 text-success border border-success/30 cursor-default'
                : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
            }
            disabled:opacity-50 disabled:cursor-not-allowed
          `}
        >
          {getActionButtonLabel()}
        </button>
      </div>
    </div>
  )
}

export default ParticipantCard
