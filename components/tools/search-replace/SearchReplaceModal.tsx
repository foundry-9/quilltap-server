'use client';

/**
 * SearchReplaceModal Component
 *
 * Main modal for the search and replace wizard.
 * Allows users to search and replace text across chat messages and memories.
 */

import { WizardModal } from '@/components/ui/WizardModal';
import { WizardStepIndicator } from '@/components/ui/WizardStepIndicator';
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

/** The steps the indicator draws: the three the operator moves through. */
const INDICATOR_STEPS = WIZARD_STEPS.slice(0, 3).map((step) => ({ key: step.id, label: step.title }));

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
  } = useSearchReplace({
    isOpen,
    initialScope,
    onComplete,
  });

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

  const showIndicator = currentStep !== 'processing' && currentStep !== 'results';

  return (
    <WizardModal
      isOpen={isOpen}
      onClose={handleClose}
      title="Search & Replace"
      maxWidth="xl"
      busy={executing}
      done={currentStep === 'results'}
      onBack={canGoBack ? prevStep : undefined}
      primary={{
        onClick: nextStep,
        disabled: !canProceed || executing,
        label: currentStep === 'confirm' ? 'Replace All' : 'Next',
      }}
      footer={currentStep === 'processing' ? null : undefined}
    >
      {showIndicator && (
        <WizardStepIndicator
          steps={INDICATOR_STEPS}
          current={stepIndex}
        />
      )}

      {/* Step content */}
      {renderStepContent()}
    </WizardModal>
  );
}
