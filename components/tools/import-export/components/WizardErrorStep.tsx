'use client'

interface WizardErrorStepProps {
  title: string
  error: string | null
}

/**
 * Error step displayed when export/import fails
 */
export function WizardErrorStep({ title, error }: WizardErrorStepProps) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center justify-center py-6">
        <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mb-4">
          <svg
            className="w-6 h-6 text-red-600 dark:text-red-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      </div>
      {error && (
        <div className="p-3 bg-destructive/10 border border-destructive rounded-lg">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}
    </div>
  )
}
