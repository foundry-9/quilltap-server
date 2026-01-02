'use client'

import { ReactNode, useState, useCallback } from 'react'
import { useAsyncOperation } from '@/hooks/useAsyncOperation'
import { SectionHeader } from './SectionHeader'
import { EmptyState } from './EmptyState'
import { ErrorAlert } from './ErrorAlert'

export interface ProfileListProps<T extends { id: string }> {
  /** Section title */
  title: string
  /** Array of items to display */
  items: T[]
  /** Render function for each item */
  renderItem: (item: T, deleteState: ProfileListDeleteState) => ReactNode
  /** Empty state configuration */
  emptyState: {
    title: string
    description: string
    actionLabel: string
  }
  /** Handler for add action */
  onAdd: () => void
  /** Handler for delete action - if provided, ProfileList manages delete state */
  onDelete?: (id: string) => Promise<void>
  /** Whether add button should be hidden (e.g., when form is showing) */
  hideAddButton?: boolean
  /** Sort function - defaults to alphabetical by 'name' or 'label' property */
  sortFn?: (a: T, b: T) => number
  /** Header level for section */
  headerLevel?: 'h2' | 'h3'
  /** Additional header actions (e.g., Import/Export buttons) */
  headerActions?: ReactNode
}

export interface ProfileListDeleteState {
  /** ID of item currently showing delete confirmation */
  deleteConfirmId: string | null
  /** Whether delete operation is in progress */
  isDeleting: boolean
  /** Handler to set delete confirmation ID */
  setDeleteConfirmId: (id: string | null) => void
  /** Handler to confirm delete */
  confirmDelete: (id: string) => void
}

/**
 * Default sort function - sorts by 'name' or 'label' property alphabetically
 */
function defaultSort<T extends { id: string }>(a: T, b: T): number {
  const aName = (a as { name?: string; label?: string }).name ||
                (a as { name?: string; label?: string }).label || ''
  const bName = (b as { name?: string; label?: string }).name ||
                (b as { name?: string; label?: string }).label || ''
  return aName.localeCompare(bName)
}

/**
 * Generic list component for displaying profile-like entities.
 * Handles sorting, empty state, section header, and delete confirmation.
 *
 * @example
 * ```tsx
 * <ProfileList
 *   title="Embedding Profiles"
 *   items={profiles}
 *   renderItem={(profile, deleteState) => (
 *     <ProfileCard
 *       title={profile.name}
 *       deleteConfig={{
 *         isConfirming: deleteState.deleteConfirmId === profile.id,
 *         onConfirmChange: (c) => deleteState.setDeleteConfirmId(c ? profile.id : null),
 *         onConfirm: () => deleteState.confirmDelete(profile.id),
 *         isDeleting: deleteState.isDeleting,
 *       }}
 *     />
 *   )}
 *   emptyState={{
 *     title: 'No profiles yet',
 *     description: 'Create one to get started.',
 *     actionLabel: 'Create Profile',
 *   }}
 *   onAdd={handleAdd}
 *   onDelete={handleDelete}
 * />
 * ```
 */
export function ProfileList<T extends { id: string }>({
  title,
  items,
  renderItem,
  emptyState,
  onAdd,
  onDelete,
  hideAddButton = false,
  sortFn = defaultSort,
  headerLevel = 'h2',
  headerActions,
}: ProfileListProps<T>) {
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const {
    loading: deleteLoading,
    error: deleteError,
    execute: executeDelete,
    clearError: clearDeleteError,
  } = useAsyncOperation<void>()

  const confirmDelete = useCallback(async (id: string) => {
    if (!onDelete) return

    await executeDelete(async () => {
      await onDelete(id)
      setDeleteConfirmId(null)
    })
  }, [onDelete, executeDelete])

  const deleteState: ProfileListDeleteState = {
    deleteConfirmId,
    isDeleting: deleteLoading,
    setDeleteConfirmId,
    confirmDelete,
  }

  const sortedItems = items.toSorted(sortFn)

  return (
    <div className="mb-8">
      {/* Section header with optional actions */}
      <div className="flex items-center justify-between gap-4 mb-4">
        <SectionHeader
          title={title}
          count={items.length}
          level={headerLevel}
          action={!hideAddButton ? {
            label: '+ Add',
            onClick: onAdd,
            show: true,
          } : undefined}
        />
        {headerActions}
      </div>

      {/* Delete error */}
      {deleteError && (
        <ErrorAlert
          message={deleteError}
          onRetry={clearDeleteError}
          className="mb-4"
        />
      )}

      {/* Empty state or list */}
      {items.length === 0 ? (
        <EmptyState
          title={emptyState.title}
          description={emptyState.description}
          action={{
            label: emptyState.actionLabel,
            onClick: onAdd,
          }}
        />
      ) : (
        <div className="space-y-3">
          {sortedItems.map((item) => (
            <div key={item.id}>
              {renderItem(item, deleteState)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
