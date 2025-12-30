/**
 * Turn Manager Module
 * Multi-Character Chat System - Phase 2
 *
 * Provides turn-based dialogue management for multi-character chats.
 * Handles turn selection algorithm, queue management, and turn state tracking.
 *
 * @module lib/chat/turn-manager
 */

// Types
export type {
  TurnState,
  TurnSelectionResult,
  CalculateTurnStateOptions,
} from './types';

// State management
export {
  createInitialTurnState,
  calculateTurnStateFromHistory,
  updateTurnStateAfterMessage,
} from './state';

// Turn selection
export { selectNextSpeaker } from './selection';

// Queue management
export {
  addToQueue,
  removeFromQueue,
  popFromQueue,
  nudgeParticipant,
  resetCycleForUserSkip,
} from './queue';

// Utilities
export {
  getQueuePosition,
  isParticipantsTurn,
  isUsersTurn,
  getSelectionExplanation,
  findUserParticipant,
  findUserControlledParticipants,
  getActiveCharacterParticipants,
  getActiveLLMParticipants,
  isMultiCharacterChat,
  isAllLLMChat,
} from './utils';

// All-LLM pause logic
export {
  INITIAL_PAUSE_INTERVAL,
  getNextPauseInterval,
  shouldPauseForAllLLM,
  getCurrentPauseThreshold,
  getNextPauseThreshold,
  getTurnsUntilNextPause,
} from './all-llm-pause';
