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
  // Skip whisper messages — they don't count as "speaking" for turn order
  const startIndex = lastUserMessageIndex + 1;
  for (let i = startIndex; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === 'ASSISTANT' && msg.participantId) {
      // Whisper messages (targetParticipantIds set) don't affect turn order
      const isWhisper = 'targetParticipantIds' in msg
        && Array.isArray(msg.targetParticipantIds)
        && msg.targetParticipantIds.length > 0;
      if (isWhisper) continue;

      if (!state.spokenSinceUserTurn.includes(msg.participantId)) {
        state.spokenSinceUserTurn.push(msg.participantId);
      }
      state.lastSpeakerId = msg.participantId;
    }
  }
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
  if (message.role === 'USER') {
    // User spoke - reset the cycle
    newState.spokenSinceUserTurn = [];
    newState.lastSpeakerId = null;
    newState.currentTurnParticipantId = null;

    // If user was in queue, remove them
    if (userParticipantId) {
      newState.queue = newState.queue.filter(id => id !== userParticipantId);
    }
  } else if (message.role === 'ASSISTANT' && message.participantId) {
    // Whisper messages don't affect turn order
    const isWhisper = 'targetParticipantIds' in message
      && Array.isArray(message.targetParticipantIds)
      && message.targetParticipantIds.length > 0;
    if (isWhisper) return currentState;

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
  }

  return newState;
}
