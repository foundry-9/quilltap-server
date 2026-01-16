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
 * Finds the first user-controlled participant in the participants list.
 * @deprecated Use findUserControlledParticipants for multi-impersonation support
 */
export function findUserParticipant(
  participants: ChatParticipantBase[]
): ChatParticipantBase | null {
  // Check for controlledBy='user'
  return participants.find(p =>
    p.isActive && p.controlledBy === 'user'
  ) ?? null;
}

/**
 * Gets all user-controlled participants (controlledBy === 'user').
 */
export function findUserControlledParticipants(
  participants: ChatParticipantBase[]
): ChatParticipantBase[] {
  return participants.filter(p =>
    p.isActive && p.controlledBy === 'user'
  );
}

/**
 * Gets all active LLM-controlled participants.
 * Replaces getActiveCharacterParticipants to work with controlledBy model.
 */
export function getActiveLLMParticipants(
  participants: ChatParticipantBase[]
): ChatParticipantBase[] {
  return participants.filter(p =>
    p.isActive &&
    p.characterId &&
    p.controlledBy === 'llm'
  );
}

/**
 * Gets all active character participants.
 * @deprecated Use getActiveLLMParticipants for proper controlledBy support
 */
export function getActiveCharacterParticipants(
  participants: ChatParticipantBase[]
): ChatParticipantBase[] {
  // For backwards compatibility, this now returns LLM-controlled participants
  return getActiveLLMParticipants(participants);
}

/**
 * Checks if a chat is a multi-character chat.
 * A chat is multi-character if it has:
 * - 2+ user-controlled participants, OR
 * - 1+ LLM-controlled participants
 * This reflects that multi-character controls are needed in these scenarios.
 */
export function isMultiCharacterChat(participants: ChatParticipantBase[]): boolean {
  const userControlled = findUserControlledParticipants(participants);
  const llmControlled = getActiveLLMParticipants(participants);
  return userControlled.length >= 2 || llmControlled.length >= 1;
}

/**
 * Checks if all participants are LLM-controlled (no user-controlled).
 * Used for all-LLM pause logic.
 */
export function isAllLLMChat(participants: ChatParticipantBase[]): boolean {
  const userControlled = findUserControlledParticipants(participants);
  return userControlled.length === 0;
}
