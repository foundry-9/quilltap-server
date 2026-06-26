/**
 * Turn Manager Utilities
 *
 * Helper functions for turn management.
 */

import type { TurnState, TurnSelectionResult } from './types';
import type { ChatParticipantBase } from '@/lib/schemas/types';
import { isParticipantPresent } from '@/lib/schemas/types';

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
 *
 * Two shapes mean "the turn has closed":
 *   - `nextSpeakerId === null` — classic case, no character was picked at all
 *     (e.g. only LLM-controlled chats where the cycle completed).
 *   - `reason === 'user_turn'` — the rotation landed on a user-controlled
 *     CHARACTER participant, whose `nextSpeakerId` is the participant's own
 *     id (not null). This is the path introduced when user characters
 *     joined the talkativeness rotation.
 *
 * Both branches must be recognized; downstream code (memory extraction,
 * orchestrator chain control, UI banners) keys off this to decide whether
 * the human now has the floor.
 */
export function isUsersTurn(selectionResult: TurnSelectionResult): boolean {
  return selectionResult.nextSpeakerId === null || selectionResult.reason === 'user_turn';
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
    isParticipantPresent(p.status) && p.controlledBy === 'user'
  ) ?? null;
}

/**
 * Finds the user-controlled participant the human is currently speaking as.
 *
 * When a chat has more than one user-controlled character, the "Speaking As"
 * selector (persisted as `chat.activeTypingParticipantId`, or supplied per-turn
 * via the send payload) decides whose voice a typed message carries. This is the
 * correct resolver for any path that attributes a human-authored message or names
 * the human in LLM context — preferring the selected speaker and falling back to
 * the first user-controlled participant when no valid selection exists.
 *
 * Prefer this over {@link findUserParticipant}, which always returns the first
 * user-controlled participant and silently mis-attributes in multi-speaker chats.
 */
export function findActiveUserParticipant(
  participants: ChatParticipantBase[],
  activeTypingParticipantId?: string | null
): ChatParticipantBase | null {
  if (activeTypingParticipantId) {
    const selected = participants.find(p =>
      p.id === activeTypingParticipantId &&
      isParticipantPresent(p.status) &&
      p.controlledBy === 'user'
    );
    if (selected) return selected;
  }
  return findUserParticipant(participants);
}

/**
 * Gets all user-controlled participants (controlledBy === 'user').
 */
export function findUserControlledParticipants(
  participants: ChatParticipantBase[]
): ChatParticipantBase[] {
  return participants.filter(p =>
    isParticipantPresent(p.status) && p.controlledBy === 'user'
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
    isParticipantPresent(p.status) &&
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
