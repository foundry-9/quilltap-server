/**
 * useSearchReplace Hook
 *
 * State management for the search and replace wizard.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useDialogState } from '@/hooks/useDialogState';
import type {
  SearchReplaceScope,
  SearchReplacePreview,
  SearchReplaceResult,
  SearchReplaceState,
  UseSearchReplaceReturn,
} from '../types';
import { WIZARD_STEPS } from '../types';

interface UseSearchReplaceOptions {
  /** The modal's open flag: the wizard starts over whenever it closes */
  isOpen: boolean;
  initialScope?: SearchReplaceScope;
  onComplete?: (result: SearchReplaceResult) => void;
}

/** The wizard's state on opening: a pre-selected scope skips the scope step. */
function initialStateFor(initialScope: SearchReplaceScope | undefined): SearchReplaceState {
  return {
    currentStep: initialScope ? 'search' : 'scope',
    scope: initialScope || null,
    searchText: '',
    replaceText: '',
    includeMessages: true,
    includeMemories: true,
    confirmed: false,
    preview: null,
    loadingPreview: false,
    previewError: null,
    executing: false,
    executionPhase: '',
    result: null,
    error: null,
  };
}

export function useSearchReplace(options: UseSearchReplaceOptions): UseSearchReplaceReturn {
  const { isOpen, initialScope, onComplete } = options;

  // Callers commonly pass an inline object literal (`{ type: 'chat', chatId }`)
  // for initialScope, so its reference changes every render; useDialogState
  // keeps the latest initial state in a ref, so `reset` stays stable.
  const { state, setState, setField, reset } = useDialogState<SearchReplaceState>({
    isOpen,
    initialState: initialStateFor(initialScope),
  });
  const {
    currentStep,
    scope,
    searchText,
    replaceText,
    includeMessages,
    includeMemories,
    confirmed,
    preview,
  } = state;

  // Debounce timer ref
  const previewTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch preview when search text changes (debounced)
  const fetchPreview = useCallback(async () => {
    if (!scope || !searchText.trim()) {
      setField('preview', null);
      return;
    }

    setState((prev) => ({ ...prev, loadingPreview: true, previewError: null }));

    try {
      const response = await fetch('/api/v1/search-replace?action=preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope,
          searchText,
          replaceText,
          includeMessages,
          includeMemories,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to fetch preview');
      }

      const data: SearchReplacePreview = await response.json();
      setField('preview', data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch preview';
      setField('previewError', message);
      console.error('[useSearchReplace] Preview fetch error', { error: message });
    } finally {
      setField('loadingPreview', false);
    }
  }, [scope, searchText, replaceText, includeMessages, includeMemories, setState, setField]);

  // Debounced preview fetch
  useEffect(() => {
    if (currentStep === 'search' && scope && searchText.trim()) {
      if (previewTimerRef.current) {
        clearTimeout(previewTimerRef.current);
      }
      previewTimerRef.current = setTimeout(() => {
        fetchPreview();
      }, 300);
    }

    return () => {
      if (previewTimerRef.current) {
        clearTimeout(previewTimerRef.current);
      }
    };
  }, [currentStep, scope, searchText, includeMessages, includeMemories, fetchPreview]);

  // Execute search/replace
  const execute = useCallback(async () => {
    if (!scope || !searchText.trim()) {
      return;
    }

    setState((prev) => ({
      ...prev,
      executing: true,
      error: null,
      currentStep: 'processing',
      executionPhase: 'Starting...',
    }));

    try {
      const response = await fetch('/api/v1/search-replace?action=execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope,
          searchText,
          replaceText,
          includeMessages,
          includeMemories,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to execute search/replace');
      }

      const data: SearchReplaceResult = await response.json();
      setState((prev) => ({ ...prev, result: data, currentStep: 'results' }));

      onComplete?.(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to execute search/replace';
      setState((prev) => ({ ...prev, error: message, currentStep: 'results' }));
      console.error('[useSearchReplace] Execute error', { error: message });
    } finally {
      setState((prev) => ({ ...prev, executing: false, executionPhase: '' }));
    }
  }, [scope, searchText, replaceText, includeMessages, includeMemories, onComplete, setState]);

  // Navigation
  const nextStep = useCallback(() => {
    const currentIndex = WIZARD_STEPS.findIndex(s => s.id === currentStep);
    if (currentIndex < WIZARD_STEPS.length - 1) {
      const nextStepId = WIZARD_STEPS[currentIndex + 1].id;

      // Skip to execution if on confirm step
      if (currentStep === 'confirm') {
        execute();
        return;
      }

      setField('currentStep', nextStepId);
    }
  }, [currentStep, execute, setField]);

  const prevStep = useCallback(() => {
    const currentIndex = WIZARD_STEPS.findIndex(s => s.id === currentStep);
    if (currentIndex > 0) {
      const prevStepId = WIZARD_STEPS[currentIndex - 1].id;
      // Reset confirmation when going back
      setState((prev) => ({ ...prev, currentStep: prevStepId, confirmed: false }));
    }
  }, [currentStep, setState]);

  // Computed values
  const canProceed = (() => {
    switch (currentStep) {
      case 'scope':
        return scope !== null;
      case 'search':
        return searchText.trim().length > 0 && preview !== null &&
               (preview.messageMatches > 0 || preview.memoryMatches > 0);
      case 'confirm':
        return confirmed;
      case 'processing':
        return false;
      case 'results':
        return true;
      default:
        return false;
    }
  })();

  const canGoBack = (() => {
    const currentIndex = WIZARD_STEPS.findIndex(s => s.id === currentStep);
    // Can't go back from first step, processing, or results
    return currentIndex > 0 && currentStep !== 'processing' && currentStep !== 'results';
  })();

  return {
    ...state,

    // Computed
    canProceed,
    canGoBack,

    // Actions
    setScope: (value) => setField('scope', value),
    setSearchText: (value) => setField('searchText', value),
    setReplaceText: (value) => setField('replaceText', value),
    setIncludeMessages: (value) => setField('includeMessages', value),
    setIncludeMemories: (value) => setField('includeMemories', value),
    setConfirmed: (value) => setField('confirmed', value),
    nextStep,
    prevStep,
    fetchPreview,
    execute,
    reset,
  };
}
