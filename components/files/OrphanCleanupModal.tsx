'use client'

/**
 * OrphanCleanupModal Component
 *
 * Modal dialog for cleaning up untracked (orphaned) files — files found on disk
 * with no prior database record. Offers two modes: move unique files to an
 * /orphans/ folder, or delete everything.
 */

import { BaseModal } from '@/components/ui/BaseModal'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

interface OrphanCleanupModalProps {
  isOpen: boolean
  stats: {
    orphanedCount: number
    duplicateCount: number
    uniqueCount: number
    totalSize: number
    uniqueSize: number
  }
  onMove: () => void
  onDelete: () => void
  onCancel: () => void
  isProcessing: boolean
}

export default function OrphanCleanupModal({
  isOpen,
  stats,
  onMove,
  onDelete,
  onCancel,
  isProcessing,
}: Readonly<OrphanCleanupModalProps>) {
  const { orphanedCount, duplicateCount, uniqueCount, uniqueSize } = stats

  const footer = (
    <div className="flex justify-end gap-2">
      <button
        onClick={onCancel}
        disabled={isProcessing}
        className="qt-button qt-button-secondary"
      >
        Cancel
      </button>
      <button
        onClick={onMove}
        disabled={isProcessing || uniqueCount === 0}
        title={uniqueCount === 0 ? 'No unique files to relocate' : 'Move unique files to an /orphans/ folder for later review. Duplicates will be removed.'}
        className="qt-button qt-button-secondary"
      >
        {isProcessing ? 'Processing...' : 'Relocate to /orphans/'}
      </button>
      <button
        onClick={onDelete}
        disabled={isProcessing}
        className="qt-button bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
      >
        {isProcessing ? 'Processing...' : 'Delete All'}
      </button>
    </div>
  )

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onCancel}
      title="Untracked Files Detected"
      footer={footer}
      closeOnClickOutside={!isProcessing}
      closeOnEscape={!isProcessing}
    >
      <div className="space-y-4">
        <p className="qt-text-base font-semibold">
          We have discovered <strong>{orphanedCount} files</strong> loitering about the premises without proper documentation — rather like uninvited guests at a garden party who nonetheless appear to have brought their own sandwiches.
        </p>

        {/* Duplicate files explanation */}
        {duplicateCount > 0 && (
          <div>
            <p className="qt-text-small text-muted-foreground">
              Of these, <strong>{duplicateCount}</strong> are mere duplicates of files already in good standing and shall be disposed of regardless of your choice below.
            </p>
          </div>
        )}

        {/* Unique files summary */}
        <div>
          <p className="qt-text-small text-muted-foreground">
            The remaining <strong>{uniqueCount} unique files</strong> ({formatSize(uniqueSize)}) await your instruction.
          </p>
        </div>

        {/* Options explanation */}
        <div className="space-y-3 pt-2">
          <div>
            <p className="qt-text-small font-medium mb-1">Relocate to /orphans/</p>
            <p className="qt-text-small text-muted-foreground">
              Move unique files to a dedicated folder for your later review. All duplicates will be removed.
            </p>
          </div>

          <div>
            <p className="qt-text-small font-medium mb-1">Delete All</p>
            <p className="qt-text-small text-muted-foreground">
              Permanently remove all untracked files, both unique and duplicates. This action cannot be undone.
            </p>
          </div>
        </div>
      </div>
    </BaseModal>
  )
}
