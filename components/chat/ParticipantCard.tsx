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
 * - Expandable settings section (system prompt override only)
 */

import { useState, useRef } from 'react'
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
  systemPromptOverride?: string | null
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
  onSystemPromptOverrideChange?: (participantId: string, override: string | null) => void
  onActiveChange?: (participantId: string, isActive: boolean) => void
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
  onSystemPromptOverrideChange,
  onActiveChange,
  onWhisper,
}: ParticipantCardProps) {
  const [localTalkativeness, setLocalTalkativeness] = useState(
    participant.character?.talkativeness ?? 0.5
  )
  const [settingsExpanded, setSettingsExpanded] = useState(false)
  const [localSystemPrompt, setLocalSystemPrompt] = useState(
    participant.systemPromptOverride || ''
  )
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isCharacter = participant.type === 'CHARACTER'
  const entity = isCharacter ? participant.character : participant.persona

  if (!entity) {
    return null
  }

  const name = entity.name
  const title = entity.title
  const isInactive = turnStatus === 'inactive'

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

  // Handle system prompt override with debounce
  const handleSystemPromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setLocalSystemPrompt(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      onSystemPromptOverrideChange?.(participant.id, value || null)
    }, 600)
  }

  // Handle active toggle via the eye icon button
  const handleActiveToggleClick = () => {
    onActiveChange?.(participant.id, !participant.isActive)
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
                  ? 'qt-badge-info hover:bg-info/20'
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

        {/* Active/inactive toggle - visible eye icon */}
        {onActiveChange && (
          <button
            onClick={handleActiveToggleClick}
            className="qt-button qt-button-sm py-1.5 px-2 qt-participant-active-toggle qt-button-secondary"
            data-active={participant.isActive ? 'true' : 'false'}
            title={participant.isActive ? `Deactivate ${name}` : `Activate ${name}`}
            aria-label={participant.isActive ? `Deactivate ${name}` : `Activate ${name}`}
          >
            {participant.isActive ? (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
              </svg>
            )}
          </button>
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

        {/* Settings toggle button - now only for system prompt override */}
        {onSystemPromptOverrideChange && (
          <button
            onClick={() => setSettingsExpanded(!settingsExpanded)}
            className={`qt-button qt-button-sm py-1.5 px-2 ${settingsExpanded ? 'qt-button-primary' : 'qt-button-secondary'}`}
            title={settingsExpanded ? 'Hide settings' : 'Show settings'}
            aria-label={settingsExpanded ? 'Hide participant settings' : 'Show participant settings'}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        )}
      </div>

      {/* Expandable settings section - system prompt override only */}
      {settingsExpanded && onSystemPromptOverrideChange && (
        <div className="mt-2 pt-2 border-t border-border space-y-2">
          <div>
            <label className="qt-text-xs block mb-1">System Prompt Override</label>
            <textarea
              value={localSystemPrompt}
              onChange={handleSystemPromptChange}
              placeholder="Custom scenario or context..."
              rows={2}
              className="qt-textarea qt-text-xs w-full"
            />
          </div>
        </div>
      )}
    </div>
  )
}

export default ParticipantCard
