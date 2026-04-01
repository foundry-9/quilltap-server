'use client'

interface ExportOptionsStepProps {
  includeMemories: boolean
  onIncludeMemoriesChange: (include: boolean) => void
  memoryCount: number
}

/**
 * Step 3: Configure export options (e.g., include memories)
 */
export function ExportOptionsStep({
  includeMemories,
  onIncludeMemoriesChange,
  memoryCount,
}: ExportOptionsStepProps) {
  return (
    <div className="space-y-4">
      <p className="qt-text-small text-muted-foreground">
        Configure export options
      </p>
      <label className="flex items-start gap-3 p-4 border border-border rounded-lg cursor-pointer hover:bg-muted/50">
        <input
          type="checkbox"
          checked={includeMemories}
          onChange={(e) => onIncludeMemoriesChange(e.target.checked)}
          className="w-4 h-4 mt-1"
        />
        <div className="flex-1">
          <p className="font-medium text-foreground">
            Include associated memories
          </p>
          {memoryCount > 0 && (
            <p className="qt-text-small text-muted-foreground mt-1">
              {memoryCount} memories will be included
            </p>
          )}
        </div>
      </label>
    </div>
  )
}
