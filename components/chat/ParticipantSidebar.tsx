'use client'

/**
 * ParticipantSidebar Component
 * Multi-Character Chat System - Phase 4
 *
 * Right-side panel showing all participants in a multi-character chat.
 * Features:
 * - Collapsed/expanded state with localStorage persistence
 * - List of participant cards with turn indicators
 * - Queue management
 * - Nudge functionality
 * - Talkativeness controls
 * - Add character button (placeholder for Phase 6)
 */

import { useMemo, useState, useCallback } from 'react'
import { ParticipantCard, type ParticipantData } from './ParticipantCard'
import { Avatar } from '@/components/ui/Avatar'
import type { TurnState, TurnSelectionResult } from '@/lib/chat/turn-manager'
import { getQueuePosition } from '@/lib/chat/turn-manager'

const STORAGE_KEY = 'quilltap.participant-sidebar.collapsed'

/** Get initial collapsed state from localStorage (with SSR safety) */
function getInitialCollapsedState(): boolean {
  if (typeof window === 'undefined') return true // SSR fallback
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored !== null ? stored === 'true' : true // Default to collapsed
}

interface ParticipantSidebarProps {
  participants: ParticipantData[]
  turnState: TurnState
  turnSelectionResult: TurnSelectionResult | null
  isGenerating: boolean
  userParticipantId: string | null
  respondingParticipantId?: string | null // The participant currently streaming a response
  waitingForResponse?: boolean // Whether we're waiting for an LLM response (used for streaming indicator)
  isPaused?: boolean // Whether auto-responses are paused
  onTogglePause?: () => void // Toggle pause state
  onNudge: (participantId: string) => void
  onQueue: (participantId: string) => void
  onDequeue: (participantId: string) => void
  onSkip?: () => void // Skip turn (for user participants in multi-char chat)
  onTalkativenessChange?: (participantId: string, value: number) => void
  onAddCharacter?: () => void
  onRemoveCharacter?: (participantId: string) => void // Phase 6: Remove character from chat
  // Impersonation support (Characters Not Personas)
  impersonatingParticipantIds?: string[] // Participant IDs the user is impersonating
  activeTypingParticipantId?: string | null // Which impersonated character is currently "active" for typing
  onImpersonate?: (participantId: string) => void // Start impersonating a character
  onStopImpersonate?: (participantId: string) => void // Stop impersonating a character
  className?: string
}

export function ParticipantSidebar({
  participants,
  turnState,
  turnSelectionResult,
  isGenerating,
  userParticipantId,
  respondingParticipantId,
  waitingForResponse = false,
  isPaused = false,
  onTogglePause,
  onNudge,
  onQueue,
  onDequeue,
  onSkip,
  onTalkativenessChange,
  onAddCharacter,
  onRemoveCharacter,
  impersonatingParticipantIds = [],
  activeTypingParticipantId,
  onImpersonate,
  onStopImpersonate,
  className = '',
}: ParticipantSidebarProps) {
  // Collapsed state with localStorage persistence (default: collapsed)
  const [isCollapsed, setIsCollapsed] = useState(getInitialCollapsedState)

  // Toggle collapsed state and persist to localStorage
  const toggleCollapsed = useCallback(() => {
    setIsCollapsed(prev => {
      const newValue = !prev
      localStorage.setItem(STORAGE_KEY, String(newValue))
      return newValue
    })
  }, [])

  // Expand sidebar (used when clicking avatars in collapsed mode)
  const expandSidebar = useCallback(() => {
    setIsCollapsed(false)
    localStorage.setItem(STORAGE_KEY, 'false')
  }, [])

  // Sort participants: personas first (the user), then characters by displayOrder
  const sortedParticipants = useMemo(() => {
    return [...participants]
      .filter(p => p.isActive)
      .sort((a, b) => {
        // Personas (user) first
        if (a.type === 'PERSONA' && b.type !== 'PERSONA') return -1
        if (b.type === 'PERSONA' && a.type !== 'PERSONA') return 1
        // Then by displayOrder
        return a.displayOrder - b.displayOrder
      })
  }, [participants])

  // Get the current speaker (either from selection result or currently generating)
  const currentSpeakerId = useMemo(() => {
    if (isGenerating) {
      // If generating, use the responding participant ID (set before streaming starts)
      // This is more accurate than lastSpeakerId which is calculated from persisted messages
      if (respondingParticipantId) {
        return respondingParticipantId
      }
      // Fallback to lastSpeakerId for backwards compatibility
      if (turnState.lastSpeakerId) {
        return turnState.lastSpeakerId
      }
    }
    return turnSelectionResult?.nextSpeakerId ?? null
  }, [isGenerating, respondingParticipantId, turnState.lastSpeakerId, turnSelectionResult?.nextSpeakerId])

  // Count active characters (not including personas)
  const activeCharacterCount = useMemo(() => {
    return participants.filter(p => p.type === 'CHARACTER' && p.isActive).length
  }, [participants])


  // Build class list based on collapsed state
  const baseClasses = ['qt-desktop-only']
  if (className) {
    baseClasses.push(className)
  }

  // Collapsed view: narrow strip with mini avatars
  if (isCollapsed) {
    return (
      <div className={['qt-chat-sidebar-collapsed', ...baseClasses].join(' ')}>
        {/* Toggle button to expand */}
        <button
          onClick={toggleCollapsed}
          className="qt-chat-sidebar-toggle"
          title="Expand participant sidebar"
          aria-label="Expand participant sidebar"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        {/* Icon-only pause button */}
        {onTogglePause && (
          <button
            onClick={onTogglePause}
            className={`qt-chat-sidebar-collapsed-pause ${isPaused ? 'qt-chat-sidebar-collapsed-pause-paused' : ''}`}
            title={isPaused ? 'Resume auto-responses' : 'Pause auto-responses'}
            aria-label={isPaused ? 'Resume auto-responses' : 'Pause auto-responses'}
          >
            {isPaused ? (
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              </svg>
            )}
          </button>
        )}

        {/* Vertical list of mini avatars */}
        <div className="qt-chat-sidebar-collapsed-avatars">
          {sortedParticipants.map((participant) => {
            const isUserParticipant = participant.id === userParticipantId
            // It's this participant's turn if they're the selected next speaker,
            // OR if it's the user's turn (nextSpeakerId is null) and this is the user's avatar
            const isUserTurn = turnSelectionResult?.nextSpeakerId === null && !isGenerating
            const isCurrentTurn = currentSpeakerId === participant.id || (isUserParticipant && isUserTurn)
            // Show pulsating animation during both waiting-for-response AND streaming phases
            const isActivelyGenerating = currentSpeakerId === participant.id && isGenerating
            const queuePos = getQueuePosition(turnState, participant.id)

            // Get participant name and avatar from character or persona
            const name = participant.character?.name || participant.persona?.name || 'Unknown'
            const avatarUrl = participant.character?.avatarUrl || participant.persona?.avatarUrl || null
            const defaultImage = participant.character?.defaultImage || participant.persona?.defaultImage || null

            // Build avatar wrapper classes
            const avatarClasses = ['qt-chat-sidebar-collapsed-avatar']
            if (isCurrentTurn || isActivelyGenerating) {
              avatarClasses.push('qt-chat-sidebar-collapsed-avatar-active')
            }
            if (isActivelyGenerating) {
              avatarClasses.push('qt-chat-sidebar-collapsed-avatar-streaming')
            }

            return (
              <button
                key={participant.id}
                onClick={expandSidebar}
                className={avatarClasses.join(' ')}
                title={`${name}${isCurrentTurn ? ' (current turn)' : ''}${queuePos ? ` (queue #${queuePos})` : ''}`}
                aria-label={`${name} - click to expand sidebar`}
              >
                <Avatar
                  name={name}
                  src={avatarUrl ? { avatarUrl } : defaultImage ? { defaultImage } : undefined}
                  size="sm"
                />
                {/* Queue position badge */}
                {queuePos > 0 && (
                  <span className="qt-chat-sidebar-collapsed-queue-badge">
                    {queuePos}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  // Expanded view: full sidebar with participant cards
  return (
    <div className={['qt-chat-sidebar', ...baseClasses].join(' ')}>
      {/* Header */}
      <div className="qt-chat-sidebar-header">
        <div className="flex items-center justify-between">
          <h3 className="qt-chat-sidebar-heading">Participants</h3>
          <div className="flex items-center gap-2">
            <span className="qt-chat-sidebar-meta">
              {activeCharacterCount} character{activeCharacterCount !== 1 ? 's' : ''}
            </span>
            {/* Toggle button to collapse */}
            <button
              onClick={toggleCollapsed}
              className="qt-chat-sidebar-toggle"
              title="Collapse participant sidebar"
              aria-label="Collapse participant sidebar"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>

        {/* Turn status indicator - Phase 7: Enhanced with edge case handling */}
        {turnSelectionResult && (
          <div className="mt-2 qt-chat-sidebar-meta">
            {activeCharacterCount === 0 ? (
              // Edge Case 1: No characters
              <span style={{ color: 'var(--qt-status-warning-fg)' }}>No characters available</span>
            ) : turnSelectionResult.nextSpeakerId === null ? (
              // Edge Case 3: User's turn (no eligible speakers or cycle complete)
              turnSelectionResult.cycleComplete ? (
                <span style={{ color: 'var(--qt-status-success-fg)' }}>All characters have spoken - your turn</span>
              ) : (
                <span style={{ color: 'var(--qt-status-success-fg)' }}>Your turn to speak</span>
              )
            ) : isGenerating ? (
              <span style={{ color: 'var(--qt-status-info-fg)' }}>Generating response...</span>
            ) : (
              <span>Waiting for next turn...</span>
            )}
          </div>
        )}

        {/* Queue indicator */}
        {turnState.queue.length > 0 && (
          <div className="mt-1 qt-chat-sidebar-meta qt-chat-sidebar-queue">
            {turnState.queue.length} in queue
          </div>
        )}

        {/* Pause/Resume button */}
        {onTogglePause && (
          <button
            onClick={onTogglePause}
            className={`qt-chat-pause-button mt-3 ${isPaused ? 'qt-chat-pause-button-paused' : ''}`}
            title={isPaused ? 'Resume auto-responses' : 'Pause auto-responses'}
          >
            {isPaused ? (
              <>
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
                <span>Resume</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                </svg>
                <span>Pause</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* Participant list */}
      <div className="qt-chat-sidebar-list">
        {/* Phase 7: Edge Case - Empty participant list */}
        {sortedParticipants.length === 0 && (
          <div className="qt-empty-state py-8">
            <svg className="qt-empty-state-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            <p className="qt-empty-state-title">No participants</p>
            <p className="qt-empty-state-description">All characters have been removed</p>
          </div>
        )}
        {sortedParticipants.map((participant) => {
          const isUserParticipant = participant.id === userParticipantId
          const isCurrentTurn = currentSpeakerId === participant.id
          const queuePos = getQueuePosition(turnState, participant.id)
          // Can skip when it's the user's turn (nextSpeakerId is null means it's user's turn)
          const canSkip = turnSelectionResult?.nextSpeakerId === null && !isGenerating

          // Check if this participant is being impersonated
          const isImpersonating = impersonatingParticipantIds.includes(participant.id)
          const isActiveTyping = activeTypingParticipantId === participant.id

          // Can remove if there's more than one active character
          // (all-LLM chats are supported with pause logic)
          const canRemove = activeCharacterCount > 1

          return (
            <ParticipantCard
              key={participant.id}
              participant={participant}
              isCurrentTurn={isCurrentTurn}
              queuePosition={queuePos}
              isGenerating={isGenerating && isCurrentTurn}
              isUserParticipant={isUserParticipant}
              onNudge={onNudge}
              onQueue={onQueue}
              onDequeue={onDequeue}
              onSkip={isUserParticipant ? onSkip : undefined}
              onTalkativenessChange={onTalkativenessChange}
              onRemove={onRemoveCharacter}
              canRemove={canRemove}
              canSkip={canSkip}
              isImpersonating={isImpersonating}
              isActiveTyping={isActiveTyping}
              onImpersonate={onImpersonate}
              onStopImpersonate={onStopImpersonate}
            />
          )
        })}
      </div>

      {/* Add character button (Phase 6 placeholder) */}
      {onAddCharacter && (
        <div className="qt-chat-sidebar-add">
          <button
            onClick={onAddCharacter}
            className="w-full py-2 px-4 text-sm font-medium rounded-lg border border-dashed border-border text-muted-foreground hover:bg-muted hover:text-foreground transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Character
          </button>
        </div>
      )}

      {/* Turn explanation (debug info) */}
      {turnSelectionResult?.debug && (
        <div className="qt-chat-sidebar-debug">
          <details>
            <summary className="cursor-pointer hover:text-foreground">Turn Debug Info</summary>
            <div className="mt-2 space-y-1">
              <div>Reason: {turnSelectionResult.reason}</div>
              <div>Cycle Complete: {turnSelectionResult.cycleComplete ? 'Yes' : 'No'}</div>
              {turnSelectionResult.debug.eligibleSpeakers.length > 0 && (
                <div>Eligible: {turnSelectionResult.debug.eligibleSpeakers.length}</div>
              )}
            </div>
          </details>
        </div>
      )}
    </div>
  )
}

export default ParticipantSidebar
