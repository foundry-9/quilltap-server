'use client'

import { WIZARD_STEPS, STEP_LABELS, type WizardStep } from './useProviderWizardState'

interface WizardStepIndicatorProps {
  currentStep: WizardStep
  completedSteps?: WizardStep[]
}

/**
 * Numbered step indicator for the provider setup wizard.
 * Shows circular step numbers with labels, highlighting current and completed states.
 */
export function WizardStepIndicator({ currentStep, completedSteps = [] }: WizardStepIndicatorProps) {
  const currentIndex = WIZARD_STEPS.indexOf(currentStep)

  return (
    <nav aria-label="Wizard progress" className="flex items-center justify-center gap-1 sm:gap-2 mb-6">
      {WIZARD_STEPS.map((step, index) => {
        const isActive = step === currentStep
        const isCompleted = completedSteps.includes(step) || index < currentIndex
        const stepNumber = index + 1

        return (
          <div key={step} className="flex items-center">
            <div className="flex flex-col items-center">
              <div
                className={`
                  flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium transition-colors
                  ${isActive
                    ? 'qt-bg-primary/10 ring-2 ring-[var(--color-primary)] qt-text-primary'
                    : isCompleted
                      ? 'bg-[var(--qt-color-primary)] qt-text-overlay'
                      : 'qt-bg-muted qt-text-muted'
                  }
                `}
                aria-current={isActive ? 'step' : undefined}
              >
                {isCompleted && !isActive ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  stepNumber
                )}
              </div>
              <span
                className={`qt-text-xs mt-1 hidden sm:block ${
                  isActive ? 'qt-text-primary font-medium' : 'qt-text-muted'
                }`}
              >
                {STEP_LABELS[step]}
              </span>
            </div>
            {index < WIZARD_STEPS.length - 1 && (
              <div
                className={`w-6 sm:w-10 h-0.5 mx-1 transition-colors ${
                  index < currentIndex ? 'bg-[var(--qt-color-primary)]' : 'qt-bg-muted'
                }`}
              />
            )}
          </div>
        )
      })}
    </nav>
  )
}
