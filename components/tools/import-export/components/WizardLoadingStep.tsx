'use client'

import { LoadingSpinner } from './LoadingSpinner'

interface WizardLoadingStepProps {
  message: string
}

/**
 * Loading step displayed while export/import is in progress
 */
export function WizardLoadingStep({ message }: WizardLoadingStepProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <LoadingSpinner />
      <p className="mt-4 text-foreground font-medium">{message}</p>
    </div>
  )
}
