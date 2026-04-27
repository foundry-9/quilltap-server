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
        <h3 className="qt-heading-4 text-foreground">
          Import Complete
        </h3>
      </div>

      {/* Import Summary */}
      <div className="p-4 qt-bg-muted/50 rounded-lg space-y-2">
        {Object.entries(importResult.imported).map(([key, value]) => {
          if (value === 0) return null
          return (
            <div key={key} className="flex justify-between">
              <span className="text-foreground capitalize">
                {key.replace(/([A-Z])/g, ' $1').trim()}
              </span>
              <span className="font-medium qt-text-success">
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
              <span className="font-medium qt-text-secondary">
                {value}
              </span>
            </div>
          )
        })}
      </div>

      {/* Warnings */}
      {importResult.warnings && importResult.warnings.length > 0 && (
        <div className="p-4 qt-bg-warning/10 border qt-border-warning/30 rounded-lg">
          <h4 className="font-medium qt-text-warning mb-2">
            Warnings
          </h4>
          <ul className="space-y-1">
            {importResult.warnings.map((warning, idx) => (
              <li key={idx} className="text-sm qt-text-warning">
                • {warning}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
