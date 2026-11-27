'use client'

import { Spinner } from '@/components/ui/Spinner'

interface WizardLoadingStepProps {
  message: string
}

/**
 * Loading step displayed while export/import is in progress
 */
export function WizardLoadingStep({ message }: WizardLoadingStepProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <Spinner className="w-6 h-6" />
      <p className="mt-4 qt-text font-medium">{message}</p>
    </div>
  )
}
