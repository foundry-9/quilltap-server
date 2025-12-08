/**
 * Turn Manager Module
 * Multi-Character Chat System - Phase 2
 *
 * Provides turn-based dialogue management for multi-character chats.
 * Handles turn selection algorithm, queue management, and turn state tracking.
 */

import { logger } from '@/lib/logger'
import type { ChatParticipantBase, Character, MessageEvent } from '@/lib/schemas/types'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Turn state tracking for multi-character chat sessions.
 * This state is session-only (stored in React state on frontend).
 * On page reload, it's recalculated from message history.
 */
export interface TurnState {
  /** Participants who have spoken since the user last spoke */
  spokenSinceUserTurn: string[] // participantId[]

  /** The participant whose turn it is (null = user's turn) */
  currentTurnParticipantId: string | null

  /** Manually queued participants (in order, first = next) */
  queue: string[] // participantId[]

  /** Last speaker (cannot speak again unless nudged/queued, except if only character) */
  lastSpeakerId: string | null
}

/**
 * Result of turn selection algorithm
 */
export interface TurnSelectionResult {
  /** The selected participant ID, or null if it's the user's turn */
  nextSpeakerId: string | null

  /** Reason for the selection (for debugging) */
  reason: 'queue' | 'weighted_selection' | 'only_character' | 'user_turn' | 'cycle_complete'

  /** Whether the cycle is complete (all characters have spoken) */
  cycleComplete: boolean

  /** Debug info about the selection process */
  debug?: {
    eligibleSpeakers: string[]
    weights: Record<string, number>
    randomValue?: number
  }
}

/**
 * Options for calculating initial turn state from message history
 */
export interface CalculateTurnStateOptions {
  /** All messages in the chat (or recent subset) */
  messages: MessageEvent[]

  /** All active participants in the chat */
  participants: ChatParticipantBase[]

  /** User's participant ID (persona participant, if exists) */
  userParticipantId: string | null
}

// ============================================================================
// TURN STATE INITIALIZATION
// ============================================================================

/**
 * Creates a fresh turn state (e.g., for a new chat or after reset)
 */
export function createInitialTurnState(): TurnState {
  logger.debug('[Turn Manager] Creating initial turn state')
  return {
    spokenSinceUserTurn: [],
    currentTurnParticipantId: null,
    queue: [],
    lastSpeakerId: null,
  }
}

/**
 * Calculates turn state from existing message history.
 * Used when reloading a chat to restore turn tracking.
 *
 * Algorithm:
 * 1. Find the last USER message
 * 2. Track all ASSISTANT messages since then (spokenSinceUserTurn)
 * 3. Set lastSpeakerId to the most recent ASSISTANT message's participantId
 */
export function calculateTurnStateFromHistory(
  options: CalculateTurnStateOptions
): TurnState {
  const { messages, participants, userParticipantId } = options

  logger.debug('[Turn Manager] Calculating turn state from history', {
    messageCount: messages.length,
    participantCount: participants.length,
    userParticipantId,
  })

  const state = createInitialTurnState()

  if (messages.length === 0) {
    return state
  }

  // Find the index of the last USER message
  let lastUserMessageIndex = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'USER') {
      lastUserMessageIndex = i
      break
    }
  }

  // Track ASSISTANT messages since last user message
  const startIndex = lastUserMessageIndex + 1
  for (let i = startIndex; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.role === 'ASSISTANT' && msg.participantId) {
      if (!state.spokenSinceUserTurn.includes(msg.participantId)) {
        state.spokenSinceUserTurn.push(msg.participantId)
      }
      state.lastSpeakerId = msg.participantId
    }
  }

  logger.debug('[Turn Manager] Calculated turn state from history', {
    spokenSinceUserTurn: state.spokenSinceUserTurn.length,
    lastSpeakerId: state.lastSpeakerId,
  })

  return state
}

// ============================================================================
// TURN SELECTION ALGORITHM
// ============================================================================

/**
 * Selects the next speaker based on turn state and talkativeness weights.
 *
 * Algorithm:
 * 1. If queue is not empty, pop and return first queued participant
 * 2. If user hasn't spoken since all characters got a turn, return null (user's turn)
 * 3. Filter out:
 *    - The last speaker (unless they're the only character)
 *    - Participants who have spoken since user's last turn
 *    - Inactive participants
 * 4. If no eligible speakers remain, return null (user's turn, cycle complete)
 * 5. For eligible speakers, calculate weighted random selection based on talkativeness
 */
export function selectNextSpeaker(
  participants: ChatParticipantBase[],
  characters: Map<string, Character>,
  turnState: TurnState,
  userParticipantId: string | null
): TurnSelectionResult {
  logger.debug('[Turn Manager] Selecting next speaker', {
    participantCount: participants.length,
    characterCount: characters.size,
    queueLength: turnState.queue.length,
    spokenSinceUserTurn: turnState.spokenSinceUserTurn.length,
    lastSpeakerId: turnState.lastSpeakerId,
    userParticipantId,
  })

  // Step 1: Check queue first
  if (turnState.queue.length > 0) {
    const nextFromQueue = turnState.queue[0]
    logger.debug('[Turn Manager] Returning queued participant', { nextFromQueue })
    return {
      nextSpeakerId: nextFromQueue,
      reason: 'queue',
      cycleComplete: false,
    }
  }

  // Get active CHARACTER participants only (personas don't take autonomous turns)
  const activeCharacterParticipants = participants.filter(
    p => p.type === 'CHARACTER' && p.isActive && p.characterId
  )

  logger.debug('[Turn Manager] Active character participants', {
    count: activeCharacterParticipants.length,
    ids: activeCharacterParticipants.map(p => p.id),
  })

  // If no active characters, it's always user's turn
  if (activeCharacterParticipants.length === 0) {
    logger.debug('[Turn Manager] No active characters, user turn')
    return {
      nextSpeakerId: null,
      reason: 'user_turn',
      cycleComplete: true,
    }
  }

  // Special case: only one character
  if (activeCharacterParticipants.length === 1) {
    const onlyCharacter = activeCharacterParticipants[0]

    // If they just spoke, it's user's turn
    if (turnState.lastSpeakerId === onlyCharacter.id) {
      logger.debug('[Turn Manager] Only character just spoke, user turn')
      return {
        nextSpeakerId: null,
        reason: 'user_turn',
        cycleComplete: true,
      }
    }

    // Otherwise, they speak
    logger.debug('[Turn Manager] Only character speaks', { id: onlyCharacter.id })
    return {
      nextSpeakerId: onlyCharacter.id,
      reason: 'only_character',
      cycleComplete: false,
    }
  }

  // Step 3: Filter eligible speakers
  const eligibleParticipants = activeCharacterParticipants.filter(p => {
    // Filter out last speaker (unless queued - but we already checked queue)
    if (p.id === turnState.lastSpeakerId) {
      logger.debug('[Turn Manager] Filtering out last speaker', { id: p.id })
      return false
    }

    // Filter out those who have spoken since user's last turn
    if (turnState.spokenSinceUserTurn.includes(p.id)) {
      logger.debug('[Turn Manager] Filtering out already spoke since user turn', { id: p.id })
      return false
    }

    return true
  })

  logger.debug('[Turn Manager] Eligible participants after filtering', {
    count: eligibleParticipants.length,
    ids: eligibleParticipants.map(p => p.id),
  })

  // Step 4: If no eligible speakers, cycle is complete, user's turn
  if (eligibleParticipants.length === 0) {
    logger.debug('[Turn Manager] No eligible speakers, cycle complete')
    return {
      nextSpeakerId: null,
      reason: 'cycle_complete',
      cycleComplete: true,
    }
  }

  // Step 5: Weighted random selection based on talkativeness
  const weights: Record<string, number> = {}
  let totalWeight = 0

  for (const participant of eligibleParticipants) {
    const character = characters.get(participant.characterId!)
    // Default talkativeness is 0.5 if character not found or no talkativeness set
    const talkativeness = character?.talkativeness ?? 0.5
    weights[participant.id] = talkativeness
    totalWeight += talkativeness
  }

  // If total weight is 0 (shouldn't happen with valid talkativeness), use equal weights
  if (totalWeight === 0) {
    logger.warn('[Turn Manager] Total weight is 0, using equal weights')
    for (const participant of eligibleParticipants) {
      weights[participant.id] = 1
      totalWeight += 1
    }
  }

  // Generate random value and select based on cumulative weights
  const randomValue = Math.random() * totalWeight
  let cumulative = 0
  let selectedId: string | null = null

  for (const participant of eligibleParticipants) {
    cumulative += weights[participant.id]
    if (randomValue < cumulative) {
      selectedId = participant.id
      break
    }
  }

  // Fallback to last eligible participant if random selection somehow failed
  if (!selectedId && eligibleParticipants.length > 0) {
    selectedId = eligibleParticipants[eligibleParticipants.length - 1].id
    logger.warn('[Turn Manager] Random selection fallback', { selectedId })
  }

  logger.debug('[Turn Manager] Weighted selection complete', {
    selectedId,
    weights,
    randomValue,
    totalWeight,
  })

  return {
    nextSpeakerId: selectedId,
    reason: 'weighted_selection',
    cycleComplete: false,
    debug: {
      eligibleSpeakers: eligibleParticipants.map(p => p.id),
      weights,
      randomValue,
    },
  }
}

// ============================================================================
// TURN STATE UPDATES
// ============================================================================

/**
 * Updates turn state after a message is sent.
 * Call this after saving each message to keep turn state current.
 */
export function updateTurnStateAfterMessage(
  currentState: TurnState,
  message: MessageEvent,
  userParticipantId: string | null
): TurnState {
  const newState = { ...currentState }

  logger.debug('[Turn Manager] Updating turn state after message', {
    role: message.role,
    participantId: message.participantId,
    userParticipantId,
  })

  if (message.role === 'USER') {
    // User spoke - reset the cycle
    newState.spokenSinceUserTurn = []
    newState.lastSpeakerId = null
    newState.currentTurnParticipantId = null

    // If user was in queue, remove them
    if (userParticipantId) {
      newState.queue = newState.queue.filter(id => id !== userParticipantId)
    }

    logger.debug('[Turn Manager] User spoke, reset cycle')
  } else if (message.role === 'ASSISTANT' && message.participantId) {
    // Character spoke
    const participantId = message.participantId

    // Add to spoken list if not already there
    if (!newState.spokenSinceUserTurn.includes(participantId)) {
      newState.spokenSinceUserTurn = [...newState.spokenSinceUserTurn, participantId]
    }

    // Update last speaker
    newState.lastSpeakerId = participantId

    // Remove from queue if they were queued
    newState.queue = newState.queue.filter(id => id !== participantId)

    // Clear current turn (will be recalculated)
    newState.currentTurnParticipantId = null

    logger.debug('[Turn Manager] Character spoke', {
      participantId,
      spokenSinceUserTurn: newState.spokenSinceUserTurn.length,
    })
  }

  return newState
}

// ============================================================================
// QUEUE MANAGEMENT
// ============================================================================

/**
 * Adds a participant to the turn queue.
 * They will speak in order when it becomes their turn.
 */
export function addToQueue(
  currentState: TurnState,
  participantId: string
): TurnState {
  logger.debug('[Turn Manager] Adding to queue', { participantId })

  // Don't add duplicates
  if (currentState.queue.includes(participantId)) {
    logger.debug('[Turn Manager] Already in queue, skipping', { participantId })
    return currentState
  }

  return {
    ...currentState,
    queue: [...currentState.queue, participantId],
  }
}

/**
 * Removes a participant from the turn queue.
 */
export function removeFromQueue(
  currentState: TurnState,
  participantId: string
): TurnState {
  logger.debug('[Turn Manager] Removing from queue', { participantId })

  return {
    ...currentState,
    queue: currentState.queue.filter(id => id !== participantId),
  }
}

/**
 * Pops the next participant from the queue and returns the updated state.
 * Returns the participant ID that was removed, or null if queue was empty.
 */
export function popFromQueue(
  currentState: TurnState
): { state: TurnState; participantId: string | null } {
  if (currentState.queue.length === 0) {
    return { state: currentState, participantId: null }
  }

  const [participantId, ...rest] = currentState.queue
  logger.debug('[Turn Manager] Popping from queue', { participantId, remaining: rest.length })

  return {
    state: {
      ...currentState,
      queue: rest,
    },
    participantId,
  }
}

/**
 * Nudges a participant to speak immediately.
 * If they're already in queue, moves them to front.
 * If not in queue, adds them to front.
 */
export function nudgeParticipant(
  currentState: TurnState,
  participantId: string
): TurnState {
  logger.debug('[Turn Manager] Nudging participant', { participantId })

  // Remove from current position in queue (if present)
  const filteredQueue = currentState.queue.filter(id => id !== participantId)

  // Add to front of queue
  return {
    ...currentState,
    queue: [participantId, ...filteredQueue],
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Gets the queue position for a participant (1-indexed), or 0 if not in queue.
 */
export function getQueuePosition(state: TurnState, participantId: string): number {
  const index = state.queue.indexOf(participantId)
  return index === -1 ? 0 : index + 1
}

/**
 * Checks if it's a specific participant's turn.
 */
export function isParticipantsTurn(
  state: TurnState,
  participantId: string,
  selectionResult: TurnSelectionResult
): boolean {
  return selectionResult.nextSpeakerId === participantId
}

/**
 * Checks if it's the user's turn (no AI character should speak).
 */
export function isUsersTurn(selectionResult: TurnSelectionResult): boolean {
  return selectionResult.nextSpeakerId === null
}

/**
 * Gets a human-readable explanation of why a participant was selected.
 */
export function getSelectionExplanation(result: TurnSelectionResult): string {
  switch (result.reason) {
    case 'queue':
      return 'Selected from queue (manually nudged/queued)'
    case 'weighted_selection':
      return 'Selected by weighted random based on talkativeness'
    case 'only_character':
      return 'Only character in chat'
    case 'user_turn':
      return "User's turn - waiting for user input"
    case 'cycle_complete':
      return 'All characters have spoken this cycle - waiting for user'
    default:
      return 'Unknown selection reason'
  }
}

/**
 * Finds the user's participant (PERSONA type) in the participants list.
 */
export function findUserParticipant(
  participants: ChatParticipantBase[]
): ChatParticipantBase | null {
  return participants.find(p => p.type === 'PERSONA' && p.isActive) ?? null
}

/**
 * Gets all active character participants.
 */
export function getActiveCharacterParticipants(
  participants: ChatParticipantBase[]
): ChatParticipantBase[] {
  return participants.filter(p => p.type === 'CHARACTER' && p.isActive)
}

/**
 * Checks if a chat has multiple active character participants.
 */
export function isMultiCharacterChat(participants: ChatParticipantBase[]): boolean {
  return getActiveCharacterParticipants(participants).length > 1
}
