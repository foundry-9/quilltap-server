/**
 * useSearchReplace Hook
 *
 * State management for the search and replace wizard.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { clientLogger } from '@/lib/client-logger';
import type {
  SearchReplaceScope,
  SearchReplacePreview,
  SearchReplaceResult,
  UseSearchReplaceReturn,
  WizardStep,
} from '../types';
import { WIZARD_STEPS } from '../types';

interface UseSearchReplaceOptions {
  initialScope?: SearchReplaceScope;
  onComplete?: (result: SearchReplaceResult) => void;
}

export function useSearchReplace(
  options: UseSearchReplaceOptions = {}
): UseSearchReplaceReturn {
  const { initialScope, onComplete } = options;

  // Wizard state
  const [currentStep, setCurrentStep] = useState<WizardStep['id']>(
    initialScope ? 'search' : 'scope'
  );

  // Form state
  const [scope, setScope] = useState<SearchReplaceScope | null>(initialScope || null);
  const [searchText, setSearchText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [includeMessages, setIncludeMessages] = useState(true);
  const [includeMemories, setIncludeMemories] = useState(true);
  const [confirmed, setConfirmed] = useState(false);

  // Preview state
  const [preview, setPreview] = useState<SearchReplacePreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Execution state
  const [executing, setExecuting] = useState(false);
  const [executionPhase, setExecutionPhase] = useState('');
  const [result, setResult] = useState<SearchReplaceResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Debounce timer ref
  const previewTimerRef = useRef<NodeJS.Timeout | null>(null);


  // Fetch preview when search text changes (debounced)
  const fetchPreview = useCallback(async () => {
    if (!scope || !searchText.trim()) {
      setPreview(null);
      return;
    }

    setLoadingPreview(true);
    setPreviewError(null);

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

      const data = await response.json();
      setPreview(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch preview';
      setPreviewError(message);
      clientLogger.error('[useSearchReplace] Preview fetch error', { error: message });
    } finally {
      setLoadingPreview(false);
    }
  }, [scope, searchText, replaceText, includeMessages, includeMemories]);

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

    setExecuting(true);
    setError(null);
    setCurrentStep('processing');
    setExecutionPhase('Starting...');

    try {
      clientLogger.info('[useSearchReplace] Executing search/replace', {
        scope,
        searchTextLength: searchText.length,
        replaceTextLength: replaceText.length,
      });

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
      setResult(data);
      setCurrentStep('results');
      clientLogger.info('[useSearchReplace] Search/replace complete', {
        messagesUpdated: data.messagesUpdated,
        memoriesUpdated: data.memoriesUpdated,
        chatsAffected: data.chatsAffected,
        errorCount: data.errors.length,
      });

      onComplete?.(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to execute search/replace';
      setError(message);
      setCurrentStep('results');
      clientLogger.error('[useSearchReplace] Execute error', { error: message });
    } finally {
      setExecuting(false);
      setExecutionPhase('');
    }
  }, [scope, searchText, replaceText, includeMessages, includeMemories, onComplete]);

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

      setCurrentStep(nextStepId);
    }
  }, [currentStep, execute]);

  const prevStep = useCallback(() => {
    const currentIndex = WIZARD_STEPS.findIndex(s => s.id === currentStep);
    if (currentIndex > 0) {
      const prevStepId = WIZARD_STEPS[currentIndex - 1].id;
      setCurrentStep(prevStepId);
      setConfirmed(false); // Reset confirmation when going back
    }
  }, [currentStep]);

  // Reset
  const reset = useCallback(() => {
    setCurrentStep(initialScope ? 'search' : 'scope');
    setScope(initialScope || null);
    setSearchText('');
    setReplaceText('');
    setIncludeMessages(true);
    setIncludeMemories(true);
    setConfirmed(false);
    setPreview(null);
    setLoadingPreview(false);
    setPreviewError(null);
    setExecuting(false);
    setExecutionPhase('');
    setResult(null);
    setError(null);
  }, [initialScope]);

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
    // State
    currentStep,
    scope,
    searchText,
    replaceText,
    includeMessages,
    includeMemories,
    confirmed,
    preview,
    loadingPreview,
    previewError,
    executing,
    executionPhase,
    result,
    error,

    // Computed
    canProceed,
    canGoBack,

    // Actions
    setScope,
    setSearchText,
    setReplaceText,
    setIncludeMessages,
    setIncludeMemories,
    setConfirmed,
    nextStep,
    prevStep,
    fetchPreview,
    execute,
    reset,
  };
}
