'use client'

type ConflictStrategy = 'skip' | 'overwrite' | 'duplicate'

interface ImportOptionsStepProps {
  conflictStrategy: ConflictStrategy
  onConflictStrategyChange: (strategy: ConflictStrategy) => void
  importMemories: boolean
  onImportMemoriesChange: (include: boolean) => void
  hasMemories: boolean
}

/**
 * Step 3: Configure import options (conflict strategy, memories)
 */
export function ImportOptionsStep({
  conflictStrategy,
  onConflictStrategyChange,
  importMemories,
  onImportMemoriesChange,
  hasMemories,
}: ImportOptionsStepProps) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block qt-label text-foreground mb-2">
          Conflict Strategy
        </label>
        <select
          value={conflictStrategy}
          onChange={(e) => onConflictStrategyChange(e.target.value as ConflictStrategy)}
          className="w-full px-3 py-2 border qt-border-default rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="skip">Skip existing entities (default)</option>
          <option value="overwrite">Overwrite existing entities</option>
          <option value="duplicate">Import as duplicates</option>
        </select>
        <p className="qt-text-small qt-text-secondary mt-2">
          {conflictStrategy === 'skip' && 'Existing entities will be kept unchanged.'}
          {conflictStrategy === 'overwrite' && 'Existing entities will be overwritten with imported versions.'}
          {conflictStrategy === 'duplicate' && 'Imported entities will be created with new IDs.'}
        </p>
      </div>

      {hasMemories && (
        <label className="flex items-start gap-3 p-4 border qt-border-default rounded-lg cursor-pointer hover:qt-bg-muted/50">
          <input
            type="checkbox"
            checked={importMemories}
            onChange={(e) => onImportMemoriesChange(e.target.checked)}
            className="w-4 h-4 mt-1"
          />
          <div className="flex-1">
            <p className="font-medium text-foreground">
              Import associated memories
            </p>
            <p className="qt-text-small qt-text-secondary mt-1">
              Memories will be included in the import
            </p>
          </div>
        </label>
      )}
    </div>
  )
}
