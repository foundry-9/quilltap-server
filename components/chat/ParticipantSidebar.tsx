'use client'

/**
 * ParticipantSidebar Component
 * Multi-Character Chat System - Phase 4
 *
 * Right-side panel showing all participants in a multi-character chat.
 * Features:
 * - List of participant cards with turn indicators
 * - Queue management
 * - Nudge functionality
 * - Talkativeness controls
 * - Add character button (placeholder for Phase 6)
 */

import { useMemo, useEffect } from 'react'
import { ParticipantCard, type ParticipantData } from './ParticipantCard'
import type { TurnState, TurnSelectionResult } from '@/lib/chat/turn-manager'
import { getQueuePosition } from '@/lib/chat/turn-manager'
import { clientLogger } from '@/lib/client-logger'

interface ParticipantSidebarProps {
  participants: ParticipantData[]
  turnState: TurnState
  turnSelectionResult: TurnSelectionResult | null
  isGenerating: boolean
  userParticipantId: string | null
  onNudge: (participantId: string) => void
  onQueue: (participantId: string) => void
  onDequeue: (participantId: string) => void
  onTalkativenessChange?: (participantId: string, value: number) => void
  onAddCharacter?: () => void
  onRemoveCharacter?: (participantId: string) => void // Phase 6: Remove character from chat
  className?: string
}

export function ParticipantSidebar({
  participants,
  turnState,
  turnSelectionResult,
  isGenerating,
  userParticipantId,
  onNudge,
  onQueue,
  onDequeue,
  onTalkativenessChange,
  onAddCharacter,
  onRemoveCharacter,
  className = '',
}: ParticipantSidebarProps) {
  // Debug logging in useEffect to avoid setState during render
  useEffect(() => {
    clientLogger.debug('[ParticipantSidebar] Rendered', {
      participantCount: participants.length,
      queueLength: turnState.queue.length,
      nextSpeakerId: turnSelectionResult?.nextSpeakerId,
      isGenerating,
    })
  }, [participants.length, turnState.queue.length, turnSelectionResult?.nextSpeakerId, isGenerating])

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
    if (isGenerating && turnState.lastSpeakerId) {
      // If generating, the last speaker is the current one
      return turnState.lastSpeakerId
    }
    return turnSelectionResult?.nextSpeakerId ?? null
  }, [isGenerating, turnState.lastSpeakerId, turnSelectionResult?.nextSpeakerId])

  // Count active characters (not including personas)
  const activeCharacterCount = useMemo(() => {
    return participants.filter(p => p.type === 'CHARACTER' && p.isActive).length
  }, [participants])

  return (
    <div className={`flex flex-col h-full bg-card border-l border-border ${className}`}>
      {/* Header */}
      <div className="flex-shrink-0 p-4 border-b border-border">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-foreground">Participants</h3>
          <span className="text-xs text-muted-foreground">
            {activeCharacterCount} character{activeCharacterCount !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Turn status indicator - Phase 7: Enhanced with edge case handling */}
        {turnSelectionResult && (
          <div className="mt-2 text-xs text-muted-foreground">
            {activeCharacterCount === 0 ? (
              // Edge Case 1: No characters
              <span className="text-warning">No characters available</span>
            ) : turnSelectionResult.nextSpeakerId === null ? (
              // Edge Case 3: User's turn (no eligible speakers or cycle complete)
              turnSelectionResult.cycleComplete ? (
                <span className="text-success">All characters have spoken - your turn</span>
              ) : (
                <span className="text-success">Your turn to speak</span>
              )
            ) : isGenerating ? (
              <span className="text-info">Generating response...</span>
            ) : (
              <span>Waiting for next turn...</span>
            )}
          </div>
        )}

        {/* Queue indicator */}
        {turnState.queue.length > 0 && (
          <div className="mt-1 text-xs text-info">
            {turnState.queue.length} in queue
          </div>
        )}
      </div>

      {/* Participant list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* Phase 7: Edge Case - Empty participant list */}
        {sortedParticipants.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
            <svg className="w-12 h-12 mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            <p className="text-sm font-medium">No participants</p>
            <p className="text-xs mt-1">All characters have been removed</p>
          </div>
        )}
        {sortedParticipants.map((participant) => {
          const isUserParticipant = participant.id === userParticipantId
          const isCurrentTurn = currentSpeakerId === participant.id
          const queuePos = getQueuePosition(turnState, participant.id)
          // Can remove if there's more than one active character
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
              onTalkativenessChange={onTalkativenessChange}
              onRemove={onRemoveCharacter}
              canRemove={canRemove}
            />
          )
        })}
      </div>

      {/* Add character button (Phase 6 placeholder) */}
      {onAddCharacter && (
        <div className="flex-shrink-0 p-4 border-t border-border">
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
        <div className="flex-shrink-0 p-4 border-t border-border text-xs text-muted-foreground">
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
