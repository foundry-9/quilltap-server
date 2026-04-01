/**
 * Turn State Management
 *
 * Functions for initializing and calculating turn state.
 */

import { turnManagerLogger as logger } from './logger';
import type { TurnState, CalculateTurnStateOptions } from './types';
import type { MessageEvent } from '@/lib/schemas/types';

/**
 * Creates a fresh turn state (e.g., for a new chat or after reset)
 * NOTE: This function may be called during React render (e.g., in useState initializer),
 * so it MUST NOT contain any side effects like logging that could trigger state updates.
 */
export function createInitialTurnState(): TurnState {
  return {
    spokenSinceUserTurn: [],
    currentTurnParticipantId: null,
    queue: [],
    lastSpeakerId: null,
  };
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
  const { messages, participants, userParticipantId } = options;

  logger.debug('[Turn Manager] Calculating turn state from history', {
    messageCount: messages.length,
    participantCount: participants.length,
    userParticipantId,
  });

  const state = createInitialTurnState();

  if (messages.length === 0) {
    return state;
  }

  // Find the index of the last USER message
  let lastUserMessageIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'USER') {
      lastUserMessageIndex = i;
      break;
    }
  }

  // Track ASSISTANT messages since last user message
  const startIndex = lastUserMessageIndex + 1;
  for (let i = startIndex; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === 'ASSISTANT' && msg.participantId) {
      if (!state.spokenSinceUserTurn.includes(msg.participantId)) {
        state.spokenSinceUserTurn.push(msg.participantId);
      }
      state.lastSpeakerId = msg.participantId;
    }
  }

  logger.debug('[Turn Manager] Calculated turn state from history', {
    spokenSinceUserTurn: state.spokenSinceUserTurn.length,
    lastSpeakerId: state.lastSpeakerId,
  });

  return state;
}

/**
 * Updates turn state after a message is sent.
 * Call this after saving each message to keep turn state current.
 */
export function updateTurnStateAfterMessage(
  currentState: TurnState,
  message: MessageEvent,
  userParticipantId: string | null
): TurnState {
  const newState = { ...currentState };

  logger.debug('[Turn Manager] Updating turn state after message', {
    role: message.role,
    participantId: message.participantId,
    userParticipantId,
  });

  if (message.role === 'USER') {
    // User spoke - reset the cycle
    newState.spokenSinceUserTurn = [];
    newState.lastSpeakerId = null;
    newState.currentTurnParticipantId = null;

    // If user was in queue, remove them
    if (userParticipantId) {
      newState.queue = newState.queue.filter(id => id !== userParticipantId);
    }

    logger.debug('[Turn Manager] User spoke, reset cycle');
  } else if (message.role === 'ASSISTANT' && message.participantId) {
    // Character spoke
    const participantId = message.participantId;

    // Add to spoken list if not already there
    if (!newState.spokenSinceUserTurn.includes(participantId)) {
      newState.spokenSinceUserTurn = [...newState.spokenSinceUserTurn, participantId];
    }

    // Update last speaker
    newState.lastSpeakerId = participantId;

    // Remove from queue if they were queued
    newState.queue = newState.queue.filter(id => id !== participantId);

    // Clear current turn (will be recalculated)
    newState.currentTurnParticipantId = null;

    logger.debug('[Turn Manager] Character spoke', {
      participantId,
      spokenSinceUserTurn: newState.spokenSinceUserTurn.length,
    });
  }

  return newState;
}
