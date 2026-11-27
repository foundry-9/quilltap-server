'use client'

import { Icon } from '@/components/ui/icon'

export interface WizardIndicatorStep {
  key: string
  label: string
}

interface WizardStepIndicatorProps {
  /** The steps to draw, in order */
  steps: ReadonlyArray<WizardIndicatorStep>
  /** Index into `steps` of the step in progress; earlier steps read as complete */
  current: number
}

/**
 * Numbered step indicator shared by the wizards (the provider setup wizard,
 * Search & Replace, the SillyTavern import): circular step numbers with
 * labels, the current step ringed and earlier steps ticked.
 */
export function WizardStepIndicator({ steps, current }: WizardStepIndicatorProps) {
  return (
    <nav aria-label="Wizard progress" className="flex items-center justify-center gap-1 sm:gap-2 mb-6">
      {steps.map((step, index) => {
        const isActive = index === current
        const isCompleted = index < current

        return (
          <div key={step.key} className="flex items-center">
            <div className="flex flex-col items-center">
              <div
                className={`
                  flex items-center justify-center w-8 h-8 rounded-full qt-label transition-colors
                  ${isActive
                    ? 'qt-bg-primary/10 ring-2 qt-ring-brand qt-text-primary'
                    : isCompleted
                      ? 'qt-bg-primary qt-text-overlay'
                      : 'qt-bg-muted qt-text-muted'
                  }
                `}
                aria-current={isActive ? 'step' : undefined}
              >
                {isCompleted ? <Icon name="check" className="w-4 h-4" /> : index + 1}
              </div>
              <span
                className={`qt-text-xs mt-1 hidden sm:block ${
                  isActive ? 'qt-text-primary font-medium' : 'qt-text-muted'
                }`}
              >
                {step.label}
              </span>
            </div>
            {index < steps.length - 1 && (
              <div
                className={`w-6 sm:w-10 h-0.5 mx-1 transition-colors ${
                  index < current ? 'qt-bg-primary' : 'qt-bg-muted'
                }`}
              />
            )}
          </div>
        )
      })}
    </nav>
  )
}

export default WizardStepIndicator
