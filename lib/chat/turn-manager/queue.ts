/**
 * Turn Queue Management
 *
 * Functions for managing the participant turn queue.
 */

import { turnManagerLogger as logger } from './logger';
import type { TurnState } from './types';

/**
 * Adds a participant to the turn queue.
 * They will speak in order when it becomes their turn.
 */
export function addToQueue(
  currentState: TurnState,
  participantId: string
): TurnState {
  logger.debug('[Turn Manager] Adding to queue', { participantId });

  // Don't add duplicates
  if (currentState.queue.includes(participantId)) {
    logger.debug('[Turn Manager] Already in queue, skipping', { participantId });
    return currentState;
  }

  return {
    ...currentState,
    queue: [...currentState.queue, participantId],
  };
}

/**
 * Removes a participant from the turn queue.
 */
export function removeFromQueue(
  currentState: TurnState,
  participantId: string
): TurnState {
  logger.debug('[Turn Manager] Removing from queue', { participantId });

  return {
    ...currentState,
    queue: currentState.queue.filter(id => id !== participantId),
  };
}

/**
 * Pops the next participant from the queue and returns the updated state.
 * Returns the participant ID that was removed, or null if queue was empty.
 */
export function popFromQueue(
  currentState: TurnState
): { state: TurnState; participantId: string | null } {
  if (currentState.queue.length === 0) {
    return { state: currentState, participantId: null };
  }

  const [participantId, ...rest] = currentState.queue;
  logger.debug('[Turn Manager] Popping from queue', { participantId, remaining: rest.length });

  return {
    state: {
      ...currentState,
      queue: rest,
    },
    participantId,
  };
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
  logger.debug('[Turn Manager] Nudging participant', { participantId });

  // Remove from current position in queue (if present)
  const filteredQueue = currentState.queue.filter(id => id !== participantId);

  // Add to front of queue
  return {
    ...currentState,
    queue: [participantId, ...filteredQueue],
  };
}

/**
 * Resets the turn cycle when user skips their turn.
 * This clears the spokenSinceUserTurn list so characters become eligible again.
 * Unlike a user message which fully resets, this preserves the queue.
 */
export function resetCycleForUserSkip(currentState: TurnState): TurnState {
  logger.debug('[Turn Manager] Resetting cycle for user skip', {
    previousSpokenCount: currentState.spokenSinceUserTurn.length,
  });

  return {
    ...currentState,
    spokenSinceUserTurn: [],
    // Keep lastSpeakerId to avoid immediate repeat
    // Keep queue intact
  };
}
