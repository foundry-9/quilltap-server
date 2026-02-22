'use client'

import type { ReactNode } from 'react'
import { WizardStepIndicator } from './WizardStepIndicator'
import type { WizardStep } from './useProviderWizardState'

interface WizardLayoutProps {
  currentStep: WizardStep
  children: ReactNode
  footer?: ReactNode
  title?: string
  subtitle?: string
}

/**
 * Centered card layout for the provider setup wizard.
 * Provides the step indicator at top, content area, and navigation footer.
 */
export function WizardLayout({
  currentStep,
  children,
  footer,
  title,
  subtitle,
}: WizardLayoutProps) {
  return (
    <div className="qt-auth-page flex items-center justify-center min-h-screen p-4">
      <div className="qt-card max-w-2xl w-full p-6 space-y-6">
        <WizardStepIndicator currentStep={currentStep} />

        {(title || subtitle) && (
          <div>
            {title && <h1 className="qt-heading-2">{title}</h1>}
            {subtitle && <p className="qt-text-muted mt-1">{subtitle}</p>}
          </div>
        )}

        <div className="min-h-[300px]">{children}</div>

        {footer && <div className="pt-4 border-t border-[var(--qt-border-color)]">{footer}</div>}
      </div>
    </div>
  )
}

// ============================================================================
// Navigation buttons for wizard footer
// ============================================================================

interface WizardNavProps {
  onBack?: () => void
  onNext?: () => void
  onSkip?: () => void
  canGoBack?: boolean
  canGoNext?: boolean
  nextLabel?: string
  nextDisabled?: boolean
  loading?: boolean
  showSkip?: boolean
}

export function WizardNav({
  onBack,
  onNext,
  onSkip,
  canGoBack = true,
  canGoNext = true,
  nextLabel = 'Next',
  nextDisabled = false,
  loading = false,
  showSkip = false,
}: WizardNavProps) {
  return (
    <div className="flex items-center justify-between">
      <div>
        {canGoBack && onBack && (
          <button
            type="button"
            onClick={onBack}
            disabled={loading}
            className="qt-button-secondary"
          >
            Back
          </button>
        )}
      </div>
      <div className="flex items-center gap-2">
        {showSkip && onSkip && (
          <button
            type="button"
            onClick={onSkip}
            disabled={loading}
            className="qt-button-secondary"
          >
            Skip
          </button>
        )}
        {canGoNext && onNext && (
          <button
            type="button"
            onClick={onNext}
            disabled={nextDisabled || loading}
            className="qt-button-primary"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="qt-spinner-sm" />
                {nextLabel}
              </span>
            ) : (
              nextLabel
            )}
          </button>
        )}
      </div>
    </div>
  )
}
