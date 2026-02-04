'use client';

/**
 * SearchReplaceModal Component
 *
 * Main modal for the search and replace wizard.
 * Allows users to search and replace text across chat messages and memories.
 */

import { useEffect } from 'react';
import { BaseModal } from '@/components/ui/BaseModal';
import { useSearchReplace } from './hooks/useSearchReplace';
import {
  ScopeSelectionStep,
  SearchInputStep,
  ConfirmationStep,
  ProcessingStep,
  ResultsStep,
} from './steps';
import { WIZARD_STEPS } from './types';
import type { SearchReplaceModalProps } from './types';

export function SearchReplaceModal({
  isOpen,
  onClose,
  initialScope,
  chatTitle,
  characterName,
  currentChatId,
  onComplete,
}: SearchReplaceModalProps) {
  const {
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
    canProceed,
    canGoBack,
    setScope,
    setSearchText,
    setReplaceText,
    setIncludeMessages,
    setIncludeMemories,
    setConfirmed,
    nextStep,
    prevStep,
    reset,
  } = useSearchReplace({
    initialScope,
    onComplete,
  });

  // Reset when modal closes
  useEffect(() => {
    if (!isOpen) {
      reset();
    }
  }, [isOpen, reset]);


  // Get step title
  const currentStepConfig = WIZARD_STEPS.find(s => s.id === currentStep);
  const stepIndex = WIZARD_STEPS.findIndex(s => s.id === currentStep);

  // Render current step content
  const renderStepContent = () => {
    switch (currentStep) {
      case 'scope':
        return (
          <ScopeSelectionStep
            scope={scope}
            onScopeChange={setScope}
            currentChatId={currentChatId}
            chatTitle={chatTitle}
            characterName={characterName}
          />
        );
      case 'search':
        return (
          <SearchInputStep
            searchText={searchText}
            replaceText={replaceText}
            includeMessages={includeMessages}
            includeMemories={includeMemories}
            preview={preview}
            loadingPreview={loadingPreview}
            previewError={previewError}
            onSearchTextChange={setSearchText}
            onReplaceTextChange={setReplaceText}
            onIncludeMessagesChange={setIncludeMessages}
            onIncludeMemoriesChange={setIncludeMemories}
          />
        );
      case 'confirm':
        return (
          <ConfirmationStep
            searchText={searchText}
            replaceText={replaceText}
            preview={preview}
            confirmed={confirmed}
            onConfirmedChange={setConfirmed}
          />
        );
      case 'processing':
        return <ProcessingStep phase={executionPhase} />;
      case 'results':
        return <ResultsStep result={result} error={error} />;
      default:
        return null;
    }
  };

  // Handle close
  const handleClose = () => {
    if (!executing) {
      onClose();
    }
  };

  // Render footer
  const renderFooter = () => {
    if (currentStep === 'processing') {
      return null;
    }

    if (currentStep === 'results') {
      return (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleClose}
            className="qt-button qt-button-primary"
          >
            Close
          </button>
        </div>
      );
    }

    return (
      <div className="flex justify-between">
        <button
          type="button"
          onClick={canGoBack ? prevStep : handleClose}
          className="qt-button qt-button-secondary"
          disabled={executing}
        >
          {canGoBack ? 'Back' : 'Cancel'}
        </button>
        <button
          type="button"
          onClick={nextStep}
          disabled={!canProceed || executing}
          className="qt-button qt-button-primary"
        >
          {currentStep === 'confirm' ? 'Replace All' : 'Next'}
        </button>
      </div>
    );
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={handleClose}
      title="Search & Replace"
      maxWidth="xl"
      showCloseButton={!executing}
      closeOnClickOutside={!executing}
      closeOnEscape={!executing}
      footer={renderFooter()}
    >
      {/* Step indicator */}
      {currentStep !== 'processing' && currentStep !== 'results' && (
        <div className="mb-6">
          <div className="flex items-center justify-between">
            {WIZARD_STEPS.slice(0, 3).map((step, index) => {
              const isActive = step.id === currentStep;
              const isComplete = index < stepIndex;

              return (
                <div key={step.id} className="flex items-center flex-1">
                  <div className="flex items-center">
                    <div
                      className={`
                        w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium
                        ${isComplete
                          ? 'bg-primary text-primary-foreground'
                          : isActive
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground'
                        }
                      `}
                    >
                      {isComplete ? '✓' : index + 1}
                    </div>
                    <span className={`ml-2 text-sm hidden sm:inline ${isActive ? 'qt-text-primary font-medium' : 'qt-text-secondary'}`}>
                      {step.title}
                    </span>
                  </div>
                  {index < 2 && (
                    <div className={`
                      flex-1 h-0.5 mx-4
                      ${isComplete ? 'bg-primary' : 'bg-muted'}
                    `} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Step content */}
      {renderStepContent()}
    </BaseModal>
  );
}
