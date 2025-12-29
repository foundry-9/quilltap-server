/**
 * Turn Manager Utilities
 *
 * Helper functions for turn management.
 */

import type { TurnState, TurnSelectionResult } from './types';
import type { ChatParticipantBase } from '@/lib/schemas/types';

/**
 * Gets the queue position for a participant (1-indexed), or 0 if not in queue.
 */
export function getQueuePosition(state: TurnState, participantId: string): number {
  const index = state.queue.indexOf(participantId);
  return index === -1 ? 0 : index + 1;
}

/**
 * Checks if it's a specific participant's turn.
 */
export function isParticipantsTurn(
  state: TurnState,
  participantId: string,
  selectionResult: TurnSelectionResult
): boolean {
  return selectionResult.nextSpeakerId === participantId;
}

/**
 * Checks if it's the user's turn (no AI character should speak).
 */
export function isUsersTurn(selectionResult: TurnSelectionResult): boolean {
  return selectionResult.nextSpeakerId === null;
}

/**
 * Gets a human-readable explanation of why a participant was selected.
 */
export function getSelectionExplanation(result: TurnSelectionResult): string {
  switch (result.reason) {
    case 'queue':
      return 'Selected from queue (manually nudged/queued)';
    case 'weighted_selection':
      return 'Selected by weighted random based on talkativeness';
    case 'only_character':
      return 'Only character in chat';
    case 'user_turn':
      return "User's turn - waiting for user input";
    case 'cycle_complete':
      return 'All characters have spoken this cycle - waiting for user';
    default:
      return 'Unknown selection reason';
  }
}

/**
 * Finds the user's participant (PERSONA type) in the participants list.
 */
export function findUserParticipant(
  participants: ChatParticipantBase[]
): ChatParticipantBase | null {
  return participants.find(p => p.type === 'PERSONA' && p.isActive) ?? null;
}

/**
 * Gets all active character participants.
 */
export function getActiveCharacterParticipants(
  participants: ChatParticipantBase[]
): ChatParticipantBase[] {
  return participants.filter(p => p.type === 'CHARACTER' && p.isActive);
}

/**
 * Checks if a chat has multiple active character participants.
 */
export function isMultiCharacterChat(participants: ChatParticipantBase[]): boolean {
  return getActiveCharacterParticipants(participants).length > 1;
}
