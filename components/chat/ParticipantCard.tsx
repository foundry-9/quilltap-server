'use client'

/**
 * ParticipantCard Component
 * Multi-Character Chat System - Phase 4
 *
 * Displays a single participant in the chat sidebar with:
 * - Avatar and name
 * - Turn position badge (numbered by predicted turn order)
 * - Connection profile dropdown (for characters)
 * - Talkativeness slider (for characters)
 * - Stop button (when generating)
 * - Active/inactive toggle (visible eye icon)
 * - Nudge/Queue button
 */

import { useState } from 'react'
import Avatar from '@/components/ui/Avatar'
import { ProviderModelBadge } from '@/components/ui/ProviderModelBadge'
import type { TurnOrderStatus } from '@/lib/chat/turn-manager'

// Special constant for user impersonation selection
const USER_IMPERSONATION_VALUE = '__user__'

export interface ParticipantData {
  id: string
  type: 'CHARACTER' | 'PERSONA'
  controlledBy?: 'llm' | 'user'
  displayOrder: number
  isActive: boolean
  /** Four-state participation status: active, silent, absent, removed */
  status?: 'active' | 'silent' | 'absent' | 'removed'
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

export interface ConnectionProfileOption {
  id: string
  name: string
  provider?: string
  modelName?: string
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
  // Turn order display
  turnPosition?: number | null // Position in predicted turn order (1-based), null for inactive
  turnStatus?: TurnOrderStatus // Status for badge styling
  onStopStreaming?: () => void // Stop/interrupt the current generation
  // Impersonation support
  isImpersonating?: boolean // True if user is currently impersonating this participant
  isActiveTyping?: boolean // True if this is the active typing participant (when impersonating multiple)
  onImpersonate?: (participantId: string) => void // Start impersonating
  onStopImpersonate?: (participantId: string) => void // Stop impersonating
  // Connection profile controls
  connectionProfiles?: ConnectionProfileOption[]
  onConnectionProfileChange?: (participantId: string, profileId: string | null, controlledBy: 'llm' | 'user') => void
  // Inline settings controls
  onActiveChange?: (participantId: string, isActive: boolean) => void
  onStatusChange?: (participantId: string, status: 'active' | 'silent' | 'absent' | 'removed') => void
  // Whisper support
  onWhisper?: (participantId: string) => void
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
  turnPosition,
  turnStatus,
  onStopStreaming,
  isImpersonating = false,
  isActiveTyping = false,
  onImpersonate,
  onStopImpersonate,
  connectionProfiles,
  onConnectionProfileChange,
  onActiveChange,
  onStatusChange,
  onWhisper,
}: ParticipantCardProps) {
  const [localTalkativeness, setLocalTalkativeness] = useState(
    participant.character?.talkativeness ?? 0.5
  )
  const isCharacter = participant.type === 'CHARACTER'
  const entity = isCharacter ? participant.character : participant.persona

  if (!entity) {
    return null
  }

  const name = entity.name
  const title = entity.title
  const participantStatus = participant.status || 'active'
  const isInactive = turnStatus === 'inactive' || turnStatus === 'absent'

  // Check if this is a user-controlled character (not LLM-controlled)
  const isUserControlledCharacter = isCharacter && participant.controlledBy === 'user'

  // Handle nudge/queue button click
  const handleActionClick = () => {
    if (queuePosition > 0) {
      // Already in queue - dequeue
      onDequeue(participant.id)
    } else if (isGenerating) {
      // Someone is actively generating - add to queue for later
      onQueue(participant.id)
    } else if (isCharacter && !isUserControlledCharacter) {
      // Not generating and this is an LLM-controlled character - nudge for immediate response
      // Only LLM-controlled characters can be nudged for AI response
      onNudge(participant.id)
    } else {
      // User persona or user-controlled character - queue them
      onQueue(participant.id)
    }
  }

  // Handle talkativeness slider change
  const handleTalkativenessChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value)
    setLocalTalkativeness(value)

    if (onTalkativenessChange) {
      onTalkativenessChange(participant.id, value)
    }
  }

  // Handle connection profile change
  const handleProfileChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (!onConnectionProfileChange) return
    const value = e.target.value
    if (value === USER_IMPERSONATION_VALUE) {
      onConnectionProfileChange(participant.id, null, 'user')
    } else {
      onConnectionProfileChange(participant.id, value || null, 'llm')
    }
  }

  // Handle active toggle via the eye icon button (legacy compat)
  const handleActiveToggleClick = () => {
    onActiveChange?.(participant.id, !participant.isActive)
  }

  // Handle status change via dropdown
  const handleStatusChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newStatus = e.target.value as 'active' | 'silent' | 'absent' | 'removed'
    if (onStatusChange) {
      onStatusChange(participant.id, newStatus)
    } else if (onActiveChange) {
      // Fallback to legacy toggle
      onActiveChange(participant.id, newStatus === 'active' || newStatus === 'silent')
    }
  }

  // Determine the current connection profile select value
  const connectionProfileValue = participant.controlledBy === 'user'
    ? USER_IMPERSONATION_VALUE
    : (participant.connectionProfile?.id || '')

  // Determine button label
  const getActionButtonLabel = () => {
    if (queuePosition > 0) return 'Dequeue'
    if (isGenerating && isCurrentTurn) return 'Speaking...'
    if (isGenerating) return 'Queue'
    if (isCurrentTurn) return isUserControlledCharacter ? 'Queue' : 'Nudge' // Their turn but not yet generating - can nudge to start (LLM only)
    // Only LLM-controlled characters show "Nudge", user-controlled show "Queue"
    return (isCharacter && !isUserControlledCharacter) ? 'Nudge' : 'Queue'
  }

  // Determine if button should be disabled - only disabled while actively generating
  const isActionDisabled = isGenerating && isCurrentTurn

  // Get the CSS class for the position badge based on turn status
  const getPositionBadgeClass = (): string => {
    if (!turnStatus) return ''
    switch (turnStatus) {
      case 'generating': return 'qt-participant-position-generating'
      case 'next': return 'qt-participant-position-next'
      case 'queued': return 'qt-participant-position-queued'
      case 'eligible': return 'qt-participant-position-eligible'
      case 'user-turn': return 'qt-participant-position-user-turn'
      case 'spoken': return 'qt-participant-position-spoken'
      default: return ''
    }
  }

  // Determine card class based on state
  const getCardClass = (): string => {
    if (isInactive) return 'qt-participant-card-inactive'
    if (participantStatus === 'silent') return isCurrentTurn ? 'qt-participant-card-active qt-participant-card-silent' : 'qt-participant-card qt-participant-card-silent'
    if (isCurrentTurn) return 'qt-participant-card-active'
    return 'qt-participant-card'
  }

  return (
    <div
      className={`
        ${getCardClass()}
        participant-card
      `}
    >
      {/* Position badge - shown for all active participants with a position */}
      {turnPosition != null && turnPosition > 0 && (
        <div className={`qt-participant-position-badge ${getPositionBadgeClass()}`} data-testid="position-badge">
          {turnPosition}
        </div>
      )}

      {/* Queue position badge - fallback when no turnPosition provided */}
      {turnPosition == null && queuePosition > 0 && (
        <div className="qt-participant-queue-badge absolute -top-2 -right-2 w-6 h-6 qt-shadow-md">
          {queuePosition}
        </div>
      )}

      {/* Turn indicator dot */}
      {isCurrentTurn && (
        <div className="qt-participant-turn-dot" />
      )}

      <div className="qt-participant-card-header">
        {/* Avatar */}
        <div className="flex-shrink-0 relative">
          <Avatar
            name={name}
            src={entity}
            size="md"
            isActive={isCurrentTurn}
            styleOverride="RECTANGULAR"
          />
          {/* Status overlay icon — visible even when sidebar is collapsed */}
          {participantStatus === 'silent' && (
            <div className="qt-participant-status-overlay qt-participant-status-overlay-silent" title="Silent">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
            </div>
          )}
          {participantStatus === 'absent' && (
            <div className="qt-participant-status-overlay qt-participant-status-overlay-absent" title="Absent">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
              </svg>
            </div>
          )}
        </div>

        {/* Info */}
        <div className="qt-participant-card-info">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="qt-participant-card-name">
              {name}
            </span>
            {/* Show "You" badge for user-controlled participants or when impersonating */}
            {(isUserParticipant || isImpersonating) && (
              <span className={`text-xs ${isImpersonating ? 'qt-badge-info' : 'qt-badge-secondary'}`}>
                {isImpersonating ? (isActiveTyping ? 'Speaking as' : 'You') : 'You'}
              </span>
            )}
            {/* Show LLM badge for LLM-controlled that could be impersonated */}
            {!isUserParticipant && !isImpersonating && participant.controlledBy === 'llm' && (
              <>
                <span className="qt-badge-secondary text-xs opacity-60">
                  AI
                </span>
                <ProviderModelBadge
                  provider={participant.connectionProfile?.provider}
                  modelName={participant.connectionProfile?.modelName}
                  size="sm"
                />
              </>
            )}
            {/* Status badge for non-active participants */}
            {participantStatus === 'silent' && (
              <span className="qt-badge-silent text-xs">Silent</span>
            )}
            {participantStatus === 'absent' && (
              <span className="qt-badge-absent text-xs">Absent</span>
            )}
          </div>

          {title && (
            <div className="qt-participant-card-status italic truncate">
              {title}
            </div>
          )}

          {/* Connection profile dropdown for characters */}
          {isCharacter && connectionProfiles && onConnectionProfileChange ? (
            <div className="mt-1">
              <select
                value={connectionProfileValue}
                onChange={handleProfileChange}
                className="qt-select qt-select-sm w-full"
                title="Connection profile"
                aria-label={`Connection profile for ${name}`}
              >
                <option value="">Select a provider...</option>
                <option value={USER_IMPERSONATION_VALUE}>User (you type)</option>
                {connectionProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.modelName || profile.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            /* Fallback: plain-text LLM indicator when no dropdown */
            isCharacter && participant.connectionProfile && (
              <div className="qt-participant-card-status mt-1 truncate flex items-center gap-1" title={`${participant.connectionProfile.provider}: ${participant.connectionProfile.modelName}`}>
                <ProviderModelBadge
                  provider={participant.connectionProfile.provider}
                  modelName={participant.connectionProfile.modelName || participant.connectionProfile.name}
                  size="sm"
                />
              </div>
            )
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
        {/* Stop button - shown when this participant is generating */}
        {turnStatus === 'generating' && onStopStreaming ? (
          <button
            onClick={onStopStreaming}
            className="flex-1 qt-button qt-button-sm qt-participant-stop-button"
            title="Stop generating"
            aria-label="Stop generating"
          >
            <svg className="w-3.5 h-3.5 mr-1" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="6" width="12" height="12" rx="1" />
            </svg>
            Stop
          </button>
        ) : isUserParticipant && onSkip ? (
          /* User participant: show Queue and Skip buttons side by side */
          <>
            <button
              onClick={handleActionClick}
              disabled={isActionDisabled}
              className={`
                flex-1
                ${queuePosition > 0
                  ? 'qt-badge-info hover:qt-bg-info/20'
                  : 'qt-button qt-button-secondary qt-button-sm'
                }
                disabled:opacity-50 disabled:cursor-not-allowed
              `}
            >
              {queuePosition > 0 ? 'Dequeue' : 'Queue'}
            </button>
            <button
              onClick={() => onSkip()}
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
                ? 'qt-badge-info hover:qt-bg-info/20'
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

        {/* Status selector — four-state dropdown replacing the old eye toggle */}
        {(onStatusChange || onActiveChange) && (
          <select
            value={participantStatus}
            onChange={handleStatusChange}
            className="qt-select qt-select-sm qt-participant-status-select py-1 px-1.5 text-xs"
            title={`Status for ${name}: ${participantStatus}`}
            aria-label={`Participation status for ${name}`}
          >
            <option value="active">Active</option>
            <option value="silent">Silent</option>
            <option value="absent">Absent</option>
          </select>
        )}

        {/* Remove button - for characters when canRemove is true
            canRemove now includes the safety check that at least one user-controlled character remains */}
        {isCharacter && onRemove && canRemove && (
          <button
            onClick={() => onRemove(participant.id)}
            disabled={isGenerating}
            className="qt-button qt-button-destructive qt-button-sm py-1.5 px-2 disabled:opacity-50 disabled:cursor-not-allowed"
            title={`Remove ${name} from chat`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}

        {/* Impersonate/Stop Impersonate button */}
        {onImpersonate && onStopImpersonate && !isUserParticipant && (
          <button
            onClick={() => {
              if (isImpersonating) {
                onStopImpersonate(participant.id)
              } else {
                onImpersonate(participant.id)
              }
            }}
            disabled={isGenerating}
            className={`
              qt-button qt-button-sm py-1.5 px-2
              ${isImpersonating
                ? 'qt-button-secondary'
                : 'qt-button-primary'
              }
              disabled:opacity-50 disabled:cursor-not-allowed
            `}
            title={isImpersonating ? `Stop speaking as ${name}` : `Speak as ${name}`}
          >
            {isImpersonating ? (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            )}
          </button>
        )}

        {/* Whisper button - for non-user participants */}
        {onWhisper && !isUserParticipant && (
          <button
            onClick={() => onWhisper(participant.id)}
            className="qt-button qt-button-sm py-1.5 px-2 qt-button-secondary"
            title={`Whisper to ${name}`}
            aria-label={`Whisper to ${name}`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </button>
        )}

      </div>
    </div>
  )
}

export default ParticipantCard
