/**
 * Chat Module
 * Sprint 5: Context Management
 *
 * Provides chat context management and intelligent context building.
 */

export {
  buildContext,
  buildSystemPrompt,
  calculateContextBudget,
  formatMemoriesForContext,
  formatSummaryForContext,
  selectRecentMessages,
  willExceedContextLimit,
  getContextStatus,
  type ContextMessage,
  type ContextBudget,
  type BuiltContext,
  type BuildContextOptions,
} from './context-manager'

export {
  generateContextSummary,
  generateContextSummaryAsync,
  chatNeedsSummary,
  clearContextSummary,
  checkAndGenerateSummaryIfNeeded,
  calculateInterchangeCount,
  shouldCheckTitleAtInterchange,
  type GenerateSummaryOptions,
  type SummaryGenerationResult,
} from './context-summary'

export {
  // Turn state types
  type TurnState,
  type TurnSelectionResult,
  type CalculateTurnStateOptions,
  // Turn state initialization
  createInitialTurnState,
  calculateTurnStateFromHistory,
  // Turn selection algorithm
  selectNextSpeaker,
  // Turn state updates
  updateTurnStateAfterMessage,
  // Queue management
  addToQueue,
  removeFromQueue,
  popFromQueue,
  nudgeParticipant,
  // Utility functions
  getQueuePosition,
  isParticipantsTurn,
  isUsersTurn,
  getSelectionExplanation,
  findUserParticipant,
  getActiveCharacterParticipants,
  isMultiCharacterChat,
} from './turn-manager'
