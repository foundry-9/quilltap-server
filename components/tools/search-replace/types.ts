/**
 * Search and Replace Feature Types
 *
 * Type definitions for the search and replace functionality
 * across chat messages and memories.
 */

/**
 * Scope for search and replace operations
 * User-controlled characters use controlledBy: 'user' on the CHARACTER type
 */
export type SearchReplaceScope =
  | { type: 'chat'; chatId: string }
  | { type: 'character'; characterId: string };

/**
 * Request payload for search and replace operations
 */
export interface SearchReplaceRequest {
  scope: SearchReplaceScope;
  searchText: string;
  replaceText: string;
  includeMessages: boolean;
  includeMemories: boolean;
}

/**
 * Preview counts before executing a search/replace
 */
export interface SearchReplacePreview {
  messageMatches: number;
  memoryMatches: number;
  affectedChats: number;
  affectedMemories: number;
}

/**
 * Result of a search/replace execution
 */
export interface SearchReplaceResult {
  messagesUpdated: number;
  memoriesUpdated: number;
  chatsAffected: number;
  errors: string[];
}

/**
 * Wizard step definition
 */
export interface WizardStep {
  id: 'scope' | 'search' | 'confirm' | 'processing' | 'results';
  title: string;
}

/**
 * Wizard steps configuration
 */
export const WIZARD_STEPS: WizardStep[] = [
  { id: 'scope', title: 'Select Scope' },
  { id: 'search', title: 'Search & Replace' },
  { id: 'confirm', title: 'Confirm Changes' },
  { id: 'processing', title: 'Processing' },
  { id: 'results', title: 'Results' },
];

/**
 * Props for the SearchReplaceModal component
 */
export interface SearchReplaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Pre-selected scope from entry point */
  initialScope?: SearchReplaceScope;
  /** Entity names for display */
  chatTitle?: string;
  characterName?: string;
  /** Current chat ID if opened from chat context */
  currentChatId?: string;
  /** Callback when search/replace completes with results */
  onComplete?: (result: SearchReplaceResult) => void;
}

/**
 * State for the useSearchReplace hook
 */
export interface SearchReplaceState {
  // Wizard state
  currentStep: WizardStep['id'];

  // Form state
  scope: SearchReplaceScope | null;
  searchText: string;
  replaceText: string;
  includeMessages: boolean;
  includeMemories: boolean;
  confirmed: boolean;

  // Preview
  preview: SearchReplacePreview | null;
  loadingPreview: boolean;
  previewError: string | null;

  // Execution
  executing: boolean;
  executionPhase: string;
  result: SearchReplaceResult | null;
  error: string | null;
}

/**
 * Actions for the useSearchReplace hook
 */
export interface SearchReplaceActions {
  setScope: (scope: SearchReplaceScope) => void;
  setSearchText: (text: string) => void;
  setReplaceText: (text: string) => void;
  setIncludeMessages: (include: boolean) => void;
  setIncludeMemories: (include: boolean) => void;
  setConfirmed: (confirmed: boolean) => void;
  nextStep: () => void;
  prevStep: () => void;
  fetchPreview: () => Promise<void>;
  execute: () => Promise<void>;
  reset: () => void;
}

/**
 * Return type for the useSearchReplace hook
 */
export interface UseSearchReplaceReturn extends SearchReplaceState, SearchReplaceActions {
  canProceed: boolean;
  canGoBack: boolean;
}
