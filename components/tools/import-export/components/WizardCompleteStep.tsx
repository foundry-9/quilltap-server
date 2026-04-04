'use client'

import { ReactNode } from 'react'

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
          <svg
            className="w-6 h-6 qt-text-success"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-foreground">{title}</h3>
        <p className="qt-text-small qt-text-secondary mt-2 text-center">
          {description}
        </p>
      </div>
      {children}
    </div>
  )
}
