'use client'

import { useCallback, useMemo } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { showErrorToast, showInfoToast } from '@/lib/toast'
import {
  type TurnState,
  type TurnSelectionResult,
  nudgeParticipant,
  addToQueue,
  removeFromQueue,
  selectNextSpeaker,
} from '@/lib/chat/turn-manager'
import type { ChatParticipantBase, Character } from '@/lib/schemas/types'
import type { EphemeralMessageData } from '@/components/chat/EphemeralMessage'
import { createEphemeralMessage } from '@/components/chat/EphemeralMessage'
import type { ParticipantData } from '@/components/chat/ParticipantCard'

export interface TurnManagementActions {
  handleNudge: (participantId: string) => void | Promise<void>
  handleQueue: (participantId: string) => void
  handleDequeue: (participantId: string) => void
  handleContinue: () => void
  handleDismissEphemeral: (ephemeralId: string) => void
}

export function useTurnManagement(
  participantsAsBase: ChatParticipantBase[],
  charactersMap: Map<string, Character>,
  turnState: TurnState,
  userParticipantId: string | null,
  participantData: ParticipantData[],
  ephemeralMessages: EphemeralMessageData[],
  setTurnState: (state: TurnState) => void,
  setTurnSelectionResult: (result: TurnSelectionResult | null) => void,
  setEphemeralMessages: (messages: EphemeralMessageData[]) => void,
  triggerContinueMode: (participantId: string) => Promise<void>,
  isPaused?: boolean,
  onUnpause?: () => Promise<void>,
) {
  const hasActiveCharacters = useMemo(() => {
    return participantsAsBase.filter(p => p.type === 'CHARACTER' && p.isActive).length > 0
  }, [participantsAsBase])

  const handleNudge = useCallback(async (participantId: string) => {
    clientLogger.debug('[Chat] Nudging participant', { participantId, isPaused })

    // If chat is paused, unpause it first
    if (isPaused && onUnpause) {
      clientLogger.debug('[Chat] Unpausing chat before nudge')
      await onUnpause()
    }

    // Find participant name for ephemeral message
    const participant = participantData.find(p => p.id === participantId)
    const participantName = participant?.character?.name || participant?.persona?.name || 'Participant'

    // Add ephemeral nudge notification
    const ephemeral = createEphemeralMessage('nudge', participantId, participantName)
    setEphemeralMessages([...ephemeralMessages, ephemeral])

    // Update turn state
    const newTurnState = nudgeParticipant(turnState, participantId)
    setTurnState(newTurnState)

    // Recalculate next speaker
    if (participantsAsBase.length > 0) {
      const result = selectNextSpeaker(
        participantsAsBase,
        charactersMap,
        newTurnState,
        userParticipantId
      )
      setTurnSelectionResult(result)
    }

    // Trigger immediate response generation
    triggerContinueMode(participantId)
  }, [turnState, participantsAsBase, charactersMap, userParticipantId, participantData, ephemeralMessages, setTurnState, setTurnSelectionResult, setEphemeralMessages, triggerContinueMode, isPaused, onUnpause])

  const handleQueue = useCallback((participantId: string) => {
    clientLogger.debug('[Chat] Queueing participant', { participantId })
    const newTurnState = addToQueue(turnState, participantId)
    setTurnState(newTurnState)

    // Recalculate next speaker
    if (participantsAsBase.length > 0) {
      const result = selectNextSpeaker(
        participantsAsBase,
        charactersMap,
        newTurnState,
        userParticipantId
      )
      setTurnSelectionResult(result)
    }
  }, [turnState, participantsAsBase, charactersMap, userParticipantId, setTurnState, setTurnSelectionResult])

  const handleDequeue = useCallback((participantId: string) => {
    clientLogger.debug('[Chat] Dequeuing participant', { participantId })
    const newTurnState = removeFromQueue(turnState, participantId)
    setTurnState(newTurnState)

    // Recalculate next speaker
    if (participantsAsBase.length > 0) {
      const result = selectNextSpeaker(
        participantsAsBase,
        charactersMap,
        newTurnState,
        userParticipantId
      )
      setTurnSelectionResult(result)
    }
  }, [turnState, participantsAsBase, charactersMap, userParticipantId, setTurnState, setTurnSelectionResult])

  const handleContinue = useCallback(() => {
    clientLogger.debug('[Chat] User passing turn via Continue button')

    // Edge case: No active characters
    if (!hasActiveCharacters) {
      clientLogger.warn('[Chat] Cannot continue - no active characters')
      showErrorToast('No characters available. Add a character to continue.')
      return
    }

    // Get the next character to speak
    let result = selectNextSpeaker(participantsAsBase, charactersMap, turnState, userParticipantId)

    if (result.nextSpeakerId && result.nextSpeakerId !== userParticipantId) {
      clientLogger.debug('[Chat] Selected next speaker for continue', {
        participantId: result.nextSpeakerId,
        reason: result.reason,
      })
      triggerContinueMode(result.nextSpeakerId)
    } else {
      clientLogger.warn('[Chat] Continue button clicked but no valid next speaker', {
        nextSpeakerId: result.nextSpeakerId,
        reason: result.reason,
      })
      showInfoToast('No characters available to speak. Try adding or activating a character.')
    }
  }, [participantsAsBase, charactersMap, turnState, userParticipantId, hasActiveCharacters, triggerContinueMode])

  const handleDismissEphemeral = useCallback((ephemeralId: string) => {
    clientLogger.debug('[Chat] Dismissing ephemeral message', { ephemeralId })
    setEphemeralMessages(ephemeralMessages.filter(em => em.id !== ephemeralId))
  }, [ephemeralMessages, setEphemeralMessages])

  return {
    handleNudge,
    handleQueue,
    handleDequeue,
    handleContinue,
    handleDismissEphemeral,
    hasActiveCharacters,
  }
}
