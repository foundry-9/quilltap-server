'use client'

import { useEffect } from 'react'
import { useListManager } from '@/hooks/useListManager'
import { fetchJson } from '@/lib/fetch-helpers'
import { PhysicalDescriptionCard, PhysicalDescription } from './physical-description-card'
import { PhysicalDescriptionEditor } from './physical-description-editor'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { LoadingState } from '@/components/ui/LoadingState'
import { ErrorAlert } from '@/components/ui/ErrorAlert'
import { EmptyState } from '@/components/ui/EmptyState'

interface PhysicalDescriptionListProps {
  // EntityType is now only 'character' - personas have been migrated to characters with controlledBy: 'user'
  entityType: 'character'
  entityId: string
  // Optional key to trigger refetch from parent (e.g., after AI wizard creates a description)
  refreshKey?: number
}

export function PhysicalDescriptionList({ entityType, entityId, refreshKey }: PhysicalDescriptionListProps) {
  // All entities are now characters (personas migrated to characters with controlledBy: 'user')
  const baseUrl = `/api/v1/characters/${entityId}/descriptions`

  const {
    items: descriptions,
    loading,
    error,
    deletingId,
    editingItem: editingDescription,
    showEditor,
    refetch,
    handleDelete,
    handleEdit,
    handleCreate,
    handleEditorClose,
    handleEditorSave,
  } = useListManager<PhysicalDescription>({
    fetchFn: async () => {
      const result = await fetchJson<{ descriptions: PhysicalDescription[] }>(baseUrl)
      if (!result.ok) throw new Error(result.error || 'Failed to fetch descriptions')
      return result.data?.descriptions || []
    },
    deleteFn: async (id: string) => {
      const result = await fetchJson(`${baseUrl}/${id}`, { method: 'DELETE' })
      if (!result.ok) throw new Error(result.error || 'Failed to delete description')
    },
    deleteConfirmMessage: 'Are you sure you want to delete this description?',
    deleteSuccessMessage: 'Description deleted',
  })

  // Refetch when refreshKey changes (used by AI Wizard to refresh after creating description)
  useEffect(() => {
    if (refreshKey !== undefined && refreshKey > 0) {
      refetch()
    }
  }, [refreshKey, refetch])

  const documentIcon = (
    <svg
      className="w-12 h-12 text-muted-foreground mx-auto"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
      />
    </svg>
  )

  if (loading) {
    return <LoadingState variant="spinner" />
  }

  if (error) {
    return (
      <ErrorAlert
        message={error}
        onRetry={refetch}
      />
    )
  }

  return (
    <div>
      <SectionHeader
        title="Physical Descriptions"
        count={descriptions.length}
        action={{
          label: 'Add Description',
          onClick: handleCreate,
        }}
      />

      {descriptions.length === 0 ? (
        <EmptyState
          icon={documentIcon}
          title="No physical descriptions yet"
          description="Add descriptions to use for image generation prompts"
          variant="dashed"
          action={{
            label: 'Add Description',
            onClick: handleCreate,
          }}
        />
      ) : (
        <div className="space-y-3">
          {descriptions.map((description) => (
            <PhysicalDescriptionCard
              key={description.id}
              description={description}
              onEdit={handleEdit}
              onDelete={handleDelete}
              isDeleting={deletingId === description.id}
            />
          ))}
        </div>
      )}

      {showEditor && (
        <PhysicalDescriptionEditor
          entityType={entityType}
          entityId={entityId}
          description={editingDescription}
          onClose={handleEditorClose}
          onSave={handleEditorSave}
        />
      )}
    </div>
  )
}
