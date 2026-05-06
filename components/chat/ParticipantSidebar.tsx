'use client'

/**
 * ParticipantSidebar Component
 * Multi-Character Chat System - Phase 4
 *
 * Right-side panel showing all participants in a multi-character chat.
 * Features:
 * - Collapsed/expanded state with localStorage persistence
 * - List of participant cards sorted by predicted turn order
 * - Inactive participants shown at bottom (dimmed)
 * - Turn position badges on all participants
 * - Stop streaming button on generating participant
 * - Queue management
 * - Nudge functionality
 * - Talkativeness controls
 */

import { useMemo, useState, useCallback } from 'react'
import { ParticipantCard, type ParticipantData, type ConnectionProfileOption } from './ParticipantCard'
import { Avatar } from '@/components/ui/Avatar'
import type { TurnState, TurnSelectionResult } from '@/lib/chat/turn-manager'
import type { OutfitState, WardrobeCache } from '@/app/salon/[id]/hooks/useOutfit'
import { getQueuePosition, computePredictedTurnOrder } from '@/lib/chat/turn-manager'
import type { TurnOrderEntry, TurnOrderStatus } from '@/lib/chat/turn-manager'

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
  onStopStreaming?: () => void // Stop/interrupt current generation
  /** Callback when user wants to whisper to a participant */
  onWhisper?: (participantId: string) => void
  // Impersonation support (Characters Not Personas)
  impersonatingParticipantIds?: string[] // Participant IDs the user is impersonating
  activeTypingParticipantId?: string | null // Which impersonated character is currently "active" for typing
  onImpersonate?: (participantId: string) => void // Start impersonating a character
  onStopImpersonate?: (participantId: string) => void // Stop impersonating a character
  // Connection profile controls (passed to cards)
  connectionProfiles?: ConnectionProfileOption[]
  onConnectionProfileChange?: (participantId: string, profileId: string | null, controlledBy: 'llm' | 'user') => void
  // System prompt override per participant (passed to cards)
  onSystemPromptChange?: (participantId: string, promptId: string | null) => void
  onParticipantSettingsChange?: (participantId: string, updates: { isActive?: boolean; status?: 'active' | 'silent' | 'absent' | 'removed' }) => void
  // Outfit display
  outfitState?: OutfitState
  wardrobeCache?: WardrobeCache
  outfitLoading?: boolean
  onEquipSlot?: (participantId: string, slot: string, itemId: string | null) => void
  // Gift wardrobe item
  onGiftItem?: (participantId: string) => void
  // Avatar regeneration
  onRegenerateAvatar?: (participantId: string) => void
  // Danger state — when the Concierge has flagged this chat
  isDangerousChat?: boolean
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
  onStopStreaming,
  onWhisper,
  impersonatingParticipantIds = [],
  activeTypingParticipantId,
  onImpersonate,
  onStopImpersonate,
  connectionProfiles,
  onConnectionProfileChange,
  onSystemPromptChange,
  onParticipantSettingsChange,
  outfitState,
  wardrobeCache,
  outfitLoading,
  onEquipSlot,
  onGiftItem,
  onRegenerateAvatar,
  isDangerousChat = false,
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

  // Compute predicted turn order (includes inactive participants at the end)
  const turnOrderEntries = useMemo(() => {
    return computePredictedTurnOrder({
      participants,
      turnState,
      turnSelectionResult,
      isGenerating,
      respondingParticipantId,
      userParticipantId,
    })
  }, [participants, turnState, turnSelectionResult, isGenerating, respondingParticipantId, userParticipantId])

  // Build a map from participant ID to turn order entry for quick lookup
  const turnOrderMap = useMemo(() => {
    const map = new Map<string, TurnOrderEntry>()
    for (const entry of turnOrderEntries) {
      map.set(entry.participantId, entry)
    }
    return map
  }, [turnOrderEntries])

  // Sort participants by turn order (matching the computed entries order)
  const sortedParticipants = useMemo(() => {
    const orderIndex = new Map<string, number>()
    turnOrderEntries.forEach((entry, index) => {
      orderIndex.set(entry.participantId, index)
    })
    return [...participants].sort((a, b) => {
      const aIdx = orderIndex.get(a.id) ?? 999
      const bIdx = orderIndex.get(b.id) ?? 999
      return aIdx - bIdx
    })
  }, [participants, turnOrderEntries])

  // Get the current speaker (either from selection result or currently generating)
  const currentSpeakerId = useMemo(() => {
    if (isGenerating) {
      // If generating, use the responding participant ID (set before streaming starts)
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

  // Count active characters (not including user-controlled participants)
  const activeCharacterCount = useMemo(() => {
    return participants.filter(p => p.type === 'CHARACTER' && p.isActive && p.controlledBy !== 'user' && p.id !== userParticipantId).length
  }, [participants, userParticipantId])

  // Count all active participants (characters + personas) for whisper eligibility
  const activeParticipantCount = useMemo(() => {
    return participants.filter(p => p.isActive).length
  }, [participants])


  // Build class list based on collapsed state
  const baseClasses: string[] = []
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

        {/* Vertical list of mini avatars - sorted by turn order */}
        <div className="qt-chat-sidebar-collapsed-avatars">
          {sortedParticipants.map((participant) => {
            const isUserParticipant = participant.id === userParticipantId
            const turnEntry = turnOrderMap.get(participant.id)
            const isInactive = turnEntry?.status === 'inactive'
            // It's this participant's turn if they're the selected next speaker,
            // OR if it's the user's turn (nextSpeakerId is null) and this is the user's avatar
            const isUserTurn = turnSelectionResult?.nextSpeakerId === null && !isGenerating
            const isCurrentTurn = currentSpeakerId === participant.id || (isUserParticipant && isUserTurn)
            // Show pulsating animation during both waiting-for-response AND streaming phases
            const isActivelyGenerating = currentSpeakerId === participant.id && isGenerating

            // Get participant name and avatar from character data
            const name = participant.character?.name || 'Unknown'
            const avatarUrl = participant.character?.avatarUrl || null
            const defaultImage = participant.character?.defaultImage || null

            // Get position badge class for collapsed view
            const positionBadgeClass = turnEntry ? getCollapsedPositionBadgeClass(turnEntry.status) : ''

            const participantStatus = (participant as ParticipantData & { status?: string }).status || 'active'

            // Build avatar wrapper classes
            const avatarClasses = ['qt-chat-sidebar-collapsed-avatar']
            if (isInactive) {
              avatarClasses.push('qt-chat-sidebar-collapsed-avatar-inactive')
            } else if (isCurrentTurn || isActivelyGenerating) {
              avatarClasses.push('qt-chat-sidebar-collapsed-avatar-active')
            }
            if (isActivelyGenerating) {
              avatarClasses.push('qt-chat-sidebar-collapsed-avatar-streaming')
            }

            const statusLabel = participantStatus !== 'active' ? ` [${participantStatus}]` : ''

            return (
              <button
                key={participant.id}
                onClick={expandSidebar}
                className={avatarClasses.join(' ')}
                title={`${name}${statusLabel}${isCurrentTurn ? ' (current turn)' : ''}${turnEntry?.position ? ` (#${turnEntry.position})` : ''}`}
                aria-label={`${name}${statusLabel} - click to expand sidebar`}
              >
                <div className="relative">
                  <Avatar
                    name={name}
                    src={avatarUrl ? { avatarUrl } : defaultImage ? { defaultImage } : undefined}
                    size="sm"
                  />
                  {/* Status overlay on collapsed avatar */}
                  {participantStatus === 'silent' && (
                    <div className="qt-participant-status-overlay qt-participant-status-overlay-silent">
                      <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                      </svg>
                    </div>
                  )}
                  {participantStatus === 'absent' && (
                    <div className="qt-participant-status-overlay qt-participant-status-overlay-absent">
                      <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
                      </svg>
                    </div>
                  )}
                </div>
                {/* Position badge - shows turn order position instead of just queue */}
                {turnEntry && turnEntry.position != null && turnEntry.position > 0 && (
                  <span className={`qt-chat-sidebar-collapsed-position-badge ${positionBadgeClass}`}>
                    {turnEntry.position}
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
        {/* Phase 7: Edge Case - Empty participant list (no active and no inactive) */}
        {sortedParticipants.length === 0 && (
          <div className="qt-empty-state py-8">
            <svg className="qt-empty-state-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            <p className="qt-empty-state-title">No participants</p>
            <p className="qt-empty-state-description">Add a character to get started</p>
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

          // Get turn order info for this participant
          const turnEntry = turnOrderMap.get(participant.id)

          // Get outfit data for this participant's character
          const characterId = participant.character?.id
          const charOutfit = characterId && outfitState ? outfitState[characterId] : undefined
          const charWardrobe = characterId && wardrobeCache ? wardrobeCache[characterId] : undefined

          return (
            <ParticipantCard
              key={participant.id}
              participant={participant}
              isCurrentTurn={isCurrentTurn}
              queuePosition={queuePos}
              isGenerating={isGenerating && isCurrentTurn}
              isUserParticipant={isUserParticipant}
              turnPosition={turnEntry?.position ?? null}
              turnStatus={turnEntry?.status}
              onStopStreaming={turnEntry?.status === 'generating' ? onStopStreaming : undefined}
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
              connectionProfiles={connectionProfiles}
              onConnectionProfileChange={onConnectionProfileChange}
              onSystemPromptChange={onSystemPromptChange}
              onActiveChange={onParticipantSettingsChange
                ? (pId, active) => onParticipantSettingsChange(pId, { isActive: active })
                : undefined}
              onStatusChange={onParticipantSettingsChange
                ? (pId, status) => onParticipantSettingsChange(pId, { status, isActive: status === 'active' || status === 'silent' })
                : undefined}
              onWhisper={activeParticipantCount >= 3 ? onWhisper : undefined}
              equippedSlots={charOutfit?.slots}
              itemsBySlot={charOutfit?.itemsBySlot}
              wardrobeItems={charWardrobe}
              onEquipSlot={onEquipSlot}
              outfitLoading={outfitLoading}
              onGiftItem={onGiftItem}
              onRegenerateAvatar={onRegenerateAvatar}
              isDangerousChat={isDangerousChat}
            />
          )
        })}
      </div>

      {/* Add character button (Phase 6 placeholder) */}
      {onAddCharacter && (
        <div className="qt-chat-sidebar-add">
          <button
            onClick={onAddCharacter}
            className="w-full py-2 px-4 text-sm font-medium rounded-lg border border-dashed qt-border-default qt-text-secondary hover:qt-bg-surface-alt hover:qt-text transition-colors flex items-center justify-center gap-2"
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

/** Get the CSS class for a collapsed position badge based on status */
function getCollapsedPositionBadgeClass(status: TurnOrderStatus): string {
  switch (status) {
    case 'generating': return 'qt-participant-position-generating'
    case 'next': return 'qt-participant-position-next'
    case 'queued': return 'qt-participant-position-queued'
    case 'eligible': return 'qt-participant-position-eligible'
    case 'user-turn': return 'qt-participant-position-user-turn'
    case 'spoken': return 'qt-participant-position-spoken'
    default: return ''
  }
}

export default ParticipantSidebar
