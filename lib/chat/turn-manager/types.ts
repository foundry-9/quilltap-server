/**
 * Turn Manager Types
 *
 * Type definitions for multi-character chat turn management.
 */

import type { ChatParticipantBase, MessageEvent } from '@/lib/schemas/types';

/**
 * Turn state tracking for multi-character chat sessions.
 * This state is session-only (stored in React state on frontend).
 * On page reload, it's recalculated from message history.
 */
export interface TurnState {
  /** Participants who have spoken since the user last spoke */
  spokenSinceUserTurn: string[]; // participantId[]

  /** The participant whose turn it is (null = user's turn) */
  currentTurnParticipantId: string | null;

  /** Manually queued participants (in order, first = next) */
  queue: string[]; // participantId[]

  /** Last speaker (cannot speak again unless nudged/queued, except if only character) */
  lastSpeakerId: string | null;
}

/**
 * Result of turn selection algorithm
 */
export interface TurnSelectionResult {
  /** The selected participant ID, or null if it's the user's turn */
  nextSpeakerId: string | null;

  /** Reason for the selection (for debugging) */
  reason: 'queue' | 'weighted_selection' | 'only_character' | 'user_turn' | 'cycle_complete';

  /** Whether the cycle is complete (all characters have spoken) */
  cycleComplete: boolean;

  /** Debug info about the selection process */
  debug?: {
    eligibleSpeakers: string[];
    weights: Record<string, number>;
    randomValue?: number;
    /** True when this selection started a new cycle in an all-LLM chat */
    allLLMNewCycle?: boolean;
  };
}

/**
 * Options for calculating initial turn state from message history.
 *
 * Note: `spokenSinceUserTurn` (renamed conceptually to "spoken this cycle") is
 * sourced from the chat row's persisted `spokenThisCycleParticipantIds` field,
 * not from message walking. USER and ASSISTANT messages count symmetrically
 * for `lastSpeakerId` — user-controlled characters take turns in the rotation
 * via the user typing as them.
 */
export interface CalculateTurnStateOptions {
  /** All messages in the chat (or recent subset) */
  messages: MessageEvent[];

  /** All active participants in the chat */
  participants: ChatParticipantBase[];

  /** User's participant ID (user-controlled character participant, if exists) */
  userParticipantId: string | null;

  /**
   * Persisted JSON-encoded list of participantIds that have spoken in the
   * current rotation cycle. Comes from `chat.spokenThisCycleParticipantIds`.
   * Defaults to `'[]'` when omitted (fresh cycle).
   */
  spokenThisCycleParticipantIds?: string;
}
