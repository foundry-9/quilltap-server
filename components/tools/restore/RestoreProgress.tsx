'use client'

import type { RestoreSummary } from '@/lib/backup/types'
import type { RestorePreview } from './types'

interface RestoreProgressProps {
  restoring: boolean
  restoreSummary: RestoreSummary | null
  error: string | null
  preview?: RestorePreview | null
  loadingPreview?: boolean
}

function PreviewCard({
  label,
  value,
}: {
  label: string
  value: number | string
}) {
  return (
    <div className="bg-muted p-4 rounded-lg">
      <p className="text-2xl font-bold text-foreground">{value}</p>
      <p className="qt-text-xs mt-1">{label}</p>
    </div>
  )
}

function LoadingSpinner() {
  return (
    <svg
      className="w-12 h-12 text-primary animate-spin"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  )
}

export function RestoreProgress({
  restoring,
  restoreSummary,
  error,
  preview,
  loadingPreview,
}: RestoreProgressProps) {
  // Preview mode (for displaying what will be restored)
  // Note: Personas from old backups are restored as characters with controlledBy: 'user'
  if (preview && !restoring && !restoreSummary) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <PreviewCard label="Characters" value={preview.characters + (preview.personas || 0)} />
          <PreviewCard label="Chats" value={preview.chats} />
          <PreviewCard label="Messages" value={preview.messages} />
          <PreviewCard label="Tags" value={preview.tags} />
          <PreviewCard label="Memories" value={preview.memories} />
        </div>
      </div>
    )
  }

  // Loading state
  if (restoring) {
    return (
      <div className="space-y-4">
        <div className="text-center py-8">
          <div className="inline-block">
            <LoadingSpinner />
          </div>
          <p className="mt-4 qt-text-small">Restoring your backup...</p>
        </div>
      </div>
    )
  }

  // Success state with summary
  if (restoreSummary) {
    return (
      <div className="space-y-4">
        <div className="bg-green-500/20 dark:bg-green-500/30 border border-green-600 dark:border-green-500 rounded-lg p-4">
          <p className="text-sm font-medium text-green-700 dark:text-green-300">
            Backup restored successfully!
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <PreviewCard label="Characters" value={restoreSummary.characters + (restoreSummary.personas || 0)} />
          <PreviewCard label="Chats" value={restoreSummary.chats} />
          <PreviewCard label="Messages" value={restoreSummary.messages} />
          <PreviewCard
            label="API Keys"
            value={restoreSummary.profiles.connection}
          />
          <PreviewCard label="Files" value={restoreSummary.files} />
        </div>

        {/* Warnings */}
        {restoreSummary.warnings && restoreSummary.warnings.length > 0 && (
          <div className="bg-yellow-500/20 dark:bg-yellow-500/30 border border-yellow-600 dark:border-yellow-500 rounded-lg p-4">
            <p className="text-sm font-medium text-yellow-700 dark:text-yellow-300 mb-2">
              Warnings ({restoreSummary.warnings.length}):
            </p>
            <ul className="text-sm text-yellow-600 dark:text-yellow-400 space-y-1 max-h-40 overflow-y-auto">
              {restoreSummary.warnings.map((warning, idx) => (
                <li key={idx} className="flex gap-2">
                  <span className="flex-shrink-0">•</span>
                  <span className="break-words">{warning}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className="p-4 bg-destructive/10 border border-destructive rounded-lg">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    )
  }

  // Loading preview
  if (loadingPreview) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        Loading preview...
      </div>
    )
  }

  return null
}
