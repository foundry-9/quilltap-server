'use client'

import { useCallback, useMemo } from 'react'
import { showErrorToast, showInfoToast } from '@/lib/toast'
import type {
  TurnState,
  TurnSelectionResult,
} from '@/lib/chat/turn-manager'
import {
  nudgeParticipant,
  addToQueue,
  removeFromQueue,
} from '@/lib/chat/turn-manager'
import type { ChatParticipantBase, Character } from '@/lib/schemas/types'
import type { EphemeralMessageData } from '@/components/chat/EphemeralMessage'
import { createEphemeralMessage } from '@/components/chat/EphemeralMessage'
import type { ParticipantData } from '@/components/chat/ParticipantCard'

export interface TurnManagementActions {
  handleNudge: (participantId: string) => void | Promise<void>
  handleQueue: (participantId: string) => void | Promise<void>
  handleDequeue: (participantId: string) => void | Promise<void>
  handleContinue: () => void | Promise<void>
  handleDismissEphemeral: (ephemeralId: string) => void
}

/**
 * Server response from the turn action API
 */
interface TurnActionResponse {
  success: boolean
  action: string
  turn: {
    nextSpeakerId: string | null
    nextSpeakerName: string | null
    nextSpeakerControlledBy: string | null
    reason: string
    explanation: string
    cycleComplete: boolean
    isUsersTurn: boolean
  }
  state: {
    queue: string[]
  }
  participant?: {
    id: string
    name: string
    queuePosition: number
  }
}

/**
 * Call the backend turn action API to persist state changes
 */
async function callTurnAction(
  chatId: string,
  action: 'nudge' | 'queue' | 'dequeue' | 'query',
  participantId?: string,
): Promise<TurnActionResponse | null> {
  try {
    const body: Record<string, string> = { action }
    if (participantId) {
      body.participantId = participantId
    }

    const res = await fetch(`/api/v1/chats/${chatId}?action=turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}))
      throw new Error(errorData.error || `Turn action failed (${res.status})`)
    }

    return await res.json()
  } catch (error) {
    console.error('[TurnManagement] API call failed', { action, participantId, error })
    return null
  }
}

/**
 * Update local turn state from server response
 */
function applyServerResponse(
  response: TurnActionResponse,
  setTurnState: (state: TurnState) => void,
  setTurnSelectionResult: (result: TurnSelectionResult | null) => void,
  currentTurnState: TurnState,
) {
  // Update queue from server's authoritative state
  setTurnState({
    ...currentTurnState,
    queue: response.state.queue,
  })

  // Update selection result from server
  setTurnSelectionResult({
    nextSpeakerId: response.turn.nextSpeakerId,
    reason: response.turn.reason as TurnSelectionResult['reason'],
    cycleComplete: response.turn.cycleComplete,
  })
}

export function useTurnManagement(
  chatId: string,
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
    // Find participant to validate it's LLM-controlled
    const participant = participantData.find(p => p.id === participantId)
    const participantBase = participantsAsBase.find(p => p.id === participantId)

    // Safety check: Only LLM-controlled characters can be nudged for AI response
    if (participantBase?.controlledBy === 'user') {
      showErrorToast('User-controlled characters cannot be nudged for AI response. Use Queue instead.')
      return
    }

    // If chat is paused, unpause it first
    if (isPaused && onUnpause) {
      await onUnpause()
    }

    const participantName = participant?.character?.name || participant?.persona?.name || 'Participant'

    // Add ephemeral nudge notification
    const ephemeral = createEphemeralMessage('nudge', participantId, participantName)
    setEphemeralMessages([...ephemeralMessages, ephemeral])

    // Optimistic local update for immediate UI feedback
    const newTurnState = nudgeParticipant(turnState, participantId)
    setTurnState(newTurnState)

    // Trigger immediate response generation directly — do NOT also add to
    // the turn queue via callTurnAction('nudge'), because triggerContinueMode
    // already requests a response for this participant.  Adding them to the
    // queue as well causes the server-side chain loop to pop the queue entry
    // and generate a second (duplicate) response.
    triggerContinueMode(participantId)
  }, [turnState, participantsAsBase, participantData, ephemeralMessages, setTurnState, setEphemeralMessages, triggerContinueMode, isPaused, onUnpause])

  const handleQueue = useCallback(async (participantId: string) => {
    // Optimistic local update for immediate UI feedback
    const newTurnState = addToQueue(turnState, participantId)
    setTurnState(newTurnState)

    // Persist to backend and get authoritative state
    const response = await callTurnAction(chatId, 'queue', participantId)
    if (response) {
      applyServerResponse(response, setTurnState, setTurnSelectionResult, turnState)
    }
  }, [chatId, turnState, setTurnState, setTurnSelectionResult])

  const handleDequeue = useCallback(async (participantId: string) => {
    // Optimistic local update for immediate UI feedback
    const newTurnState = removeFromQueue(turnState, participantId)
    setTurnState(newTurnState)

    // Persist to backend and get authoritative state
    const response = await callTurnAction(chatId, 'dequeue', participantId)
    if (response) {
      applyServerResponse(response, setTurnState, setTurnSelectionResult, turnState)
    }
  }, [chatId, turnState, setTurnState, setTurnSelectionResult])

  const handleContinue = useCallback(async () => {
    // Edge case: No active characters
    if (!hasActiveCharacters) {
      showErrorToast('No characters available. Add a character to continue.')
      return
    }

    // Query the server for the authoritative next speaker
    const response = await callTurnAction(chatId, 'query')

    if (!response) {
      showErrorToast('Failed to determine next speaker. Please try again.')
      return
    }

    applyServerResponse(response, setTurnState, setTurnSelectionResult, turnState)

    const { nextSpeakerId, nextSpeakerControlledBy } = response.turn

    if (nextSpeakerId && nextSpeakerId !== userParticipantId) {
      if (nextSpeakerControlledBy === 'user') {
        showInfoToast("It's a user-controlled character's turn. Type a message as them.")
        return
      }
      triggerContinueMode(nextSpeakerId)
    } else {
      showInfoToast('No characters available to speak. Try adding or activating a character.')
    }
  }, [chatId, hasActiveCharacters, userParticipantId, turnState, setTurnState, setTurnSelectionResult, triggerContinueMode])

  const handleDismissEphemeral = useCallback((ephemeralId: string) => {
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
