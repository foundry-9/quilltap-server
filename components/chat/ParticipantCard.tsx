'use client'

/**
 * ParticipantCard Component
 * Multi-Character Chat System - Phase 4
 *
 * Displays a single participant in the chat sidebar with:
 * - Avatar and name
 * - Turn indicator (glowing border when it's their turn)
 * - Connection profile dropdown (for characters)
 * - Talkativeness slider (for characters)
 * - Queue position badge (when queued)
 * - Nudge/Queue button
 * - Expandable settings section (system prompt override, active toggle)
 */

import { useState, useRef } from 'react'
import Avatar from '@/components/ui/Avatar'

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
  isImpersonating = false,
  isActiveTyping = false,
  onImpersonate,
  onStopImpersonate,
  connectionProfiles,
  onConnectionProfileChange,
  onSystemPromptOverrideChange,
  onActiveChange,
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
  const talkativeness = participant.character?.talkativeness ?? 0.5


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

  // Handle active toggle
  const handleActiveToggle = (e: React.ChangeEvent<HTMLInputElement>) => {
    onActiveChange?.(participant.id, e.target.checked)
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
              <span className="qt-badge-secondary text-xs opacity-60">
                AI
              </span>
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
              <div className="qt-participant-card-status mt-1 truncate" title={`${participant.connectionProfile.provider}: ${participant.connectionProfile.modelName}`}>
                {participant.connectionProfile.modelName || participant.connectionProfile.name}
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

        {/* Settings toggle button */}
        {(onSystemPromptOverrideChange || onActiveChange) && (
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

      {/* Expandable settings section */}
      {settingsExpanded && (
        <div className="mt-2 pt-2 border-t border-border space-y-2">
          {onSystemPromptOverrideChange && (
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
          )}
          {onActiveChange && (
            <label className="flex items-center gap-2 qt-text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={participant.isActive}
                onChange={handleActiveToggle}
                className="rounded border-input"
              />
              Active in chat
            </label>
          )}
        </div>
      )}
    </div>
  )
}

export default ParticipantCard
