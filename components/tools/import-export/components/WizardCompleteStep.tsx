'use client'

import { ReactNode } from 'react'
import { Icon } from '@/components/ui/icon'

interface WizardCompleteStepProps {
  title: string
  description: string
  children?: ReactNode
}

/**
 * Success step displayed when export/import completes successfully
 */
export function WizardCompleteStep({
  title,
  description,
  children,
}: WizardCompleteStepProps) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center justify-center py-6">
        <div className="w-12 h-12 rounded-full qt-bg-success/10 flex items-center justify-center mb-4">
          <Icon name="check" className="w-6 h-6 qt-text-success" />
        </div>
        <h3 className="qt-heading-4 text-foreground">{title}</h3>
        <p className="qt-text-small qt-text-secondary mt-2 text-center">
          {description}
        </p>
      </div>
      {children}
    </div>
  )
}
