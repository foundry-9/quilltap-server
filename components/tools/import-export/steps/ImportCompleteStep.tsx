'use client'

interface ImportResult {
  imported: Record<string, number>
  skipped?: Record<string, number>
  warnings?: string[]
}

interface ImportCompleteStepProps {
  importResult: ImportResult
}

/**
 * Step 5: Display import completion with summary and warnings
 */
export function ImportCompleteStep({ importResult }: ImportCompleteStepProps) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center justify-center py-6">
        <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-4">
          <svg
            className="w-6 h-6 text-green-600 dark:text-green-400"
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
        <h3 className="text-lg font-semibold text-foreground">
          Import Complete
        </h3>
      </div>

      {/* Import Summary */}
      <div className="p-4 bg-muted/50 rounded-lg space-y-2">
        {Object.entries(importResult.imported).map(([key, value]) => {
          if (value === 0) return null
          return (
            <div key={key} className="flex justify-between">
              <span className="text-foreground capitalize">
                {key.replace(/([A-Z])/g, ' $1').trim()}
              </span>
              <span className="font-medium text-green-600 dark:text-green-400">
                +{value}
              </span>
            </div>
          )
        })}
        {Object.entries(importResult.skipped || {}).map(([key, value]) => {
          if (value === 0) return null
          return (
            <div key={`skipped-${key}`} className="flex justify-between">
              <span className="text-foreground capitalize">
                {key.replace(/([A-Z])/g, ' $1').trim()} (skipped)
              </span>
              <span className="font-medium text-muted-foreground">
                {value}
              </span>
            </div>
          )
        })}
      </div>

      {/* Warnings */}
      {importResult.warnings && importResult.warnings.length > 0 && (
        <div className="p-4 bg-yellow-100/20 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
          <h4 className="font-medium text-yellow-800 dark:text-yellow-200 mb-2">
            Warnings
          </h4>
          <ul className="space-y-1">
            {importResult.warnings.map((warning, idx) => (
              <li key={idx} className="text-sm text-yellow-700 dark:text-yellow-300">
                • {warning}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
